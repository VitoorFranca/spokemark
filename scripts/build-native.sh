#!/usr/bin/env bash
# Builds the native helpers into build/bin:
#   audiotap        (Swift, CoreAudio Process Tap)
#   whisper-worker  (C++, whisper.cpp static + Metal)
#   translator      (Swift, Apple Translation framework)
#   speech-worker   (Swift, Apple SpeechAnalyzer: speech recognition, macOS 26+)
#   speaker-worker  (Swift package, FluidAudio: speaker diarization on CoreML)
#   parakeet-worker (Swift package, FluidAudio: speech recognition on CoreML)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WHISPER_TAG="v1.9.5"
WHISPER_DIR="$ROOT/vendor/whisper.cpp"
OUT="$ROOT/build/bin"
# Distribution builds: MACOS_MIN keeps binaries runnable on older macOS (Process Tap needs 14.2+),
# GGML_NATIVE=OFF avoids CPU-specific instructions of the build machine (CI sets it).
MACOS_MIN="${MACOS_MIN:-14.2}"
GGML_NATIVE="${GGML_NATIVE:-ON}"
mkdir -p "$OUT" "$ROOT/vendor"

if [ ! -d "$WHISPER_DIR/.git" ]; then
  git clone --depth 1 --branch "$WHISPER_TAG" https://github.com/ggml-org/whisper.cpp.git "$WHISPER_DIR"
fi

echo "==> audiotap"
swiftc -O -target "arm64-apple-macos$MACOS_MIN" "$ROOT/native/audiotap/main.swift" -o "$OUT/audiotap"

echo "==> translator (Apple Translation, macOS 26+; weak-linked so it starts on 14.2)"
swiftc -O -parse-as-library -target "arm64-apple-macos$MACOS_MIN" -Xlinker -weak_framework -Xlinker Translation \
  "$ROOT/native/translator/main.swift" -o "$OUT/translator"

echo "==> speech-worker (Apple SpeechAnalyzer, macOS 26+; weak-linked so it starts on 14.2)"
swiftc -O -parse-as-library -target "arm64-apple-macos$MACOS_MIN" -Xlinker -weak_framework -Xlinker Speech \
  "$ROOT/native/speech-worker/main.swift" -o "$OUT/speech-worker"

echo "==> speaker-worker + parakeet-worker (FluidAudio, pinned in native/fluid-workers/Package.resolved)"
swift build -c release --arch arm64 --package-path "$ROOT/native/fluid-workers"
FLUID_BIN="$(swift build -c release --arch arm64 --package-path "$ROOT/native/fluid-workers" --show-bin-path)"
cp "$FLUID_BIN/speaker-worker" "$FLUID_BIN/parakeet-worker" "$OUT/"

echo "==> whisper-worker (whisper.cpp $WHISPER_TAG, Metal)"
cmake -S "$ROOT/native/whisper-worker" -B "$ROOT/build/whisper-worker" \
  -DCMAKE_BUILD_TYPE=Release -DWHISPER_DIR="$WHISPER_DIR" \
  -DCMAKE_OSX_DEPLOYMENT_TARGET="$MACOS_MIN" -DCMAKE_OSX_ARCHITECTURES=arm64 -DGGML_NATIVE="$GGML_NATIVE" >/dev/null
cmake --build "$ROOT/build/whisper-worker" --config Release -j "$(sysctl -n hw.ncpu)" --target whisper-worker
cp "$ROOT/build/whisper-worker/whisper-worker" "$OUT/whisper-worker"
echo "==> done: $(ls "$OUT")"
