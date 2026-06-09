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

# 5 角色 + 期望工件
declare -A expected_artifacts=(
    ["design_baseline"]="intent.md spec.md architecture.md plan.md"
    ["process_output"]="status.md scaffold.log deploy.log"
    ["evidence_archive"]="verify/ test-results/ chaos-results/"
    ["control_marker"]=".xdd-halt.json .l5-unresolved.json .xdd-iter.lock"
    ["template_instance"]="scale.md BXX-*.md xdd-schema.json"
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
    exit 0
else
    echo "[xdd] ❌ R5 lifecycle 失败角色:" >&2
    for f in "${failed_categories[@]}"; do
        echo "[xdd]    - $f" >&2
    done
    echo "[xdd]    修法: 加载 xdd-artifact-lifecycle skill, 补齐缺失工件" >&2
    exit 2
fi
