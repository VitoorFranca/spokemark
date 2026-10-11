#!/usr/bin/env bash
# Long session on the packaged app: loops a speech/silence playlist through the
# real system output for N minutes, sampling CPU/memory/latency every minute.
# Usage: scripts/e2e-session.sh <minutes> <outdir> [model]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIN="${1:-30}"; OUT="$2"; MODEL="${3:-}"
F="$ROOT/tests/e2e/fixtures"
APP="${APP:-$ROOT/release/Spokemark-darwin-arm64/Spokemark.app}"
PROC="$(basename "$APP" .app).app/Contents/MacOS"
EXTRA_ENV=(); [ -n "${LC_MODELS_DIR:-}" ] && EXTRA_ENV=(--env "LC_MODELS_DIR=$LC_MODELS_DIR")
mkdir -p "$OUT"; rm -f "$OUT"/{metrics,transcript,playlog}.jsonl
open -n ${EXTRA_ENV[@]+"${EXTRA_ENV[@]}"} --env LC_E2E_AUTOSTART=1 --env LC_METRICS_FILE="$OUT/metrics.jsonl" --env LC_TRANSCRIPT_FILE="$OUT/transcript.jsonl" \
  --env LC_METRICS_INTERVAL_MS=60000 --stdout "$OUT/app.log" --stderr "$OUT/app.err" "$APP"
sleep 8
APP_PID=$(pgrep -f "$PROC" | head -1)
if [ -n "$MODEL" ]; then # switch model at runtime (SIGUSR2 = same code path as the tray menu), no app restart
  for _ in 1 2 3 4 5; do
    grep -q "started (model $MODEL," "$OUT/app.log" && break
    kill -USR2 "$APP_PID"; sleep 10
  done
  AFTER=$(pgrep -f "$PROC" | head -1)
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
# Cumulative CPU time of every process of the app (main, renderers, GPU, helpers):
# robust, unlike `ps %cpu` sampled once a minute.
APP_DIR_ESC="$(dirname "$APP")/$(basename "$APP")"
ps -A -o cputime=,command= | grep -F "$APP_DIR_ESC" | grep -v grep | awk '{split($1,t,":"); n=split($1,t,":"); s=0; for(i=1;i<=n;i++) s=s*60+t[i]; total+=s; line=$0; sub(/^ *[^ ]+ +/,"",line); sub(/.*\/Contents\//,"",line); printf "%8.1f s  %s\n", s, substr(line,1,90)} END {printf "%8.1f s  TOTAL\n", total}' | tee "$OUT/cputime.txt"
osascript -e "quit app \"$(basename "$APP" .app)\""; sleep 3
echo "helpers after quit: $(ps -A -o command= | grep -cE 'bin/(audiotap|whisper-worker)( |$)' || true)" | tee "$OUT/after-quit.txt"
