#!/usr/bin/env bash
set -euo pipefail

# 用法:
#   bash skills/shadow-l1-flow/scripts/check-semantic-gate-l1.sh <slug>
#   bash skills/shadow-l1-flow/scripts/check-semantic-gate-l1.sh l1 <slug>

if [ "${1:-}" = "l1" ]; then
  LAYER="l1"
  SLUG="${2:-}"
else
  LAYER="l1"
  SLUG="${1:-}"
fi
[ -z "$SLUG" ] && { echo "用法: $0 [l1] <slug>"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SHADOW_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"

# 使用 iter-helpers.sh 解析迭代作用域
HELPERS="$PROJECT_DIR/skills/shadow-l1-flow/scripts/iter-helpers.sh"
[ -f "$HELPERS" ] && source "$HELPERS"

# 确定迭代作用域根目录
if type resolve_iter_root &>/dev/null; then
  ITER_ROOT="$(resolve_iter_root "$PROJECT_DIR")"
else
  # fallback: 无迭代标记时使用旧版路径
  ITER_ROOT="$PROJECT_DIR/.shadow"
fi

SEMANTIC_GATE_DIR="$ITER_ROOT/reviews/semantic-gate"
mkdir -p "$SEMANTIC_GATE_DIR"

REPORT_FILE=""
for f in \
  "$SEMANTIC_GATE_DIR/l1.$SLUG.md" \
  "$PROJECT_DIR/.shadow/L1-business/$SLUG/reviews/semantic-gate.md"; do
  [ -f "$f" ] && REPORT_FILE="$f" && break
done

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; NC='\033[0m'
PASS=0; FAIL=0
ok()  { echo -e "${GREEN}PASS${NC} $1"; PASS=$((PASS+1)); }
fail(){ echo -e "${RED}FAIL${NC} $1"; FAIL=$((FAIL+1)); }

[ -n "$REPORT_FILE" ] || {
  fail "语义 Gate 报告缺失: $SEMANTIC_GATE_DIR/l1.$SLUG.md"
  echo "=== Result: PASS=$PASS FAIL=$FAIL ==="
  exit 1
}
ok "语义 Gate 报告存在: $(basename "$REPORT_FILE")" "l1.semantic.report.exists" "$REPORT_FILE"

grep -Eiq "Verdict:\s*PASS|verdict:\s*PASS" "$REPORT_FILE" && ok "Verdict = PASS" "l1.semantic.verdict" || fail "Verdict 不是 PASS" "l1.semantic.verdict" "" "将 Verdict 改为 PASS，或先修正报告中列出的阻塞问题"
grep -Eq "实现指导性" "$REPORT_FILE" && ok "包含实现指导性章节" "l1.semantic.section.guidance" || fail "缺少实现指导性章节" "l1.semantic.section.guidance" "" "补齐实现指导性章节"
grep -Eq "人类可读性" "$REPORT_FILE" && ok "包含人类可读性章节" "l1.semantic.section.readability" || fail "缺少人类可读性章节" "l1.semantic.section.readability" "" "补齐人类可读性章节"
grep -Eq "业务完整性" "$REPORT_FILE" && ok "包含业务完整性章节" "l1.semantic.section.completeness" || fail "缺少业务完整性章节" "l1.semantic.section.completeness" "" "补齐业务完整性章节"
grep -Eq "必改项" "$REPORT_FILE" && ok "包含必改项章节" "l1.semantic.section.must-fix" || fail "缺少必改项章节" "l1.semantic.section.must-fix" "" "补齐必改项章节并列出必须修复内容"

# 至少 3 条 evidence / finding（宽松匹配）
count=$(grep -Ec "^[0-9]+\. |^- " "$REPORT_FILE" || true)
if [ "$count" -ge 3 ]; then ok "报告包含足够条目（>=3）" "l1.semantic.evidence-count" "$count"; else fail "报告条目不足（<3）" "l1.semantic.evidence-count" "$count" "至少补足 3 条审查条目"; fi

echo "=== Result: PASS=$PASS FAIL=$FAIL ==="
if [ "$FAIL" -eq 0 ]; then
  exit 0
else
  exit 1
fi
