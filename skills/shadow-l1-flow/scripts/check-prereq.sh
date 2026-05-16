#!/usr/bin/env bash
set -euo pipefail

# check-prereq.sh — L1 前置文件检查
# L1 前置条件检查脚本
# 用法: bash skills/shadow-l1-flow/scripts/check-prereq.sh <slug>
#   或: bash skills/shadow-l1-flow/scripts/check-prereq.sh l1 <slug>

if [ "${1:-}" = "l1" ]; then
  SLUG="${2:-}"
else
  SLUG="${1:-}"
fi
[ -z "$SLUG" ] && { echo "用法: $0 [l1] <slug>"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SHADOW_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
SHADOW_DIR="$PROJECT_DIR/.shadow"
L1_DIR="$SHADOW_DIR/L1-business/$SLUG"
source "$PROJECT_DIR/skills/shadow-l1-flow/scripts/iter-helpers.sh"
prereq_init "$PROJECT_DIR" "l1" "$SLUG"

echo "=== L1 前置文件检查: $SLUG ==="

check_file() {
  local file="$1"; local label="$2"
  local check_id="${3:-l1.prereq.file}"
  if [ -f "$file" ]; then prereq_ok "$label 存在" "$check_id" "$file"; else prereq_fail "$label 缺失: $file" "$check_id" "$file"; fi
}

check_file "$SHADOW_DIR/L1-business/INDEX.md" "INDEX.md" "l1.prereq.index"
check_file "$L1_DIR/research.md" "research.md" "l1.prereq.research"
check_file "$L1_DIR/spec.md" "spec.md" "l1.prereq.spec"

FLOW_FILE=""
for f in "$SHADOW_DIR/L1-business/project.flow.mermaid" "$SHADOW_DIR/L1-business/flow.mermaid" "$L1_DIR/flow.mermaid" "$L1_DIR/${SLUG}.flow.mermaid"; do
  [ -f "$f" ] && FLOW_FILE="$f" && break
done
if [ -n "$FLOW_FILE" ]; then
  prereq_ok "project.flow.mermaid 存在: $(basename "$FLOW_FILE")" "l1.prereq.flow" "$FLOW_FILE"
  if [ "$(basename "$FLOW_FILE")" != "project.flow.mermaid" ]; then
    prereq_warn "使用旧版 flow 文件名，建议迁移到 .shadow/L1-business/project.flow.mermaid" "l1.prereq.flow-legacy" "$FLOW_FILE"
  fi
else
  prereq_fail "project.flow.mermaid 缺失" "l1.prereq.flow"
fi

if [ -f "$L1_DIR/wire.svg" ]; then
  prereq_ok "wire.svg 存在（正式产物）" "l1.prereq.wire" "$L1_DIR/wire.svg"
elif [ -d "$L1_DIR/wire" ]; then
  prereq_fail "wire/ 目录不再作为 L1 Wire 产物；请升级为 wire.svg" "l1.prereq.wire" "$L1_DIR/wire"
elif [ -f "$L1_DIR/wire.html" ]; then
  prereq_fail "wire.html 不再作为 L1 Wire 产物；请升级为 wire.svg" "l1.prereq.wire" "$L1_DIR/wire.html"
else
  prereq_warn "wire 产物缺失（若为纯后端/Skill 可接受）" "l1.prereq.wire"
fi

echo
prereq_finish "$0"
