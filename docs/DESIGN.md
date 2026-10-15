# Design decisions

What was chosen, what was discarded, and why. Measurements: MacBook Air M4, macOS 26.6.2.

## Product structure

- **The menu bar panel is the primary surface.** It covers daily use: start/stop, what is being captured, and the essential controls. Reading (large transcript, history) lives in the main window; configuration in Settings. Discarded: a native tray menu only — it can't show state, a preview or actionable errors.
- **One primary action per screen.** In the panel it is Start/Stop, unless a card (missing or broken model) holds the action that unblocks the user; then the big button becomes neutral and disabled. In Settings → Transcription, "Use" is a secondary button.
- **Errors say what happened and what to do.** Failures are classified as `model`, `capture` or `unknown`, each with a localized message and an action ("Download again" deletes and re-downloads a model that failed to load). The technical message only appears in the tooltip and logs.
- **No placeholders.** No "coming soon", no dead controls: search and "Delete…" disappear while history is empty; the spoken language is shown as information ("English"), not as a one-option picker.

## Native feel

- **Solid surfaces (since the brand alignment, October 2026):** every window paints `--bg` (`#080808` dark, `#F6F6F7` light), and the native `backgroundColor` matches, so there is no white flash. Sidebar and toolbar are `--surface` with a hairline border. Discarded: keeping macOS vibrancy. It made the app look like a different product from the website, and translucent surfaces made screenshots unpredictable.
- **Traffic lights:** `titleBarStyle: 'hiddenInset'` with `trafficLightPosition` aligned to the content; toolbars and headers are `-webkit-app-region: drag`, their controls `no-drag`.
- **Interface behavior:** no text selection in UI chrome (only transcripts are selectable), no hand cursor, focus ring for keyboard only. Programmatic focus uses `focusVisible: false`; each onboarding step heading receives focus for VoiceOver without a ring.
- **Full app menu** with standard shortcuts: ⌘, (Settings), ⌘W, ⌘Q, ⌘F (history search), ⌘0 (main window).
- **Appearance:** Settings › General offers Dark (default), Light or System, applied as `nativeTheme.themeSource`. Dark is the default because it is the brand's main look (website and app).
- **Theme plumbing:** Chromium's `prefers-color-scheme` does **not** follow `nativeTheme.themeSource` in these renderers (measured with Playwright: main reported `shouldUseDarkColors: true`, the renderer `matches: false`). The main process is the source of truth: it sends `dark` in the state, renderers apply `data-theme` on `<html>`, and the first frame is right because the preload reads the theme synchronously once.

## Panel lifecycle

Measured open-to-paint (12 opens each):

| Strategy | p50 | p95 | Memory cost |
|---|---|---|---|
| Always preloaded | 42 ms | 61 ms | ~100–117 MB renderer, permanently (idle 376 → 503 MB) |
| Created on click | 138–153 ms | 188–190 ms | none while closed |
| **Chosen: warmed on hover**, destroyed 60 s after closing | **47 ms** | **59 ms** | none while closed |

The panel is created on the menu bar icon's `mouse-enter`, so it is ready by the time of the click. Reopening within 60 s: 43 ms. Without hover (e.g., via shortcut): p50 138 ms.

**Keyboard:** focus goes to the main control on open; Tab reaches everything; the `⋯` menu uses arrow keys; Esc closes. **Level meter:** shown and moving only while capturing, fed by an RMS computed in main at ~15 Hz and sent only to visible windows.

## Settings

- **Live preview:** the same component (`CaptionBox`) and style function (`captionCss`) as the overlay, so the preview is exactly what the overlay renders. The sample animation **plays once** and replays only when the style changes. Discarded: a continuous loop (violates "no looping animation").
- **Presets:** Standard, High contrast (weight 700, 92% background), Cinema (no box, outlined text). A preset sets font, size and background; each value stays adjustable.
- **Models:** relative speed measured offline (median of 5 inferences on a 10 s window): base-q5 149 ms, base 159 ms, small-q5 388 ms, small 430 ms. Our clean-speech tests did not separate the models' accuracy, so relative accuracy follows model size (Whisper paper) and **no WER number is shown in the UI**.
- **Configurable shortcuts:** a key recorder that requires ⌘, ⌃ or ⌥; if registration fails (shortcut in use) the field turns red with an explanation.

## History

- **Writes:** only **confirmed** words, grouped into segments (pause, speaker change, 32 words or 12 s) and written **in batches every 2 s** in one transaction. Sessions without words are not saved.
- **Search:** each term becomes a quoted prefix (safe against FTS syntax); results show a snippet with the match highlighted.
- **Source app:** `audiotap` lists processes with `kAudioProcessPropertyIsRunningOutput` and walks up to the "regular" parent app (Chrome's audio service → "Google Chrome"); a session keeps the most frequent one.

## Overlay header, translation and waves

- **Header:** app icon + name above the captions, like system notifications; optional (Settings › Captions).
- **Translation:** smaller (0.86×) and dimmer line(s) below the original, so the original stays primary; "translation only" swaps them.
- **Waves:** a canvas behind the text near the bottom edge, four soft colored sine waves whose amplitude follows the audio level. This replaces the earlier "no looping animation" rule for this element on request: the animation runs only while there is sound, settles into a still frame in silence, and is disabled with Reduce Motion. Cost: ≈ +1.7 % of one core while speech plays.

## Overlay

Behavior unchanged from the MVP (click-through, `type: 'panel'`, all Spaces, full screen); styles from the presets. Edit mode shows a subtle frame, a corner handle and the hint "Drag to move · Esc to finish"; the window takes focus only in this mode so Esc works. The overlay intentionally does **not** use brand colors: white on black is the most legible.

## Visual verification

- Screenshots use `screencapture -l <CGWindowID>` (id from `getMediaSourceId()`) instead of `webContents.capturePage`, which only captures web content and leaves vibrant areas transparent.
- Non-happy states are **real**, not mocked: model missing (empty models folder), downloading (a real download), error (an invalid model file). The *permission denied* card was not captured: it would require revoking the user's real permission.

## Identity

The app follows the website's identity (v4): near-black warm surfaces, Manrope, pill buttons, ember for "live", and the sound-wave landscape. See [`BRAND.md`](BRAND.md) for the palette, components and wave rules.
- Waves: the onboarding welcome, the panel header while listening, the empty Live view, the caption preview and About. They animate only with sound (or on the welcome screen), at 30 fps, and become still frames under Reduce Motion, software GL or a slow GPU.
- Discarded: WebGL waves in the overlay. It already has 2D waves at +1.7 % of one core, recoloured to the same palette, and the overlay is on screen for hours.
- Discarded: animated waves in the panel during silence. They cost +15 % of a GPU core at 60 fps and 2× DPR; see RESULTS.md.
- Discarded (earlier): an animated or pulsing glow on the main button. The glow while listening is static (now ember).
