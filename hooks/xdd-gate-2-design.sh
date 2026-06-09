#!/bin/bash
# xdd-gate-2-design.sh — Phase 2 DESIGN 出口 gate
# 检查 5 个工件 (bdd/flow/wire/arch/resilience) 都存在 — v2.0 9→6 合并: add 已并入 arch § 12, business 已并入 bdd/

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=xdd-gate-lib.sh
source "$SCRIPT_DIR/xdd-gate-lib.sh"

is_meta_project && exit 0

xdd_dir=$(get_xdd_dir)
[[ -z "$xdd_dir" ]] && exit 2

iter=$(get_current_iter)
status_path="$xdd_dir/iterations/$iter/pipeline/status.md"
[[ ! -f "$status_path" ]] && exit 0

# 检查 BDD 必做 — 新路径 baseline/bdd, 老路径 bdd 兼容
bdd_dir="$xdd_dir/baseline/bdd"
[[ ! -d "$bdd_dir" ]] && bdd_dir="$xdd_dir/bdd"
if [[ ! -d "$bdd_dir" ]] || [[ -z "$(ls -A "$bdd_dir" 2>/dev/null)" ]]; then
    echo "[xdd] ❌ Phase 2 DESIGN 缺 BDD 工件 ($bdd_dir 为空或不存在)" >&2
    echo "[xdd]    加载 xdd-bdd skill 补 BDD 验收场景 + business 业务线 landscape" >&2
    exit 2
fi

echo "[xdd] ✓ Phase 2 DESIGN: BDD 工件存在 ($bdd_dir)"
echo "[xdd]    (Flow / Wire / Arch / Resilience 是可选/触发, 由 scale 字段决定; ADD 工件已合并入 Arch § 12 运维视图)"
exit 0
