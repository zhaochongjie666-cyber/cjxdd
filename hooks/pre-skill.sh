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

# Load schema (needed for stage_order lookups). No-op if already loaded.
load_shadow_schema || {
    echo "[shadow] ⚠️  framework/shadow-schema.json not found — stage gating disabled this run." >&2
    exit 0
}

echo "[shadow] Skill loading: $skill_name"

# Skill 名 → stage num (来自 schema 的 STAGE_SKILL_NUM)
current_order=$(skill_to_num "$skill_name")

# === L3 增强: 自动标 stage DOING ===
# skill 名 → stage 内部 ID (来自 schema)
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
                # Translate display name → stage id → stage num (via schema).
                pending_id=$(stage_alias_to_id "$stage")
                pending_order="${STAGE_NUM[$pending_id]:-}"
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
