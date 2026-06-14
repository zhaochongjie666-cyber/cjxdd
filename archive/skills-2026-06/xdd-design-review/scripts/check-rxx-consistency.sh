#!/bin/bash
# check-rxx-consistency.sh — 回环 2 RXX 1 致 + BXX 覆盖自动卡
# 5 工件 (bdd/flow/add/wire/arch) RXX 编号必须 1 致, BXX 业务线必须全覆盖
# 详见 skills/xdd-design-review/SKILL.md + docs/LOOP-DESIGN.md § 回环 2

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Meta 守卫
HOOK_LIB="$(cd "$SCRIPT_DIR/../../.." && pwd)/hooks/xdd-gate-lib.sh"
if [[ -f "$HOOK_LIB" ]]; then
    source "$HOOK_LIB"
    if is_meta_project 2>/dev/null; then
        echo "[xdd] (Meta 项目, 跳过)"
        exit 0
    fi
fi

XDD_DIR=".xdd"
[[ ! -d "$XDD_DIR" ]] && { echo "❌ 无 .xdd/"; exit 1; }

ITER=0
MAX_ITER="${XDD_LOOP_MAX_ITER:-3}"
REPORT=".xdd/reports/design-review-loop-$(date +%Y%m%d-%H%M%S).log"
mkdir -p .xdd/reports

echo "[xdd] === 回环 2 设计评审 RXX 1 致 (max iter: $MAX_ITER) ===" | tee "$REPORT"

