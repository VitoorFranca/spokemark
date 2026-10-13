# Claims on the landing page → source

Every product statement on `site/index.html` must appear here with the file (and line) that backs it. If a claim has no source, it doesn't go on the page. This version covers the v2 page (branch `landing-v2`, 2026-10-12).

Abbreviations: **R** = `README.md`, **RES** = `docs/RESULTS.md`, **DEC** = `docs/DECISIONS.md`, **DSN** = `docs/DESIGN.md`, **ST** = `src/shared/settings.ts`, **MM** = `src/main/models/ModelManager.ts`.

## Hero

| Claim | Source |
|---|---|
| Badge "Open source · 100% on-device" | `LICENSE` (MIT); R:8 ("100% on-device") |
| "Live captions for your Mac." | R:7 |
| "100% on-device." | R:8. Recognition: DEC:36–38 (whisper.cpp + Metal in a local helper). Translation: DEC:80 (Apple Translation, on-device). The only network call in the code is the model download (MM:92). |
| "Real-time captions for anything playing on macOS" | R:7, R:32 (global Process Tap of the system output) |
| "Free, open source, and processed on your Mac" | `LICENSE`; R:33 |
| v0.2.0 · Apple silicon · macOS 14.2+ | `package.json` version; `scripts/package.mjs:29` (arm64), `:49` (`LSMinimumSystemVersion: '14.2'`); R:55–56 |
| English speech | R:43 |
| Download for macOS → dmg of v0.2.0 | `gh release view v0.2.0`: `Spokemark-0.2.0-macos-arm64.dmg` |
| Caption text and timing | `docs/landing/demo-jfk.log`: a real run of `dist/cli/transcribe.js` on `tests/e2e/fixtures/jfk.wav`, base.en, WER 0 % |
| `jfk.wav` is public domain | RES:5 |
| Caption look: black at 60 %, 14 px radius, SF 500, 1.35 line height, 2 lines, provisional at 55 % | `src/shared/captionStyle.ts:8,21,40–41`; `src/renderer/shared/CaptionBox.tsx:14,103`; ST:31 |

## How it works

| Claim | Source |
|---|---|
| ~32 ms; CoreAudio process tap; playback stays audible | RES:16; DEC:7–9 |
| 0 words; Silero VAD gates the model; 621 s of silence produced nothing | DEC:44–47; RES:47 |
| 179 ms; whisper.cpp with Metal; window every 500 ms | RES:25 (base.en p50); DEC:36–38, DEC:50 |
| ~0.95 s; confirmed when two passes agree; confirmed text never changes | RES:27 (946 ms); DEC:56 |
| 0.45 s from speech to screen, median; painted above every app | RES:45 (446 ms); DEC:90 |

## The app

| Claim | Source |
|---|---|
| Menu bar panel; caption overlay that floats over full-screen apps; searchable history | R:31, R:34, R:35; `src/main/overlay/OverlayManager.ts:104,128`. Overlay over full-screen apps: **implemented, not verified interactively** (RES:134). |
| "These are screenshots, not mockups" | Captured from the running app with the test hooks (`src/main/main.ts:554`), an isolated `LC_DATA_DIR` and `language: en` (ST:18). The history is seeded with the real `jfk.wav` runs; session clock times are synthetic. |
| The Settings preview is the overlay's own component | DSN:36 |
| ⌥⌘C from anywhere | ST:21; R:75 |
| Full-text search; export to .txt, .srt, .md | R:34; `src/shared/appIpc.ts:90`; DEC:96 |
| Presets Standard, High contrast, Cinema; 2–3 lines, top or bottom | R:36; ST:9, ST:31–32 |
| Translation on-device with Apple Translation, macOS 26 | R:37; DEC:80 |
| History text only; deleted after 30 days by default, or off | R:34; ST:45–46 |
| Zoom, Meet, YouTube, podcasts: it hears the Mac's output | R:32. **Not tested in a real call** (RES:131); the page says so in Install. |

## Privacy

| Claim | Source |
|---|---|
| Your audio never leaves your Mac | R:8, R:33; DEC:10 (PCM helper → main over stdout); `src/main/native/ChildSupervisor.ts:45` (`stdio: pipe`); no network code besides MM:92 |
| Recognition on the GPU, in a helper process; audio never recorded or saved | DEC:36–38; R:33 |
| Transcripts text only, in the Library folder, 30 days by default, or off | `src/main/paths.ts:9`; `src/main/main.ts:403` (`history.sqlite`); ST:45–46 |
| The only network request in the code is the one-time model download, from Hugging Face, SHA-256 checked | MM:13–22, MM:92–114. A search of `src/` and `native/` for `fetch(`, `XMLHttpRequest`, `WebSocket`, `net.request`, `https.get` and `URLSession` finds only MM:92. `shell.openExternal` (`src/main/main.ts:284,325`) only opens System Settings. |
| `lsof` printed nothing in our test | RES:123 |

## Performance

| Claim | Source |
|---|---|
| 0.45 s from speech to screen, median | RES:45 (median of per-minute p50: 446 ms) |
| 2.3 % word error rate over 2,750 words | RES:46 |
| 0 words invented in 621 s of silence | RES:47 |
| 1.3 s, 95th percentile | RES:45 (median of per-minute p95: 1312 ms) |
| MacBook Air M4, 16 GB; Standard model (base.en); 30-minute session of real speech through the speakers | RES:3–5, RES:41–43; `src/shared/i18n.ts:209` (Standard = base.en) |

## Open source and download

| Claim | Source |
|---|---|
| MIT; no account, no trial, no paid tier | `LICENSE`; no licensing or payment code in `src/` |
| Name and logo not part of the license | `TRADEMARKS.md`; R:164 |
| Build commands | R:117–123 |
| 0.2.0, .dmg 144 MB, released 2026-10-12 | release assets (143,648,418 bytes); `publishedAt` |
| Apple silicon (M1 or later); macOS 14.2+; translation needs 26 | R:55–56; R:37 |
| Only System Audio Recording; no microphone or screen recording | R:69 |
| English | R:43 |
| Not notarized, no Developer ID | R:62; RES:139 |
| macOS 15+: Done → Privacy & Security → Open Anyway; macOS 14: right-click → Open | Apple, [Open a Mac app from an unknown developer](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac) |
| Not tested in a real call; captions the output, not the microphone | RES:131; R:69 |
| SHA256SUMS.txt | R:65; release asset |

## Footer

| Claim | Source |
|---|---|
| Built with whisper.cpp, Silero VAD, Electron and React | R:168–170 |
| No cookies or third-party requests on this page | `site/`: no `document.cookie`; every resource is local (fonts in `site/fonts/`); external URLs are links only |

## Contrast (WCAG 2.x, on `#000`)

| Token | Ratio |
|---|---|
| ink `#F5F7FB` | 19.6 |
| ink-2 `#9BA3B4` | 8.3 |
| ink-3 `#7C8498` (small meta text) | 5.6 |
| accent `#7AA7FF` | 8.8 |
| CTA text `#05070C` on `#F5F7FB` | 18.8 |
| White on the CTA icon `#1658FA` | 5.5 |

## Removed or reworded for lack of evidence

From v1:
- "about two minutes" to install.
- "0 open network connections" as a hero stat (it now cites RES:123).
- The comparison table about other products.
- Right-click → Open as the only first-launch path.

From the v2 drafts:
- A headline option "Nothing leaves the device." It overclaims, because the model download is a network request.
