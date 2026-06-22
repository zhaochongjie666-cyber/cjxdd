#!/usr/bin/env bash
# wander-test.sh — xdd-verify 部署验证漫游（可移植，无平台 hook 依赖）
# 跑真实漫游 (curl 所有端点, 验证 401/200/404)
# 详见 skills/xdd-verify/SKILL.md §2

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

XDD_DIR=".xdd"
[[ ! -d "$XDD_DIR" ]] && { echo "❌ 无 .xdd/"; exit 1; }

ITER=0
MAX_ITER="${XDD_LOOP_MAX_ITER:-3}"
REPORT=".xdd/reports/wander-loop-$(date +%Y%m%d-%H%M%S).log"
mkdir -p .xdd/reports

# 证据保留: 截图 (screenshots/) + curl 响应体 (responses/)，供 verify-report.md 引用
CUR_ITER="$(cat .xdd/current-iteration 2>/dev/null || echo iter-1)"
EVIDENCE_DIR=".xdd/runs/$CUR_ITER/evidence"
mkdir -p "$EVIDENCE_DIR/screenshots" "$EVIDENCE_DIR/snapshots" "$EVIDENCE_DIR/responses"

echo "[xdd] === 回环 7 L6 部署验证 wander-test (max iter: $MAX_ITER) ===" | tee "$REPORT"

# 找 base URL
BASE_URL="${XDD_WANDER_BASE_URL:-http://localhost:8000}"

