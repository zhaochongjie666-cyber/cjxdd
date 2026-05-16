#!/usr/bin/env bash
# check-prereq.sh — L1.5 Gate 前置检查
# 用法: bash check-prereq.sh <slug>
#   或: bash check-prereq.sh l1p5 <slug>

set -euo pipefail

if [ "${1:-}" = "l1p5" ]; then
    LAYER="l1p5"
    SLUG="${2:-}"
else
    LAYER="l1p5"
    SLUG="${1:-}"
fi
[ -z "$SLUG" ] && { echo "用法: $0 [l1p5] <slug>"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SHADOW_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
source "$PROJECT_DIR/skills/shadow-l1-flow/scripts/iter-helpers.sh"
SHADOW_DIR="$PROJECT_DIR/.shadow"
L15_ROOT="$SHADOW_DIR/L1.5-architecture"
GATE_DIR="$(resolve_gate_dir "$PROJECT_DIR")"
prereq_init "$PROJECT_DIR" "l1p5" "$SLUG"
L1_GATE=""
for candidate in \
    "$GATE_DIR/l1.${SLUG}.passed" \
    "$GATE_DIR/l1.${SLUG#B??-}.passed"; do
    if [ -f "$candidate" ]; then
        L1_GATE="$candidate"
        break
    fi
done

resolve_l15_dir() {
    local input="$1"
    if [ -d "$L15_ROOT/$input" ]; then
        printf '%s\n' "$L15_ROOT/$input"
        return 0
    fi
    local match
    match=$(find "$L15_ROOT" -maxdepth 1 -mindepth 1 -type d -name "B??-$input" | head -n 1)
    if [ -n "$match" ]; then
        printf '%s\n' "$match"
        return 0
    fi
    return 1
}

L15_DIR="$(resolve_l15_dir "$SLUG" || true)"
[ -n "$L15_DIR" ] || L15_DIR="$L15_ROOT/$SLUG"

# 检查 L1 Gate
if [ -z "$L1_GATE" ]; then
    prereq_fail "错误: L1 Gate 未通过" "l1p5.prereq.l1-gate"
else
    prereq_ok "L1 Gate 已通过" "l1p5.prereq.l1-gate" "$L1_GATE"
fi

# 检查三个子技能产出
for file in "architecture.md" "file-list.md" "quality.md"; do
    if [ ! -f "$L15_DIR/$file" ]; then
        prereq_fail "错误: $file 不存在" "l1p5.prereq.output" "$L15_DIR/$file"
    else
        prereq_ok "$file 已存在" "l1p5.prereq.output" "$L15_DIR/$file"
    fi
done

prereq_finish "$0"
