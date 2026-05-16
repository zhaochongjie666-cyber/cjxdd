#!/bin/bash
# Generic test template for CLI program testing via tmux
# Copy this file and customize for your specific test case and target program
#
# Usage: ./my-test.sh
# Set APP to match a references/<name>.md file for app-specific guidance

set -e

SESSION="test-$(basename $0 .sh)-$$"
TEST_DIR=$(mktemp -d)
PASS=0
FAIL=0
TOTAL=0
LOG="${TEST_DIR}/stderr.log"

# Set APP to your target program (opencode, pi-coding-agent, cloud-code, codex, etc.)
APP="${APP:-generic}"

# Start command - customize for your target program
START_CMD="${START_CMD:-opencode}"
# Busy pattern for wait detection - customize per program
BUSY_PATTERN="${BUSY_PATTERN:-Working|thinking|loading}"
# Startup wait time in seconds
STARTUP_WAIT="${STARTUP_WAIT:-5}"

cleanup() {
  tmux send-keys -t $SESSION C-c C-c 2>/dev/null || true
  sleep 1
  tmux kill-session -t $SESSION 2>/dev/null || true
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT

assert() {
  local desc="$1"
  shift
  TOTAL=$((TOTAL + 1))
  if "$@" 2>/dev/null; then
    echo "PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $desc"
    FAIL=$((FAIL + 1))
  fi
}

wait_for_response() {
  local max="${1:-120}"
  local pattern="${2:-$BUSY_PATTERN}"
  for i in $(seq 1 $((max / 5))); do
    sleep 5
    if ! tmux capture-pane -t $SESSION -p 2>/dev/null | grep -qE "$pattern"; then
      return 0
    fi
  done
  return 1
}

# === Setup ===
echo "Starting $APP in tmux session '$SESSION'..."
tmux new-session -d -s $SESSION -x 120 -y 40
tmux send-keys -t $SESSION "cd $TEST_DIR && $START_CMD 2>${LOG}" Enter
sleep $STARTUP_WAIT

# === Your Tests Here ===

# Test: Basic startup
assert "$APP started" \
  tmux capture-pane -t $SESSION -p -S -100 | grep -qE "$APP|Ready|Model|Agent"

# Test: Send message and wait for response
tmux send-keys -t $SESSION 'your test message here' Enter
wait_for_response 60

assert "expected behavior" \
  tmux capture-pane -t $SESSION -p -S -200 | grep -qi "expected output"

# === Summary ===
echo ""
echo "Results: $PASS / $TOTAL passed, $FAIL failed"
[ $FAIL -eq 0 ] && echo "ALL TESTS PASSED" || exit 1
