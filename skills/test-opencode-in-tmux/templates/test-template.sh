#!/bin/bash
# Test template for opencode skill/tool/plugin testing
# Copy this file and customize for your specific test case

set -e

SESSION="oc-test-$$"
TEST_DIR=$(mktemp -d)
PASS=0
FAIL=0

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
  if "$@" 2>/dev/null; then
    echo "✅ PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "❌ FAIL: $desc"
    FAIL=$((FAIL + 1))
  fi
}

wait_for_response() {
  local max="${1:-120}"
  for i in $(seq 1 $((max / 5))); do
    sleep 5
    if ! tmux capture-pane -t $SESSION -p 2>/dev/null | grep -qE "Working|thinking|loading|\.\.\."; then
      return 0
    fi
  done
  return 1
}

# === Setup ===
tmux new-session -d -s $SESSION -x 120 -y 40
tmux send-keys -t $SESSION "cd $TEST_DIR && opencode 2>${TEST_DIR}/stderr.log" Enter
sleep 5

# === Your Tests Here ===

# Test: Basic startup
assert "opencode started" \
  tmux capture-pane -t $SESSION -p -S -100 | grep -qE "opencode|Model|Agent"

# Test: Send message and wait for response
tmux send-keys -t $SESSION 'your test message here' Enter
wait_for_response 60

assert "expected behavior" \
  tmux capture-pane -t $SESSION -p -S -200 | grep -qi "expected output"

# === Summary ===
echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ] && echo "ALL TESTS PASSED" || exit 1
