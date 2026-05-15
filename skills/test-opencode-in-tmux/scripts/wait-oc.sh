#!/bin/bash
# wait-oc.sh - Wait for opencode to finish current task
# Usage: wait-oc.sh <tmux-session-name> [max-seconds]

SESSION="${1:?Usage: wait-oc.sh <tmux-session-name> [max-seconds]}"
MAX_WAIT="${2:-120}"
INTERVAL=5

echo "⏳ Waiting for opencode in session '$SESSION' (max ${MAX_WAIT}s)..."

for i in $(seq 1 $((MAX_WAIT / INTERVAL))); do
  sleep $INTERVAL
  if ! tmux capture-pane -t "$SESSION" -p 2>/dev/null | grep -qE "Working|thinking|loading|\.\.\."; then
    echo "✅ Opencode completed"
    exit 0
  fi
done

echo "⏰ Timeout after ${MAX_WAIT}s"
exit 1
