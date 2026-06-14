#!/bin/bash
# xdd-gate-1-research.sh — Phase 1 RESEARCH 出口 gate
# 强制硬阻断: 需求边界 / 任务类型 / 工件清单 三项必须已确认

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=xdd-gate-lib.sh
source "$SCRIPT_DIR/xdd-gate-lib.sh"

is_meta_project && exit 0

xdd_dir=$(get_xdd_dir)
[[ -z "$xdd_dir" ]] && exit 2

iter=$(get_current_iter)
status_path="$xdd_dir/iterations/$iter/pipeline/status.md"
[[ ! -f "$status_path" ]] && { echo "[xdd] (无 status.md, Phase 1 跳过)"; exit 0; }

# 读 Phase 1 行
phase1_status=$(grep -E "^\| *1 " "$status_path" 2>/dev/null | head -1 | awk -F'|' '{print $3}' | xargs)

if [[ "$phase1_status" == *"⏳"* || "$phase1_status" == *"🔄"* ]]; then
    echo "[xdd] ❌ HARD BLOCK: Phase 1 RESEARCH 还未完成 (标: $phase1_status)" >&2
    echo "[xdd]    三项必确认: 需求边界 / 任务类型 / 工件清单" >&2
    echo "[xdd]    完成 Phase 1 (写 status.md, 重跑 gate) 后再进 Phase 2" >&2
    exit 2
fi

echo "[xdd] ✓ Phase 1 RESEARCH ✅"
exit 0
