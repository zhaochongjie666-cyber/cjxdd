#!/bin/bash
# pre-skill.sh — Enforce Walker's 5-step rhythm.
# Triggered by: PreToolUse hook, matcher: "Skill".
#
# Walker discipline (from agents/xdd-walker.md):
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
# shellcheck source=xdd-gate-lib.sh
source "$SCRIPT_DIR/xdd-gate-lib.sh"

# Parse tool input from stdin (Claude Code passes JSON).
input=$(cat)
skill_name=$(echo "$input" | jq -r '.tool_input.skill // .tool_input.name // empty' 2>/dev/null)

if [[ -z "$skill_name" ]]; then
    # Couldn't determine skill; not a Shadow Skill call. Allow.
    exit 0
fi

# === Phase 2-3: 压力信号检测 (反"加速跳过"护栏) ===
# 触发场景: AI 在调某个 skill 时, 工具参数或上下文含 "时间紧" / "跳过" / "简化" 等
# 软提醒 (不阻断, 但提醒 AI 保持 5 步节奏)
# 注: 只能扫到 .tool_input.skill 这一层, 没法扫 AI 的"思考", 但用户给的 skill
#     参数里常带"压力", 例如 --skip-l2 / --rough / "hurry up" 等
tool_input_text=$(echo "$input" | jq -r '.tool_input | tostring' 2>/dev/null)
check_pressure_signals "$tool_input_text $skill_name"

# Load schema (needed for stage_order lookups). No-op if already loaded.
load_xdd_schema || {
    echo "[xdd] ⚠️  .xdd/xdd-schema.json not found (also tried framework/ + framework template) — stage gating disabled this run." >&2
    exit 0
}

# === 实施 #23: 项目级 CLAUDE.md / AGENTS.md 注入兜底 ===
# 装 xdd skill 时, idempotent sync 用户项目根的 CLAUDE.md + AGENTS.md (5-10 行 pointer)
# 跟 .xdd/WORKFLOW.md (xdd-owned payload) 联动
# 老 demo (无 .xdd/LIFECYCLE.md) grandfather, 跳过
xdd_dir=$(get_xdd_dir 2>/dev/null || echo "")
if [[ -n "$xdd_dir" ]] && [[ -f "$xdd_dir/LIFECYCLE.md" ]]; then
    if declare -f inject_claude_md_pointer >/dev/null 2>&1; then
        # 读 xdd-version
        xdd_ver=""
        [[ -f "$xdd_dir/gates/xdd-version" ]] && xdd_ver=$(head -1 "$xdd_dir/gates/xdd-version" 2>/dev/null | tr -d '[:space:]')
        inject_claude_md_pointer "$(dirname "$xdd_dir")" "$xdd_ver" || true
    fi
fi

echo "[xdd] Skill loading: $skill_name"

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
                echo "[xdd] → status.md 自动更新: $display_name  ⏳ → 🔄 DOING"
            fi
        elif [[ "$cur_status" == *"✅"* ]]; then
            echo "[xdd] (本 stage 已标 ✅ DONE — 重新加载是 OK 的, 状态不变)"
        fi
    fi
fi

# Soft reminder: 5-step rhythm.
cat <<'EOF'
[xdd] 5-step rhythm check (from walker):
  ① 装工具         ← you are here
  ② 写 checklist 到 status.md（输入 / 产出 / 自检 / 必读 refs）
  ③ 按工具流程干
  ④ 按需读 references/
  ⑤ 自检 + 写状态

[xdd] Before proceeding: confirm status.md has a fresh 30-50 line checklist
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
                    echo "[xdd] ❌ HARD BLOCK: $stage is still ⏳ pending." >&2
                    echo "[xdd]    Loading $skill_name would skip earlier pipeline stage." >&2
                    echo "[xdd]    Complete $stage first (write to status.md, re-run gate)." >&2
                    exit 2
                fi
                ;;
        esac
    done < <(grep -E '^\|\s*L' "$md" 2>/dev/null)
fi

# === P0-Y Round 1: L0 调研重做门禁 (每轮 iter 软警告) ===
# 问题: 每轮 iter 启动时, L0 调研常被跳过 — 但新需求可能涉及新方案/新竞品/新约束
# 检测: 扫 .xdd/iterations/iter-N/research/ 是否存在, 且 mtime ≤ 14 天
# Round 1: 软警告 (不阻断); Round 2: 硬阻断
# 适用: iter-1 也算"项目首轮开发", 必须重做 (不是项目级例外)
xdd_dir=$(get_xdd_dir)
iter=$(get_current_iter)
# iter-1, iter-2, iter-3, ... 都需 L0 refresh
if [[ -n "$iter" ]] && [[ "$iter" =~ ^iter-([1-9]|[1-9][0-9]+)$ ]] && [[ -n "$xdd_dir" ]]; then
    l0_dir="$xdd_dir/iterations/$iter/research"
    l0_warn=""
    if [[ ! -d "$l0_dir" ]]; then
        l0_warn="L0 调研目录不存在"
    elif [[ -z "$(find "$l0_dir" -maxdepth 1 -name "*.md" -print -quit 2>/dev/null)" ]]; then
        l0_warn="L0 调研目录为空 (无 .md 笔记本)"
    elif [[ -z "$(find "$l0_dir" -maxdepth 1 -name "*.md" -mtime -14 2>/dev/null | head -1)" ]]; then
        l0_warn="L0 调研 ≥ 14 天未重做"
    fi
    if [[ -n "$l0_warn" ]]; then
        echo ""
        echo "[xdd] 🐢 P0-Y Round 1: L0 调研重做软警告"
        echo "[xdd]    原因: $l0_warn"
        echo "[xdd]    期望: $xdd_dir/iterations/$iter/research/ 存在 + 有 .md 笔记本 + mtime ≤ 14 天"
        echo "[xdd]    处置: 调 xdd-l0 skill 重新做调研 (新需求可能涉及新方案/新竞品)"
        echo "[xdd]    注意: 每轮 iter (含 iter-1) 都需 L0 调研, L0 是'每轮的起点'"
    fi
