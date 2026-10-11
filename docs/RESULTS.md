# Measured results

Environment: MacBook Air M4 (16 GB), macOS 26.6.2, Electron 44.7.0, whisper.cpp v1.9.5 with Metal. Every number below was measured on this machine; anything not measured is listed under *Not verified*.

All audio was played through the **real system output** (`afplay`, `say` or a browser) and captured by the Process Tap. Reference texts are synthetic macOS voices (`say`) and `jfk.wav`, real public-domain human speech from the whisper.cpp samples.

## 1. Capture

| Test | Result |
|---|---|
| `afplay` English speech, 10 s recorded to WAV | 48,000 Hz, 2 channels, interleaved float32, RMS 0.163 (−15.8 dBFS) |
| Video in Chrome (YouTube), 10 s | RMS 0.0565 (−25.0 dBFS) |
| Without the TCC permission | RMS 0 (digital zeros); `silent-since-start` emitted |
| Playback stays audible while capturing | confirmed by the user |
| Permission prompt in the packaged app | shown; the user clicked "Allow" |
| Capture → main clock | ~32 ms (p50 and p95), the tap's delivery latency |

## 2. Transcription (headless harness `dist/cli/transcribe.js`, same modules as the app)

Latency here is from the capture of a word's last sample to the result arriving in main (no rendering).

| Test | base.en | small.en |
|---|---|---|
| 75-word reference with a 5 s pause: WER | 0 % | 1.3 % (1 deletion) |
| Inference p50 / p95 | 179 / 243 ms | 338 / 423 ms |
| First appearance of a word, p50 / p95 | 527 / 1204 ms | 491 / 1187 ms |
| Confirmation (LocalAgreement), p50 / p95 | 946 / 1556 ms | 934 / 1493 ms |
| `jfk.wav` (real human speech): WER | 0 % | not measured |
| 45 s of silence | 0 words, 0 inferences | not measured |

With timestamp-only dedup (the first version) the same reference had a WER of 5.3 %.

**After the end-of-utterance fix (final pipeline), base.en:** reference, 3 runs: WER 1.3 %, 0 %, 0 %; first appearance p50 392 / 481 / 565 ms, p95 1230 / 1133 / 1207 ms; confirmation p50 927–968 ms, p95 1413–1490 ms. `jfk.wav`: 0 %. 45 s of silence: 0 words, 0 inferences.

**Offline inference per model** (10 s window, median of 5, no playback): base.en-q5_1 149 ms, base.en 159 ms, small.en-q5_1 388 ms, small.en 430 ms. The portable release build (`GGML_NATIVE=OFF`, built on the GitHub runner) measured 160 ms for base.en.

## 3. Packaged app

Latency here is from the capture of a word's last sample to the **overlay painted** (the renderer acknowledges after `requestAnimationFrame`).

### 30-minute session, base.en (MVP UI, final pipeline)

Looping playlist: 6 passages, 5 voices, pauses of 1–10 s and 60 s of silence per loop; metrics sampled every minute (32 samples).

- **Latency on screen:** median of per-minute p50 446 ms, median of per-minute p95 1312 ms; worst minute p95 2104 ms.
- **WER:** 2.3 % over 2,750 words (per passage: 0.4 %, 2.1 %, 2.4 %, 7.2 % — British voice "Eddy" —, 3.2 % `jfk`, 0.5 %).
- **Silence:** 621 s of long pauses, 0 words.
- **Total memory** (app + overlay + worker + capture): 745 / 753 / 755 MB in the first 3 minutes, 676 / 666 / 666 MB in the last 3 — no growth; the worker uses ~260–300 MB.
- **Total CPU:** median 8.2 %, max 25 % (`ps` `%cpu`, a decaying average, plus `app.getAppMetrics()`).
- **Inferences:** 1,939; 2 steps dropped by backpressure. **After quit:** 0 helpers.

### 6-minute session, small.en (switched at runtime, no app restart)

Latency on screen p50 625 ms / p95 1522 ms; WER 3.8 % over 550 words; 124 s of silence, 0 words; total memory ~1.0 GB, stable; 0 helpers after quit.

### Lifecycle

| Test | Result |
|---|---|
| 10 Stop/Start cycles (SIGUSR1 = same function as the UI), run twice | 0 helpers after each Stop, 0 orphans, app process tree 308–375 MB, no growth |
| Quit | 0 app processes, 0 helpers |
| `kill -9` of the main process | helpers exit by themselves (stdin EOF): 0 left |
| Model switch with the app open | same app PID; worker restarted with the new model (base.en → base.en-q5_1 → small.en → small.en-q5_1 → base.en) |

## 4. Speaker changes (tinydiarize, `small.en-tdrz`)

