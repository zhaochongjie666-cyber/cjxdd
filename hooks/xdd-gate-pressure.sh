#!/bin/bash
# xdd-gate-pressure.sh — 压力信号检测 (Phase 2-3 反"加速跳过"护栏)
# 触发: UserPromptSubmit (用户消息) / PreToolUse (AI 工具调用)
# 模式分类 (case-insensitive):
#   RUSH      — 加快节奏 / hurry / rush / asap (强压力)
#   TIME      — 时间紧 / deadline / running out of time
#   SKIP      — 跳过 / 省略 / skip / omit (显式跳步)
#   SIMPLIFY  — 简化 / 草草 / rough (质量降级)
#   WORKLOAD  — 工作量大 / huge workload
# 行为: 软提醒 (不阻断), 把警告以 stdout 输出
# 退出码: 0 永远 (软提醒)

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=xdd-gate-lib.sh
source "$SCRIPT_DIR/xdd-gate-lib.sh"

INPUT=$(cat 2>/dev/null || true)
TEXT=$(echo "$INPUT" | jq -r '.user_prompt // .message // .prompt // .userPrompt // .content // .tool_input.prompt // empty' 2>/dev/null)

if [[ -z "$TEXT" ]]; then
    if [[ -t 0 ]]; then
        TEXT=$(cat)
    fi
fi

[[ -z "$TEXT" ]] && exit 0

# check_pressure_signals 来自 lib.sh
check_pressure_signals "$TEXT"
exit 0
