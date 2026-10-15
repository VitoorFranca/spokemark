# Technical decisions

Each entry lists what was chosen, the alternatives that were discarded, and why. Everything was verified on the real environment: MacBook Air M4, macOS 26.6.2, Electron 44.7.0, whisper.cpp v1.9.5.

## Audio capture

**Chosen: a Swift helper (`native/audiotap`) using a CoreAudio Process Tap.** The tap is created with `AudioHardwareCreateProcessTap` and `CATapDescription(stereoGlobalTapButExcludeProcesses: [])`, `muteBehavior = .unmuted` and `isPrivate = true`, inside a private aggregate device with `kAudioAggregateDeviceTapAutoStartKey`. The API is available from macOS 14.2 (SDK headers, `AudioHardwareTapping.h`).
- It only needs the TCC permission "System Audio Recording" (`kTCCServiceAudioCapture`), which is narrower than Screen Recording.
- `muteBehavior = .unmuted` keeps normal playback audible.
- PCM goes from the helper straight to the main process over stdout and never passes through a renderer.

**Discarded: pure Electron (`setDisplayMediaRequestHandler` + `audio: 'loopback'`).** Tested in `scripts/spike-a/`:
- Without Screen Recording, `desktopCapturer.getSources()` rejects and `getDisplayMedia` fails with `AbortError: Invalid capture constraints`.
- With Screen Recording granted it worked: one "loopback" track at 48 kHz, RMS 0.18.
- Still discarded: it requires a screen video stream and the Screen Recording permission, audio goes through the renderer, and the audio constraints default to AEC/NS/AGC on.
- Since Electron 39, Chromium uses the same CoreAudio Tap underneath (`desktopCapturer` docs), so the helper uses the same API without that cost.

**Discarded: ScreenCaptureKit (`capturesAudio`).** Needs Screen Recording and adds nothing over the Process Tap on macOS 14.2+.

**Discarded: BlackHole and virtual drivers.** Out of scope by design; they also require changing the output device.

**Output device changes.** The helper listens to `kAudioHardwarePropertyDefaultSystemOutputDevice` and rebuilds the aggregate device. The tap is global, not tied to a device. Not verified with real hardware (see `RESULTS.md`).

**Protocol.** Binary frames with a 24-byte header (magic, type, seq, length, timestamp in ns) and three payload types: FORMAT (JSON), AUDIO (interleaved float32), STATUS (JSON). Logs go to stderr.
- Timestamps use `CLOCK_MONOTONIC_RAW` (= `mach_continuous_time`), the same clock as `process.hrtime.bigint()` on macOS.
- Measured: the first version used `CLOCK_UPTIME_RAW` and was ~52 h off — the machine's accumulated sleep time.

**Capture problems.**
- Permission denied: read-only preflight through the TCC SPI (`TCCAccessPreflight`). On "denied" the helper exits with code 3 and the app shows the permission state.
- Permission missing: the tap delivers digital zeros; 5 s of absolute silence from the start emits `silent-since-start`.
- Silent stream: `silent` / `audio-resumed`. Device changed: `device-changed`.
- Helper exit: restarted with exponential backoff, up to 5 times per minute.

## Transcription

**Chosen: a C++ helper process (`native/whisper-worker`) statically linking `libwhisper` with Metal (`GGML_METAL_EMBED_LIBRARY`).** The model is loaded and warmed up once. Requests arrive as binary frames on stdin; responses are JSON lines with segments, tokens, `p`, `no_speech_prob` and mean logprob.
- Isolates crashes and Metal from the Electron process; no ABI issues.
- `ggml_metal_device_init: GPU name: MTL0 (Apple M4)` in the log confirms Metal.

**Discarded: `whisper-stream`** — per the current code (`examples/stream`) it captures the microphone through SDL and does not accept PCM on stdin.
**Discarded: the Node addon (`examples/addon.node`)** — an example rather than a maintained package; it would need rebuilding against Electron's ABI and would put Metal in the main process.
**Discarded: `whisper-server`** — HTTP plus WAV encoding for every window; only worth it if the options above failed.

**VAD: Silero, built into whisper.cpp** (`whisper_vad_detect_speech_no_reset` / `whisper_vad_probs`, model `ggml-silero-v6.2.0`).
- Runs on the CPU on its own thread in the worker, so it keeps up while an inference is running.
- Hysteresis: 0.5 to enter speech, 0.35 to leave it, 600 ms of silence to end an utterance.
- Discarded: an energy threshold (not robust) and Silero through onnxruntime (extra dependency).

**Streaming.**
- One inference every 500 ms, at most one in flight; if the worker is busy the step is dropped (`skippedBusy`).
- Window 1–15 s; beyond 8 s it is trimmed at the last confirmed word.
- A window only exists if the VAD detected speech; during silence the buffer start moves forward.
- Fixed ring buffer: 60 s at 16 kHz.
- Whisper does not stream tokens: latency = step + inference + agreement between two hypotheses.

**Confirmation: LocalAgreement-2.** The common prefix of two consecutive hypotheses is confirmed; confirmed text never changes.
- Alignment with already-confirmed text is done **by text** (the last 2–4 confirmed words are searched for in the new hypothesis).
- Word timestamps are only a fallback: whisper.cpp token timestamps are coarse. With time-only dedup the reference lost "team finished … version" (WER 5.3%, 4 deletions in 75 words); with text alignment, 0%.
- DTW discarded: whisper.cpp disables it with flash attention (`dtw_token_timestamps is not supported with flash_attn`).

