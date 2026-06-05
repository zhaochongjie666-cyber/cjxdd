#!/bin/bash
# pre-skill.sh — Enforce Walker's 5-step rhythm.
# Triggered by: PreToolUse hook, matcher: "Skill".
#
# Walker discipline (from agents/shadow-walker.md):
#   1. 装工具（Skill 加载）
#   2. 写 checklist 到 status.md  ← this hook enforces this
#   3. 按工具流程干
#   4. 按需读 references/
#   5. 自检 + 写状态
#
# Behavior:
#   - Parse JSON from stdin to extract the skill name being loaded.
#   - Print an advisory reminder (not a hard block) before the tool runs.
#   - If status.md is missing the "本阶段必读" pointer, print a warning.
#   - Exit 0 (allow tool to run) unless a hard violation is detected.
#
# Hard-block condition (exit 2): if a previous step is still ⏳ pending
# and the loaded skill is a later-stage one. This guards against skipping
# the pipeline.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

# Parse tool input from stdin (Claude Code passes JSON).
input=$(cat)
skill_name=$(echo "$input" | jq -r '.tool_input.skill // .tool_input.name // empty' 2>/dev/null)

if [[ -z "$skill_name" ]]; then
    # Couldn't determine skill; not a Shadow Skill call. Allow.
    exit 0
fi

echo "[shadow] Skill loading: $skill_name"

# Stage mapping (from agents/shadow-walker.md pipeline order).
# Used to detect out-of-order Skill loads.
declare -A stage_order=(
    [shadow-l0-research]=0
    [shadow-l1-research]=1
    [shadow-l1-flow]=2
    [shadow-l1-spec]=3
    [shadow-l1-wire]=4
    [shadow-l1p5-architecture]=5
    [shadow-scaffold]=6
    [shadow-l2-e2e]=7
    [shadow-l5-plan]=8
    [shadow-l5-impl]=9
    [shadow-reviewer]=10
    [shadow-l6-deploy]=11
)
current_order="${stage_order[$skill_name]:-}"

# === L3 增强: 自动标 stage DOING ===
# skill 名 → stage 内部 ID
stage_id=$(skill_to_stage "$skill_name")
if [[ -n "$stage_id" ]]; then
    # 把内部 ID 转成 status.md 中的显示名 (空格)
    display_name="${stage_id/_/ }"
    md=$(get_status_md)
    if [[ -n "$md" && -f "$md" ]]; then
        # 找这行的 status
        cur_status=$(grep -E "^\| *$(echo "$display_name" | sed 's/[.[\*^$()+?{|]/\\&/g') " "$md" 2>/dev/null \
            | head -1 | awk -F'|' '{print $3}' | xargs)
        if [[ "$cur_status" == *"⏳"* ]]; then
            if update_stage_status "$display_name" "🔄 DOING"; then
                echo "[shadow] → status.md 自动更新: $display_name  ⏳ → 🔄 DOING"
            fi
        elif [[ "$cur_status" == *"✅"* ]]; then
            echo "[shadow] (本 stage 已标 ✅ DONE — 重新加载是 OK 的, 状态不变)"
        fi
    fi
fi

# status.md 里的阶段显示名 → skill 名 映射。
# 用于把 "L1 Spec" 这样的展示名转换回 stage_order 的 key。
declare -A display_to_skill=(
    [L0]=shadow-l0-research
    [L1\ Research]=shadow-l1-research
    [L1\ Flow]=shadow-l1-flow
    [L1\ Spec]=shadow-l1-spec
    [L1\ Wire]=shadow-l1-wire
    [L1.5]=shadow-l1p5-architecture
    [Scaffold]=shadow-scaffold
    [L2]=shadow-l2-e2e
    [L5\ Plan]=shadow-l5-plan
    [L5\ Impl]=shadow-l5-impl
    [全链路审查]=shadow-reviewer
    [L6]=shadow-l6-deploy
    [L6\ 漫游修复]=shadow-l6-deploy
)

# Soft reminder: 5-step rhythm.
cat <<'EOF'
[shadow] 5-step rhythm check (from walker):
  ① 装工具         ← you are here
  ② 写 checklist 到 status.md（输入 / 产出 / 自检 / 必读 refs）
  ③ 按工具流程干
  ④ 按需读 references/
  ⑤ 自检 + 写状态

[shadow] Before proceeding: confirm status.md has a fresh 30-50 line checklist
        for this stage. If not, write it first.
EOF

# Hard guard: if status.md shows an earlier stage still pending, block.
md=$(get_status_md)
if [[ -n "$md" && -f "$md" && -n "$current_order" ]]; then
    # Walk stage table; find first ⏳ and check its stage order.
    while IFS='|' read -r _ stage status _ _; do
        stage=$(echo "$stage" | xargs)
        [[ -z "$stage" || "$stage" == "阶段" ]] && continue
        case "$status" in
            *⏳*)
                # Translate display name → skill name → stage order.
                pending_skill="${display_to_skill[$stage]:-}"
                pending_order="${stage_order[$pending_skill]:-}"
                if [[ -n "$pending_order" && "$pending_order" -lt "$current_order" ]]; then
                    echo "" >&2
                    echo "[shadow] ❌ HARD BLOCK: $stage is still ⏳ pending." >&2
                    echo "[shadow]    Loading $skill_name would skip earlier pipeline stage." >&2
                    echo "[shadow]    Complete $stage first (write to status.md, re-run gate)." >&2
                    exit 2
                fi
                ;;
        esac
    done < <(grep -E '^\|\s*L' "$md" 2>/dev/null)
fi

exit 0
