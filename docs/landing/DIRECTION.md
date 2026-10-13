# Landing page — diagnosis and direction

Scope: `site/` only. The desktop app is not touched.

## 1. Diagnosis

### Stack and structure

| | |
|---|---|
| Framework | none; static `site/index.html` + `site/styles.css` |
| Routing | single page; in-page anchors `#top #main #features #how #privacy #open-source #build #install #faq` |
| Styles | one hand-written CSS file, custom properties, light/dark via `prefers-color-scheme` |
| Components | none; inline SVG for the GitHub and download icons |
| JS | none |
| Assets | `site/img/` WebP screenshots, `icon-64/180.png`, `og.png` |
| Build | none |
| Deploy | `.github/workflows/pages.yml` uploads `site/` to GitHub Pages on push to `main` (paths `site/**`) |

There is no reason to add a framework: the page is one document, and a static file keeps the Pages workflow, the zero-JS baseline and the "no third-party requests" promise intact. **The stack stays.**

### Screenshots of the current page

`docs/landing/screenshots/before/{375,768,1280,1920}.webp` (full page, light scheme).

### Main design problems

1. **Template hero** (`1280`, `1920` top). Centered stack of pill badge → two-line headline → paragraph → two buttons → screenshot, with a radial glow behind it. It is the default shape of a SaaS template, and nothing in it is specific to captions.
2. **The product is a picture of a picture** (`1280` hero). The overlay is a static screenshot inside a decorative gradient frame, labelled with the app *iTerm2*. It doesn't show what makes Spokemark different: text arriving in real time, the faint provisional tail and words being corrected before they're confirmed.
3. **One card recipe, used everywhere** (`1280`, middle). It covers six feature cards, five pipeline cards and three open-source cards, all with the same radius, border and padding. The rhythm is monotone, and the pipeline (the most technical idea) looks like the feature list.
4. **Typography with no voice.** System UI font at one weight family, default tracking. Without the logo it could be any product.
5. **Metrics as a SaaS stat strip** (`1280`, below hero; `375` 2×2 grid). Four equal boxes mix a latency median with a socket count, out of context. The model and hardware they belong to are in small print below.
6. **Redundant sections** (`1280` full). The page has an app chip cloud, a comparison table, a 10-item FAQ and a closing CTA band ("Never miss a word again."). These repeat what earlier sections already said: 8,499 px at 1280 px wide.
7. **The accent means nothing.** Electric blue is used on the badge dot, step numbers, links, chips' focus and both CTAs, so it no longer points at anything.
8. **Mobile is the desktop, stacked** (`375`). The comparison table scrolls sideways, the stats wrap into a 2×2 grid, and the hero screenshot shrinks to unreadable 9 px caption text.
9. **Screenshots in Portuguese** on an English page (history and panel images show the pt-BR UI).

### Real assets

| Asset | Where | Notes |
|---|---|---|
| Logo (raster, 1254 px) | `assets/logo.png` | AI-generated, user-owned; not redesigned |
| App icon 512 | `assets/brand/icon-512.png` | squircle-clipped |
| Logo vector | `assets/brand/logo.svg` | approximation for small sizes |
| Screenshots (pt-BR UI) | `docs/screenshots/*.png` | every surface, light and dark |
| Screenshots (English UI) | new, captured for this page with `LC_DATA_DIR` isolated, `language: en`, history seeded with the real `jfk.wav` pipeline output; not committed to `docs/screenshots` | history + search, settings › captions, panel |
| Real streaming output | `docs/landing/demo-jfk.log` | `dist/cli/transcribe.js` on `jfk.wav`, base.en, 2026-10-11 |
| Brand colors | `docs/BRAND.md` | navy `#0A0F1F`, electric blue `#1658FA`, cyan `#18D2FD`, ice `#BBECFD` |

## 2. Direction

### Central idea

**The page reads like a caption track: text arrives, settles and becomes a record.** Everything follows that one idea:
- The hero is a live caption: the real JFK run, with the provisional tail dim and the word being said in the accent color.
- Sections are laid out like a transcript: a narrow left column carries a monospaced marker (a timestamp-like label or a component name), and the right column carries the text.
- Motion is a word settling from provisional to confirmed, and nothing else.

### Typography

| Role | Face | Why |
|---|---|---|
| Display | **Schibsted Grotesk** (variable 400–900, OFL) | Drawn for a news publisher: a compact grotesk built for headlines people read fast. It has more character than Inter/SF without being quirky, and it pairs naturally with "text you read". |
| Text | **Atkinson Hyperlegible Next** (variable 200–800, OFL) | Designed by the Braille Institute for low-vision readers, with distinct letterforms (`Il1`, `0O`). Captions are an accessibility tool; the body face says so. It is not what every SaaS uses. |
| Mono | **Atkinson Hyperlegible Mono** (variable, OFL) | Only where it has a job: timestamps, component names, numbers in tables and shell commands. |

