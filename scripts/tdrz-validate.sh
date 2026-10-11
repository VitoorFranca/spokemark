#!/usr/bin/env bash
# Speaker-turn validation: plays each dialogue/monologue through the real system
# output and scores turn detection. Usage: scripts/tdrz-validate.sh <outdir> [models...]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$1"; shift; MODELS=("${@:-small.en-tdrz small.en}")
[ $# -eq 0 ] && MODELS=(small.en-tdrz small.en)
mkdir -p "$OUT"
D="$ROOT/tests/e2e/dialogues"; F="$ROOT/tests/e2e/fixtures"
for m in "${MODELS[@]}"; do
  for name in d1_gap800 d2_gap300_three d3_gap0_same_gender; do
    "$ROOT/scripts/e2e-transcribe.sh" "$D/$name.wav" "$D/$name.txt" "$m" "$OUT/$m-$name.json" 5 >/dev/null
    node "$ROOT/scripts/tdrz-eval.mjs" "$OUT/$m-$name.json" "$D/$name.json" | tee -a "$OUT/results.jsonl"
  done
  for name in ref1 p3; do # single speaker: every detected turn is false
    ext=aiff
    "$ROOT/scripts/e2e-transcribe.sh" "$F/$name.$ext" "$F/$name.txt" "$m" "$OUT/$m-mono-$name.json" 5 >/dev/null
    node "$ROOT/scripts/tdrz-eval.mjs" "$OUT/$m-mono-$name.json" none | tee -a "$OUT/results.jsonl"
  done
done
