#!/usr/bin/env bash
set -euo pipefail

# Research Quality Check — research.md 结构完整性校验
# 用法:
#   bash skills/shadow-l1-research-review/scripts/check-research-quality.sh <slug>

SLUG="${1:-}"
[ -z "$SLUG" ] && { echo "用法: $0 <slug>"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SHADOW_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
SHADOW_DIR="$PROJECT_DIR/.shadow"
L1_DIR="$SHADOW_DIR/L1-business/$SLUG"
RESEARCH_FILE="$L1_DIR/research.md"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; NC='\033[0m'
PASS=0
FAIL=0
WARN=0

ok()   { echo -e "${GREEN}PASS${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}FAIL${NC} $1"; FAIL=$((FAIL+1)); }
warn() { echo -e "${YELLOW}WARN${NC} $1"; WARN=$((WARN+1)); }

echo "=== Research Quality Check: $SLUG ==="

if [ -f "$RESEARCH_FILE" ]; then
  ok "research.md 存在"
else
  fail "research.md 缺失: $RESEARCH_FILE"
  echo
  echo "=== Result: PASS=$PASS WARN=$WARN FAIL=$FAIL ==="
  exit 1
fi

lines=$(wc -l < "$RESEARCH_FILE" | tr -d '[:space:]')
if [ "$lines" -ge 50 ]; then
  ok "research.md 行数 >= 50 (实际: $lines)"
else
  fail "research.md 行数不足: $lines < 50"
fi

section_count=$(grep -cE "^## " "$RESEARCH_FILE" || true)
if [ "$section_count" -ge 5 ]; then
  ok "research.md 章节数 >= 5 (实际: $section_count)"
else
  fail "research.md 章节数不足: $section_count < 5"
fi

checks=(
  "流程:流程|业务背景|现有系统"
  "实现:实现|方案|技术"
  "技术选型:技术选型|选型|决策"
  "调研结论:调研结论|结论|总结"
  "风险:风险|约束"
)
for item in "${checks[@]}"; do
  label="${item%%:*}"
  pattern="${item#*:}"
  if grep -Eq "^## .*(${pattern})" "$RESEARCH_FILE"; then
    ok "research.md 包含章节: $label"
  else
    fail "research.md 缺少章节: $label"
  fi
done

compare_count=$(grep -Ec "方案对比|方案选型|备选方案" "$RESEARCH_FILE" || true)
if [ "$compare_count" -ge 2 ]; then
  ok "research.md 包含方案对比 (匹配: $compare_count 处)"
else
  fail "research.md 缺少足够的方案对比 (匹配: $compare_count < 2)"
fi

echo
echo "=== Result: PASS=$PASS WARN=$WARN FAIL=$FAIL ==="
[ "$FAIL" -eq 0 ]