**End of utterance.** An utterance is complete when the VAD has declared end of speech (after 600 ms of silence) and that end lies inside the transcribed window. The first version also required the VAD to have processed exactly up to the window end; since the VAD works in 256 ms chunks that was almost never true, so the same speech was re-transcribed during pauses. Found by a unit test.

**Anti-hallucination.**
- Nothing is transcribed without VAD speech.
- Segments dropped with `no_speech_prob > 0.6` and mean logprob < −1, or mean logprob < −1.5.
- Typical silence phrases ("Thank you.", "Thanks for watching", …) dropped when < 50% of their frames are speech.
- Bracketed tokens ("[BLANK_AUDIO]", "(music)") removed; `suppress_nst` on.
- Loops of 1–4-grams repeated ≥ 3 times collapsed.
- A single isolated word with p < 0.6 dropped (measured: applause at the end of `jfk.wav` produced "Great." / "free." with p ≈ 0.55).
- `no_context = true`; prompting with previous text off (`usePrompt: false`); no temperature fallback (bounded latency).

**Speaker changes: tinydiarize** (`small.en-tdrz`, `tdrz_enable`, `whisper_full_get_segment_speaker_turn_next`).
- The turn is a pseudo-token that goes through LocalAgreement (counts only once confirmed) and starts a new line with "–".
- Marks the change only; does not identify who is speaking.
- **Transition context:** after a pause, the next window re-sends the last 3 s of the previous utterance (`turnContextS`) so the model sees both voices; repeated words are removed by text alignment. Apollo 13 audio: 1–2 of 21 turns without context, 11–12 with it; cost ≈ +0.4 s p50 first appearance.
- Discarded: speaker-embedding diarization (WeSpeaker/3D-Speaker via ONNX) — new native dependency, uncertain real-time quality.

## Translation

**Chosen: Apple's Translation framework in a Swift helper (`native/translator`)**, `TranslationSession(installedSource:target:)` (macOS 26+, no SwiftUI needed). On-device, free, no network, uses the language packs installed in System Settings; weak-linked so the app still runs on macOS 14.2 (translation is then shown as unavailable).
- Discarded: Whisper's `translate` task (only into English); local MT models (NLLB/Marian via ONNX — large downloads and a new runtime); any cloud API (breaks the "nothing leaves the Mac" promise).
- The visible caption (confirmed + provisional) is translated with one request in flight, latest-wins and a bounded cache (`LiveTranslator`).

**Source app icon:** `NSWorkspace.icon(forFile:)` in `audiotap` (64 px PNG). Discarded: Electron `app.getFileIcon`, which returned a generic placeholder for apps on macOS 26.

**Reference product:** these features were requested after a commercial app ("Subtitles Live"). Its source is published under the FSL-1.1 (no competing use), so nothing was copied or read from it; the implementation is independent.

## Brand alignment (October 2026)

**Chosen: one identity for the website and the app.**
- Near-black warm surfaces, Manrope, pill buttons, ember for live states, and the website's sound-wave shader on selected app surfaces.
- Dark is the default appearance, with Light and System in Settings.
- Vibrancy was removed in favour of solid surfaces.

**Discarded: keeping the navy and cyan vibrant UI.** It read as a different product next to the site.

**Wave shader:**
- A TypeScript copy of `site/js/waves.js` (`src/renderer/shared/waves.ts`), because the site has no build step; the two copies must change together.
- The app copy adds a transparent mode (black becomes alpha) and a frame cap.

## App

- **Overlay:** `BrowserWindow` with `type: 'panel'` (documented to "float on top of full-screened apps" and "appear on all spaces"), plus `setAlwaysOnTop(true, 'screen-saver')` and `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`. Click-through: `setIgnoreMouseEvents(true)`.
- **Resizing in edit mode:** a renderer handle sends the new size over zod-validated IPC. Discarded: native `resizable: true` — Electron docs: "Transparent windows are not resizable".
- **Hide from screen sharing:** `setContentProtection`, optional and off by default (apps using ScreenCaptureKit capture the window anyway, per Electron docs).
- **Build:** esbuild for main/preload (the sandboxed preload must be one bundle with zod), Vite + React + Tailwind v4 for renderers. Discarded: electron-vite / electron-forge (more dependencies).
- **Packaging:** `@electron/packager`, ad-hoc signing via `codesign`, optional Developer ID + notarization in CI. Discarded: electron-builder (much larger).
- **IPC:** zod on both ends — main validates renderer requests, preloads validate main messages.
- **History:** `node:sqlite` with FTS5 (built into Electron 44's Node 24). Discarded: `better-sqlite3` (native addon to rebuild for Electron) and JSON with linear search (doesn't scale).

## Dependencies

- **Runtime (bundled):** `react`, `react-dom`, `zod`, `lucide-react`.
- **Dev:** `electron`, `vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite`, `typescript`, `esbuild`, `vitest`, `@playwright/test`, `@electron/packager`, `@types/*`.
- **Native (no N-API addons):** whisper.cpp v1.9.5 built from source in `vendor/`; CoreAudio/AudioToolbox/AppKit (system); `cmake` (build only); `potrace` (only to regenerate brand SVGs).
