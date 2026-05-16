#!/usr/bin/env bash
# gate-pass.sh — L1.5 Gate 通过标记
# 用法: bash gate-pass.sh <slug>
#   或: bash gate-pass.sh l1p5 <slug>

set -euo pipefail

if [ "${1:-}" = "l1p5" ]; then
    SLUG="${2:-}"
else
    SLUG="${1:-}"
fi
[ -z "$SLUG" ] && { echo "用法: $0 [l1p5] <slug>"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SHADOW_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
source "$PROJECT_DIR/skills/shadow-l1-flow/scripts/iter-helpers.sh"
GATE_DIR="$(resolve_gate_dir "$PROJECT_DIR")"
gate_init_checks
trap gate_cleanup_checks EXIT

mkdir -p "$GATE_DIR"

cat > "$GATE_DIR/l1p5.${SLUG}.passed" <<EOF
L1.5 Gate PASSED
timestamp: $(date '+%Y-%m-%dT%H:%M:%S')
layer: L1.5
slug: ${SLUG}
EOF
gate_record_check PASS "l1p5.final.marker-written" "L1.5 Gate 通过标记已写入" "$GATE_DIR/l1p5.${SLUG}.passed" "finalization" "info" "最终标记已写入，可进入下一层"
echo "✅ L1.5 Gate 通过标记已创建: $GATE_DIR/l1p5.${SLUG}.passed"
