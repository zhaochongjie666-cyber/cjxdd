#!/bin/bash
# gate-check-lifecycle.sh — R5 hard-gate: 工件 lifecycle 校验
# 5 角色: design_baseline / process_output / evidence_archive / control_marker / template_instance
# 阈值: 0.95 (用户调整 80% → 95%)
#
# 来源: .xdd/xdd-schema.json:lifecycle_artifacts[] 单一源真理
# 详见 skills/xdd-artifact-lifecycle/SKILL.md

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 阈值
THRESHOLD="${XDD_LIFECYCLE_THRESHOLD:-0.95}"

# 5 角色 + 期望工件 (v3 4 目录扁平 — flow + resilience colocation 到 arch/{slug}/, 不再独立目录)
declare -A expected_artifacts=(
    ["design_baseline"]="baseline/research/00-intent.md baseline/bdd baseline/arch baseline/wire"
    ["process_output"]="iterations/iter-1/pipeline/status.md iterations/iter-1/plan iterations/iter-1/verify"
    ["evidence_archive"]="iterations/iter-1/verify iterations/iter-1/gate-logs iterations/iter-1/reports"
    ["control_marker"]="gates/scale.md gates/current-iteration gates/xdd-version"
    ["template_instance"]="gates/scale.md baseline/bdd/_landscape.md"
)

# 校验
xdd_dir="${PWD}/.xdd"
if [[ ! -d "$xdd_dir" ]]; then
    # 尝试向上找
    while [[ ! -d "$xdd_dir" && "$PWD" != "/" ]]; do
        cd ..
        xdd_dir="${PWD}/.xdd"
    done
    cd - >/dev/null 2>&1 || true
fi

if [[ ! -d "$xdd_dir" ]]; then
    echo "[xdd] (无 .xdd/, 跳过 R5 lifecycle gate)"
    exit 0
fi

total_categories=${#expected_artifacts[@]}
passed_categories=0
declare -a failed_categories=()

for role in "${!expected_artifacts[@]}"; do
    artifacts=${expected_artifacts[$role]}
    role_pass=0
    role_total=0

    for art in $artifacts; do
        ((role_total++)) || true
        # wildcard (e.g. BXX-*.md)
        if [[ "$art" == *"*"* ]]; then
            pattern="${art//\*/*}"
            count=$(find "$xdd_dir" -path "$xdd_dir" -prune -o -name "$art" -print 2>/dev/null | wc -l)
            [[ $count -gt 0 ]] && ((role_pass++)) || true
        else
            # 检查文件或目录
            if [[ -d "$xdd_dir/$art" ]]; then
                # 目录非空算过
                [[ -n "$(ls -A "$xdd_dir/$art" 2>/dev/null)" ]] && ((role_pass++)) || true
            elif [[ -f "$xdd_dir/$art" ]]; then
                ((role_pass++)) || true
            fi
        fi
    done

    ratio=0
    if [[ $role_total -gt 0 ]]; then
        ratio=$(awk -v p="$role_pass" -v t="$role_total" 'BEGIN{printf "%.4f", p/t}')
    fi

    if awk -v r="$ratio" -v t="$THRESHOLD" 'BEGIN{exit !(r >= t)}'; then
        ((passed_categories++)) || true
        pct=$(awk -v r="$ratio" 'BEGIN{printf "%.0f", r*100}')
        echo "[xdd] ✓ lifecycle[$role]: $role_pass/$role_total (${pct}%)"
    else
        pct=$(awk -v r="$ratio" 'BEGIN{printf "%.0f", r*100}')
        failed_categories+=("$role: $role_pass/$role_total (${pct}%)")
    fi
done

# 报告
echo "[xdd] === R5 lifecycle hard-gate (阈值 $THRESHOLD) ==="
echo "[xdd] 5 角色: $passed_categories/$total_categories 过"

if [[ ${#failed_categories[@]} -eq 0 ]]; then
    echo "[xdd] ✓ R5 lifecycle 5 角色全过 (≥ 95%)"
else
    echo "[xdd] ❌ R5 lifecycle 失败角色:" >&2
    for f in "${failed_categories[@]}"; do
        echo "[xdd]    - $f" >&2
    done
    echo "[xdd]    修法: 加载 xdd-artifact-lifecycle skill, 补齐缺失工件" >&2
fi

# === 实施 #21 (放水 6 修): FINAL-DELIVERY 拆分检查 ===
# 当 status.md 5 Execute 是 ❌ late-fail (Phase 6 back-prop) 时, FINAL-DELIVERY.md 必须有 Late Fix 段
# 当 status.md 5 Execute 是 ✅ 时, FINAL-DELIVERY.md 不应有 Late Fix 段 (矛盾)
final_delivery_path="$xdd_dir/iterations/iter-1/FINAL-DELIVERY.md"
if [[ -f "$final_delivery_path" ]]; then
    fd_has_orig=$(grep -E "原计划交付" "$final_delivery_path" 2>/dev/null | wc -l)
    fd_has_late=$(grep -E "Late Fix" "$final_delivery_path" 2>/dev/null | wc -l)
    status_5=$(grep -E "^\| *5 Execute" "$xdd_dir/iterations/iter-1/pipeline/status.md" 2>/dev/null | head -1)
    if [[ -n "$status_5" ]]; then
        if echo "$status_5" | grep -qE "❌.*late-fail"; then
            # status.md 5 Execute 是 late-fail → FINAL-DELIVERY 必须有 Late Fix
            if [[ "$fd_has_late" -eq 0 ]]; then
                echo "[xdd] ❌ FINAL-DELIVERY 缺 'Late Fix' 段 (status.md 5 Execute 是 ❌ late-fail, 矛盾)" >&2
                echo "[xdd]    修法: 在 $final_delivery_path 补 '## ⚠️ Late Fix' 段, 描述 P0/P1 修复" >&2
                failed_categories+=("final-delivery-missing-late-fix")
            else
                echo "[xdd] ✓ FINAL-DELIVERY 含 Late Fix 段 (跟 status.md ❌ late-fail 一致)"
            fi
        elif echo "$status_5" | grep -qE "✅"; then
            # status.md 5 Execute 是 ✅ → FINAL-DELIVERY 不应有 Late Fix (矛盾)
            if [[ "$fd_has_late" -gt 0 ]]; then
                echo "[xdd] ⚠️ FINAL-DELIVERY 有 Late Fix 段但 status.md 5 Execute 是 ✅ (矛盾 — back-prop 漏触发?)" >&2
                failed_categories+=("final-delivery-late-fix-status-5-ok-contradiction")
            else
                echo "[xdd] ✓ FINAL-DELIVERY 无 Late Fix 段 (跟 status.md ✅ 一致)"
            fi
        fi
    fi
    if [[ "$fd_has_orig" -eq 0 ]]; then
        echo "[xdd] ⚠️ FINAL-DELIVERY 缺 '原计划交付' 段 (实施 #21 要求 2 段: 原计划 + Late Fix)" >&2
        failed_categories+=("final-delivery-missing-orig-section")
    fi
fi

if [[ ${#failed_categories[@]} -eq 0 ]]; then
    echo "[xdd] ✓ R5 lifecycle 5 角色全过 + FINAL-DELIVERY 拆分合规"
    exit 0
else
    exit 2
fi
