#!/bin/bash
# install-to-pi.sh - Symlink agents, skills, hooks, settings.json to ~/.pi/
# Usage:
#   ./install-to-pi.sh                # 默认装到 ~/.pi/
#   PI_DIR=~/.config/pi ./install-to-pi.sh  # 自定义路径
#   ./install-to-pi.sh --dry-run      # 干跑 (只显示会装什么)
#   ./install-to-pi.sh --uninstall    # 卸载 (删软链)
#   ./install-to-pi.sh --force        # 强制覆盖非软链的现有目标 (备份为 .bak)
#   ./install-to-pi.sh --help
#
# 跟 install-to-claude-code.sh / install-to-opencode.sh 共享同一个 Shadow 仓库,
# 仅 target 目录不同. 修改本仓库后自动同步(软链).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PI_DIR="${PI_DIR:-$HOME/.pi}"

# ---------- 参数 ----------
DRY_RUN=0
UNINSTALL=0
FORCE=0

usage() {
    cat <<'USAGE'
install-to-pi.sh — 把 Shadow 软链到 pi coding agent

Usage:
  ./install-to-pi.sh [options]

Options:
  --dry-run     只显示会装什么, 不实际创建软链
  --uninstall   删所有软链 (还原)
  --force       强制覆盖非软链目标 (现有文件备份为 .bak)
  --help        显示帮助

Environment:
  PI_DIR=path   自定义 target 目录 (默认 ~/.pi)

Examples:
  ./install-to-pi.sh
  PI_DIR=~/.config/pi ./install-to-pi.sh
  ./install-to-pi.sh --dry-run
  ./install-to-pi.sh --uninstall
USAGE
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run)    DRY_RUN=1; shift ;;
        --uninstall)  UNINSTALL=1; shift ;;
        --force)      FORCE=1; shift ;;
        -h|--help)    usage ;;
        *)            echo "Unknown arg: $1"; usage; exit 1 ;;
    esac
done

# ---------- 校验 ----------
[[ -d "$SCRIPT_DIR/agents"  ]] || { echo "❌  $SCRIPT_DIR/agents  not found"; exit 1; }
[[ -d "$SCRIPT_DIR/skills"  ]] || { echo "❌  $SCRIPT_DIR/skills  not found"; exit 1; }
[[ -d "$SCRIPT_DIR/hooks"   ]] || { echo "❌  $SCRIPT_DIR/hooks  not found"; exit 1; }
[[ -f "$SCRIPT_DIR/settings.json" ]] || { echo "❌  $SCRIPT_DIR/settings.json not found"; exit 1; }

# ---------- 卸载 ----------
if [[ $UNINSTALL -eq 1 ]]; then
    echo "🗑️  Uninstalling from $PI_DIR..."
    # 软链删法: 软链本身, 不要 follow
    for f in agents skills hooks settings.json; do
        if [[ -L "$PI_DIR/$f" ]]; then
            target=$(readlink "$PI_DIR/$f")
            echo "   🔥 rm $PI_DIR/$f → $target"
            [[ $DRY_RUN -eq 0 ]] && rm -f "$PI_DIR/$f"
        elif [[ -e "$PI_DIR/$f" ]]; then
            echo "   ⚠️  $PI_DIR/$f exists but is not a symlink; skip (手动删)"
        else
            echo "   ·  $PI_DIR/$f 不存在, 跳过"
        fi
    done
    [[ $DRY_RUN -eq 0 ]] && echo "" && echo "✅ 卸载完成。"
    exit 0
fi

echo "🚀 Installing Shadow to $PI_DIR ..."
echo "   Source: $SCRIPT_DIR"
echo "   Target: $PI_DIR"
[[ $DRY_RUN -eq 1 ]] && echo "   Mode:   DRY RUN (不会改任何文件)"
[[ $FORCE -eq 1 ]]   && echo "   Force:  强制覆盖 (现有非软链目标备份为 .bak)"
echo ""

