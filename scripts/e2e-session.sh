#!/usr/bin/env bash
# Long session on the packaged app: loops a speech/silence playlist through the
# real system output for N minutes, sampling CPU/memory/latency every minute.
# Usage: scripts/e2e-session.sh <minutes> <outdir> [model]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIN="${1:-30}"; OUT="$2"; MODEL="${3:-}"
F="$ROOT/tests/e2e/fixtures"
APP="$ROOT/release/Live Captions-darwin-arm64/Live Captions.app"
mkdir -p "$OUT"; rm -f "$OUT"/{metrics,transcript,playlog}.jsonl
open -n --env LC_E2E_AUTOSTART=1 --env LC_METRICS_FILE="$OUT/metrics.jsonl" --env LC_TRANSCRIPT_FILE="$OUT/transcript.jsonl" \
  --env LC_METRICS_INTERVAL_MS=60000 --stdout "$OUT/app.log" --stderr "$OUT/app.err" "$APP"
sleep 8
APP_PID=$(pgrep -f "Live Captions.app/Contents/MacOS/Live Captions" | head -1)
if [ -n "$MODEL" ]; then # switch model at runtime (SIGUSR2 = same code path as the tray menu), no app restart
  for _ in 1 2 3 4 5; do
    grep -q "started (model $MODEL," "$OUT/app.log" && break
    kill -USR2 "$APP_PID"; sleep 10
  done
  AFTER=$(pgrep -f "Live Captions.app/Contents/MacOS/Live Captions" | head -1)
  echo "model switch: app pid before=$APP_PID after=$AFTER; $(grep 'started (model' "$OUT/app.log" | tail -1)" | tee "$OUT/model-switch.txt"
fi
now_ms() { python3 -c 'import time;print(int(time.time()*1000))'; }
play() { local s e; s=$(now_ms); afplay "$F/$1"; e=$(now_ms); echo "{\"file\":\"$1\",\"start\":$s,\"end\":$e}" >> "$OUT/playlog.jsonl"; }
gap() { local s; s=$(now_ms); sleep "$1"; echo "{\"gap\":$1,\"start\":$s,\"end\":$(now_ms)}" >> "$OUT/playlog.jsonl"; }
END=$(( $(date +%s) + MIN * 60 ))
while [ "$(date +%s)" -lt "$END" ]; do
  play ref1.aiff; gap 3; play p2.aiff; gap 2; play p3.aiff; gap 10; play p4.aiff; gap 1; play jfk.wav; gap 2; play p5.aiff; gap 60
done
sleep 65 # one more metrics sample
osascript -e 'quit app "Live Captions"'; sleep 3
echo "helpers after quit: $(ps -A -o command= | grep -cE 'bin/(audiotap|whisper-worker)( |$)' || true)" | tee "$OUT/after-quit.txt"