| Test | Result |
|---|---|
| 3 synthetic dialogues (`say`, 2–3 voices, 0/300/800 ms gaps, 16 turns) | **0 turns detected**, also offline with the official `whisper-cli` — the model does not recognize turns in synthetic voices, so this test cannot evaluate it |
| Official Apollo 13 sample (NASA radio, real speech), offline `whisper-cli -tdrz` | 21 turns marked, as in the whisper.cpp README |
| Same audio played through the system, streaming, **without** transition context | 1–2 of the 21 offline turns (recall 5–10 %), 0 false |
| Streaming **with** 3 s of context (default for tdrz) | 2 runs: recall 52 % and 57 %, precision 73 % and 75 % (±2 words tolerance) |
| Monologues (3 passages) with tdrz + context | 0 false turns; WER 1.3 %, 2.4 %, 0 % (context did not duplicate words) |
| First-appearance latency, clean speech | p50 533–714 ms, p95 1.27–2.54 s (small.en without tdrz: 491 ms / 1.19 s) |
| First-appearance latency, Apollo 13 (noisy radio) | tdrz + context 1.42 s / 4.03 s; plain small.en on the same audio 1.03 s / 6.14 s |
| Packaged app | switch to `small.en-tdrz` without restart; worker runs with `--tdrz`; the overlay starts each speaker's line with "–" (screenshot checked) |

**Caveat:** the 21-turn reference is the **model's own offline output**, not human annotation. It measures how much of the offline behavior survives streaming, not absolute accuracy. A real call is the definitive test.

## 5. UI redesign (Spokemark) — before / after

Same machine, same harness (`scripts/e2e-session.sh`: looping playlist through the real system output, base.en), packaged apps: the **MVP build** (menu-only UI) vs. **Spokemark** (panel, main window, history, settings).

| Metric | MVP | Spokemark | Change |
|---|---|---|---|
| Latency to screen, p50 (10-min session) | 470 ms | 446 ms | −5 % |
| Latency to screen, p95 (10-min session) | 1344 ms | 1375 ms | +2 % |
| Latency to screen, p50 / p95 (5-min session) | 474 / 1302 ms | 464 / 1378 ms | −2 % / +6 % |
| WER (10-min, 1,100 words) | 2.6 % | 2.7 % | 1 word |
| Words produced in silence (249 s) | 0 | 0 | — |
| Memory while capturing, median (10-min) | 643 MB | 636 MB | −1 % |
| **Cumulative CPU time, all processes** (5-min session + teardown) | **61 s** | **58 s** | **−5 %** |
| Idle memory, panel closed, onboarding done | 376 MB (4 processes) | 382 MB (4 processes) | +2 % |
| Helpers left after quit | 0 | 0 | — |

All within the ±10 % budget. Notes:
- A first comparison based on `ps %cpu` (sampled once a minute, a decaying average) suggested higher CPU; per-process **cumulative** CPU time showed it was sampling noise (speech engine 29 s → 31 s at 1 s resolution, main process 26 s → 21 s).
- The release build of the speech engine is portable (`GGML_NATIVE=OFF`). A fixed offline workload (VAD over ~8 min of audio + 20 transcriptions) used the same CPU time with native, portable and `armv8.4-a+dotprod+fp16` builds (1.67–1.77 s).
- Keeping the panel always loaded would cost ~110 MB permanently; it is warmed on hover instead (see `DESIGN.md`).

| UI test | Result |
|---|---|
| Unit tests (vitest) | 41 passed |
| Playwright for Electron | 4 passed: onboarding with permission already granted; start/stop from the panel; preset in Settings restyles the overlay; **real capture → full-text search → `.srt` export** (plays audio) |
| Panel open-to-paint | hover-warmed p50 47 ms / p95 59 ms; cold p50 138 ms / p95 188 ms |

## Known limitations

- **Source app is a heuristic.** `audiotap` reports apps that have an *open audio output stream* (`kAudioProcessPropertyIsRunningOutput`), not the app that is actually audible. A browser keeps its stream open with a paused video, so a session can be attributed to "Google Chrome" while the speech came from another process (observed in our tests with `afplay`).

## Not verified

- **A real call** in Meet, Zoom or Discord.
- **Wired/Bluetooth headphones and switching the output device** while capturing (implemented; no hardware in the test sessions).
- **Permission denied, then granted** (requires changing System Settings by hand).
- **Overlay above full-screen apps and on other Spaces** (relies on the documented `type: 'panel'` behavior; not exercised interactively).
- **Multiple displays** (only one display available).
- **Click-through and drag/resize in edit mode with a real mouse.**
- **VoiceOver** walkthrough (ARIA roles and labels are in place).
- **`setContentProtection` during screen sharing** (per Electron docs, apps using ScreenCaptureKit capture the window anyway).
- **Developer ID signing and notarization** (the project has no Apple Developer account; release builds are ad-hoc signed).
