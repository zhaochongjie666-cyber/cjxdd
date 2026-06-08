#!/bin/bash
# xdd-gate-3-review.sh — Phase 3 REVIEW 用户确认 gate
# 等待用户明确确认才能进 Phase 4

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=xdd-gate-lib.sh
source "$SCRIPT_DIR/xdd-gate-lib.sh"

is_meta_project && exit 0

# 这个 gate 主要靠 user-prompt-submit 检测用户回复, 这里只是打印提醒
# 让用户明确知道 Phase 3 是阻塞点

echo "[xdd] Phase 3 REVIEW: 等待用户确认"
echo "[xdd]    设计变更展示: git diff .xdd/"
echo "[xdd]    用户回复 '确认' / 'OK' / '继续' / 'go' → 进 Phase 4"
echo "[xdd]    如有修改意见 → 回 Phase 2"
exit 0
