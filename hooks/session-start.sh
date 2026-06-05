#!/bin/bash
# session-start.sh — Pipeline context loader.
# Triggered by: SessionStart hook.
#
# Output: a short context block printed to stdout (Claude Code will surface it
# as additional context for the model). Exit 0 always — never blocks session.
#
# L1 (对齐 OpenCode shadow-flow plugin):
#   - 打印 pipeline 摘要
#   - 打印当前 stage + 预期产物 + 允许的 skill + 下一 stage
#   - 注入 5 步节奏

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

shadow=$(get_shadow_dir)
if [[ -z "$shadow" ]]; then
    echo "[shadow] No .shadow/ found above $PWD. Walker not initialized for this project."
    echo "[shadow] Hint: open a shadow project (one with intent.md / status.md), or run 'mkdir -p .shadow/iterations/iter-1/pipeline .shadow/iterations/iter-1/gate' to start a new iter."
    exit 0
fi

iter=$(get_current_iter)
echo "[shadow] project_root = $(find_project_root)"
echo "[shadow] shadow_dir   = $shadow"

if [[ -z "$iter" ]]; then
    echo "[shadow] No active iteration (.shadow/current-iteration missing). Walker is idle."
    exit 0
fi
echo "[shadow] active_iter  = $iter"

summary=$(read_status_summary)
if [[ -n "$summary" ]]; then
    echo "[shadow] pipeline     = $summary"
fi

# Per-bizline breakdown (only printed for multi-bizline projects).
breakdown=$(read_bxx_breakdown)
if [[ -n "$breakdown" ]]; then
    echo "[shadow] pipeline (per-bizline):"
    echo "$breakdown" | sed 's/^/  /'
fi

# === L1 增强: 注入当前 stage 上下文 ===
pending=$(detect_pending_stage)
doing=$(detect_doing_stage)
current="${pending:-$doing}"
if [[ -n "$current" ]]; then
    cur_id=$(stage_alias_to_id "$current")
    cur_skill="${STAGE_SKILL[$cur_id]:-}"
    cur_output="${STAGE_OUTPUTS[$cur_id]:-}"
    cur_num="${STAGE_NUM[$cur_id]:-?}"
    next_id=""
    # 找下一个 stage (按 STAGE_NUM 顺序)
    for k in "${!STAGE_NUM[@]}"; do
        n="${STAGE_NUM[$k]}"
        if [[ $((n - cur_num)) -eq 1 ]]; then
            next_id="$k"; break
        fi
    done
    next_skill="${STAGE_SKILL[$next_id]:-}"

    echo ""
    echo "[shadow] === Current Stage (L1 增强) ==="
    echo "[shadow] stage: $current"
    echo "[shadow] skill: $cur_skill"
    echo "[shadow] expected output: $cur_output"
    if [[ -n "$next_skill" ]]; then
        echo "[shadow] next stage skill: $next_skill"
    fi
    echo ""
    echo "[shadow] 5-step rhythm (Walker discipline):"
    echo "[shadow]   ① 装 skill 工具 ($cur_skill)"
    echo "[shadow]   ② 写 checklist 到 status.md"
    echo "[shadow]   ③ 按 skill 流程干, 落到预期路径"
    echo "[shadow]   ④ 自检 + 标 ✅ DONE"
    echo "[shadow]   ⑤ 加载下一 stage ($next_skill)"
fi

# If there's a CONTEXT-MAP section in status.md, surface it.
md=$(get_status_md)
if [[ -n "$md" && -f "$md" ]]; then
    if grep -q "^## 上下文地图" "$md" 2>/dev/null; then
        echo ""
        echo "[shadow] context_map (from status.md):"
        awk '/^## 上下文地图/{flag=1; print; next} /^## /{if (flag && !/上下文地图/) exit} flag' "$md" \
            | head -40 \
            | sed 's/^/  /'
    fi
fi
