#!/usr/bin/env bash
# check-semantic-gate-l5.sh — L5 语义 Gate 校验（抽查报告声明版）
# 不只检查报告格式，还要验证报告中声称的结论是否与实际代码一致
#
# 用法: bash skills/shadow-l5-impl/scripts/check-semantic-gate-l5.sh <slug>
#   或: bash skills/shadow-l5-impl/scripts/check-semantic-gate-l5.sh l5 <slug>

set -euo pipefail

if [ "${1:-}" = "l5" ]; then
  SLUG="${2:-}"
else
  SLUG="${1:-}"
fi
[ -z "$SLUG" ] && { echo "用法: $0 [l5] <slug>"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SHADOW_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
source "$PROJECT_DIR/skills/shadow-l1-flow/scripts/iter-helpers.sh" 2>/dev/null || true

if type resolve_iter_root &>/dev/null; then
  ITER_ROOT="$(resolve_iter_root "$PROJECT_DIR")"
else
  ITER_ROOT="$PROJECT_DIR/.shadow"
fi

SEMANTIC_GATE_DIR="$ITER_ROOT/reviews/semantic-gate"
mkdir -p "$SEMANTIC_GATE_DIR"

REPORT_FILE=""
for f in \
  "$SEMANTIC_GATE_DIR/l5.$SLUG.md" \
  "$PROJECT_DIR/.shadow/L5-impl/$SLUG/reviews/semantic-gate.md"; do
  [ -f "$f" ] && REPORT_FILE="$f" && break
done

SHADOW_DIR="$PROJECT_DIR/.shadow"
HARNESS_PLAN=""
for f in \
  "$SHADOW_DIR/L5-plan/$SLUG/harness-plan.md" \
  "$(find "$SHADOW_DIR/L5-plan" -maxdepth 2 -name 'harness-plan.md' -path "*$SLUG*" 2>/dev/null | head -1)"; do
  [ -f "$f" ] && HARNESS_PLAN="$f" && break
done

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; NC='\033[0m'
PASS=0; FAIL=0; WARN=0
ok()   { echo -e "${GREEN}PASS${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}FAIL${NC} $1"; FAIL=$((FAIL+1)); }
warn() { echo -e "${YELLOW}WARN${NC} $1"; WARN=$((WARN+1)); }

echo "=== L5 语义 Gate 校验: $SLUG ==="
echo ""

# --- 1. 报告存在性 + 基本格式 ---
[ -n "$REPORT_FILE" ] || {
  fail "语义 Gate 报告缺失: $SEMANTIC_GATE_DIR/l5.$SLUG.md"
  echo "=== Result: PASS=$PASS FAIL=$FAIL ==="
  exit 1
}
ok "语义 Gate 报告存在: $(basename "$REPORT_FILE")"

grep -Eiq "Verdict:\s*PASS|verdict:\s*PASS" "$REPORT_FILE" && ok "Verdict = PASS" || fail "Verdict 不是 PASS"
grep -Eq "实现指导性" "$REPORT_FILE" && ok "包含实现指导性章节" || fail "缺少实现指导性章节"
grep -Eq "人类可读性" "$REPORT_FILE" && ok "包含人类可读性章节" || fail "缺少人类可读性章节"
grep -Eq "业务完整性" "$REPORT_FILE" && ok "包含业务完整性章节" || fail "缺少业务完整性章节"

count=$(grep -Ec "^[0-9]+\. |^- " "$REPORT_FILE" || true)
if [ "$count" -ge 3 ]; then ok "报告包含足够条目（>=3）"; else fail "报告条目不足（<3）"; fi

# --- 2. 抽查报告中声称的文件是否存在且体量充足 ---
echo ""
echo "--- 抽查报告声称的文件 ---"

CLAIMED_FILES=$(grep -oE '`([a-zA-Z0-9_./-]+\.(py|ts|js|tsx|jsx|vue|go|rs|java))`' "$REPORT_FILE" 2>/dev/null | sed 's/`//g' | sort -u || true)

if [ -n "$CLAIMED_FILES" ]; then
  CLAIMED_COUNT=$(echo "$CLAIMED_FILES" | grep -c '.' || echo "0")
  ok "报告中引用了 $CLAIMED_COUNT 个实现文件"
  CLAIMED_MISSING=0
  while read -r claimed; do
    [ -z "$claimed" ] && continue
    FOUND=false
    for search in "$PROJECT_DIR/$claimed" "$PROJECT_DIR/server/$claimed" "$PROJECT_DIR/backend/$claimed" "$PROJECT_DIR/src/$claimed" "$PROJECT_DIR/frontend/$claimed"; do
      if [ -f "$search" ]; then
        FOUND=true
        LINES=$(wc -l < "$search" 2>/dev/null || echo "0")
        if [ "$LINES" -lt 5 ]; then
          fail "报告声称检查了 $claimed 但文件仅 ${LINES} 行（空壳）"
          CLAIMED_MISSING=$((CLAIMED_MISSING + 1))
        fi
        break
      fi
    done
    if ! $FOUND; then
      fail "报告声称检查了 $claimed 但文件不存在"
      CLAIMED_MISSING=$((CLAIMED_MISSING + 1))
    fi
  done < <(echo "$CLAIMED_FILES")
  [ "$CLAIMED_MISSING" -eq 0 ] && ok "报告声称检查的所有文件都存在且非空壳" || true
else
  warn "报告中未引用具体的实现文件路径（无法抽查）"
fi

# --- 3. 抽查报告中声称验证的规则 ID ---
echo ""
echo "--- 抽查报告声称验证的规则 ---"

CLAIMED_RULES=$(grep -oE "${SLUG}-R[0-9]+" "$REPORT_FILE" 2>/dev/null | sort -u || true)

if [ -n "$CLAIMED_RULES" ]; then
  RULE_COUNT=$(echo "$CLAIMED_RULES" | grep -c '.' || echo "0")
  ok "报告中引用了 $RULE_COUNT 条规则 ID"

  UNVERIFIED_RULES=""
  while read -r rule_id; do
    [ -z "$rule_id" ] && continue
    CODE_HIT=$(find "$PROJECT_DIR" -type f \( -name '*.py' -o -name '*.ts' -o -name '*.js' -o -name '*.tsx' -o -name '*.vue' \) \
      -not -path '*/.shadow/*' -not -path '*/node_modules/*' \
      -exec grep -l "$rule_id" {} + 2>/dev/null | head -1 || true)
    if [ -z "$CODE_HIT" ]; then
      UNVERIFIED_RULES="$UNVERIFIED_RULES $rule_id"
    fi
  done < <(echo "$CLAIMED_RULES")

  if [ -n "$UNVERIFIED_RULES" ]; then
    fail "报告声称验证了规则但代码中找不到: $UNVERIFIED_RULES"
  else
    ok "报告声称验证的规则在代码中都有对应实现"
  fi
else
  warn "报告中未引用具体规则 ID（无法抽查规则覆盖）"
fi

# --- 4. Harness 计划文件覆盖率 vs 报告声称 ---
echo ""
echo "--- Harness 计划覆盖 vs 报告声称 ---"

if [ -n "$HARNESS_PLAN" ]; then
  HARNESS_FILE_COUNT=$(grep -cE '^### 文件:' "$HARNESS_PLAN" 2>/dev/null || echo "0")
  REPORT_FILE_COUNT=$(echo "$CLAIMED_FILES" | grep -c '.' 2>/dev/null || echo "0")

  if [ "$HARNESS_FILE_COUNT" -gt 0 ] && [ "$REPORT_FILE_COUNT" -gt 0 ]; then
    if [ "$REPORT_FILE_COUNT" -lt "$((HARNESS_FILE_COUNT / 2))" ]; then
      fail "报告只抽查了 $REPORT_FILE_COUNT 个文件，但 Harness 计划有 $HARNESS_FILE_COUNT 个文件（抽查率 < 50%）"
    else
      ok "报告抽查了 $REPORT_FILE_COUNT/$HARNESS_FILE_COUNT 个文件"
    fi
  fi
else
  warn "无 Harness 计划，跳过覆盖率抽查"
fi

# --- 5. 检测报告中的"全部通过"空话 ---
echo ""
echo "--- 检测空话模式 ---"

VAGUE_PASS=$(grep -cE '(所有|全部|每个|均).*(通过|PASS|正确|正常|无问题|符合)' "$REPORT_FILE" 2>/dev/null || echo "0")
SPECIFIC_PASS=$(grep -cE '(文件|方法|类|函数|端点|组件).*(实现|验证|检查|测试)' "$REPORT_FILE" 2>/dev/null || echo "0")

if [ "$VAGUE_PASS" -gt 3 ] && [ "$SPECIFIC_PASS" -lt 3 ]; then
  fail "报告包含大量空话（$VAGUE_PASS 处'全部通过'类表述，仅 $SPECIFIC_PASS 处具体描述）"
else
  ok "报告表述具体度合理（空话=$VAGUE_PASS, 具体=$SPECIFIC_PASS）"
fi

echo ""
echo "=== Result: PASS=$PASS WARN=$WARN FAIL=$FAIL ==="
if [ "$FAIL" -eq 0 ]; then
  exit 0
else
  exit 1
fi
