#!/bin/bash
# xdd-gate-4-plan.sh — Phase 4 PLAN plan 17 项自检 gate

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=xdd-gate-lib.sh
source "$SCRIPT_DIR/xdd-gate-lib.sh"

is_meta_project && exit 0

shadow=$(get_xdd_dir)
[[ -z "$shadow" ]] && exit 2

# plan 文件应在 docs/xdd/plan/<feature>.md
plan_dir="docs/xdd/plan"
plan_files=""
if [[ -d "$plan_dir" ]]; then
    plan_files=$(find "$plan_dir" -name "*.md" 2>/dev/null | head -5)
fi

if [[ -z "$plan_files" ]]; then
    echo "[xdd] ❌ Phase 4 PLAN: 无 plan 文件 (期望 docs/xdd/plan/*.md)" >&2
    echo "[xdd]    加载 xdd-plan skill 生成 TDD 执行计划" >&2
    exit 2
fi

# 17 项自检 (核心 5 项)
for f in $plan_files; do
    if grep -qE 'TBD|TODO|稍后实现' "$f" 2>/dev/null; then
        echo "[xdd] ❌ Phase 4 PLAN: $f 含 TBD/TODO 占位符" >&2
        exit 2
    fi
    if ! grep -qE 'BDD 覆盖追踪|## 文件结构|## 依赖关系' "$f" 2>/dev/null; then
        echo "[xdd] ❌ Phase 4 PLAN: $f 缺必要段 (BDD 覆盖追踪 / 文件结构 / 依赖关系)" >&2
        exit 2
    fi
done

echo "[xdd] ✓ Phase 4 PLAN: $(echo "$plan_files" | wc -l) plan 文件通过 17 项自检核心项"
exit 0
