# Landing page

`site/` is the project's landing page: static HTML + CSS, no build step, no third-party scripts, fonts, cookies or analytics. `.github/workflows/pages.yml` publishes it to GitHub Pages.

Preview locally: `cd site && python3 -m http.server 8765` → http://localhost:8765.

## Reference and what we did differently

The structure was benchmarked against a commercial competitor's landing page (Subtitles Live, reviewed 2026-10-12). Only the public page was analysed; no code or assets were copied. Weak points found there, and how this page answers them:

| Weak point in the reference | Our page |
|---|---|
| "Nothing leaves your Mac", while the same page describes license checks, a version check and a 633 MB model download. | Says exactly which network request exists (model download from Hugging Face, pinned and SHA-256-verified) and that there is no telemetry or update ping. |
| Privacy is a promise; no way to check it. | "Verify it yourself": a one-line `lsof` command, plus "build it from source". Our own run showed zero sockets with captions and translation on. |
| Inconsistent claims (license check "from time to time" vs "about once a month"; "nothing written to disk" vs a downloaded model). | One statement per fact, each traceable to code or `docs/RESULTS.md`. |
| Performance numbers without method (RTF 0.15 in one place, 0.31 / 0.6–2.2 elsewhere). | Four measured numbers (latency, WER, hallucinations in silence, sockets) with machine, model and a link to methodology and "what we haven't verified". |
| Requirements hidden in the FAQ (translation needs a newer macOS). | Requirements under the main CTA; a `macOS 26` badge on the translation card. |
| Trial limits unexplained; promo dates without a year. | Free, no trial, no license key. No dates that age. |
| "Source-available" (FSL) shown without explanation. | MIT, explained in plain words: use, change, ship, sell; forks welcome with their own name (brand policy linked). |
| No path for building or contributing. | Build-from-source block, contribution links, and an "Honest status" list of what is done and what is not yet. |
| 13,269 px page, 9 purchase CTAs, cross-promos for unrelated apps. | 8,499 px at 1280 px wide; two CTAs (download, source) repeated only at the end; nothing unrelated. |
| Mocked interactive demo (926 DOM nodes). | Real screenshots of the app, labelled as such ("background added"). |
| 4 buttons without an accessible name. | Every control is labelled; FAQ uses native `<details>`; skip link, visible focus, reduced motion, light/dark. |
| Third-party model licenses not stated. | Footer credits whisper.cpp, OpenAI Whisper models, Silero VAD, Electron and React. |

Kept from the reference because it works: a concrete headline about the outcome, an app strip that answers "does it work with X", a short how-it-works, a comparison table and an FAQ.

## Rules for editing

- Every number must come from `docs/RESULTS.md` (or be added there first) with machine and conditions.
- No claim the code doesn't back: no "signed" (releases are ad-hoc signed and not notarized — say "SHA-256 checksums"), no languages other than English for recognition, no music claims.
- Don't name competitors in the comparison table.
- Screenshots come from the real app (`docs/screenshots`), converted to WebP.
- `img/og.png` is 1200×630; regenerate it if the headline changes.
