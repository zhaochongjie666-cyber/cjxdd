#!/usr/bin/env bash
set -euo pipefail

# Spec ID 连续性 + 模糊词检查
# 用法: bash skills/shadow-l1-spec/scripts/check-spec-ids.sh <slug>

SLUG="${1:-}"
[ -z "$SLUG" ] && { echo "用法: $0 <slug>"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SHADOW_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
SPEC_FILE="$PROJECT_DIR/.shadow/L1-business/BXX-$SLUG/spec.md"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; NC='\033[0m'
PASS=0
FAIL=0

ok()   { echo -e "${GREEN}PASS${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}FAIL${NC} $1"; FAIL=$((FAIL+1)); }

extract_section() {
  local file="$1"
  local section="$2"
  awk -v section="$section" '
    $0 ~ "^##[[:space:]]+([0-9]+(\\.[0-9]+)*\\.?[[:space:]]+)?" section "[[:space:]]*$" { in_section=1; next }
    in_section && /^##[[:space:]]+/ { exit }
    in_section { print }
  ' "$file"
}

# --- 1. spec.md 存在 ---
if [ -f "$SPEC_FILE" ]; then
  ok "spec.md 存在"
else
  fail "spec.md 缺失: $SPEC_FILE"
  echo -e "\n=== Result: PASS=$PASS FAIL=$FAIL ==="
  exit 1
fi

# --- 2. 规则 ID 格式 ---
mapfile -t rules < <(grep -oE "${SLUG}-R[0-9]+" "$SPEC_FILE" 2>/dev/null | sort -u)
if [ ${#rules[@]} -eq 0 ]; then
  fail "spec.md 无规则 ID (格式: ${SLUG}-RNN)"
else
  ok "发现 ${#rules[@]} 个规则 ID"
fi

# --- 3. 规则 ID 连续性 ---
if [ ${#rules[@]} -gt 0 ]; then
  i=1
  bad=0
  for r in "${rules[@]}"; do
    expect=$(printf "%s-R%02d" "$SLUG" "$i")
    if [ "$r" != "$expect" ]; then
      bad=1
      break
    fi
    i=$((i+1))
  done
  if [ $bad -eq 0 ]; then
    ok "规则 ID 连续无跳号 (${#rules[@]} 条)"
  else
    fail "规则 ID 不连续或格式不一致 (期望第 ${i} 条为 $(printf '%s-R%02d' "$SLUG" "$i"), 实际为 ${r:-空})"
  fi
fi

# --- 4. 必须章节 ---
required_sections=("业务目标" "角色" "业务规则" "可观测状态" "验收路径")
for s in "${required_sections[@]}"; do
  if grep -Eq "^## .*${s}" "$SPEC_FILE"; then
    ok "包含必须章节: $s"
  else
    fail "缺少必须章节: $s"
  fi
done

# --- 5. 推荐章节 ---
recommended_sections=("核心对象与状态" "异常与边界" "数据约束" "外部依赖与副作用" "实现提醒")
for s in "${recommended_sections[@]}"; do
  if grep -Eq "^## .*${s}" "$SPEC_FILE"; then
    ok "包含推荐章节: $s"
  else
    echo -e "${YELLOW}WARN${NC} 缺少推荐章节: $s"
  fi
done

# --- 5.5. 下游交接章节 ---
handoff_sections=("给 L1.5 的输入" "给 L2 的输入" "给 L3-L5 的输入")
for s in "${handoff_sections[@]}"; do
  if grep -Eq "^## .*${s}" "$SPEC_FILE"; then
    ok "包含交接章节: $s"
  else
    fail "缺少交接章节: $s"
  fi
done

# --- 5.6. 交接章节固定条目 ---
check_handoff_labels() {
  local section="$1"
  shift
  local block
  block="$(extract_section "$SPEC_FILE" "$section")"
  if [ -z "$block" ]; then
    return
  fi
  for label in "$@"; do
    if printf '%s\n' "$block" | grep -Eq "^[[:space:]]*-[[:space:]]*${label}："; then
      ok "${section} 包含固定条目: ${label}"
    else
      fail "${section} 缺少固定条目: ${label}"
    fi
  done
}

check_handoff_labels "给 L1.5 的输入" \
  "模块边界" "文件职责" "接口/集成边界" "外部依赖与约束"
check_handoff_labels "给 L2 的输入" \
  "主路径" "失败路径" "权限/角色场景" "状态断言" "错误码/失败信号"
check_handoff_labels "给 L3-L5 的输入" \
  "关键对象" "输入输出契约" "状态迁移" "副作用" "不可省略约束"

# --- 6. BXX-NYY 坐标标注 ---
node_count=$(grep -oE 'B[0-9]+-N[0-9]+(\.[0-9]+)?' "$SPEC_FILE" 2>/dev/null | sort -u | wc -l | tr -d '[:space:]')
if [ "$node_count" -gt 0 ]; then
  ok "包含 BXX-NYY 坐标标注 (${node_count} 个节点)"
else
  fail "缺少 BXX-NYY 坐标标注"
fi

# --- 6.5. 业务规则表必须声明 Wire 承接语义 ---
business_rule_section="$(extract_section "$SPEC_FILE" "业务规则")"
if printf '%s\n' "$business_rule_section" | grep -Fq '需 Wire 承接'; then
  ok "业务规则表包含「需 Wire 承接」列"
else
  fail "业务规则表缺少「需 Wire 承接」列"
fi

if printf '%s\n' "$business_rule_section" | grep -Fq '用户可见'; then
  ok "业务规则表包含「用户可见」列"
else
  fail "业务规则表缺少「用户可见」列"
fi

if printf '%s\n' "$business_rule_section" | grep -Fq 'UI 载体/方位'; then
  ok "业务规则表包含「UI 载体/方位」列"
else
  fail "业务规则表缺少「UI 载体/方位」列"
fi

# --- 7. 模糊词检测 (9 种模式) ---
vague_patterns="相关|必要时|适当|做校验|处理异常|返回结果|系统处理|系统进行|触发通知"
vague_count=$(grep -Eo "$vague_patterns" "$SPEC_FILE" 2>/dev/null | wc -l | tr -d '[:space:]')
if [ "$vague_count" -eq 0 ]; then
  ok "无模糊词"
else
  fail "存在模糊词 ${vague_count} 处"
  echo "  模糊词详情:"
  grep -En "$vague_patterns" "$SPEC_FILE" | while IFS= read -r line; do
    echo "    $line"
  done
fi

# --- 8. 实现关键信息 ---
keywords=("错误码|error" "状态" "验收" "权限" "数据" "依赖")
for k in "${keywords[@]}"; do
  if grep -Eiq "$k" "$SPEC_FILE"; then
    ok "包含实现关键信息: $k"
  else
    echo -e "${YELLOW}WARN${NC} 缺少实现关键信息: $k"
  fi
done

echo ""
echo "=== Result: PASS=$PASS FAIL=$FAIL ==="
[ "$FAIL" -eq 0 ]
