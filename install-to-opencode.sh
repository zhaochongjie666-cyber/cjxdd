#!/bin/bash
# install-to-opencode.sh - Symlink agents, skills, extensions, models to ~/.config/opencode/
# Usage: ./install-to-opencode.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENCODE_DIR="${HOME}/.config/opencode"

echo "🚀 Installing to ~/.config/opencode/..."
echo "   Source: $SCRIPT_DIR"
echo "   Target: $OPENCODE_DIR"
echo

mkdir -p "$OPENCODE_DIR"

# === Skills ===
if [[ -d "$SCRIPT_DIR/skills" ]]; then
    ln -sfn "$SCRIPT_DIR/skills" "$OPENCODE_DIR/skills"
    SKILL_COUNT=$(find "$SCRIPT_DIR/skills" -maxdepth 1 -mindepth 1 -type d | wc -l)
    echo "   🔗 skills ($SKILL_COUNT skills)"
fi

# === Agents ===
if [[ -d "$SCRIPT_DIR/agents" ]]; then
    ln -sfn "$SCRIPT_DIR/agents" "$OPENCODE_DIR/agents"
    AGENT_COUNT=$(find "$SCRIPT_DIR/agents" -maxdepth 1 -type f -name "*.md" | wc -l)
    echo "   🔗 agents ($AGENT_COUNT agents)"
fi

# === Extensions ===
if [[ -d "$SCRIPT_DIR/extensions" ]]; then
    ln -sfn "$SCRIPT_DIR/extensions" "$OPENCODE_DIR/extensions"
    EXT_COUNT=$(find "$SCRIPT_DIR/extensions" -maxdepth 1 -type f -name "*.ts" | wc -l)
    echo "   🔗 extensions ($EXT_COUNT extensions)"
fi


# === System Prompt ===
if [[ -f "$SCRIPT_DIR/APPEND_SYSTEM.md" ]]; then
    ln -sfn "$SCRIPT_DIR/APPEND_SYSTEM.md" "$OPENCODE_DIR/APPEND_SYSTEM.md"
    echo "   🔗 APPEND_SYSTEM.md"
fi

# === Plugins ===
# 约定: 项目根的 plugins/ 目录 (不是 .opencode/plugins/)
# 这样更显眼, 跟 agents/ skills/ 平级
if [[ -d "$SCRIPT_DIR/plugins" ]]; then
    mkdir -p "$OPENCODE_DIR/plugins"
    PLUGIN_COUNT=0
    for plugin_file in "$SCRIPT_DIR/plugins"/*; do
        [[ -f "$plugin_file" ]] || continue
        plugin_name=$(basename "$plugin_file")
        ln -sfn "$plugin_file" "$OPENCODE_DIR/plugins/$plugin_name"
        PLUGIN_COUNT=$((PLUGIN_COUNT + 1))
    done
    echo "   🔗 plugins ($PLUGIN_COUNT plugins)"
fi

# === npm install for extensions with package.json ===
echo ""
echo "📦 Installing npm dependencies for extensions..."
if [[ -d "$SCRIPT_DIR/extensions" ]]; then
    for ext_dir in "$SCRIPT_DIR/extensions"/*/; do
        if [[ -f "${ext_dir}package.json" ]]; then
            ext_name=$(basename "$ext_dir")
            echo "   📦 $ext_name..."
            (cd "$ext_dir" && npm install --no-save 2>&1 | tail -1) || echo "   ⚠️  $ext_name npm install failed (non-fatal)"
        fi
    done
fi

echo ""
echo "✅ 安装完成！修改自动同步。"
