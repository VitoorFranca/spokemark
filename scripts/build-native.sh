#!/usr/bin/env bash
# Builds the native helpers into build/bin:
#   audiotap        (Swift, CoreAudio Process Tap)
#   whisper-worker  (C++, whisper.cpp static + Metal)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WHISPER_TAG="v1.9.5"
WHISPER_DIR="$ROOT/vendor/whisper.cpp"
OUT="$ROOT/build/bin"
mkdir -p "$OUT" "$ROOT/vendor"

if [ ! -d "$WHISPER_DIR/.git" ]; then
  git clone --depth 1 --branch "$WHISPER_TAG" https://github.com/ggml-org/whisper.cpp.git "$WHISPER_DIR"
fi

echo "==> audiotap"
swiftc -O "$ROOT/native/audiotap/main.swift" -o "$OUT/audiotap"

echo "==> whisper-worker (whisper.cpp $WHISPER_TAG, Metal)"
cmake -S "$ROOT/native/whisper-worker" -B "$ROOT/build/whisper-worker" \
  -DCMAKE_BUILD_TYPE=Release -DWHISPER_DIR="$WHISPER_DIR" >/dev/null
cmake --build "$ROOT/build/whisper-worker" --config Release -j "$(sysctl -n hw.ncpu)" --target whisper-worker
cp "$ROOT/build/whisper-worker/whisper-worker" "$OUT/whisper-worker"
echo "==> done: $(ls "$OUT")"
