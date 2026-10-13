# Claims on the landing page → source

Every product statement on `site/index.html` must appear here with the file (and line) that backs it. If a claim has no source, it doesn't go on the page. Line numbers are as of commit `0ee39ef`+ (2026-10-12).

Abbreviations: **R** = `README.md`, **RES** = `docs/RESULTS.md`, **DEC** = `docs/DECISIONS.md`, **DSN** = `docs/DESIGN.md`, **ST** = `src/shared/settings.ts`, **MM** = `src/main/models/ModelManager.ts`.

## Hero

| Claim | Source |
|---|---|
| Captions for everything the Mac plays (calls, videos, podcasts) | R:7–8, R:32 (global Process Tap, any app) |
| The audio never leaves the Mac | R:8, R:33; DEC:10 (PCM goes helper → main over stdout); `src/main/native/ChildSupervisor.ts:45` (helpers on local pipes); the only network call is MM:92 (models) |
| Whisper model on the Mac's GPU | DEC:36–38 (whisper.cpp + Metal) |
| Free and open source, no account | `LICENSE` (MIT); R:8 |
| Recognizes English speech | R:43 |
| v0.2.0 · Apple silicon · macOS 14.2 or later | `package.json` version; `scripts/package.mjs:29` (arm64), `:49` (`LSMinimumSystemVersion: '14.2'`); R:55–56 |
| Not notarized | R:62; RES:139 |
| Download link = dmg of the latest release | `gh release view v0.2.0`: `Spokemark-0.2.0-macos-arm64.dmg`, 143,648,418 bytes (shown as 144 MB) |

## Live caption demo

| Claim | Source |
|---|---|
| Text, order of passes, provisional tails, inference times, utterance ends | `docs/landing/demo-jfk.log`: the run of `dist/cli/transcribe.js` on `tests/e2e/fixtures/jfk.wav`, base.en, Metal, WER 0 % (2026-10-11). The page replays the 20 updates at their logged times. |
| `jfk.wav` is a public-domain recording | RES:5 |
| Played through a Mac's speakers | `scripts/e2e-transcribe.sh:10` (`afplay`) |
| Dim words are provisional and can change; confirmed text doesn't | R:97; DEC:56 |
| Caption look: font stack, weight 500, line height 1.35, 14 px radius, box `rgba(9,9,13,.6)`, provisional at 55 % opacity, 2 lines | `src/shared/captionStyle.ts:8,21,40–41`; `src/renderer/shared/CaptionBox.tsx:14,103`; ST:31 (default 2 lines) |
| "Standard model" = base.en | `src/shared/i18n.ts:209` |

## How it works

| Claim | Source |
|---|---|
| CoreAudio process tap, playback stays audible, no virtual driver | DEC:7–9, DEC:20 |
| ~32 ms tap → app | RES:16 |
| Silero VAD gates the model; 16 kHz | DEC:44–47; R:88–89 |
| 0 words in 621 s of silence | RES:47 |
| whisper.cpp on the GPU (Metal) in its own process; window every 500 ms | DEC:36–38, DEC:50 |
| 179 ms per pass, p50 (base.en) | RES:25 |
| Confirmed when two passes agree; confirmed text never changes | DEC:56 |
| ~0.95 s to confirm, p50 | RES:27 (946 ms) |
| 0.45 s speech → screen, p50 | RES:45 (446 ms) |
| Latency = step + inference + agreement | DEC:54 |

## Features

| Claim | Source |
|---|---|
| Stays above full-screen apps and on every Space; click-through; drag and resize in edit mode | R:31; `src/main/overlay/OverlayManager.ts:104,128–129,172`; DEC:90–91. **Not verified interactively**: RES:134, RES:136. |
| Any app: Zoom, Meet, Teams, YouTube, podcasts; nothing to install; no bot | R:32 (Process Tap of the system output) |
| Presets Standard / High contrast / Cinema; font, size, background, 2–3 lines, top or bottom, live preview | R:36; ST:9, ST:28–32; DSN:36–37 |
| Live translation under the original or alone, Apple Translation on-device, installed languages, macOS 26 | R:37; DEC:80; ST:37–40 |
| Speaker changes, experimental, Enhanced · speakers model, doesn't identify who | R:39; DEC:72–76; `src/shared/i18n.ts:213` |
| Sessions kept as text, never audio; full-text search; export .txt/.srt/.md | R:34; `src/shared/appIpc.ts:90`; DEC:96 |
| Deleted after 30 days by default; keep longer, delete a range, turn off | ST:45–46; `src/main/store/TranscriptStore.ts:224` (`deleteRange`) |
| Menu bar panel: start, stop, fix problems | R:35; DSN:7 |
| Shortcuts ⌥⌘C, ⌥⌘O, ⌥⌘E | ST:21–23; R:75–77 |
| Settings screenshot: preview uses the same component as the overlay | DSN:36 |
| Screenshots are of the real app, English UI | captured with `tests/ui/screenshots.mjs`-style hooks (`src/main/main.ts:554`), `LC_DATA_DIR` isolated, `language: en` (ST:18); history seeded from the real `jfk.wav` runs (session clock times are synthetic) |

## Privacy

