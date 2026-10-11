#!/usr/bin/env bash
# Stop/Start the running app N times (SIGUSR1 toggles captions) and check that
# helpers are gone after every Stop and that memory does not grow.
set -euo pipefail
N="${1:-10}"
APP_PID=$(pgrep -f "Live Captions.app/Contents/MacOS/Live Captions" | head -1)
[ -n "$APP_PID" ] || { echo "app not running"; exit 1; }
helpers() { ps -A -o ppid=,command= | awk -v p="$APP_PID" '$1==p' | grep -cE "bin/(audiotap|whisper-worker)" || true; }
tree_rss_mb() { ps -A -o pid=,ppid=,rss= | awk -v p="$APP_PID" '$1==p||$2==p{s+=$3} END{printf "%.0f", s/1024}'; }
# make sure we start in "capturing"
[ "$(helpers)" = "2" ] || { kill -USR1 "$APP_PID"; sleep 6; }
echo "cycle,helpers_while_running,helpers_after_stop,orphans_total,app_tree_rss_mb"
for i in $(seq 1 "$N"); do
  running=$(helpers)
  kill -USR1 "$APP_PID"; sleep 3                       # Stop
  after=$(helpers)
  orphans=$(ps -A -o command= | grep -cE "bin/(audiotap|whisper-worker)( |$)" || true)
  rss=$(tree_rss_mb)
  echo "$i,$running,$after,$orphans,$rss"
  kill -USR1 "$APP_PID"; sleep 6                       # Start (model load + warm-up)
done
