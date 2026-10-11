#!/usr/bin/env bash
# Plays a reference file through the real system output (afplay) while the
# headless pipeline captures it via the Process Tap. Prints WER/latency summary.
# Usage: scripts/e2e-transcribe.sh <audio> <ref.txt> <model> <out.json> [lead_s] [extra cli args...]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AUDIO="$1"; REF="$2"; MODEL="$3"; OUT="$4"; LEAD="${5:-6}"; shift 5 || shift $#
DUR=$(afinfo "$AUDIO" | awk '/estimated duration/ {print int($3+0.999)}')
SECS=$((DUR + LEAD + 4))
( sleep "$LEAD"; afplay "$AUDIO" ) &
node "$ROOT/dist/cli/transcribe.js" --model "$MODEL" --seconds "$SECS" --ref "$REF" --out "$OUT" "$@" > "${OUT%.json}.out" 2> "${OUT%.json}.err"
wait
node -e "const r=require('$OUT');console.log(JSON.stringify({model:r.model,metal:r.metal,wer:r.wer,confirmed:r.confirmedLatencyMs,firstSeen:r.firstSeenLatencyMs,infer:r.inferMs,capToMain:r.captureToMainMs,filters:r.stats.filters,skippedBusy:r.stats.skippedBusy}));console.log('HYP:',r.transcript)"
