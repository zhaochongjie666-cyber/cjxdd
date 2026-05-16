#!/bin/bash
# run-test.sh - Generic test runner for CLI programs in tmux
# Usage: run-test.sh <test-script> [app-name]
#
# The test script should use these environment variables:
#   SESSION  - tmux session name (auto-generated)
#   TEST_DIR - temporary test directory (auto-created)
#   LOG      - stderr log file path
#   APP      - app name for reference lookup

set -e

APP="${2:-generic}"
SESSION="test-$(basename "$1" .sh)-$$"
TEST_DIR=$(mktemp -d)
LOG="${TEST_DIR}/stderr.log"

echo "Test Runner"
echo "  App: $APP"
echo "  Test: $1"
echo "  Session: $SESSION"
echo "  Work dir: $TEST_DIR"
echo ""

export SESSION TEST_DIR LOG APP

cleanup() {
  tmux send-keys -t $SESSION C-c C-c 2>/dev/null || true
  sleep 1
  tmux kill-session -t $SESSION 2>/dev/null || true
  if [ "${KEEP_TEST_DIR:-0}" != "1" ]; then
    rm -rf "$TEST_DIR"
  else
    echo "Test dir preserved: $TEST_DIR"
  fi
}
trap cleanup EXIT

bash "$1"
echo ""
echo "Test completed. Work dir: $TEST_DIR"