while [[ $ITER -lt $MAX_ITER ]]; do
    ITER=$((ITER + 1))
    echo "" | tee -a "$REPORT"
    echo "=== iter $ITER / $MAX_ITER ===" | tee -a "$REPORT"

    # 收集 5 工件 RXX
    declare -A RXX_BDD=()
    declare -A RXX_FLOW=()
    declare -A RXX_ADD=()
    declare -A RXX_ARCH=()
    declare -A RXX_UNION=()

    # BDD (spec.md / *.feature)
    for f in $XDD_DIR/bdd/*.md $XDD_DIR/bdd/*.feature 2>/dev/null; do
        [[ -f "$f" ]] || continue
        while IFS= read -r r; do
            [[ -n "$r" ]] && RXX_BDD["$r"]=1 && RXX_UNION["$r"]=1
        done < <(grep -ohE 'R[0-9]{2,}' "$f" 2>/dev/null | sort -u)
    done

    # Flow (project.flow.mermaid)
    for f in $XDD_DIR/flow/*.mermaid $XDD_DIR/flow/*.mmd 2>/dev/null; do
        [[ -f "$f" ]] || continue
        while IFS= read -r r; do
            [[ -n "$r" ]] && RXX_FLOW["$r"]=1 && RXX_UNION["$r"]=1
        done < <(grep -ohE 'R[0-9]{2,}' "$f" 2>/dev/null | sort -u)
    done

    # Add
    for f in $XDD_DIR/add/*.md 2>/dev/null; do
        [[ -f "$f" ]] || continue
        while IFS= read -r r; do
            [[ -n "$r" ]] && RXX_ADD["$r"]=1 && RXX_UNION["$r"]=1
        done < <(grep -ohE 'R[0-9]{2,}' "$f" 2>/dev/null | sort -u)
    done

    # Arch
    for f in $XDD_DIR/arch/*.md 2>/dev/null; do
        [[ -f "$f" ]] || continue
        while IFS= read -r r; do
            [[ -n "$r" ]] && RXX_ARCH["$r"]=1 && RXX_UNION["$r"]=1
        done < <(grep -ohE 'R[0-9]{2,}' "$f" 2>/dev/null | sort -u)
    done

    # 找 1 致性
    declare -a issues=()

    # 1. bdd 的 RXX 在其他 4 工件都有引用 (bdd 是源头)
    for r in "${!RXX_BDD[@]}"; do
        if [[ -z "${RXX_FLOW[$r]:-}" ]]; then
            issues+=("RXX $r: 在 bdd 有, flow 没引用")
        fi
        if [[ -z "${RXX_ADD[$r]:-}" ]]; then
            issues+=("RXX $r: 在 bdd 有, add 没引用")
        fi
        if [[ -z "${RXX_ARCH[$r]:-}" ]]; then
            issues+=("RXX $r: 在 bdd 有, arch 没端点")
        fi
    done

    # 2. flow 的 RXX 不在 bdd (孤儿)
    for r in "${!RXX_FLOW[@]}"; do
        if [[ -z "${RXX_BDD[$r]:-}" ]]; then
            issues+=("RXX $r: flow 引用, bdd 没定义 (孤儿)")
        fi
    done

    # 3. arch 的 RXX 不在 bdd (孤儿)
    for r in "${!RXX_ARCH[@]}"; do
        if [[ -z "${RXX_BDD[$r]:-}" ]]; then
            issues+=("RXX $r: arch 引用, bdd 没定义 (孤儿)")
        fi
    done

    # === BXX 业务线覆盖 ===
    declare -a bxx_issues=()
    bxx_total=0
    bxx_in_bdd=0
    bxx_in_flow=0
    bxx_in_arch=0
    bxx_files=$(find $XDD_DIR/business -name "BXX-*.md" 2>/dev/null)
    for bf in $bxx_files; do
        bxx_id=$(basename "$bf" | grep -oE 'B[0-9]{2}')
        [[ -z "$bxx_id" ]] && continue
        ((bxx_total++))

        # 在 bdd 出现
        if grep -rq "$bxx_id" $XDD_DIR/bdd/ 2>/dev/null; then
            ((bxx_in_bdd++))
        else
            bxx_issues+=("BXX $bxx_id: 业务线文件有, bdd 没引用")
        fi

        # 在 flow 出现
        if grep -rq "$bxx_id" $XDD_DIR/flow/ 2>/dev/null; then
            ((bxx_in_flow++))
        else
            bxx_issues+=("BXX $bxx_id: 业务线文件有, flow 没节点")
        fi

        # 在 arch 出现
        if grep -rq "$bxx_id" $XDD_DIR/arch/ 2>/dev/null; then
            ((bxx_in_arch++))
        else
            bxx_issues+=("BXX $bxx_id: 业务线文件有, arch 没端点")
        fi
    done

    # === 报告 ===
    total_issues=$((${#issues[@]} + ${#bxx_issues[@]}))

    echo "" | tee -a "$REPORT"
    echo "--- RXX 编号 (1 致) ---" | tee -a "$REPORT"
    echo "BDD:   ${#RXX_BDD[@]} 唯一 RXX" | tee -a "$REPORT"
    echo "Flow:  ${#RXX_FLOW[@]} 唯一 RXX" | tee -a "$REPORT"
    echo "Add:   ${#RXX_ADD[@]} 唯一 RXX" | tee -a "$REPORT"
    echo "Arch:  ${#RXX_ARCH[@]} 唯一 RXX" | tee -a "$REPORT"
    echo "Union: ${#RXX_UNION[@]} 唯一 RXX" | tee -a "$REPORT"

    echo "" | tee -a "$REPORT"
    echo "--- BXX 业务线 (覆盖) ---" | tee -a "$REPORT"
    echo "业务线: $bxx_total 条" | tee -a "$REPORT"
    echo "Bdd:    $bxx_in_bdd / $bxx_total" | tee -a "$REPORT"
    echo "Flow:   $bxx_in_flow / $bxx_total" | tee -a "$REPORT"
    echo "Arch:   $bxx_in_arch / $bxx_total" | tee -a "$REPORT"

    echo "" | tee -a "$REPORT"
    echo "--- 发现 (${#issues[@]} RXX + ${#bxx_issues[@]} BXX = $total_issues) ---" | tee -a "$REPORT"
    for i in "${issues[@]}"; do
        echo "  ❌ $i" | tee -a "$REPORT"
    done
    for i in "${bxx_issues[@]}"; do
        echo "  ❌ $i" | tee -a "$REPORT"
    done

    # 全过 (0 RXX issues + 0 BXX issues) 才出 loop
    if [[ $total_issues -eq 0 ]]; then
        echo "" | tee -a "$REPORT"
        echo "[xdd] ✓ 回环 2 设计评审通过 (iter $ITER)" | tee -a "$REPORT"
        exit 0
    fi

    echo "" | tee -a "$REPORT"
    echo "--- 修脱节 (iter $ITER) ---" | tee -a "$REPORT"
    echo "phase-designer 修: 补 RXX 引用 / 加 BXX 节点 / 补端点" | tee -a "$REPORT"
done

# 3 试未过 → HALT
echo "" | tee -a "$REPORT"
echo "[xdd] ❌ 回环 2 失败: $MAX_ITER 试未过, 写 .xdd-halt.json" | tee -a "$REPORT"

cat > .xdd-halt.json <<EOF
{
  "phase": "2",
  "stage": "DESIGN",
  "loop": "2-design-review",
  "attempts": $MAX_ITER,
  "reason": "RXX 1 致 / BXX 覆盖 3 试未过",
  "last_log": "$REPORT",
  "suggested_retreat": "回 Phase 1 RESEARCH 重做 L0 笔记本 (业务线 BXX 可能就定义错)",
  "created_at": "$(date -Iseconds)"
}
EOF
exit 1
