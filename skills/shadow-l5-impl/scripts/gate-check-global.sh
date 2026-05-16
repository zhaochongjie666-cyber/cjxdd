#!/usr/bin/env bash
set -euo pipefail

# gate-check-global.sh — 全局业务线完备性检查
# 验证声明的所有业务线都有对应产物，防止整条业务线被遗漏
#
# 用法:
#   bash skills/shadow-l5-impl/scripts/gate-check-global.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SHADOW_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
SHADOW_DIR="$PROJECT_DIR/.shadow"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; NC='\033[0m'
PASS=0; FAIL=0; WARN=0
ok()   { echo -e "${GREEN}PASS${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}FAIL${NC} $1"; FAIL=$((FAIL+1)); }
warn() { echo -e "${YELLOW}WARN${NC} $1"; WARN=$((WARN+1)); }

echo "=== 全局业务线完备性检查 ==="
echo ""

# --- 1. 从 business-landscape.md 或 intent.md 提取声明的业务线 ---
echo "--- 1. 声明的业务线 ---"

DECLARED_SLUGS=""

for f in \
  "$SHADOW_DIR/L1-business/business-landscape.md" \
  "$SHADOW_DIR/L1-business/intent.md"; do
  if [ -f "$f" ]; then
    # 提取 BXX-slug 格式的业务线标识
    DECLARED_SLUGS=$(grep -oE 'B[0-9]{2}-[a-zA-Z0-9_-]+' "$f" 2>/dev/null | sort -u || true)
    if [ -n "$DECLARED_SLUGS" ]; then
      ok "从 $(basename "$f") 提取到业务线声明"
      break
    fi
  fi
done

# fallback: 从 L1-business 子目录推断
if [ -z "$DECLARED_SLUGS" ]; then
  if [ -d "$SHADOW_DIR/L1-business" ]; then
    DECLARED_SLUGS=$(find "$SHADOW_DIR/L1-business" -maxdepth 1 -mindepth 1 -type d -name "B??-*" -exec basename {} \; 2>/dev/null | sort -u || true)
    if [ -n "$DECLARED_SLUGS" ]; then
      warn "未从 business-landscape.md/intent.md 提取到业务线声明，从 L1-business 目录推断"
    fi
  fi
fi

DECLARED_COUNT=$(echo "$DECLARED_SLUGS" | grep -c '.' || echo "0")

if [ "$DECLARED_COUNT" -eq 0 ]; then
  warn "未发现任何声明的业务线（可能尚未执行 L1 Research）"
  echo "=== 全局检查结果: PASS=$PASS WARN=$WARN FAIL=$FAIL ==="
  exit 0
fi

echo "声明的业务线 ($DECLARED_COUNT 条):"
echo "$DECLARED_SLUGS" | while read -r slug; do echo "  - $slug"; done
echo ""

# --- 2. 逐层检查每条业务线的产物 ---
echo "--- 2. 逐层完备性检查 ---"

check_layer_completeness() {
  local slug="$1"
  local layer_name="$2"
  shift 2
  local paths=("$@")

  for p in "${paths[@]}"; do
    if [ -e "$p" ]; then
      return 0
    fi
  done
  return 1
}

GLOBAL_FAIL=0

