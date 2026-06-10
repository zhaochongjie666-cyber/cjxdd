#!/bin/bash
# xdd-gate-coverage-check.sh — 设计 vs 实施覆盖率检查
# session c3692b46 教训: 60 端点只实施 23 (38%) — 这次 95% 阈值强制
#
# 检查维度:
#  1. API 端点: arch 设计的端点 vs 代码实际暴露的端点 (≥ 0.95)
#  2. BDD 规则: spec.md RXX vs 代码 @implements RXX (≥ 0.95)
#  3. 真实持久化: InMemoryRepository / mock 比例 (≤ 0.05)
#  4. 跨服务 BXX 业务线: 每个 BXX 至少 1 个 e2e (≥ 0.95)
#  5. 跨服务真链路: 真跑 producer→queue→consumer→DB (实施 #17, 放水 1 修)
#
# 阈值: 0.95 (用户调整, 80% → 95%)

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=xdd-gate-lib.sh
source "$SCRIPT_DIR/xdd-gate-lib.sh"

is_meta_project && exit 0

xdd_dir=$(get_xdd_dir)
[[ -z "$xdd_dir" ]] && exit 2

# 阈值 (可被 env 覆盖, 默认 0.95)
THRESHOLD="${XDD_COVERAGE_THRESHOLD:-0.95}"

# 模式: --api / --bdd / --persistence / --cross-biz / --all
# 新增: --cross-service-real-path (实施 #17, 放水 1 修: 真跑 producer→queue→consumer→DB)
MODE="${1:-all}"

# === 实施 #17: 跨服务真链路模式 (放水 1 修) ===
if [[ "$MODE" == "--cross-service-real-path" ]]; then
    # scale-driven: L 规模 ≥ 5 路径, S/M ≥ 2 路径 (跟 strict_mode 读)
    # 用跟 read_scale_field 一致的 grep+sed 模式 (scale.md 是 `key: value` YAML 格式)
    scale_label=$(grep -E "^\s*scale\s*[|:]" .xdd/scale.md 2>/dev/null | head -1 | sed -E 's/.*scale\s*[|:]\s*([A-Za-z]+).*/\1/' | tr -d '[:space:]')
    scale_label="${scale_label:-L}"
    strict_mode=$(grep -E "^\s*strict_mode\s*[|:]" .xdd/scale.md 2>/dev/null | head -1 | sed -E 's/.*strict_mode\s*[|:]\s*([a-zA-Z]+).*/\1/' | tr -d '[:space:]')
    strict_mode="${strict_mode:-true}"
    if [[ "$scale_label" == "L" || "$strict_mode" == "true" ]]; then
        min_paths=5
    else
        min_paths=2
    fi
    echo "[xdd]   scale=$scale_label strict_mode=$strict_mode → min_paths=$min_paths"

    # 收集 @cross-service-e2e 块
    scenarios_raw=$(collect_real_path_scenarios 2>/dev/null)
    if [[ -z "$scenarios_raw" ]]; then
        echo "[xdd] ❌ 闸门 4 跨服务真链路: 无 @cross-service-e2e scenario (在 .xdd/baseline/arch/*/event-contract.md 写触发+期望块)" >&2
        echo "[xdd]    示例:"
        echo "[xdd]    \`\`\`"
        echo "[xdd]    @cross-service-e2e B03-train-model"
        echo "[xdd]    trigger: POST http://localhost:38080/api/v1/training-jobs {\"project_id\":\"...\"}"
        echo "[xdd]    wait: 5"
        echo "[xdd]    expect: queue|asynq:training:job|nonzero"
        echo "[xdd]    \`\`\`"
        exit 2
    fi

    passed=0; failed=0; total=0
    while IFS='|' read -r name method url body wait ekind etarget evalue; do
        [[ -z "$name" ]] && continue
        total=$((total + 1))
        # body 里的换行/多余空格清掉
        body=$(echo "$body" | tr -d '\n' | sed 's/  */ /g')
        if execute_real_path_scenario "$name" "$method" "$url" "$body" "$wait" "$ekind" "$etarget" "$evalue"; then
            passed=$((passed + 1))
        else
            failed=$((failed + 1))
        fi
    done <<< "$scenarios_raw"

    echo "[xdd] 闸门 4 跨服务真链路: $passed/$total PASS (min_paths=$min_paths)"
    if [[ $total -lt $min_paths ]]; then
        echo "[xdd] ❌ scenario 总数 $total < $min_paths (L 规模/strict 需 ≥ 5, S/M 需 ≥ 2)" >&2
        exit 2
    fi
    # 任一失败 → exit 2
    if [[ $failed -gt 0 ]]; then
        echo "[xdd] ❌ 闸门 4 跨服务真链路: $failed 失败 (exit 2, orchestrator 派 subagent 修)" >&2
        exit 2
    fi
    echo "[xdd] ✓ 闸门 4 跨服务真链路: 全过"
    exit 0
