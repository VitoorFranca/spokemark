#!/usr/bin/env bash
# Regenerates the E2E audio fixtures (not versioned): macOS `say` voices + jfk.wav from whisper.cpp.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
F="$ROOT/tests/e2e/fixtures"
say -v Samantha -r 175 -f "$F/ref1.say" -o "$F/ref1.aiff"
say -v Daniel -f "$F/p2.txt" -o "$F/p2.aiff"
say -v "Flo (Inglês (EUA))" -f "$F/p3.txt" -o "$F/p3.aiff"
say -v "Eddy (Inglês (Reino Unido))" -f "$F/p4.txt" -o "$F/p4.aiff"
say -v Samantha -r 190 -f "$F/p5.txt" -o "$F/p5.aiff"
cp "$ROOT/vendor/whisper.cpp/samples/jfk.wav" "$F/jfk.wav" # run build:native first (clones whisper.cpp)
python3 -I "$ROOT/scripts/make-dialogues.py" "$ROOT/tests/e2e/dialogues"
echo "fixtures ready"