while read -r slug; do
  [ -z "$slug" ] && continue
  echo ""
  echo "业务线: $slug"

  SLUG_FAIL=0

  # L1 Research
  if check_layer_completeness "$slug" "L1 Research" \
    "$SHADOW_DIR/L1-business/$slug/research.md"; then
    ok "  $slug: L1 Research ✓"
  else
    fail "  $slug: L1 Research 缺失"
    SLUG_FAIL=$((SLUG_FAIL + 1))
  fi

  # L1 Spec
  if check_layer_completeness "$slug" "L1 Spec" \
    "$SHADOW_DIR/L1-business/$slug/spec.md"; then
    ok "  $slug: L1 Spec ✓"
  else
    fail "  $slug: L1 Spec 缺失"
    SLUG_FAIL=$((SLUG_FAIL + 1))
  fi

  # L1.5 Architecture
  if check_layer_completeness "$slug" "L1.5 Architecture" \
    "$SHADOW_DIR/L1.5-architecture/$slug/architecture.md"; then
    ok "  $slug: L1.5 Architecture ✓"
  else
    fail "  $slug: L1.5 Architecture 缺失"
    SLUG_FAIL=$((SLUG_FAIL + 1))
  fi

  # L2 E2E
  if check_layer_completeness "$slug" "L2 E2E" \
    "$SHADOW_DIR/L2-e2e/$slug/e2e.md"; then
    ok "  $slug: L2 E2E ✓"
  else
    fail "  $slug: L2 E2E 缺失"
    SLUG_FAIL=$((SLUG_FAIL + 1))
  fi

  # L5 Harness Plan
  if check_layer_completeness "$slug" "L5 Plan" \
    "$SHADOW_DIR/L5-plan/$slug/harness-plan.md"; then
    ok "  $slug: L5 Plan ✓"
  else
    fail "  $slug: L5 Plan 缺失"
    SLUG_FAIL=$((SLUG_FAIL + 1))
  fi

  # L6 Deploy (可选，可能在迭代中)
  DEPLOY_FOUND=false
  source "$PROJECT_DIR/skills/shadow-l1-flow/scripts/iter-helpers.sh" 2>/dev/null || true
  if type resolve_iter_root &>/dev/null; then
    ITER_ROOT="$(resolve_iter_root "$PROJECT_DIR")"
    for f in \
      "$ITER_ROOT/L6-deploy/$slug/deployment-report.md" \
      "$SHADOW_DIR/L6-deploy/$slug/deployment-report.md"; do
      if [ -f "$f" ]; then
        ok "  $slug: L6 Deploy ✓"
        DEPLOY_FOUND=true
        break
      fi
    done
  fi
  $DEPLOY_FOUND || warn "  $slug: L6 Deploy 未开始（可能在迭代中）"

  if [ "$SLUG_FAIL" -gt 0 ]; then
    fail "  $slug: 缺失 $SLUG_FAIL 层产物 — 整条业务线不完整"
    GLOBAL_FAIL=$((GLOBAL_FAIL + 1))
  fi
done < <(echo "$DECLARED_SLUGS")

# --- 3. .done 标记覆盖检查 ---
echo ""
echo "--- 3. .done 标记覆盖检查 ---"

while read -r slug; do
  [ -z "$slug" ] && continue

  DONE_COUNT=$(find "$SHADOW_DIR" -name "${slug}-*.done" -o -name "*.done" -path "*/feature-status/${slug}/*" 2>/dev/null | wc -l || echo "0")

  HARNESS=""
  for f in \
    "$SHADOW_DIR/L5-plan/$slug/harness-plan.md" \
    "$(find "$SHADOW_DIR/L5-plan" -maxdepth 2 -name 'harness-plan.md' -path "*$slug*" 2>/dev/null | head -1)"; do
    [ -f "$f" ] && HARNESS="$f" && break
  done

  if [ -n "$HARNESS" ]; then
    BATCH_COUNT=$(grep -cE '^## Batch|^### Batch' "$HARNESS" 2>/dev/null || echo "0")
    NODE_COUNT=$(grep -cE '^### 文件:' "$HARNESS" 2>/dev/null || echo "0")
    if [ "$BATCH_COUNT" -gt 0 ] || [ "$NODE_COUNT" -gt 0 ]; then
      EXPECTED_DONE=$((BATCH_COUNT > NODE_COUNT ? BATCH_COUNT : NODE_COUNT))
      if [ "$DONE_COUNT" -lt "$EXPECTED_DONE" ]; then
        fail "$slug: .done 标记 ($DONE_COUNT) < 预期 ($EXPECTED_DONE from Harness)"
      else
        ok "$slug: .done 标记覆盖充分 ($DONE_COUNT)"
      fi
    else
      warn "$slug: Harness 计划无 Batch/文件定义"
    fi
  else
    warn "$slug: 无 Harness 计划，跳过 .done 覆盖检查"
  fi
done < <(echo "$DECLARED_SLUGS")

echo ""
echo "=== 全局业务线完备性检查结果: PASS=$PASS WARN=$WARN FAIL=$FAIL ==="
if [ "$FAIL" -eq 0 ]; then
  exit 0
else
  exit 1
fi