fi

# 收集 arch 设计的端点清单
arch_endpoints=()
if [[ -f "$xdd_dir/arch/architecture.md" ]]; then
    while IFS= read -r line; do
        ep=$(echo "$line" | grep -oE '\| `/api/[^`]+`' | head -1 | tr -d '|`' || true)
        [[ -n "$ep" ]] && arch_endpoints+=("$ep")
    done < <(grep -E '^\| `/api/' "$xdd_dir/arch/architecture.md" 2>/dev/null || true)
fi

# 收集代码实际端点
code_endpoints=()
for app_dir in apps/*/src; do
    [[ -d "$app_dir" ]] || continue
    while IFS= read -r ep; do
        [[ -n "$ep" ]] && code_endpoints+=("$ep")
    done < <(grep -rhE '@(app|router)\.(get|post|put|delete|patch)\(["'\''/]?(/api/[^"'\'',)]*)' "$app_dir" 2>/dev/null | grep -oE '/api/[^"'\'',)]*' | sort -u)
done

# 计算 API 端点覆盖率
api_total=${#arch_endpoints[@]}
api_done=${#code_endpoints[@]}
api_ratio=0
if [[ $api_total -gt 0 ]]; then
    # 简化: 算交集 / 总
    matched=0
    for arch_ep in "${arch_endpoints[@]}"; do
        for code_ep in "${code_endpoints[@]}"; do
            if [[ "$arch_ep" == "$code_ep" ]]; then
                ((matched++)) || true
                break
            fi
        done
    done
    api_ratio=$(awk -v m="$matched" -v t="$api_total" 'BEGIN{printf "%.4f", m/t}')
fi

# 收集 BDD RXX
bdd_rxx=()
if [[ -d "$xdd_dir/bdd" ]]; then
    while IFS= read -r r; do
        [[ -n "$r" ]] && bdd_rxx+=("$r")
    done < <(grep -rhE 'R[0-9]{2,}' "$xdd_dir/bdd/" 2>/dev/null | grep -oE 'R[0-9]{2,}' | sort -u)
fi

# 收集代码 @implements RXX
code_rxx=()
for app_dir in apps/*/src; do
    [[ -d "$app_dir" ]] || continue
    while IFS= read -r r; do
        [[ -n "$r" ]] && code_rxx+=("$r")
    done < <(grep -rhE '@implements R[0-9]{2,}' "$app_dir" 2>/dev/null | grep -oE 'R[0-9]{2,}' | sort -u)
done

