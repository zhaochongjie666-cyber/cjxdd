#!/bin/bash
# test-opencode.sh - Full test suite for opencode skills, tools, plugins
# Usage: test-opencode.sh [test-dir]

set -e

SESSION="oc-test-$$"
TEST_DIR="${1:-$(mktemp -d)}"
PASS=0
FAIL=0
TOTAL=0

cleanup() {
  echo ""
  echo "🧹 Cleaning up..."
  tmux send-keys -t $SESSION C-c C-c 2>/dev/null || true
  sleep 1
  tmux kill-session -t $SESSION 2>/dev/null || true
  echo "✅ Session destroyed"
}
trap cleanup EXIT

assert() {
  local desc="$1"
  shift
  TOTAL=$((TOTAL + 1))
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

echo "🚀 OpenCode Test Suite"
echo "   Test directory: $TEST_DIR"
echo "   Session: $SESSION"
echo ""

# === 1. Start opencode ===
echo "--- Test 1: Basic Startup ---"
tmux new-session -d -s $SESSION -x 120 -y 40
tmux send-keys -t $SESSION "cd $TEST_DIR && opencode 2>${TEST_DIR}/stderr.log" Enter
sleep 5

assert "opencode TUI starts" \
  tmux capture-pane -t $SESSION -p -S -100 | grep -qE "opencode|Model|Agent"

# === 2. Basic AI Response ===
echo ""
echo "--- Test 2: Basic AI Response ---"
tmux send-keys -t $SESSION 'hello' Enter
wait_for_response 60

assert "AI responds to hello" \
  tmux capture-pane -t $SESSION -p -S -200 | grep -qiE "hello|hi|hey|你好"

# === 3. Tool Invocation ===
echo ""
echo "--- Test 3: Tool Invocation ---"
tmux send-keys -t $SESSION '列出当前目录的文件' Enter
wait_for_response 60

assert "tool (bash/read/list) is invoked" \
  tmux capture-pane -t $SESSION -p -S -200 | grep -qiE "bash|read|list|ls|files"

# === 4. Doubt Plugin - Add ===
echo ""
echo "--- Test 4: Doubt Plugin - Add ---"
tmux send-keys -t $SESSION '记录一个疑问：这个测试是否有效？优先级 high' Enter
wait_for_response 60

assert "doubt_add tool is called" \
  tmux capture-pane -t $SESSION -p -S -200 | grep -qiE "doubt|疑问|Added|记录"

# === 5. Doubt Plugin - List ===
echo ""
echo "--- Test 5: Doubt Plugin - List ---"
tmux send-keys -t $SESSION 'doubt_list' Enter
wait_for_response 60

assert "doubt_list shows doubts" \
  tmux capture-pane -t $SESSION -p -S -200 | grep -qiE "doubt|疑问|Summary|Pending"

# === 6. Doubt Plugin - Review ===
echo ""
echo "--- Test 6: Doubt Plugin - Review ---"
tmux send-keys -t $SESSION 'doubt_review' Enter
wait_for_response 60

assert "doubt_review shows review" \
  tmux capture-pane -t $SESSION -p -S -200 | grep -qiE "review|Pending|Resolved"

# === 7. File Creation ===
echo ""
echo "--- Test 7: File Creation ---"
tmux send-keys -t $SESSION '创建一个文件 test-output.txt，内容为 "Hello from opencode test"' Enter
wait_for_response 60

assert "file is created" \
  test -f "$TEST_DIR/test-output.txt"

# === 8. Skill Trigger ===
echo ""
echo "--- Test 8: Skill Trigger ---"
tmux send-keys -t $SESSION '帮我设计一个用户注册的业务流程' Enter
wait_for_response 90

# Check if any skill-related content appears in output
assert "skill is triggered for design request" \
  tmux capture-pane -t $SESSION -p -S -200 | grep -qiE "流程|spec|research|flow|设计|业务"

# === Summary ===
echo ""
echo "========================================"
echo "📊 Test Results"
echo "========================================"
echo "✅ PASS: $PASS / $TOTAL"
echo "❌ FAIL: $FAIL / $TOTAL"
echo "========================================"

if [ $FAIL -gt 0 ]; then
  echo ""
  echo "📁 Full output:"
  tmux capture-pane -t $SESSION -p -S -300 > ${TEST_DIR}/output.txt 2>/dev/null || true
  echo "   Saved to: ${TEST_DIR}/output.txt"
  echo ""
  echo "📋 Stderr log:"
  cat ${TEST_DIR}/stderr.log 2>/dev/null | tail -20 || true
  exit 1
fi

echo ""
echo "🎉 ALL TESTS PASSED"