- Self-hosted from `site/fonts/` (from the Fontsource packages), Latin subset, `font-display: swap`. Display and text are preloaded; mono is not.
- The demo caption uses the app's own caption stack (`-apple-system, "SF Pro Text"…`, weight 500), so it matches the overlay on a Mac.
- Fluid scale, in `clamp()`:

| Token | Size |
|---|---|
| `--step-5` (h1) | `clamp(2.6rem, 1.5rem + 4.6vw, 5.6rem)` |
| `--step-4` (h2) | `clamp(1.9rem, 1.4rem + 2.1vw, 3.1rem)` |
| `--step-3` | `clamp(1.35rem, 1.15rem + 0.8vw, 1.75rem)` |
| `--step-1` (lead) | `clamp(1.1rem, 1.03rem + 0.3vw, 1.3rem)` |
| `--step-0` (body) | `1.0625rem` |
| `--step--1` (meta) | `0.875rem` |

### Color

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F4F5F8` | `#0A0F1F` | page |
| `--surface` | `#FFFFFF` | `#10172B` | tables, code |
| `--ink` | `#0B1022` | `#EAF0FB` | primary text |
| `--ink-2` | `#4A5470` | `#9AA7C2` | secondary text |
| `--line` | `#D9DEE8` | `#222C47` | rules, borders |
| `--accent` | `#1658FA` | `#18D2FD` | primary CTA, the spoken word in the demo, active/focus states |
| `--on-accent` | `#FFFFFF` | `#0A0F1F` | text on the CTA |
| `--stage` | `#0A0F1F` | `#050913` | the screen behind the demo caption |

- Contrast was checked with the WCAG 2.x formula; the numbers are recorded in `CLAIMS.md` §Contrast.
- The accent appears in exactly three places:
  - the primary CTA;
  - the word being spoken in the demo;
  - focus rings and the current nav item.
- Links are ink with an underline, not blue.
- No gradients, glass, glows or heavy shadows. The only "effect" is the caption box itself, `rgba(9,9,13,.6)` with a 14 px radius, the app's real values.

### Grid and spacing

- 12 columns, max content width 1200 px, gutter 24 px (16 px under 600 px).
- Transcript layout: a 3-column marker rail and an 8–9-column body. The rail collapses above the body on mobile.
- Spacing scale: 4, 8, 12, 16, 24, 32, 48, 72, 112. Sections are separated by 112 px (72 px on mobile) and a hairline rule.
- Asymmetry is deliberate and always goes left-heavy: the headline starts at column 1, and imagery bleeds to the right edge of the container. Nothing is centered except inside the demo stage.

### References (principles only)

- **Linear:** hierarchy through weight and spacing, not boxes.
- **Raycast:** the product is the hero, shown working.
- **Apple:** one idea per section, type does the work.
- **Vercel:** generous, consistent empty space.

No layouts, illustrations or recognizable elements are taken from any of them.

## 3. Headline

| | Headline | Subheadline |
|---|---|---|
| A | **Captions for everything your Mac plays. The audio never leaves it.** | Spokemark writes what's said in calls, videos and podcasts on screen, live, with a Whisper model running on your Mac's GPU. English speech · free and MIT-licensed · no account. |
| B | Every call, video and podcast, captioned live — on your Mac. | Free, open-source live captions that run entirely on Apple silicon. |
| C | Live captions, computed on your Mac. | Open source, free, private by construction. |

**Chosen: A.**
- The first sentence answers what it is and the problem it solves (it captions anything, not one app).
- The second answers why it's different, as a fact we can back (`README.md`, `DECISIONS.md`: audio goes from the tap to the worker over pipes, nothing is uploaded).
- The subheadline adds the constraint that matters before installing (English speech) and the open-source terms.
- B is close to the reference product's own wording, and C is vague ("private by construction").

## 4. Information architecture

1. **Hero:** headline, subheadline, Download (dmg of the latest release) + GitHub, one line of requirements, then the live demo stage.
2. **How it works** (`#how`): one ruled pipeline, system output → Process Tap → VAD → whisper.cpp/Metal → LocalAgreement → overlay. Each stage has a real number. It renders as a horizontal sequence on desktop and a vertical rail on mobile.
3. **What you get** (`#features`): a large history screenshot beside a definition list of real capabilities, then a second row with the caption settings screenshot, the presets and the default shortcuts.
4. **Privacy** (`#privacy`): a ledger, "stays on your Mac" vs "goes over the network", plus what is stored and where, plus the one-line `lsof` check.
5. **Performance** (`#performance`): one table, base.en vs small.en, from `RESULTS.md`, with the machine named above it.
6. **Open source** (`#open-source`, `#build`): MIT in one sentence, the build commands, and how to contribute.
7. **Download** (`#install`, `#faq`): the version, requirements, permission, first-open steps, checksum, and four short answers about limits.
8. **Footer.**

Removed: the app chip cloud (folded into one sentence), the comparison table (it named no one and proved nothing), the stat strip (numbers moved to Performance with context) and the closing CTA band (the download section is the close).
