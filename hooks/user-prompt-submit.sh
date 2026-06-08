#!/bin/bash
# user-prompt-submit.sh — Detect Walker-suitable intents in user messages.
# Triggered by: UserPromptSubmit hook.
#
# When the user says something like "做一个 XX 系统", "build me X", "从零开发"
# this hook emits a soft hint that prompts Claude to load the shadow-walker
# subagent. Two flavors of hint:
#
#   1. .shadow/ already exists → remind the model to continue via Walker
#      (don't freelance).
#   2. No .shadow/ yet → suggest initializing the pipeline via Walker.
#
# This removes the friction of users having to remember to say
# "use shadow-walker subagent to …" for every new project.
#
# Match patterns (intentionally broad to reduce false-negatives):
#   - Chinese: 做一个 / 开发一个 / 建一个 / 搭一个 / 从零 / 全栈 / 新系统 / 新项目
#   - English: build / create / develop / implement + system/app/service/platform
#   - Phrases: from scratch / new project / greenfield / mvp
#
# Always exits 0 (advisory only — never blocks user input).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"
load_shadow_schema || true  # silent; this hook is advisory only

# Parse the user prompt from stdin JSON.
input=$(cat)
prompt=$(echo "$input" | jq -r '
    .user_prompt // .message // .prompt //
    .userPrompt  // .content   // empty
' 2>/dev/null)

if [[ -z "$prompt" ]]; then
    # Couldn't extract a prompt; not actionable.
    exit 0
fi

# === P0-7 Meta 旁路 ===
# 当 CWD 是 cjxdd 仓库本身 (framework 自身) 时, 不做"build me X" → walker 加载
# 引导, 不做 stage 状态查询 (status.md 是 cjxdd 内部状态, 不应混入 context).
# 让用户直接改 skills/agents/hooks/plugins 源码.
if is_meta_project; then
    # 极小旁路: 仅压力信号检测 (跟 framework 也相关: 用户催/简化会污染 quality)
    # 跳过意图识别 / 跳过 stage 查询 / 跳过 shadow-init 引导.
    check_pressure_signals "$prompt"
    exit 0
fi

# Lowercase copy for matching.
lc=$(echo "$prompt" | tr '[:upper:]' '[:lower:]')

# Detect intent.
matched=""
hint_kind=""

# === L2 增强: stage 查询命令 (在 intent 识别之前) ===
# 先检查是否是 stage 状态查询 — 这种消息应该直接回答 stage 状态,
# 不需要走 "build me X" 的意图识别
shadow=$(get_shadow_dir)
is_shadow="no"
[[ -n "$shadow" ]] && is_shadow="yes"

if [[ "$is_shadow" == "yes" ]]; then
    # 当前 stage?
    if echo "$lc" | grep -qE '当前.{0,4}(stage|阶段|状态|在哪)|where am i|what stage|current stage|我在哪|现在在哪'; then
        pending=$(detect_pending_stage)
        doing=$(detect_doing_stage)
        current="${pending:-$doing}"
        iter=$(get_current_iter)
        echo "[shadow] === Stage 状态查询 ==="
        echo "[shadow] iter: $iter"
        if [[ -n "$current" ]]; then
            cur_id=$(stage_alias_to_id "$current")
            cur_skill="${STAGE_SKILL[$cur_id]:-}"
            cur_output="${STAGE_OUTPUTS[$cur_id]:-}"
            echo "[shadow] current: $current (skill=$cur_skill)"
            echo "[shadow] expected output: $cur_output"
        else
            echo "[shadow] current: 全部 ✅ DONE"
        fi
        exit 0
    fi
    # 下一 stage?
    if echo "$lc" | grep -qE '下一.{0,4}(stage|阶段|步)|next stage|what.{0,3}next|下一步'; then
        pending=$(detect_pending_stage)
        if [[ -n "$pending" ]]; then
            cur_id=$(stage_alias_to_id "$pending")
            cur_num="${STAGE_NUM[$cur_id]:-}"
            for k in "${!STAGE_NUM[@]}"; do
                n="${STAGE_NUM[$k]}"
                if [[ $((n - cur_num)) -eq 1 ]]; then
                    next_skill="${STAGE_SKILL[$k]:-}"
                    echo "[shadow] === 下一 Stage ==="
                    echo "[shadow] 当前 ⏳: $pending"
                    echo "[shadow] 下一 stage: $k (skill=$next_skill)"
                    exit 0
                fi
            done
        fi
        echo "[shadow] === 下一 Stage ==="
        echo "[shadow] 没有 pending stage (可能全部 ✅ DONE)"
        exit 0
    fi
fi

# 5 类意图检测 — 抽到 lib.sh:detect_intent_pattern() 集中维护
# 4 个 hint_kind: zh-new-build / zh-continue / en-new-build / en-greenfield
# 注: 改一处即生效,避免 grep 正则散落 + 重复 token
hint_kind=$(detect_intent_pattern "$lc")
[[ -n "$hint_kind" ]] && matched=1

# === Phase 2-3: 压力信号检测 (反"加速跳过"护栏) ===
# 触发场景: 用户说"时间紧" / "加快节奏" / "跳过" / "简化" 等
# 软提醒 (不阻断, 跟 matched 无关 — 任何 prompt 都要扫压力信号)
check_pressure_signals "$prompt"

[[ -z "$matched" ]] && exit 0

if [[ "$is_shadow" == "yes" ]]; then
    # Existing shadow project. The model should be using Walker already.
    # Just remind of pipeline position.
    iter=$(get_current_iter)
    case "$hint_kind" in
        zh-new-build|en-new-build|en-greenfield)
            echo "[shadow] Detected new-build intent, but .shadow/ already exists (iter=$iter)."
            echo "[shadow] Likely scenario: new requirement within existing project, or 'rewrite'."
            echo "[shadow] → If extending: load next stage skill per pipeline (see status.md CONTEXT-MAP)."
            echo "[shadow] → If 'rewrite from scratch': start a new iter — 'shadow walker, start iter-2'."
            ;;
        zh-continue)
            # 跟"无 .shadow/"分支一致, 也静默.
            # "继续" / "接着" 是用户跟 AI 工作的常用词, 误触 zh-continue 触发 hint 输出
            # → OpenCode 1.16.2 server 把 hook 输出当 synthetic user part 注入, schema
            # 缺 id/sessionID/messageID 字段 → server 拒收整个 user message → 中文输入
            # "能显示但提交失败" 现象根因.
            # 修法: 任何模糊词 (zh-continue) 在 shadow 项目里也不输出 hint, 让 user message
            # 干净进 server, 不污染 schema 校验.
            # 显式 "下一步" / "重构" 等明确扩展意图仍由 L5 L1 L1.5 skill 自己捕获.
            ;;

    esac
