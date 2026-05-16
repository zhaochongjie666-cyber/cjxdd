#!/usr/bin/env bash
# check-prereq.sh — 检查前置层完成状态

set -euo pipefail

if [ "${1:-}" = "l4" ] || [ "${1:-}" = "l5" ] || [ "${1:-}" = "l6" ]; then
    CURRENT_LAYER="${1:-}"
    SLUG="${2:-}"
else
    CURRENT_LAYER="l5"
    SLUG="${1:-}"
fi

[ -z "$CURRENT_LAYER" ] || [ -z "$SLUG" ] && { echo "用法: $0 [l4|l5|l6] <slug>"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SHADOW_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
source "$PROJECT_DIR/skills/shadow-l1-flow/scripts/iter-helpers.sh"
GATE_DIR="$(resolve_gate_dir "$PROJECT_DIR")"
prereq_init "$PROJECT_DIR" "$CURRENT_LAYER" "$SLUG"

layer_passed() {
    local layer="$1"
    [ -f "$GATE_DIR/${layer}.${SLUG}.passed" ] || [ -f "$GATE_DIR/${layer}.${SLUG#B??-}.passed" ]
}

# 定义前置层依赖
declare -A LAYER_DEPS=(
    ["l4"]="l1 l1p5 l2 l3"
    ["l5"]="l1 l1p5 l3 l4"
    ["l6"]="l1 l1p5 l2 l4 l3 l5"
)

echo "=== 检查 ${CURRENT_LAYER} 前置依赖 ==="

DEPS="${LAYER_DEPS[$CURRENT_LAYER]:-}"
if [ -z "$DEPS" ]; then
    prereq_fail "未知层: $CURRENT_LAYER" "${CURRENT_LAYER}.prereq.layer"
    prereq_finish "$0"
fi

for dep in $DEPS; do
    if layer_passed "$dep"; then
        prereq_ok "$dep 已完成" "${CURRENT_LAYER}.prereq.dep" "$dep"
    else
        prereq_fail "$dep 未完成" "${CURRENT_LAYER}.prereq.dep" "$dep"
    fi
done

prereq_finish "$0"
