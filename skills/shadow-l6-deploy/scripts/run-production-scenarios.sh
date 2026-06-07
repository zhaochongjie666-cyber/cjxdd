#!/usr/bin/env bash
# run-production-scenarios.sh — Shadow L6 Phase 5.8 (P0-X Round 2)
# 用法: bash run-production-scenarios.sh <slug> [extra-playwright-args...]
#
# 行为:
#   - 读 .shadow/L2-e2e/<slug>/production-scenarios/prod.config.json
#   - 验证真实账号 env (E2E_USER_ENGINEER / E2E_USER_RESEARCHER / E2E_PASSWORD / E2E_TENANT_ID)
#   - cd 到 production-scenarios/ 跑 npx playwright test --grep @P0
#   - evidence 落 .shadow/iterations/iter-N/L6-deploy/<slug>/prod-evidence/
#   - 跑通写 smoke-test-passed marker (含 prod-config-hash 防复用)
#   - chmod 444 marker + evidence (R3 联动)
#   - 退出码: 0=PASS / 1=playwright failed / 2=契约违反 / 3=selector 不存在
#
# R11 Round 2 4 层验证消费此 marker:
#   L1: mtime < 7 天
#   L2: 首行正则 'production-scenarios @production: [0-9]+ passed'
#   L3: prod-evidence/summary.json.failed == 0 + playwright.log 末行 passed
#   L4: marker 中 prod-config-hash == prod-evidence/prod-config-hash.txt

set -euo pipefail

SLUG="${1:?usage: $0 <slug> [extra-args...]}"
shift || true

PROJECT_ROOT="${PROJECT_ROOT:-$(pwd)}"
SHADOW_DIR="$PROJECT_ROOT/.shadow"
[[ -d "$SHADOW_DIR" ]] || { echo "❌ $SHADOW_DIR 不存在" >&2; exit 2; }

ITER=""
if [[ -f "$SHADOW_DIR/current-iteration" ]]; then
    ITER=$(cat "$SHADOW_DIR/current-iteration" | tr -d '[:space:]')
fi
ITER="${ITER:-iter-1}"

EVIDENCE_DIR="$SHADOW_DIR/iterations/$ITER/L6-deploy/$SLUG/prod-evidence"
PROD_DIR="$SHADOW_DIR/L2-e2e/$SLUG/production-scenarios"
MARKER_PATH="$SHADOW_DIR/iterations/$ITER/L6-deploy/$SLUG/smoke-test-passed"

mkdir -p "$EVIDENCE_DIR"

# ───────── 1. 必存在性 (exit 2: 契约违反) ─────────
if [[ ! -f "$PROD_DIR/prod.config.json" ]]; then
    echo "❌ Phase 5.8 契约违反: $PROD_DIR/prod.config.json 缺失" >&2
    echo "   处置: L2 阶段必须先写 prod.config.json (见 skills/shadow-l2-e2e/templates/production-scenarios.md)" >&2
    exit 2
fi

if [[ ! -d "$PROD_DIR/specs" ]]; then
    echo "❌ Phase 5.8 契约违反: $PROD_DIR/specs/ 目录缺失" >&2
    exit 2
fi

# ───────── 2. 真实账号 env 校验 (exit 2) ─────────
PROJECT_TYPE=$(jq -r '.project_type // "fullstack"' "$PROD_DIR/prod.config.json")
REAL_ACCOUNTS_REQUIRED=$(jq -r '.production_contract.real_accounts.required // true' "$PROD_DIR/prod.config.json")

if [[ "$REAL_ACCOUNTS_REQUIRED" == "true" ]]; then
    for v in E2E_USER_ENGINEER E2E_PASSWORD E2E_TENANT_ID; do
        if [[ -z "${!v:-}" ]]; then
            echo "❌ Phase 5.8 契约违反: 真实账号 env $v 未设置" >&2
            echo "   处置: 从 secrets manager / ~/.config/shadow/secrets.env 拉, 写 env" >&2
            echo "         永不可入库 (R11 4 层验证 L4 防 marker 复用)" >&2
            exit 2
        fi
    done
fi

# 可选但强烈推荐
for v in E2E_USER_RESEARCHER E2E_BASE_URL; do
    if [[ -z "${!v:-}" ]]; then
        echo "⚠️  Phase 5.8 软警告: $v 未设 (cross_bxx / persistence 场景可能跳过)" >&2
    fi
done

# ───────── 3. pre-flight Playwright 可用性 ─────────
if ! command -v npx >/dev/null 2>&1; then
    echo "❌ Phase 5.8: npx 未装, 跑不了 playwright test" >&2
    echo "   处置: npm install -g npx && npm install -D @playwright/test" >&2
    exit 2
fi

if ! npx --no-install playwright --version >/dev/null 2>&1; then
    echo "❌ Phase 5.8: @playwright/test 未装" >&2
    echo "   处置: cd $PROD_DIR && npm init -y && npm install -D @playwright/test" >&2
    echo "         然后跑: npx playwright install --with-deps chromium" >&2
    exit 2
fi

