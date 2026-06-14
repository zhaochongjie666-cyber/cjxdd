#!/bin/bash
# wait-completion.sh - Wait for a CLI program to finish current task in tmux
# Usage: wait-completion.sh <tmux-session-name> [max-seconds] [busy-pattern]

SESSION="${1:?Usage: wait-completion.sh <tmux-session-name> [max-seconds] [busy-pattern]}"
MAX_WAIT="${2:-120}"
BUSY_PATTERN="${3:-Working|thinking|loading|\.\.\.}"
INTERVAL=5

echo "Waiting for program in session '$SESSION' (max ${MAX_WAIT}s)..."

for i in $(seq 1 $((MAX_WAIT / INTERVAL))); do
  sleep $INTERVAL
  if ! tmux capture-pane -t "$SESSION" -p 2>/dev/null | grep -qE "$BUSY_PATTERN"; then
    echo "Program completed"
    exit 0
  fi
done

echo "Timeout after ${MAX_WAIT}s"
exit 1
