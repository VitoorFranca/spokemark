#!/usr/bin/env bash
# Turns the packaged .app into release artifacts in dist-release/:
#   <Name>-<version>-macos-arm64.dmg, .zip and SHA256SUMS.txt
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME=$(node -p "require('$ROOT/package.json').productName")
VERSION=$(node -p "require('$ROOT/package.json').version")
APP="$ROOT/release/$NAME-darwin-arm64/$NAME.app"
OUT="$ROOT/dist-release"
BASE="$NAME-$VERSION-macos-arm64"
[ -d "$APP" ] || { echo "missing $APP (run npm run package)"; exit 1; }
rm -rf "$OUT"; mkdir -p "$OUT"

# .zip (ditto keeps signatures, symlinks and extended attributes intact)
ditto -c -k --sequesterRsrc --keepParent "$APP" "$OUT/$BASE.zip"

# .dmg with an Applications shortcut
STAGE="$(mktemp -d)"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "$NAME" -srcfolder "$STAGE" -fs HFS+ -format UDZO -ov "$OUT/$BASE.dmg" >/dev/null
rm -rf "$STAGE"
if [ -n "${SIGN_IDENTITY:-}" ]; then
  codesign --force --sign "$SIGN_IDENTITY" --timestamp "$OUT/$BASE.dmg"
  if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_APP_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
    xcrun notarytool submit "$OUT/$BASE.dmg" --apple-id "$APPLE_ID" --password "$APPLE_APP_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
    xcrun stapler staple "$OUT/$BASE.dmg"
  fi
fi

(cd "$OUT" && shasum -a 256 "$BASE.dmg" "$BASE.zip" > SHA256SUMS.txt)
ls -la "$OUT"; cat "$OUT/SHA256SUMS.txt"
