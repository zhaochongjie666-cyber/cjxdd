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
#
# TUI plugin 必须显式列在 tui.json, 不会有 dir auto-discovery
# (见 packages/opencode/specs/tui-plugins.md: "There is no directory auto-discovery for TUI plugins")
# 这里软链文件 + 同步 tui.json 两件事都做
TUI_PLUGIN_NAMES=()
if [[ -d "$SCRIPT_DIR/plugins" ]]; then
    mkdir -p "$OPENCODE_DIR/plugins"
    PLUGIN_COUNT=0
    for plugin_file in "$SCRIPT_DIR/plugins"/*; do
        [[ -f "$plugin_file" ]] || continue
        plugin_name=$(basename "$plugin_file")
        ln -sfn "$plugin_file" "$OPENCODE_DIR/plugins/$plugin_name"
        PLUGIN_COUNT=$((PLUGIN_COUNT + 1))
        # 只把 .tsx 的列为 TUI plugin (TUI plugin 用 Solid JSX)
        if [[ "$plugin_name" == *.tsx ]]; then
            TUI_PLUGIN_NAMES+=("$plugin_name")
        fi
    done
    echo "   🔗 plugins ($PLUGIN_COUNT plugins)"

    # 同步 tui.json: 增量加 .tsx plugin, 保留已有 entry 不动
    if [[ ${#TUI_PLUGIN_NAMES[@]} -gt 0 ]]; then
        TUI_JSON="$OPENCODE_DIR/tui.json"
        if [[ ! -f "$TUI_JSON" ]]; then
            # 不存在则新建
            {
                echo '{'
                echo '  "$schema": "https://opencode.ai/tui.json",'
                echo '  "plugin": ['
                first=1
                for pn in "${TUI_PLUGIN_NAMES[@]}"; do
                    if [[ $first -eq 0 ]]; then echo '    ,'; fi
                    echo -n "    \"./plugins/$pn\""
                    first=0
                done
                echo
                echo '  ]'
                echo '}'
            } > "$TUI_JSON"
            echo "   📝 tui.json (新建, ${#TUI_PLUGIN_NAMES[@]} TUI plugins)"
        else
            # 存在则合并: 用 jq 加缺失的 plugin
            if command -v jq >/dev/null 2>&1; then
                ADDED=0
                for pn in "${TUI_PLUGIN_NAMES[@]}"; do
                    if ! jq -e --arg p "./plugins/$pn" '.plugin | index($p) != null' "$TUI_JSON" >/dev/null 2>&1; then
                        jq --arg p "./plugins/$pn" '.plugin += [$p]' "$TUI_JSON" > "${TUI_JSON}.tmp" && mv "${TUI_JSON}.tmp" "$TUI_JSON"
                        ADDED=$((ADDED + 1))
                    fi
                done
                [[ $ADDED -gt 0 ]] && echo "   📝 tui.json (新增 $ADDED plugin)" || echo "   📝 tui.json (无变化)"
            else
                echo "   ⚠️  jq 未装, 跳过 tui.json 合并 (手动加 plugins: [...])"
            fi
        fi
    fi
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
