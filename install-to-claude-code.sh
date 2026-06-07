#!/bin/bash
# install-to-claude-code.sh - Symlink agents and skills to ~/.claude/
# Usage: ./install-to-claude-code.sh
#
# 装到用户级 ~/.claude/，让 shadow-walker agent 和所有 skill
# 在 Claude Code 任何项目里都可用。
# OpenCode 用户请继续用 install-to-opencode.sh。

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${HOME}/.claude"

echo "🚀 Installing to ~/.claude/..."
echo "   Source: $SCRIPT_DIR"
echo "   Target: $CLAUDE_DIR"
echo

mkdir -p "$CLAUDE_DIR/agents"
mkdir -p "$CLAUDE_DIR/skills"
mkdir -p "$CLAUDE_DIR/commands"
# 注意：$CLAUDE_DIR/hooks 后面要软链整个 hooks/ 目录（项目根，跟 agents/ skills/
# 平级；之前是 .claude/hooks/，已经搬出来），所以这里不 mkdir，而是先 rmdir
# 掉（如果存在且为空），让 ln -sfn 能把软链放到正确位置。如果目标已经是一个
# symlink 指向别处（包含 dangling 软链 → 已删除的源），rm 后再软链。
if [[ -L "$CLAUDE_DIR/hooks" ]]; then
    rm -f "$CLAUDE_DIR/hooks"
elif [[ -e "$CLAUDE_DIR/hooks" ]]; then
    if [[ -d "$CLAUDE_DIR/hooks" && -z "$(ls -A "$CLAUDE_DIR/hooks" 2>/dev/null)" ]]; then
        rmdir "$CLAUDE_DIR/hooks"
    else
        echo "   ⚠️  $CLAUDE_DIR/hooks exists and is non-empty; backing up to ${CLAUDE_DIR}/hooks.bak"
        mv "$CLAUDE_DIR/hooks" "${CLAUDE_DIR}/hooks.bak"
    fi
fi

# === Agents ===
AGENT_COUNT=0
if [[ -d "$SCRIPT_DIR/agents" ]]; then
    for agent_file in "$SCRIPT_DIR/agents"/*.md; do
        [[ -f "$agent_file" ]] || continue
        agent_name=$(basename "$agent_file")
        ln -sfn "$agent_file" "$CLAUDE_DIR/agents/$agent_name"
        AGENT_COUNT=$((AGENT_COUNT + 1))
    done
    echo "   🔗 agents: $AGENT_COUNT → $CLAUDE_DIR/agents/"
fi

# === Skills ===
SKILL_COUNT=0
if [[ -d "$SCRIPT_DIR/skills" ]]; then
    for skill_dir in "$SCRIPT_DIR/skills"/*/; do
        [[ -d "$skill_dir" ]] || continue
        skill_name=$(basename "$skill_dir")
        ln -sfn "$skill_dir" "$CLAUDE_DIR/skills/$skill_name"
        SKILL_COUNT=$((SKILL_COUNT + 1))
    done
    echo "   🔗 skills: $SKILL_COUNT → $CLAUDE_DIR/skills/"
fi

# === Commands (Claude Code slash commands, 如 /cjgoal) ===
# commands/*.md 会被 Claude Code 识别为 /<name> slash command.
# OpenCode 端等价功能在 plugins/goal-mode.tsx (TUI plugin).
CMD_COUNT=0
if [[ -d "$SCRIPT_DIR/commands" ]]; then
    for cmd_file in "$SCRIPT_DIR/commands"/*.md; do
        [[ -f "$cmd_file" ]] || continue
        cmd_name=$(basename "$cmd_file")
        ln -sfn "$cmd_file" "$CLAUDE_DIR/commands/$cmd_name"
        CMD_COUNT=$((CMD_COUNT + 1))
    done
    echo "   🔗 commands: $CMD_COUNT → $CLAUDE_DIR/commands/"
fi

# === Hooks ===
# 软链整个 hooks/ 目录到 ~/.claude/hooks/，让 settings.json 里的
# $HOME/.claude/hooks/*.sh 路径在所有项目里都能解析。
# 源在项目根 hooks/（跟 agents/ skills/ 平级），不是 .claude/hooks/。
if [[ -d "$SCRIPT_DIR/hooks" ]]; then
    ln -sfn "$SCRIPT_DIR/hooks" "$CLAUDE_DIR/hooks"
    HOOK_COUNT=$(find "$SCRIPT_DIR/hooks" -maxdepth 1 -type f -name "*.sh" | wc -l)
    echo "   🔗 hooks:  $HOOK_COUNT → $CLAUDE_DIR/hooks/ (含 lib.sh 共用库)"
fi

# === settings.json ===
# Claude Code 的项目级 hook 配置从 .claude/settings.json 加载，但本仓库的
# settings.json 在项目根（跟 hooks/ 平级）。为了让 hook 在 CWD 在本项目时
# 自动 fire，把仓库的 settings.json 软链到 ~/.claude/settings.json。
# 注意：会覆盖用户的 ~/.claude/settings.json（之前是项目级、Claude Code 只在
# 当前项目里加载，所以"项目级 vs 用户级"的语义现在变成"用户级"了）。
# 如果用户已有非 symlink 的 settings.json，先备份到 ${CLAUDE_DIR}/settings.json.bak。
if [[ -f "$SCRIPT_DIR/settings.json" ]]; then
    if [[ -L "$CLAUDE_DIR/settings.json" ]]; then
        rm -f "$CLAUDE_DIR/settings.json"
    elif [[ -e "$CLAUDE_DIR/settings.json" ]]; then
        echo "   ⚠️  $CLAUDE_DIR/settings.json exists; backing up to ${CLAUDE_DIR}/settings.json.bak"
        mv "$CLAUDE_DIR/settings.json" "${CLAUDE_DIR}/settings.json.bak"
    fi
    ln -sfn "$SCRIPT_DIR/settings.json" "$CLAUDE_DIR/settings.json"
    echo "   🔗 settings.json → $CLAUDE_DIR/settings.json"
fi

echo ""
echo "✅ Claude Code 安装完成！修改自动同步（软链）。"
echo ""
echo "💡 用法："
echo "   • 调出 walker：在 Claude Code 中对 Claude 说"
echo "       '使用 shadow-walker subagent 给我做一个 XX 系统'"
echo "   • 直接调某个 skill：输入 /shadow-l1-research 等 slash 命令"
echo "   • Walker 内部自动按需 Skill 加载工具，无需手动调用"
echo "   • Hooks 自动门禁：SessionStart 输出流水线上下文，PreToolUse(Skill)"
echo "     强制 5 步节奏 + 阻止跳阶段，Stop 扫存根 + 查 status 完成度"
echo ""
echo "🔁 卸载："
echo "   rm $CLAUDE_DIR/agents/shadow-walker.md"
echo "   rm $CLAUDE_DIR/skills/shadow-*"
echo "   rm $CLAUDE_DIR/commands/*.md  # slash commands (如 cjgoal)"
echo "   rm $CLAUDE_DIR/hooks   # 整个目录都是软链，删一个就行"
echo "   rm $CLAUDE_DIR/settings.json"
