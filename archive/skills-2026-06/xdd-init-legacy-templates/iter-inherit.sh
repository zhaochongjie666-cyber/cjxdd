#!/bin/bash
# iter-inherit.sh — 回环 5 iter 反馈机制
# iter-N 收尾: 把 .xdd-halt.json / .l5-unresolved.json / session review P0/P1 复制到 iter-N+1/.inherited/
# iter-N+1 init: 检查 inherited 列表, phase-researcher 优先修遗留
# 详见 skills/xdd-init/SKILL.md + docs/LOOP-DESIGN.md § 回环 5

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_LIB="$(cd "$SCRIPT_DIR/../../.." && pwd)/hooks/xdd-gate-lib.sh"
if [[ -f "$HOOK_LIB" ]]; then
    source "$HOOK_LIB"
    if is_meta_project 2>/dev/null; then
        echo "[xdd] (Meta 项目, 跳过 iter-inherit)"
        exit 0
    fi
fi

XDD_DIR=".xdd"
[[ ! -d "$XDD_DIR" ]] && { echo "❌ 无 .xdd/"; exit 1; }

MODE="${1:-auto}"  # auto / save / load

# 找 current iter
CUR_ITER=$(cat .xdd/current-iteration 2>/dev/null || echo "iter-1")
CUR_ITER_NUM=$(echo "$CUR_ITER" | grep -oE '[0-9]+' || echo 1)
NEXT_ITER_NUM=$((CUR_ITER_NUM + 1))
NEXT_ITER="iter-${NEXT_ITER_NUM}"

INHERITED_DIR="$XDD_DIR/iterations/$NEXT_ITER/.inherited"
mkdir -p "$INHERITED_DIR"

case "$MODE" in
    save)
        echo "[xdd] === 回环 5 iter 反馈 save: $CUR_ITER → $NEXT_ITER ==="
        # 复制 .xdd-halt.json / .l5-unresolved.json / session review
        for f in .xdd-halt.json .l5-unresolved.json .xdd/reports/bug-report-*.md .xdd/reports/design-review-*.md; do
            for src in $f; do
                [[ -e "$src" ]] || continue
                cp "$src" "$INHERITED_DIR/"
                echo "  ✓ 复制: $src → .inherited/"
            done
        done
        # 写 inherited 摘要
        cat > "$INHERITED_DIR/SUMMARY.md" <<EOF
# iter-${CUR_ITER_NUM} → iter-${NEXT_ITER_NUM} 继承清单

**生成时间**: $(date -Iseconds)
**来源 iter**: $CUR_ITER

## 继承文件

$(ls -la "$INHERITED_DIR" 2>/dev/null | tail -n +2 | head -20)

## P0/P1 优先修

phase-researcher 启动时必读本目录, 优先调研:
1. .xdd-halt.json 列的失败原因
2. .l5-unresolved.json 列的未解 P1
3. session review 列的改进点

EOF
        echo "  ✓ 摘要: $INHERITED_DIR/SUMMARY.md"
        exit 0
        ;;
    load)
        echo "[xdd] === 回环 5 iter 反馈 load: $NEXT_ITER ==="
        if [[ ! -d "$INHERITED_DIR" ]] || [[ -z "$(ls -A "$INHERITED_DIR" 2>/dev/null)" ]]; then
            echo "  ⏸ 无 .inherited/ 内容 (新 iter 无遗留)"
            exit 0
        fi
        echo "  继承内容:"
        for f in "$INHERITED_DIR"/*; do
            [[ -f "$f" ]] && echo "    - $(basename $f)"
        done
        echo ""
        echo "  phase-researcher 必读: cat $INHERITED_DIR/SUMMARY.md"
        exit 0
        ;;
    auto|*)
        # 自动模式: 检测 iter 是否收尾 (Phase 6 ✅ + 无 halt)
        status_file="$XDD_DIR/iterations/$CUR_ITER/pipeline/status.md"
        if [[ -f "$status_file" ]] && grep -q '6.*VERIFY.*✅' "$status_file" 2>/dev/null; then
            # iter 收尾了, 准备 next
            if [[ ! -f .xdd-halt.json ]] || ! grep -q '"attempts":' .xdd-halt.json 2>/dev/null; then
                echo "[xdd] (iter 收尾, 但无 halt/unresolved 遗留, 无需 inherit)"
                exit 0
            fi
            bash "$0" save
        else
            echo "[xdd] (iter 未收尾, skip)"
            exit 0
        fi
        ;;
esac