# ───────── 4. 算 prod.config.json hash (防 marker 复用) ─────────
HASH=$(sha256sum "$PROD_DIR/prod.config.json" | awk '{print $1}')
echo "$HASH" > "$EVIDENCE_DIR/prod-config-hash.txt"
chmod 444 "$EVIDENCE_DIR/prod-config-hash.txt"

# ───────── 5. 跑 Playwright (exit 1 if fail) ─────────
cd "$PROD_DIR"

echo "▶ Phase 5.8: 跑 production-scenarios @P0 (slug=$SLUG, scale=$PROJECT_TYPE)"
echo "  evidence: $EVIDENCE_DIR"

set +e
npx playwright test --grep "@P0" \
    --reporter=json,html,list \
    --output="$EVIDENCE_DIR/playwright-output" \
    --trace=on \
    --video=retain-on-failure \
    --screenshot=on \
    "$@" 2>&1 | tee "$EVIDENCE_DIR/playwright.log"
ec=$?
set -e
cd - >/dev/null

# ───────── 6. 解析 summary.json (从 playwright JSON 报告) ─────────
JSON_REPORT="$EVIDENCE_DIR/playwright-output/results.json"
PASSED=0
FAILED=0
FLAKY=0
TOTAL_MS=0
if [[ -f "$JSON_REPORT" ]]; then
    if command -v jq >/dev/null 2>&1; then
        STATS=$(jq -r '
            {
              passed: ([.suites[].specs[]? | select(.ok==true) | .tests[]? | select(.results[0].status=="passed")] | length // 0),
              failed: ([.suites[].specs[]? | .tests[]? | select(.results[0].status=="failed" or .results[0].status=="timedOut")] | length // 0),
              flaky:  ([.suites[].specs[]? | .tests[]? | select(.results[0].status=="passed" and (.tests[0].results | length > 1))] | length // 0),
              total_ms: ((.suites[].specs[]?.tests[]?.results[]?.duration // 0) | add // 0)
            } | @base64' "$JSON_REPORT" 2>/dev/null | base64 -d 2>/dev/null || echo "")
        if [[ -n "$STATS" ]]; then
            PASSED=$(echo "$STATS" | jq -r '.passed // 0')
            FAILED=$(echo "$STATS" | jq -r '.failed // 0')
            FLAKY=$(echo "$STATS" | jq -r '.flaky // 0')
            TOTAL_MS=$(echo "$STATS" | jq -r '.total_ms // 0')
        fi
    fi
fi

# 兜底: grep playwright.log (Playwright list reporter 输出格式)
if [[ $PASSED -eq 0 && $FAILED -eq 0 ]]; then
    PASSED=$(grep -cE "^\s+✓|passed in" "$EVIDENCE_DIR/playwright.log" 2>/dev/null || echo 0)
    FAILED=$(grep -cE "^\s+✘|^\s+✗|^\s+\d+ failed" "$EVIDENCE_DIR/playwright.log" 2>/dev/null || echo 0)
    PASSED=$(echo "$PASSED" | tr -d '[:space:]')
    FAILED=$(echo "$FAILED" | tr -d '[:space:]')
    [[ -z "$PASSED" ]] && PASSED=0
    [[ -z "$FAILED" ]] && FAILED=0
fi

cat > "$EVIDENCE_DIR/summary.json" <<EOF
{
  "passed": $PASSED,
  "failed": $FAILED,
  "flaky":  $FLAKY,
  "total_ms": $TOTAL_MS,
  "exit_code": $ec,
  "prod_config_hash": "$HASH",
  "project_type": "$PROJECT_TYPE",
  "scale": "$(jq -r '.scale // "L"' "$PROD_DIR/prod.config.json")"
}
EOF

# ───────── 7. 退出码分流 ─────────
if [[ $ec -ne 0 ]]; then
    echo "❌ Phase 5.8: playwright exit=$ec (passed=$PASSED failed=$FAILED)"
    echo "   evidence 落 $EVIDENCE_DIR, 不写 marker, R11 必 fail"
    chmod -R a-w "$EVIDENCE_DIR" 2>/dev/null || true
    exit $ec
fi

# ───────── 8. 写 smoke-test-passed marker (exit 0) ─────────
TS=$(date -Iseconds)
SCALE=$(jq -r '.scale // "L"' "$PROD_DIR/prod.config.json")
EMAIL_REDACTED=$(echo "${E2E_USER_ENGINEER:-unknown}" | sed 's/\([^@]*\)@.*/\1****@***/')

cat > "$MARKER_PATH" <<EOF
${TS} | production-scenarios @production: ${PASSED} passed / ${FAILED} failed / ${FLAKY} flaky in ${TOTAL_MS}ms | playwright.config=production-scenarios/playwright.config.ts | evidence=prod-evidence/ | prod-config-hash=${HASH} | scale=${SCALE} | env-var=E2E_USER_ENGINEER=${EMAIL_REDACTED}
EOF

chmod 444 "$MARKER_PATH"
chmod -R a-w "$EVIDENCE_DIR" 2>/dev/null || true

echo "✅ Phase 5.8: ${PASSED} passed / ${FAILED} failed / ${FLAKY} flaky in ${TOTAL_MS}ms"
echo "   marker: $MARKER_PATH (chmod 444)"
echo "   evidence: $EVIDENCE_DIR/ (chmod -R 444)"

exit 0