| Claim | Source |
|---|---|
| Audio: tap → speech engine in memory over local pipes, never recorded or saved | R:33; DEC:10; `src/main/native/ChildSupervisor.ts:45` (`stdio: pipe`) |
| Recognition in a helper process | DEC:36–38 |
| Translation on-device with System Settings language packs | DEC:80 |
| Transcripts: text only in `~/Library/Application Support/Spokemark/history.sqlite`; 30 days default or off | `src/main/paths.ts:9`; `src/main/main.ts:403`; ST:45–46; R:34 |
| Models from huggingface.co at pinned revisions, SHA-256 checked | MM:13–22, MM:94–114 |
| That's the only request in the app's code: no account, analytics or update check | a search of `src/` and `native/` for `fetch(`, `XMLHttpRequest`, `WebSocket`, `net.request`, `https.get`, `URLSession` finds only MM:92. `shell.openExternal` (`src/main/main.ts:284,325`) only opens System Settings. |
| `lsof` check printed nothing with captions and translation on | RES:123 |

## Performance

| Claim | Source |
|---|---|
| MacBook Air M4, 16 GB, macOS 26.6.2; real audio through the system output | RES:3–5 |
| Latency = word's last sample → overlay painted | RES:39 |
| Standard: 0.45 / 1.3 s p50/p95, 30-min session | RES:45 (446 / 1312 ms) |
| Enhanced: 0.63 / 1.5 s, 6-min session | RES:54 (625 / 1522 ms) |
| WER 2.3 % (2,750 words) / 3.8 % (550 words) | RES:46, RES:54 |
| 0 words in 621 s / 124 s of silence | RES:47, RES:54 |
| Memory 666–755 MB, no growth / ~1.0 GB stable | RES:48, RES:54 |
| CPU 8.2 % median (sampled every minute); small.en not measured | RES:49 (`ps %cpu`, see the caveat at RES:97) |
| Model download 148 MB / 488 MB | MM:17, MM:19 (`bytes`) |
| Not verified: real call, Bluetooth headphones, multiple displays | RES:131–135 |

## Open source

| Claim | Source |
|---|---|
| App, capture helper and speech worker in one MIT repository | `LICENSE`; R:146–147 |
| Name and logo not covered; forks need their own | `TRADEMARKS.md`; R:164 |
| Pipeline changes come with measured results | `CONTRIBUTING.md:34` |
| Build commands | R:117–123 |
| Needs Xcode command-line tools, Node 24, Apple silicon | `CONTRIBUTING.md:13` |

## Install

| Claim | Source |
|---|---|
| Spokemark 0.2.0, released 2026-10-12 | `gh release view v0.2.0` (`publishedAt`); `CHANGELOG.md` |
| .dmg 144 MB, .zip 131 MB, SHA256SUMS.txt | release assets (143,648,418 and 130,581,500 bytes) |
| Apple silicon (M1 or later); macOS 14.2+; translation needs 26 | R:55–56; R:37 |
| English speech | R:43 |
| Only System Audio Recording; no microphone or screen recording | R:69 |
| ~150 MB model on first launch | R:57; MM:17 |
| `shasum -a 256 -c SHA256SUMS.txt` | R:65 |
| Not notarized; the project has no Developer ID | R:62 |
| macOS 15+: Done → System Settings › Privacy & Security › Open Anyway; macOS 14: right-click → Open | R:62 (both paths); Apple: [Open a Mac app from an unknown developer](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac) (Privacy & Security › Open Anyway); the Control-click bypass was removed in macOS 15 |
| Setup asks for System Audio Recording, then downloads the model | R:63 |
| Interface in English and Portuguese (Brazil) | R:43; ST:18 |
| Not tested in a real call | RES:131 |
| Doesn't caption your own voice (output, not microphone) | R:69 |
| Free, no trial, no account, no paid version | `LICENSE`; there is no licensing or payment code in `src/` |

## Footer

| Claim | Source |
|---|---|
| Built with whisper.cpp, OpenAI Whisper models, Silero VAD, Electron, React | R:168–170 |
| The page sets no cookies and loads nothing from other sites | `site/`: no `document.cookie`, no external `src`/`href` for resources (only outbound links); fonts self-hosted in `site/fonts/` |

## Contrast (WCAG 2.x)

| Pair | Ratio |
|---|---|
| Light: ink `#0B1022` / bg `#F4F5F8` | 17.3 |
| Light: ink-2 `#4A5470` / bg | 6.9 |
| Light: white / accent `#1658FA` (CTA) | 5.5 |
| Light: accent / bg (focus ring) | 5.1 |
| Dark: ink `#EAF0FB` / bg `#0A0F1F` | 16.7 |
| Dark: ink-2 `#9AA7C2` / bg | 7.9 |
| Dark: navy / accent `#18D2FD` (CTA) | 10.6 |
| Stage: provisional (55 % white) on the caption box | 5.9 |
| Stage: spoken word `#18D2FD` on the caption box | 11.1 |
| Stage: meta `#8C97B3` on `#0A0F1F` | 6.5 |

## Removed or reworded for lack of evidence

- "about two minutes" to install: not measured. Removed.
- "0 open network connections" in the hero stats was based on a session check that wasn't in the repo. Moved to Privacy and recorded in RES:123.
- "Every line points at code": the page doesn't link each line. It now points to this file.
- The comparison table ("Cloud meeting note-takers", "paid caption apps") made claims about other products without sources. Removed.
- Right-click → Open as the only first-launch path is wrong on macOS 15+. Both paths are now given.
