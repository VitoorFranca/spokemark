# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Real-time captions for any audio the Mac plays (CoreAudio Process Tap), recognized on-device with whisper.cpp on Metal, gated by Silero VAD.
- Always-on-top caption overlay (click-through, edit mode, presets, per-display position).
- Menu bar panel with start/stop, level meter, live preview and actionable error states.
- Main window with live transcript and searchable history (SQLite FTS5), export to `.txt`, `.srt`, `.md`.
- Settings (general, captions with live preview, transcription models, privacy, about) and first-run onboarding.
- Experimental speaker-change marks (tinydiarize model).
- English and Portuguese (Brazil) interface.
- Release workflow producing `.dmg`/`.zip` and SHA-256 checksums.
