#!/usr/bin/env bash
# Regenerates the vector brand assets from assets/logo.png:
#   1. isolates the bright glyph (white/ice/cyan, G > 140) inside the squircle
#   2. traces it with potrace (brew install potrace)
#   3. writes assets/brand/{glyph,logo,tray-idle,tray-listening}.svg
# Then run: npx electron scripts/render-icons.cjs
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
sips -s format bmp "$ROOT/assets/logo.png" --out "$TMP/logo.bmp" >/dev/null
python3 -I "$ROOT/scripts/brand/glyph_bitmap.py" "$TMP/logo.bmp" "$TMP"
potrace "$TMP/glyph.pbm" -s -o "$TMP/glyph.svg" -t 40 -a 1.1 -O 0.4
python3 -I "$ROOT/scripts/brand/make_svgs.py" "$TMP" "$ROOT/assets/brand"
rm -rf "$TMP"
echo "brand SVGs written to assets/brand/"
