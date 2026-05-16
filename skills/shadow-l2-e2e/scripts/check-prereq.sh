#!/usr/bin/env bash
# check-prereq.sh — L2 E2E 前置检查
# 用法: bash check-prereq.sh <slug>
#   或: bash check-prereq.sh l2 <slug>

set -euo pipefail

if [ "${1:-}" = "l2" ]; then
    SLUG="${2:-}"
else
    SLUG="${1:-}"
fi
[ -z "$SLUG" ] && { echo "用法: $0 [l2] <slug>"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SHADOW_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
source "$PROJECT_DIR/skills/shadow-l1-flow/scripts/iter-helpers.sh"
GATE_DIR="$(resolve_gate_dir "$PROJECT_DIR")"
prereq_init "$PROJECT_DIR" "l2" "$SLUG"

# 检查 L1 Gate
if [ ! -f "$GATE_DIR/l1.${SLUG}.passed" ]; then
    prereq_fail "错误: L1 Gate 未通过" "l2.prereq.l1-gate" "$GATE_DIR/l1.${SLUG}.passed"
else
    prereq_ok "L1 Gate 已通过" "l2.prereq.l1-gate" "$GATE_DIR/l1.${SLUG}.passed"
fi

# 检查 L1.5 Gate
if [ ! -f "$GATE_DIR/l1p5.${SLUG}.passed" ]; then
    prereq_fail "错误: L1.5 Gate 未通过" "l2.prereq.l1p5-gate" "$GATE_DIR/l1p5.${SLUG}.passed"
else
    prereq_ok "L1.5 Gate 已通过" "l2.prereq.l1p5-gate" "$GATE_DIR/l1p5.${SLUG}.passed"
fi

prereq_finish "$0"