fi

# === 实施 #22 (xdd-l0 增强): L0 design gate 硬阻断 ===
# 装 xdd-bdd / xdd-flow / xdd-wire / xdd-arch 前, 验:
# 1) .xdd/baseline/design/ 存在 + ≥ 1 个 .md (走 L0 §7 HARD-GATE 写的)
# 2) .xdd/gates/.l0-review-block.md 不存在 (用户已审过)
# 老 demo (无 .xdd/LIFECYCLE.md) grandfather, 不阻断
if [[ "$skill_name" == "xdd-bdd" || "$skill_name" == "xdd-flow" || "$skill_name" == "xdd-wire" || "$skill_name" == "xdd-arch" ]]; then
    if [[ -n "$xdd_dir" ]] && [[ -f "$xdd_dir/LIFECYCLE.md" ]]; then
        design_dir="$xdd_dir/baseline/design"
        block_file="$xdd_dir/gates/.l0-review-block.md"
        if [[ ! -d "$design_dir" ]] || [[ -z "$(find "$design_dir" -name "*.md" -print -quit 2>/dev/null)" ]]; then
            echo "" >&2
            echo "[xdd] ❌ HARD BLOCK: L0 design.md 缺失" >&2
            echo "[xdd]    必须先跑 xdd-l0 §7 HARD-GATE, 写 design.md 到 $design_dir" >&2
            echo "[xdd]    模板: skills/xdd-l0/templates/design.md (5 段: Selected / Alternatives / Assumptions / Out of Scope / Open Questions)" >&2
            echo "[xdd]    详见: skills/xdd-l0/SKILL.md §7" >&2
            exit 2
        fi
        if [[ -f "$block_file" ]]; then
            echo "" >&2
            echo "[xdd] ❌ HARD BLOCK: L0 design 待用户审 ($block_file 存在)" >&2
            echo "[xdd]    用户审 design.md 后**删除** $block_file 才能进 $skill_name" >&2
            exit 2
        fi
    fi
fi

# === P0-Z Round 1: wire.svg 产物形态门禁 (state 变体偷工减料检测) ===
# SKILL 要求: 每个 page 至少 4 个状态变体 (normal/loading/empty/error)
# AI 偷工减料时常说 "状态变体可简化" / "主路径 12-15 页", 把 state 简化掉
# 检测: 扫 wire.svg 的 data-page (页数) 和 data-state (变体数), ratio < 3 → 软警告
if [[ "$skill_name" == "xdd-wire" ]] && [[ -n "$xdd_dir" ]]; then
    # v2.0 9→6 合并: wire.svg 实际位置在 baseline/wire/{page}.svg (per-page), 老 demo 兼容 business/wire.svg
    wire_svg="$xdd_dir/baseline/wire/wire.svg"
    [[ ! -f "$wire_svg" ]] && wire_svg="$xdd_dir/business/wire.svg"
    if [[ -f "$wire_svg" ]]; then
        # unique data-page 数量
        page_count=$(grep -oE 'data-page="[^"]+"' "$wire_svg" 2>/dev/null | sort -u | wc -l)
        # 所有 data-state 元素 (含 normal/loading/empty/error 4 变体)
        state_count=$(grep -oE 'data-state="[^"]+"' "$wire_svg" 2>/dev/null | wc -l)
        if [[ $page_count -gt 0 ]]; then
            # SKILL.md line 130: 每页 ≥4 状态变体. 实际 ratio 通常 4, 最少 3 算"勉强"
            if [[ $state_count -lt $((page_count * 3)) ]]; then
                echo ""
                echo "[xdd] 🐢 P0-Z Round 1: wire.svg 状态变体被简化 (产物形态门禁)"
                echo "[xdd]    期望: $page_count 页 × ≥4 状态变体 = ≥$((page_count * 4)) 个 data-state"
                echo "[xdd]    实际: 仅 $state_count 个 data-state (平均 $((state_count / page_count))/页, < 3 警戒值)"
                echo "[xdd]    AI 报错时常说"状态变体可简化" / "主路径 N 页" — 这是偷工减料"
                echo "[xdd]    处置: 把 normal/loading/empty/error 4 变体补全, 或在 status.md 标 deferred 注明砍了哪些"
                echo "[xdd]    SKILL.md 约束: 每个页面有 ≥4 个状态变体 (normal/loading/empty/error)"
            fi
        fi
    fi
fi

exit 0
