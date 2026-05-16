#!/usr/bin/env bash
set -euo pipefail

# gate-pass.sh — 标记 L1 Gate 通过
# L1 Gate 通过标记写入脚本
# 用法: bash skills/shadow-l1-flow/scripts/gate-pass.sh <slug>
#   或: bash skills/shadow-l1-flow/scripts/gate-pass.sh l1 <slug>

if [ "${1:-}" = "l1" ]; then
  SLUG="${2:-}"
else
  SLUG="${1:-}"
fi
[ -z "$SLUG" ] && { echo "用法: $0 [l1] <slug>"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SHADOW_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
source "$PROJECT_DIR/skills/shadow-l1-flow/scripts/iter-helpers.sh"
GATE_DIR="$(resolve_gate_dir "$PROJECT_DIR")"
gate_init_checks
trap gate_cleanup_checks EXIT
mkdir -p "$GATE_DIR"

PASSED_FILE="${GATE_DIR}/l1.${SLUG}.passed"
rm -f "${GATE_DIR}/l1.${SLUG}.failed"
cat > "$PASSED_FILE" <<EOF
L1 Gate PASSED
timestamp: $(date '+%Y-%m-%dT%H:%M:%S')
layer: L1
slug: ${SLUG}
EOF

GREEN='\033[0;32m'; BOLD='\033[1m'; NC='\033[0m'
gate_record_check PASS "l1.final.marker-written" "L1 Gate 通过标记已写入" "$PASSED_FILE" "finalization" "info" "最终标记已写入，可进入下一层"
echo -e "${GREEN}${BOLD}✅ L1 Gate 通过${NC} → $(basename "$PASSED_FILE")"
