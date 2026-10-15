# Brand — Spokemark

> The Spokemark name, logo and visual identity are **not** covered by the MIT License. See [`TRADEMARKS.md`](../TRADEMARKS.md).

<p>
<img src="../assets/brand/icon-512.png" width="96" alt="Spokemark app icon">&nbsp;
<img src="../assets/brand/logo.svg" width="96" alt="Spokemark logo (vector)">
</p>

## Name: **Spokemark**

*spoken* + *mark* — the mark of what was said. Deliberately broad: it fits today's live captions and the planned expansion (meeting transcription, history, minutes) as well as a possible community edition.

**Domains on 2026-10-11**, checked through RDAP (the registries' official source; `404` means unregistered):
- `spokemark.com` (Verisign) and `spokemark.app` (Google Registry) were both **unregistered**.
- "Unregistered" does not guarantee a regular price — a name can be reserved or *premium*; confirm with a registrar before buying.
- No app or product with this name was found in a web search. No trademark search (INPI/USPTO) was made.

**How the name was chosen:**
1. The first proposal, **Earline**, had a free `.app` but a registered `.com`, so it was dropped.
2. ~130 candidates were then checked requiring **both** `.com` and `.app` free; almost every name built from common words already has its `.com` registered.
3. Eight passed: Saidstone, Minuteloom, Wrenote, **Spokemark**, Quillear, Heardlight, Heardara, Larkscribe. Larkscribe had a mention of an audio app with the same name; Minuteloom is close to the Loom brand.

**In code:** a single constant, `APP_NAME` in `src/shared/brand.ts`, drives the package name, UI text, data folder and menus.
- **Bundle ID:** `app.spokemark.desktop` (reverse DNS of `spokemark.app`), permanent from v0.1.1 on. Up to v0.1.0 it was `dev.local.livecaptions`; because macOS ties the *System Audio Recording* grant to the bundle ID, users of v0.1.0 grant the permission once more after updating.
- **Data folder:** folders from earlier builds ("Earline", "Live Captions") are migrated once.

## Logo

**Source:** `assets/logo.png` (1254 px), generated with AI (ChatGPT), without a hired designer and without intentional use of third-party elements. A speech-bubble "S" in white, ice and cyan with a glow, on an electric-blue squircle over navy.

### Derived assets

| File | How it is made | Used for |
|---|---|---|
| `build/macos/icon.icns` (128–1024 px) | the **original PNG**, clipped with a continuous-corner squircle (superellipse n=5) on the macOS 824/1024 grid | app icon |
| `build/macos/icon.icns` (16, 32 px) | `logo.svg` | at small sizes the original's glow turns to blur; the vector stays crisp |
| `src/renderer/public/icon.png`, `assets/brand/icon-512.png` | the original PNG, clipped, 512 px | logo inside the app (panel, onboarding, About, sidebar) and in the docs |
| `assets/brand/glyph.svg` | the glyph vectorized with `potrace` from the PNG (bright pixels: green > 140, inside the squircle) | base of the vectors below |
| `assets/brand/logo.svg` | a vector **recreation** with approximate gradients and glow — not an exact copy | small sizes, web, docs |
| `assets/tray/*Template.png` | `tray-idle.svg` (solid glyph) and `tray-listening.svg` (glyph + indicator dot), 18 pt @1x/@2x | menu bar (monochrome template images) |

**Regenerate:** `scripts/brand/vectorize-logo.sh`, then `npx electron scripts/render-icons.cjs`. The pipeline is reproducible: its output is byte-identical to the committed files.

## Colors

The app and the website share one palette, taken from the website (v4). It is near-black and warm, with white pills and ember for "live". Before October 2026 the app used navy and cyan sampled from the logo; the logo itself is unchanged (navy `#00061E` / `#012478`, electric blue `#1658FA`, cyan `#18D2FD`, ice `#BBECFD`).

**Dark is the default appearance** (Settings › General › Appearance: Dark / Light / System).

| Token | Dark (default) | Light | Use |
|---|---|---|---|
| `--bg` | `#080808` | `#F6F6F7` | window background (solid, no vibrancy) |
| `--surface` / `--surface-2` | `#111112` / `#18181B` | `#FFFFFF` / `#EEEEF0` | cards, sidebar / inset areas, selected rows |
| `--text` | `#F4F4F5` (18.2:1) | `#0A0A0B` (18.3:1) | primary text |
| `--text-2` | `#A1A1AA` (7.8:1) | `#52525B` (7.2:1) | secondary text |
| `--text-3` | `#8B8B95` (5.9:1) | `#6E6E78` (4.7:1) | meta text, timestamps |
| `--primary-bg` / `--primary-fg` | white / `#0A0A0A` | `#0A0A0A` / white | primary pill button |
| `--accent` | `#F4F4F5` | `#0A0A0A` | toggles, slider fill, focus |
| `--ember` / `--signal` | `#F2541B` (5.8:1) | `#E14A12` / `#C2410C` (4.8:1) | "Listening" dot, live badge, glow, search highlight |
| `--ember-tag` | `#C2410C` | `#C2410C` | behind white text (5.2:1) |
| `--success` / `--warning` / `--danger` | `#22C55E` / `#F5B341` / `#FF6B5E` | `#15803D` / `#9A5A00` / `#C42B1F` | states |

- Contrast was computed with the WCAG 2.x formula; tokens live in `src/renderer/shared/tokens.css`.
- Radii 8 / 12 / 14 px plus pills; transitions 180 ms.
- The **caption box** keeps white on black for legibility; only the waves behind it use brand colours.

## Typography

- **UI:** Manrope (variable 400–700, SIL OFL, a 21 KB Latin subset in `src/renderer/shared/fonts/` and `site/fonts/`), the website's face.
- **Reading surfaces** (transcripts, live preview): the system font (`--font-read`), which is more legible for long text.
- **Timestamps:** the system monospace.
- **Captions:** System (SF Pro), Rounded, Serif (New York) or Monospaced (SF Mono); default System, medium weight.

## Components

- **Buttons are pills.** Primary is solid (white in dark); `size="lg"` can end in a contrasting disc with an arrow or play/stop icon, like the site's CTA. Secondary is the outlined "ghost" pill.
- **Badge:** a dark pill with a coloured dot; ember for live states ("Open source · 100% on-device" in onboarding).
- **Cards and sections** sit on `--surface` with 1 px hairline borders and no shadows in dark. Section titles are small uppercase labels.
- **Segmented controls and tabs:** a pill track; the selected item is a subtle filled pill.

## Sound waves

The website's sound-wave landscape (WebGL, `src/renderer/shared/waves.ts`, the same shader as `site/js/waves.js`) appears behind:
- the onboarding welcome;
- the menu bar panel header while listening (driven by the real audio level);
- the empty Live view;
- the caption preview in Settings;
- Settings › About.

The overlay keeps its cheap 2D waves, recoloured to the same palette (ember, gold, ivory, teal, violet, cobalt).

Rules:
- They animate only while there is sound (in the panel and Live view) or on the welcome screen.
- Elsewhere they are a single still frame.
- They never animate with Reduce Motion, on software WebGL, or when a GPU can't hold 45 fps.
- In app windows they run at 30 fps and are transparent (black becomes alpha), so they work on light and dark surfaces.

## UI icons

**Lucide** (`lucide-react`), 1.75 px stroke at 16–18 px, imported per icon (tree-shaken). SF Symbols are not embedded.
