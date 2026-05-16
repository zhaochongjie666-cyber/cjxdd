#!/usr/bin/env bash
# gate-pass.sh — L2 Gate 通过标记
# 用法: bash gate-pass.sh <slug>
#   或: bash gate-pass.sh l2 <slug>

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

mkdir -p "$GATE_DIR"

cat > "$GATE_DIR/l2.${SLUG}.passed" <<EOF
L2 Gate PASSED
timestamp: $(date '+%Y-%m-%dT%H:%M:%S')
layer: L2
slug: ${SLUG}
EOF
echo "✅ L2 Gate 通过标记已创建: $GATE_DIR/l2.${SLUG}.passed"
