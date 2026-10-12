# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/VitoorFranca/spokemark/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/VitoorFranca/spokemark/releases/tag/v0.1.0