# ---------- 辅助: 智能软链 (处理 4 种情况) ----------
# 1) 目标不存在 → ln -sfn
# 2) 目标是软链 → 删了重建 (保证指向新源)
# 3) 目标是文件/目录但不是软链 + --force → mv .bak + ln -sfn
# 4) 目标是文件/目录但不是软链 + 无 --force → 报错退出
safe_link() {
    local src="$1" dst="$2" label="${3:-}"
    if [[ $DRY_RUN -eq 1 ]]; then
        echo "   [dry] ln -sfn $src $dst"
        return
    fi
    if [[ -L "$dst" ]]; then
        rm -f "$dst"
        ln -sfn "$src" "$dst"
        [[ -n "$label" ]] && echo "   🔗 $label → (更新软链)"
    elif [[ -e "$dst" ]]; then
        if [[ $FORCE -eq 1 ]]; then
            mv "$dst" "${dst}.bak"
            ln -sfn "$src" "$dst"
            [[ -n "$label" ]] && echo "   🔗 $label → (备份为 ${dst}.bak)"
        else
            echo "   ⚠️  $dst 已存在且不是软链. 跳过 (--force 强制覆盖)"
        fi
    else
        mkdir -p "$(dirname "$dst")"
        ln -sfn "$src" "$dst"
        [[ -n "$label" ]] && echo "   🔗 $label"
    fi
}

# === Agents ===
AGENT_COUNT=0
for agent_file in "$SCRIPT_DIR/agents"/*.md; do
    [[ -f "$agent_file" ]] || continue
    agent_name=$(basename "$agent_file")
    safe_link "$agent_file" "$PI_DIR/agents/$agent_name" "agent: $agent_name"
    AGENT_COUNT=$((AGENT_COUNT + 1))
done
echo "   📦 agents: $AGENT_COUNT"

# === Skills ===
SKILL_COUNT=0
for skill_dir in "$SCRIPT_DIR/skills"/*/; do
    [[ -d "$skill_dir" ]] || continue
    skill_name=$(basename "$skill_dir")
    safe_link "$skill_dir" "$PI_DIR/skills/$skill_name" "skill: $skill_name"
    SKILL_COUNT=$((SKILL_COUNT + 1))
done
echo "   📦 skills: $SKILL_COUNT"

# === Hooks (整个目录) ===
HOOK_COUNT=$(find "$SCRIPT_DIR/hooks" -maxdepth 1 -type f -name "*.sh" | wc -l)
safe_link "$SCRIPT_DIR/hooks" "$PI_DIR/hooks" "hooks/ ($HOOK_COUNT scripts, 含 lib.sh)"
echo "   📦 hooks:  $HOOK_COUNT"

# === settings.json ===
# pi 的 settings.json 在 ~/.pi/settings.json, 跟 CC 类似
# 仓库根的 settings.json 已含 4 个 hook 注册 (SessionStart/PreToolUse/PostToolUse/Stop)
# 注: 软链后 pi 启动时会直接读 ~/.pi/settings.json, 看到的是仓库根的版本
safe_link "$SCRIPT_DIR/settings.json" "$PI_DIR/settings.json" "settings.json (4 hook 注册)"

# === 报告 ===
echo ""
if [[ $DRY_RUN -eq 1 ]]; then
    echo "✅ DRY RUN 完成 (无文件改动). 去掉 --dry-run 实际安装."
else
    echo "✅ pi 安装完成! 修改自动同步(软链)."
    echo ""
    echo "💡 用法:"
    echo "   • 调出 walker: 对 pi 说"
    echo "       '使用 xdd-walker-pi subagent 给我做一个 XX 系统'"
    echo "   • 直接调某个 skill: /xdd-bdd 等 slash 命令"
    echo "   • 装到自定义目录: PI_DIR=~/.config/pi ./install-to-pi.sh"
    echo "   • 干跑看会装什么: ./install-to-pi.sh --dry-run"
    echo "   • 卸载: ./install-to-pi.sh --uninstall"
    echo ""
    echo "🔍 验证:"
    echo "   ls -la $PI_DIR/agents/ $PI_DIR/skills/ $PI_DIR/hooks/ $PI_DIR/settings.json"
    echo "   bash $PI_DIR/hooks/stop-gate.sh"
    echo ""
    echo "🔁 卸载:"
    echo "   ./install-to-pi.sh --uninstall"
fi
