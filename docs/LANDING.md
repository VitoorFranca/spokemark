# Landing page

`site/` is the project's landing page: static HTML + CSS and one small script (`js/page.js`), with no build step. It loads no third-party scripts, sets no cookies and has no analytics; the fonts are self-hosted. `.github/workflows/pages.yml` publishes it to GitHub Pages on every push to `main` that touches `site/`.

Preview locally: `cd site && python3 -m http.server 8765` → http://localhost:8765.

- **Current design (v3):** [`landing/V3.md`](landing/V3.md)
- **v2 (superseded): diagnosis of v1, ribbon shader:** [`landing/V2.md`](landing/V2.md)
- **Previous direction (v1, superseded):** [`landing/DIRECTION.md`](landing/DIRECTION.md)
- **Every claim and its source:** [`landing/CLAIMS.md`](landing/CLAIMS.md)
- **Before/after screenshots:** `landing/screenshots/{before,after}/` (375, 768, 1280, 1920 px)
- **Demo data:** [`landing/demo-jfk.log`](landing/demo-jfk.log), the real streaming output replayed by the hero

## Rules for editing

- A claim goes on the page only with a line in `CLAIMS.md`. Numbers come from `docs/RESULTS.md`; add them there first, with the machine and conditions.
- No "signed" (releases are ad-hoc signed and not notarized; say "SHA-256 checksums"), no recognition languages other than English, and no compatibility we haven't tested stated as tested.
- The accent color is used only for the headline's second line, the CTA icon, the word being said in the caption, and focus/active states.
- The hero demo replays `demo-jfk.log` exactly. If the pipeline changes, re-run `scripts/e2e-transcribe.sh` on `jfk.wav` (it plays audio) and replace the log and the `LOG` array together.
- Screenshots are of the real app in English and dark mode, captured with an isolated `LC_DATA_DIR`. Each one is exported as WebP at 1× and 2×, with `width`/`height`.

## On each release

1. Update the version and download URLs in `site/index.html` (hero CTA, Install section, JSON-LD), plus the file sizes. The asset names contain the version, so `releases/latest/download/` can't be used.
2. Update the release date and the `CLAIMS.md` rows for the version and sizes.
3. Regenerate `site/img/og.png` (1200×630) only if the headline changes.

## Benchmark against a commercial competitor (2026-10-12)

Only the public page of Subtitles Live was analysed; no code or assets were copied. Weak points there, and how this page answers them:

| Weak point in the reference | Here |
|---|---|
| "Nothing leaves your Mac", next to license checks, a version check and a 633 MB model download | The Privacy ledger names the one network request (models from Hugging Face, pinned, SHA-256) and says what is stored and where |
| Privacy is a promise | A one-line `lsof` check, and build-from-source |
| Contradictory claims (license check "from time to time" vs "about once a month") | One statement per fact, each in `CLAIMS.md` |
| Performance numbers without method (RTF 0.15 vs 0.31 vs 0.6–2.2) | One table from `RESULTS.md`, with machine, conditions and what hasn't been verified |
| Requirements hidden in the FAQ | Requirements under the hero CTA and in Install |
| Mocked demo | The hero replays real output, at its real timing |
| "Source-available" unexplained; no build or contribution path | MIT in plain words, build commands, contribution links |
| 9 purchase CTAs, cross-promos | Two CTAs (download, source), nothing unrelated |
