#!/bin/bash
# worker-dispatch-hint.sh — Advisory hook for shadow-worker dispatch.
# Triggered by: PreToolUse hook, matcher: "Task".
#
# 当 walker 调 Task 工具派 shadow-worker 时, 检查 prompt 是否引用了
# work order 文件. 不引用 → 提示 walker 先写 WO; 引用了但文件不存在
# → 警告; 都 OK → 简短确认 + 累计统计.
#
# Advisory only — 不阻断. Walker 自己决定怎么处理.
# 配套的 WO 累计统计在 SessionStart 时由 session-start.sh 打印.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

# 从 prompt 文本里抽 work order 路径.
# 形如 ".shadow/iterations/iter-1/work-orders/WO-007-something.md"
extract_wo_path() {
    local prompt="$1"
    local path
    path=$(echo "$prompt" | grep -oE '\.shadow/iterations/iter-[0-9]+/work-orders/WO-[0-9]+[^[:space:]]*\.md' 2>/dev/null | head -1)
    if [[ -z "$path" ]]; then
        path=$(echo "$prompt" | grep -oE '[^[:space:]]*WO-[0-9]+[^[:space:]]*\.md' 2>/dev/null | head -1)
    fi
    echo "$path"
}

# 从 prompt 文本里抽 task_id (WO-NNN).
extract_wo_id() {
    local prompt="$1"
    echo "$prompt" | grep -oE 'WO-[0-9]+' 2>/dev/null | head -1
}

# ---------- 入口 ----------
# stdin 读一次 (Claude Code 传 JSON 进来).
INPUT=$(cat 2>/dev/null || true)

# 没匹配上 → 静默退出
if ! echo "$INPUT" | jq -e '.tool_input' >/dev/null 2>&1; then
    exit 0
fi

prompt=$(echo "$INPUT" | jq -r '.tool_input.prompt // .tool_input.description // empty' 2>/dev/null)
subagent_type=$(echo "$INPUT" | jq -r '.tool_input.subagent_type // .tool_input.agent // empty' 2>/dev/null)

# 只关心 shadow-worker, 其它 subagent (Explore 等) 不打扰
case "$subagent_type" in
    *worker*|shadow-worker) ;;
    *) exit 0 ;;
esac

# 没 prompt 没法分析
[[ -z "$prompt" ]] && exit 0

wo_id=$(extract_wo_id "$prompt")
wo_path=$(extract_wo_path "$prompt")

# 1. 派了 worker 但 prompt 里没提 WO-XXX
if [[ -z "$wo_id" && -z "$wo_path" ]]; then
    echo "[shadow] ⚠️  Walker 派了 shadow-worker 但 prompt 里没找到 WO-NNN 引用。" >&2
    echo "[shadow]    建议: 先写 work order 到 .shadow/iterations/iter-N/work-orders/WO-NNN-slug.md" >&2
    echo "[shadow]    模板: docs/work-order-template.md" >&2
    echo "[shadow]    契约: agents/shadow-worker.md" >&2
    exit 0
fi

# 2. WO 文件不存在
if [[ -n "$wo_path" && ! -f "$wo_path" ]]; then
    echo "[shadow] ❌ $wo_id 引用了 WO 文件但不存在: $wo_path" >&2
    echo "[shadow]    Walker: 先用 docs/work-order-template.md 写 work order, 再派 worker。" >&2
    exit 0
fi

# 3. WO 存在, 简短确认
echo "[shadow] 派 $wo_id 给 shadow-worker (WO 文件: $wo_path)"

# 4. 累计统计 (只在有回报时)
wo_counts=$(count_wo_reports)
wo_total=$(echo "$wo_counts" | grep -oE 'total=[0-9]+' | cut -d= -f2)
if [[ "${wo_total:-0}" -gt 0 ]]; then
    echo "[shadow] (累计已回报 WO: $wo_counts)"
fi

exit 0