else
    # No .shadow/ — suggest initializing via Walker.
    case "$hint_kind" in
        zh-new-build)
            echo "[shadow] 检测到'从零开发'意图，但 .shadow/ 尚未初始化。"
            echo "[shadow] 建议两步走:"
            echo "  1. 先跑 shadow-init 生成骨架:"
            echo "       bash skills/shadow-init/scripts/init.sh"
            echo "     (生成 .shadow/SHADOW_VERSION + status.md + scale.md + iter-1/)"
            echo "  2. 再加载 shadow-walker subagent, 它会:"
            echo "     - 走 L0 发散 → L1 业务 → L1.5 架构 → L2 验收 → L5 计划/实现 → L6 部署验证 全流程"
            echo "     - 每个阶段用 status.md + gate-check 自我门禁"
            echo ""
            echo "[shadow] 触发方式: '使用 shadow-walker subagent 给我做一个 XX'"
            ;;
        en-new-build|en-greenfield)
            echo "[shadow] Detected new-build / greenfield intent, but .shadow/ is not initialized."
            echo "[shadow] Recommended two-step:"
            echo "  1. First run shadow-init to scaffold:"
            echo "       bash skills/shadow-init/scripts/init.sh"
            echo "     (generates .shadow/SHADOW_VERSION + status.md + scale.md + iter-1/)"
            echo "  2. Then load the shadow-walker subagent. It will:"
            echo "     - Walk L0 → L1 → L1.5 → L2 → L5 → L6 pipeline"
            echo "     - Self-gate each stage via status.md + gate-check"
            echo ""
            echo "[shadow] Trigger: 'Use shadow-walker subagent to build me X'"
            ;;
        zh-continue)
            # "继续" 在无 .shadow/ 时是模糊的（也可能是普通代码对话的"继续"）；
            # 静默，避免噪声。
            ;;
    esac
fi

exit 0