bdd_total=${#bdd_rxx[@]}
bdd_done=${#code_rxx[@]}
bdd_ratio=0
if [[ $bdd_total -gt 0 ]]; then
    matched=0
    for r in "${bdd_rxx[@]}"; do
        for c in "${code_rxx[@]}"; do
            if [[ "$r" == "$c" ]]; then
                ((matched++)) || true
                break
            fi
        done
    done
    bdd_ratio=$(awk -v m="$matched" -v t="$bdd_total" 'BEGIN{printf "%.4f", m/t}')
fi

# 真实持久化: 算 InMemoryRepository + mock 出现次数
mock_count=0
total_repos=0
for app_dir in apps/*/src; do
    [[ -d "$app_dir" ]] || continue
    total_repos=$((total_repos + $(grep -rE 'class.*Repository' "$app_dir" 2>/dev/null | wc -l)))
    mock_count=$((mock_count + $(grep -rE 'InMemoryRepository|MockRepository|class.*InMemory' "$app_dir" 2>/dev/null | wc -l)))
done

persistence_ratio=0
if [[ $total_repos -gt 0 ]]; then
    real=$((total_repos - mock_count))
    persistence_ratio=$(awk -v r="$real" -v t="$total_repos" 'BEGIN{printf "%.4f", r/t}')
fi

# 跨服务 BXX 业务线 (v2.0 9→6 合并: business → bdd/{slug}/business.md)
bxx_count=0
bxx_with_e2e=0
if [[ -d "$xdd_dir/baseline/bdd" ]]; then
    # 新路径: baseline/bdd/B*/business.md
    bxx_count=$(find "$xdd_dir/baseline/bdd" -maxdepth 2 -name "business.md" -path "*/B*" 2>/dev/null | wc -l)
    # 兜底: 老路径 .xdd/business/B*.md (兼容老 demo)
    if [[ $bxx_count -eq 0 && -d "$xdd_dir/business" ]]; then
        bxx_count=$(find "$xdd_dir/business" -name "B*.md" 2>/dev/null | wc -l)
    fi
    bxx_with_e2e=$(grep -lE "e2e.*B[0-9]{2}" tests/e2e/ -r 2>/dev/null | wc -l)
fi
cross_ratio=0
if [[ $bxx_count -gt 0 ]]; then
    cross_ratio=$(awk -v m="$bxx_with_e2e" -v t="$bxx_count" 'BEGIN{printf "%.4f", m/t}')
fi

# 报告
echo "[xdd] === 100% 完成度 6 闸门 (阈值 $THRESHOLD) ==="

fail=0

# 1. API 端点覆盖率
if [[ "$MODE" == "all" || "$MODE" == "--api" ]]; then
    api_pct=$(awk -v r="$api_ratio" 'BEGIN{printf "%.1f", r*100}')
    api_threshold_pct=$(awk -v t="$THRESHOLD" 'BEGIN{printf "%.1f", t*100}')
    if awk -v r="$api_ratio" -v t="$THRESHOLD" 'BEGIN{exit !(r >= t)}'; then
        echo "[xdd] ✓ 1. API 端点: $api_done/$api_total 实施 (${api_pct}%, 阈值 ${api_threshold_pct}%)"
    else
        echo "[xdd] ❌ 1. API 端点: $api_done/$api_total 实施 (${api_pct}%, 阈值 ${api_threshold_pct}%)" >&2
        fail=1
    fi
fi

# 2. BDD 覆盖率
if [[ "$MODE" == "all" || "$MODE" == "--bdd" ]]; then
    bdd_pct=$(awk -v r="$bdd_ratio" 'BEGIN{printf "%.1f", r*100}')
    bdd_threshold_pct=$(awk -v t="$THRESHOLD" 'BEGIN{printf "%.1f", t*100}')
    if awk -v r="$bdd_ratio" -v t="$THRESHOLD" 'BEGIN{exit !(r >= t)}'; then
        echo "[xdd] ✓ 2. BDD RXX: $bdd_done/$bdd_total 实施 (${bdd_pct}%, 阈值 ${bdd_threshold_pct}%)"
    else
        echo "[xdd] ❌ 2. BDD RXX: $bdd_done/$bdd_total 实施 (${bdd_pct}%, 阈值 ${bdd_threshold_pct}%)" >&2
        fail=1
    fi
fi

# 3. 真实持久化 (反向: mock 必须 ≤ 5%)
if [[ "$MODE" == "all" || "$MODE" == "--persistence" ]]; then
    p_pct=$(awk -v r="$persistence_ratio" 'BEGIN{printf "%.1f", r*100}')
    if awk -v r="$persistence_ratio" -v t="$THRESHOLD" 'BEGIN{exit !(r >= t)}'; then
        echo "[xdd] ✓ 3. 真实持久化: $p_pct% 真 DB (阈值 ≥ ${THRESHOLD})"
    else
        echo "[xdd] ❌ 3. 真实持久化: $p_pct% 真 DB, $mock_count mock (阈值 ≥ ${THRESHOLD})" >&2
        fail=1
    fi
fi

# 4. 跨服务 BXX
if [[ "$MODE" == "all" || "$MODE" == "--cross-biz" ]]; then
    cross_pct=$(awk -v r="$cross_ratio" 'BEGIN{printf "%.1f", r*100}')
    cross_threshold_pct=$(awk -v t="$THRESHOLD" 'BEGIN{printf "%.1f", t*100}')
    if awk -v r="$cross_ratio" -v t="$THRESHOLD" 'BEGIN{exit !(r >= t)}'; then
        echo "[xdd] ✓ 4. 跨服务 BXX: $bxx_with_e2e/$bxx_count 有 e2e (${cross_pct}%, 阈值 ${cross_threshold_pct}%)"
    else
        echo "[xdd] ❌ 4. 跨服务 BXX: $bxx_with_e2e/$bxx_count 有 e2e (${cross_pct}%, 阈值 ${cross_threshold_pct}%)" >&2
        fail=1
    fi
fi

if [[ $fail -eq 0 ]]; then
    echo "[xdd] === 全部闸门通过 ==="
    exit 0
else
    echo "[xdd] === 至少 1 闸门失败, 触发 subagent 修复 ===" >&2
    exit 2
fi
