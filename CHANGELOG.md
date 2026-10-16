# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.4.0] - 2026-10-15

### Added
- **Three recognition engines** (Settings › Transcription › Recognition engine): **Parakeet** (NVIDIA Nemotron Speech Streaming on the Neural Engine, 626 MB, the new default), **Apple** (macOS 26's on-device speech recognition; macOS installs its model) and **Whisper** (as before). In our comparison Parakeet had the fewest errors (0.4 % vs 2.6 % Whisper, 3.5 % Apple), settled words fastest and used no GPU. Existing installs keep Whisper until you switch.

### Changed
- **Live translation keeps up.** It now translates the transcript sentence by sentence instead of re-translating the lines on screen: a finished sentence is translated once and shows up about 0.3 s later (before: often 2–3.5 s, and long sentences that scrolled off were never shown whole). Only the sentence in progress is updated while it grows.
- **Speaker changes work with every speech model.** A separate speaker model (NVIDIA Nemotron 3 Diarization, 199 MB, downloaded from Settings › Transcription) listens to the same audio and tells voices apart on the Neural Engine; each confirmed word goes to the voice heard over it, and a new line with a dash starts when the voice changes. On test dialogues it found every change at the right word, where the previous model found none. Captions appear on screen as fast as before; confirmed words settle about 0.1 s later. Nothing about voices is saved: speakers are told apart only within a session. The *Enhanced · speakers* model keeps working as before when the speaker model isn't installed.
- **Translation under each speaker.** With speaker changes and "original + translation", each speaker's line is followed right away by its translation, instead of all translations in a block below.

## [0.3.0] - 2026-10-15

### Fixed
- **Settings reset each other**: changing one setting put every other setting back to its default (a partial update filled in all defaults). Each change now only touches its own setting.
- **Translation with speaker changes**: each speaker is translated separately and shown on its own line with a dash, matching the original, instead of one run-on line.

### Changed
- **Stop and Pause.** Stop ends the session and hides the captions. Pause stops listening but keeps the last captions on screen; Resume continues the same session. Both are in the menu bar panel and the main window; ⌥⌘C still starts (or resumes) and stops.
- **New look, shared with the website.** Near-black warm surfaces, the Manrope typeface, pill buttons, ember for live states, and solid windows instead of translucent vibrancy.
- **Sound waves.** The website's sound-wave landscape appears on the welcome screen, behind the panel header while listening (it follows the real audio level), in the empty Live view, behind the caption preview and in About. The overlay waves use the same palette.
- **Speaker changes are a setting of their own** (Settings › Transcription), no longer tied to picking a model. The app explains that only some models support it (today *Enhanced · speakers*), offers to switch or download it, and the panel shows a hint when the current model can't. People who already used the speakers model keep it on.
- **Appearance setting.** Settings › General › Appearance: Dark (new default), Light or System.

## [0.2.0] - 2026-10-12

### Added
- **Live translation**, on-device with Apple's Translation framework (macOS 26+): show the original with the translation below, or the translation only. Settings › Translation and a panel toggle. Nothing is sent to the internet; languages are the ones installed in System Settings.
- **Source app header**: the overlay shows the icon and name of the app that is playing (a heuristic: the app that started playing most recently).
- **Audio-reactive waves** behind the captions; they stay still in silence and with Reduce Motion. Can be turned off.

## [0.1.1] - 2026-10-12

### Fixed
- Closing the onboarding window after granting permission and downloading the model no longer brings it back on the next launch.

### Changed
- Permanent bundle identifier `app.spokemark.desktop` (was `dev.local.livecaptions`). macOS asks for the *System Audio Recording* permission again once after updating from 0.1.0.

## [0.1.0] - 2026-10-11

First public release. Unsigned (ad-hoc) build for Apple Silicon, macOS 14.2+.

### Added
- Real-time captions for any audio the Mac plays (CoreAudio Process Tap), recognized on-device with whisper.cpp on Metal, gated by Silero VAD.
- Always-on-top caption overlay (click-through, edit mode, presets, per-display position).
- Menu bar panel with start/stop, level meter, live preview and actionable error states.
- Main window with live transcript and searchable history (SQLite FTS5), export to `.txt`, `.srt`, `.md`.
- Settings (general, captions with live preview, transcription models, privacy, about) and first-run onboarding.
- Experimental speaker-change marks (tinydiarize model).
- English and Portuguese (Brazil) interface.
- Release workflow producing `.dmg`/`.zip` and SHA-256 checksums.

[Unreleased]: https://github.com/VitoorFranca/spokemark/compare/v0.4.0...HEAD
[0.1.1]: https://github.com/VitoorFranca/spokemark/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/VitoorFranca/spokemark/releases/tag/v0.1.0