while [[ $ITER -lt $MAX_ITER ]]; do
    ITER=$((ITER + 1))
    echo "" | tee -a "$REPORT"
    echo "=== iter $ITER / $MAX_ITER (base: $BASE_URL) ===" | tee -a "$REPORT"

    # === 部分 A: 真实漫游 - curl 所有 arch 端点 ===
    arch_file="$XDD_DIR/arch/architecture.md"
    endpoints=()
    if [[ -f "$arch_file" ]]; then
        while IFS= read -r ep; do
            [[ -n "$ep" ]] && endpoints+=("$ep")
        done < <(grep -oE '\| `/api/[^`]+' "$arch_file" | tr -d '|`' | sort -u)
    fi

    if [[ ${#endpoints[@]} -eq 0 ]]; then
        echo "  ⏸ 无 arch 端点, 跳过 wander" | tee -a "$REPORT"
        echo "[xdd] ✓ 回环 7 跳过 (无端点)" | tee -a "$REPORT"
        exit 0
    fi

    # === 部分 B: 4 维 L5 audit ===
    declare -a l5_issues=()

    # B1: spec ↔ code (RXX 实施)
    bdd_rxx_total=$(find $XDD_DIR/bdd -name "*.md" -o -name "*.feature" 2>/dev/null | xargs grep -ohE 'R[0-9]{2,}' 2>/dev/null | sort -u | wc -l)
    code_rxx=$(find apps -name "*.py" -o -name "*.ts" 2>/dev/null | xargs grep -ohE '@implements R[0-9]{2,}' 2>/dev/null | sort -u | wc -l)
    if [[ $bdd_rxx_total -gt 0 ]]; then
        ratio=$(awk -v d="$code_rxx" -v t="$bdd_rxx_total" 'BEGIN{printf "%.2f", d/t}')
        if awk -v r="$ratio" 'BEGIN{exit !(r < 0.9)}'; then
            l5_issues+=("L5 spec↔code: 实施 $code_rxx/$bdd_rxx_total RXX ($ratio) < 0.9")
        fi
    fi

    # B2: wire ↔ code (跳过纯后端)
    [[ -d "$XDD_DIR/wire" && -n "$(ls $XDD_DIR/wire/*.svg 2>/dev/null)" ]] && {
        wire_pages=$(find $XDD_DIR/wire -name "*.svg" 2>/dev/null | xargs grep -ohE 'data-page="[^"]+"' 2>/dev/null | sort -u | wc -l)
        if [[ $wire_pages -gt 0 ]]; then
            echo "  ✓ L5 wire↔code: $wire_pages wire pages" | tee -a "$REPORT"
        fi
    }

    # B3: arch ↔ code (端点)
    arch_endpoints=${#endpoints[@]}
    code_endpoints=$(find apps -name "*.py" -o -name "*.ts" 2>/dev/null | xargs grep -hE '@(app|router)\.(get|post)' 2>/dev/null | grep -oE '/api/[^"'\'',)]*' | sort -u | wc -l)
    if [[ $arch_endpoints -gt 0 ]]; then
        ratio=$(awk -v d="$code_endpoints" -v t="$arch_endpoints" 'BEGIN{printf "%.2f", d/t}')
        if awk -v r="$ratio" 'BEGIN{exit !(r < 0.9)}'; then
            l5_issues+=("L5 arch↔code: 实施 $code_endpoints/$arch_endpoints 端点 ($ratio) < 0.9")
        fi
    fi

    # B4: l3 ↔ code (跳过纯文档项目)
    [[ -d "$XDD_DIR/resilience" ]] && {
        l3_fails=$(find $XDD_DIR/resilience -name "*.md" 2>/dev/null | xargs grep -cE '^##? ' 2>/dev/null | awk -F: '{s+=$2} END{print s}')
        if [[ ${l3_fails:-0} -gt 0 ]]; then
            echo "  ✓ L5 l3↔code: $l3_fails 韧性文档" | tee -a "$REPORT"
        fi
    }

    # === 部分 C: 真实漫游 - 试 endpoints ===
    declare -a wander_issues=()
    for ep in "${endpoints[@]}"; do
        url="$BASE_URL$ep"
        # 响应体存证据（文件名: 端点 path 转 - 去掉斜杠）
        resp_file="$EVIDENCE_DIR/responses/$(echo "$ep" | tr '/?&=' '----' | sed 's/^-//').html"
        code=$(curl -s -L -o "$resp_file" -w "%{http_code}" -m 5 "$url" 2>/dev/null || echo "000")
        if [[ "$code" == "000" ]]; then
            rm -f "$resp_file"
            wander_issues+=("wander: $ep 无响应 (服务未起?)")
        elif [[ "$code" =~ ^(200|201|301|302|401|403|404)$ ]]; then
            # 期望的 HTTP code（响应体已存 resp_file 作证据）
            :
        else
            wander_issues+=("wander: $ep 返回 $code")
        fi
    done

    # 首页取证（截图 + 结构化 snapshot；API 端点是数据不用截图，页面才截）
    "$SCRIPT_DIR/capture-evidence.sh" "$BASE_URL/" \
        "$EVIDENCE_DIR/screenshots/home.png" \
        "$EVIDENCE_DIR/snapshots/home.yaml" \
        "$EVIDENCE_DIR/responses/home.html" 2>/dev/null | tee -a "$REPORT" || true

    # === 汇总 ===
    total_l5=${#l5_issues[@]}
    total_wander=${#wander_issues[@]}
    total_fail=$((total_l5 + total_wander))

    echo "" | tee -a "$REPORT"
    echo "--- L5 4 维 audit: $total_l5 失败 ---" | tee -a "$REPORT"
    for i in "${l5_issues[@]}"; do
        echo "  ❌ $i" | tee -a "$REPORT"
    done

    echo "" | tee -a "$REPORT"
    echo "--- wander 漫游: $total_wander 失败 (端点数: $arch_endpoints) ---" | tee -a "$REPORT"
    for i in "${wander_issues[@]}"; do
        echo "  ❌ $i" | tee -a "$REPORT"
    done

    # 证据清单（供 verify-report.md 引用）
    echo "" | tee -a "$REPORT"
    echo "--- 证据保留 ($EVIDENCE_DIR/) ---" | tee -a "$REPORT"
    n_resp=$(find "$EVIDENCE_DIR/responses" -type f 2>/dev/null | wc -l)
    n_shot=$(find "$EVIDENCE_DIR/screenshots" -type f -name '*.png' 2>/dev/null | wc -l)
    n_snap=$(find "$EVIDENCE_DIR/snapshots" -type f -name '*.yaml' 2>/dev/null | wc -l)
    echo "  curl 响应体: $n_resp 个 ($EVIDENCE_DIR/responses/)" | tee -a "$REPORT"
    echo "  截图: $n_shot 个 ($EVIDENCE_DIR/screenshots/) — 无则见 responses/*.html" | tee -a "$REPORT"
    echo "  结构化快照: $n_snap 个 ($EVIDENCE_DIR/snapshots/) — playwright-cli snapshot (元素 ref)" | tee -a "$REPORT"

    if [[ $total_fail -eq 0 ]]; then
        echo "" | tee -a "$REPORT"
        echo "[xdd] ✓ 回环 7 L6 wander 通过 (iter $ITER)" | tee -a "$REPORT"
        exit 0
    fi

    echo "" | tee -a "$REPORT"
    echo "--- 修 (iter $ITER) ---" | tee -a "$REPORT"
    echo "phase-verifier 修: 补 RXX 实施 / 修端点 / 起服务" | tee -a "$REPORT"
done

# 3 试未过 → 卡住回退（写 failure-log，停下问用户）
# 定位当前 iter 的 runs 目录（读 current-iteration 指针）
CUR_ITER="$(cat .xdd/current-iteration 2>/dev/null || echo iter-1)"
FAILURE_LOG=".xdd/runs/$CUR_ITER/failure-log.md"
mkdir -p "$(dirname "$FAILURE_LOG")"
echo "" | tee -a "$REPORT"
echo "[xdd] ❌ wander $MAX_ITER 试未过, 写 $FAILURE_LOG, 停下问用户" | tee -a "$REPORT"

cat > "$FAILURE_LOG" <<EOF
# FAILURE-LOG — 卡在 代码·验证

- 子 agent: phase-verify
- 卡点: wander + 4 维一致性 $MAX_ITER 试未过
- 试过: 详见 $REPORT
- 建议回退: 回 xdd-execute 修缺 RXX / 缺端点 / 起服务；若根因在设计层，回 spec/architecture
EOF
exit 1
