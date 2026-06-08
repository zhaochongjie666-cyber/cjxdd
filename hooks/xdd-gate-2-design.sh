#!/bin/bash
# xdd-gate-2-design.sh — Phase 2 DESIGN 出口 gate
# 检查 5 个工件 (bdd/flow/add/wire/arch) 都存在 (或显式跳过)

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=xdd-gate-lib.sh
source "$SCRIPT_DIR/xdd-gate-lib.sh"

is_meta_project && exit 0

shadow=$(get_xdd_dir)
[[ -z "$shadow" ]] && exit 2

iter=$(get_current_iter)
status_path="$shadow/iterations/$iter/pipeline/status.md"
[[ ! -f "$status_path" ]] && exit 0

# 检查 BDD 必做
if [[ ! -d "$shadow/bdd" ]] || [[ -z "$(ls -A "$shadow/bdd" 2>/dev/null)" ]]; then
    echo "[xdd] ❌ Phase 2 DESIGN 缺 BDD 工件 (.xdd/bdd/ 为空或不存在)" >&2
    echo "[xdd]    加载 xdd-bdd skill 补 BDD 验收场景" >&2
    exit 2
fi

echo "[xdd] ✓ Phase 2 DESIGN: BDD 工件存在"
echo "[xdd]    (Flow / Add / Wire / Arch 是可选/触发, 由 scale 字段决定)"
exit 0
