# Contributing to Spokemark

Thanks for helping! Bug reports, ideas, documentation fixes and pull requests are all welcome.

## Before you start

- For anything bigger than a small fix, **open an issue first** so we can agree on the approach.
- Be kind and constructive — this project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
- Security problems: please don't open a public issue; see [SECURITY.md](SECURITY.md).

## Development setup

Requirements: Apple Silicon Mac, macOS 14.2+, Node.js 24, Xcode Command Line Tools, `brew install cmake`.

```bash
npm install
npm run build:native   # Swift capture helper + whisper.cpp worker (Metal)
npm run models         # default speech model + VAD
npm run dev
```

During development the *System Audio Recording* permission is attributed to your terminal app. If no prompt appears, add the terminal under System Settings → Privacy & Security → Screen & System Audio Recording → *System Audio Recording Only*.

## Checks

Run these before opening a pull request:

```bash
npm run typecheck
npm test               # unit tests
npm run test:ui        # Playwright UI tests (opens the app)
```

Changes to the audio/transcription pipeline (`native/`, `src/main/audio`, `src/main/asr`) should also be checked with the end-to-end harnesses that play real audio through the speakers (`scripts/e2e-transcribe.sh`, `scripts/e2e-session.sh`) and the results compared with [`docs/RESULTS.md`](docs/RESULTS.md). Please include the numbers in your PR.

UI changes: regenerate screenshots with `node tests/ui/screenshots.mjs` and review them in light **and** dark mode.

## Guidelines

- **Keep it local.** No feature may send audio or transcripts off the device.
- **TypeScript strict**, no `any` escapes without a reason. Validate everything that crosses IPC with zod.
- **Match the surrounding code**: naming, comment density, small focused modules.
- **User-facing text** goes through `src/shared/i18n.ts` with both English and Portuguese (Brazil) strings.
- **Design**: use the tokens in `src/renderer/shared/tokens.css` and the shared components; check contrast (WCAG AA) for any new color.
- **Decisions**: if you choose between real alternatives, add a short entry to [`docs/DECISIONS.md`](docs/DECISIONS.md).
- **Brand assets** (name, logo, icons) are not MIT-licensed — see [TRADEMARKS.md](TRADEMARKS.md). Forks must use their own name and logo.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/) style prefixes (`feat:`, `fix:`, `docs:`, `perf:`, `test:`, `ci:`, `chore:`), written in the imperative.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
