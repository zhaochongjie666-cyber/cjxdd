#!/usr/bin/env bash
# install.sh — xdd 通用安装（平台中立）
# 只软链 agents/ + skills/（平台公约数），不装 hooks/plugins/commands/settings。
#
# 用法:
#   ./install.sh                       # 自动探测 harness 目标目录
#   TARGET_DIR=~/.claude ./install.sh  # 显式指定目标目录
#   TARGET_DIR=~/.config/opencode ./install.sh
#   TARGET_DIR=~/.pi ./install.sh
#
# 平台中立: 装完后任何支持 agent+skill 的 AI coding 工具都能用 xdd。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# === 探测目标目录 ===
if [ -n "${TARGET_DIR:-}" ]; then
  DEST="$TARGET_DIR"
elif [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then
  DEST="$CLAUDE_CONFIG_DIR"
elif [ -d "$HOME/.config/opencode" ]; then
  DEST="$HOME/.config/opencode"
elif [ -d "$HOME/.pi" ]; then
  DEST="$HOME/.pi"
else
  DEST="$HOME/.claude"
fi

echo "xdd 安装 → $DEST"
echo "  软链: agents/ + skills/（平台公约数，无 hooks/plugins/commands/settings）"
echo

mkdir -p "$DEST"

# === 软链 agents/ + skills/ ===
link_dir() {
  local name="$1"   # agents / skills
  local src="$REPO_ROOT/$name"
  local dst="$DEST/$name"

  if [ -L "$dst" ]; then
    # 已是符号链接，更新指向
    rm "$dst"
    ln -s "$src" "$dst"
    echo "  ✓ $name → $src（更新软链）"
  elif [ -d "$dst" ]; then
    # 已是真实目录，不覆盖，提示
    echo "  ⚠ $dst 已是真实目录（非软链），跳过。手动处理: mv $dst $dst.bak 后重跑"
  else
    ln -s "$src" "$dst"
    echo "  ✓ $name → $src"
  fi
}

link_dir agents
link_dir skills

echo
echo "=== 验证 ==="
echo "  agents/: $(ls "$DEST/agents" 2>/dev/null | wc -l) 个 agent"
echo "  skills/: $(ls "$DEST/skills" 2>/dev/null | wc -l) 个 skill"
echo
echo "✅ 安装完成。对 AI 说: \"用 xdd-walker 给我做一个 <你的功能>\""
echo
echo "  其他平台手动软链:"
echo "    ln -s $REPO_ROOT/agents  ~/.claude/agents      # Claude Code"
echo "    ln -s $REPO_ROOT/skills  ~/.claude/skills"
echo "    ln -s $REPO_ROOT/agents  ~/.config/opencode/agents   # OpenCode"
echo "    ln -s $REPO_ROOT/skills  ~/.config/opencode/skills"
