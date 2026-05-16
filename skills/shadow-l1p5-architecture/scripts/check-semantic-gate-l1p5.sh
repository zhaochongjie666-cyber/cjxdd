#!/usr/bin/env bash
# check-semantic-gate-l1p5.sh — L1.5 语义 Gate 校验
# 用法: bash skills/shadow-l1p5-architecture/scripts/check-semantic-gate-l1p5.sh <slug>
#   或: bash skills/shadow-l1p5-architecture/scripts/check-semantic-gate-l1p5.sh l1p5 <slug>

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

if type resolve_iter_root &>/dev/null; then
  ITER_ROOT="$(resolve_iter_root "$PROJECT_DIR")"
else
  ITER_ROOT="$PROJECT_DIR/.shadow"
fi

SEMANTIC_GATE_DIR="$ITER_ROOT/reviews/semantic-gate"
mkdir -p "$SEMANTIC_GATE_DIR"

REPORT_FILE=""
for f in \
  "$SEMANTIC_GATE_DIR/l1p5.$SLUG.md" \
  "$PROJECT_DIR/.shadow/L1.5-architecture/$SLUG/reviews/semantic-gate.md"; do
  [ -f "$f" ] && REPORT_FILE="$f" && break
done

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; NC='\033[0m'
PASS=0; FAIL=0
ok()  { echo -e "${GREEN}PASS${NC} $1"; PASS=$((PASS+1)); }
fail(){ echo -e "${RED}FAIL${NC} $1"; FAIL=$((FAIL+1)); }

[ -n "$REPORT_FILE" ] || {
  fail "语义 Gate 报告缺失: $SEMANTIC_GATE_DIR/l1p5.$SLUG.md"
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

echo "=== Result: PASS=$PASS FAIL=$FAIL ==="
if [ "$FAIL" -eq 0 ]; then
  exit 0
else
  exit 1
fi
