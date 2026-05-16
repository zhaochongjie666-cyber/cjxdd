#!/usr/bin/env bash
set -euo pipefail

# generate-trace-matrix.sh — 生成追溯矩阵
# 从旧的追溯矩阵逻辑收敛而来
# 用法: bash skills/shadow-l1-flow/scripts/generate-trace-matrix.sh <slug>

SLUG="${1:-}"
[ -z "$SLUG" ] && { echo "用法: $0 <slug>"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SHADOW_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
SHADOW_DIR="$PROJECT_DIR/.shadow"
L1_DIR="$SHADOW_DIR/L1-business/$SLUG"
SPEC_FILE="$L1_DIR/spec.md"
OUTPUT_DIR="$L1_DIR"
OUTPUT_FILE="$OUTPUT_DIR/trace.md"

FLOW_FILE=""
for f in "$SHADOW_DIR/L1-business/project.flow.mermaid" "$SHADOW_DIR/L1-business/flow.mermaid" "$L1_DIR/flow.mermaid" "$L1_DIR/${SLUG}.flow.mermaid"; do
  [ -f "$f" ] && FLOW_FILE="$f" && break
done

extract_rules() {
  if [ -f "$SPEC_FILE" ]; then
    grep -oE "${SLUG}-R[0-9]+" "$SPEC_FILE" 2>/dev/null | sort -u
  fi
}

extract_flow_nodes() {
  if [ -n "$FLOW_FILE" ]; then
    grep -oE 'N[0-9]{2}(_[0-9]{2})?' "$FLOW_FILE" 2>/dev/null | sort -u | sed 's/_/./g' || true
  fi
}

extract_rule_desc() {
  local rule="$1"
  if [ -f "$SPEC_FILE" ]; then
    grep -A1 "$rule" "$SPEC_FILE" 2>/dev/null | tail -1 | sed 's/^[[:space:]]*//' | head -c 60
  fi
}

extract_implements_code() {
  grep -rnoP '(//|#|\*)\s*@implements:\s*(.+)' \
    --include='*.py' --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
    "$PROJECT_DIR" 2>/dev/null | \
    sed -E 's/.*@implements:\s*//' || true
}

extract_implements_harness() {
  grep -rnoP '@implements:\s*(.+)' \
    "$SHADOW_DIR/L5-plan/" 2>/dev/null | \
    sed -E 's/.*@implements:\s*//' || true
}

extract_covers_test() {
  grep -rnoP '@covers:\s*(.+)' \
    "$PROJECT_DIR/server/tests/" "$PROJECT_DIR/tests/" \
    "$PROJECT_DIR/client/src/__tests__/" "$PROJECT_DIR/frontend/src/__tests__/" \
    "$PROJECT_DIR/src/__tests__/" 2>/dev/null | \
    sed -E 's/.*@covers:\s*//' || true
}

echo "# L1 追溯矩阵: $SLUG"
echo ""
echo "> 自动生成于 $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# Build rule -> files mapping
declare -A rule_files
while IFS= read -r line; do
  [ -z "$line" ] && continue
  local_file="$(echo "$line" | cut -d: -f1)"
  local_rules="$(echo "$line" | cut -d: -f2-)"
  IFS=',' read -ra rarr <<< "$local_rules"
  for r in "${rarr[@]}"; do
    r="$(echo "$r" | xargs)"
    [ -z "$r" ] && continue
    if [ -z "${rule_files[$r]:-}" ]; then
      rule_files[$r]="$local_file"
    else
      if [[ "${rule_files[$r]}" != *"$local_file"* ]]; then
        rule_files[$r]="${rule_files[$r]},$local_file"
      fi
    fi
  done
done < <(extract_implements_code; extract_implements_harness)

# Build rule -> test coverage
declare -A rule_tests
while IFS= read -r line; do
  [ -z "$line" ] && continue
  local_rules="$(echo "$line" | cut -d: -f2- | sed 's/^[[:space:]]*//')"
  IFS=',' read -ra rarr <<< "$local_rules"
  for r in "${rarr[@]}"; do
    r="$(echo "$r" | xargs)"
    [ -z "$r" ] && continue
    if [ -z "${rule_tests[$r]:-}" ]; then
      rule_tests[$r]="1"
    fi
  done
done < <(extract_covers_test)

# Flow nodes
FLOW_NODES=$(extract_flow_nodes)
echo "## 流程节点"
echo ""
if [ -n "$FLOW_NODES" ]; then
  echo "| 节点 | 存在 |"
  echo "|------|------|"
  while IFS= read -r node; do
    [ -z "$node" ] && continue
    echo "| $node | ✅ |"
  done < <(echo "$FLOW_NODES")
else
  echo "（无 project.flow.mermaid 或无节点）"
fi
echo ""

# Rules table
echo "## 规则追溯"
echo ""
echo "| 规则 | 描述 | L5 Plan | L5 代码 | L5 测试 | 状态 |"
...
  echo "| 规则 | 描述 | L5 Plan | L5 代码 | L5 测试 | 状态 |"
  echo "|------|------|---------|---------|---------|------|"
  while IFS= read -r rule; do
    [ -z "$rule" ] && continue
    local short_rule desc
    short_rule="$(echo "$rule" | sed -E 's/^.*-R/R/')"
    desc=$(extract_rule_desc "$rule")
  plan_files="$(grep -rl "$rule" "$SHADOW_DIR/L5-plan/" 2>/dev/null | wc -l || echo 0)"
    code_count="$(grep -rl "@implements:.*$rule" --include='*.py' --include='*.ts' --include='*.tsx' "$PROJECT_DIR" 2>/dev/null | wc -l || echo 0)"
    if [ -n "${rule_tests[$rule]:-}" ]; then test_status="✅"; else test_status="❌"; fi
    if [ "$code_count" -gt 0 ] && [ -n "${rule_tests[$rule]:-}" ]; then status_icon="✅"
    elif [ "$code_count" -gt 0 ]; then status_icon="🟡"
    else status_icon="⚠️"
    fi
    echo "| $short_rule | $desc | $plan_files 个 | $code_count 个 | $test_status | $status_icon |"
  done < <(extract_rules)
  echo ""
} > "$OUTPUT_FILE"

echo "追溯矩阵已写入: $OUTPUT_FILE"
