#!/usr/bin/env bash
# gate-pass.sh — 标记 Gate 通过

set -euo pipefail

if [ "${1:-}" = "l5" ]; then
    LAYER="l5"
    SLUG="${2:-}"
else
    LAYER="l5"
    SLUG="${1:-}"
fi

[ -z "$LAYER" ] || [ -z "$SLUG" ] && { echo "用法: $0 [l5] <slug>"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SHADOW_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
source "$PROJECT_DIR/skills/shadow-l1-flow/scripts/iter-helpers.sh"
GATE_DIR="$(resolve_gate_dir "$PROJECT_DIR")"
gate_init_checks
trap gate_cleanup_checks EXIT

mkdir -p "$GATE_DIR"
PASSED_FILE="${GATE_DIR}/${LAYER}.${SLUG}.passed"
rm -f "${GATE_DIR}/${LAYER}.${SLUG}.failed"
cat > "$PASSED_FILE" <<EOF
L5 Gate PASSED
timestamp: $(date '+%Y-%m-%dT%H:%M:%S')
layer: L5
slug: ${SLUG}
EOF
gate_record_check PASS "${LAYER}.final.marker-written" "${LAYER} Gate 通过标记已写入" "$PASSED_FILE" "finalization" "info" "最终标记已写入，可进入下一层"
echo "✅ ${LAYER} Gate 通过 → $(basename "$PASSED_FILE")"
