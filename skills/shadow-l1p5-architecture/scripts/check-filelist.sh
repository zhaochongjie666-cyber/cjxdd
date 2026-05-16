#!/usr/bin/env bash
# check-filelist.sh — L1.5 Filelist 前置检查
# 用法: bash check-filelist.sh <slug>

set -euo pipefail

SLUG="${1:-}"
if [ -z "$SLUG" ]; then
    echo "用法: $0 <slug>"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SHADOW_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
SHADOW_DIR="$PROJECT_DIR/.shadow"

resolve_l15_dir() {
    local input="$1"
    if [ -d "$SHADOW_DIR/L1.5-architecture/$input" ]; then
        printf '%s\n' "$SHADOW_DIR/L1.5-architecture/$input"
        return 0
    fi
    local match
    match=$(find "$SHADOW_DIR/L1.5-architecture" -maxdepth 1 -mindepth 1 -type d -name "B??-$input" | head -n 1)
    if [ -n "$match" ]; then
        printf '%s\n' "$match"
        return 0
    fi
    return 1
}

L15_DIR="$(resolve_l15_dir "$SLUG" || true)"
[ -n "$L15_DIR" ] || L15_DIR="$SHADOW_DIR/L1.5-architecture/$SLUG"
ARCH_FILE="$L15_DIR/architecture.md"
FILELIST_FILE="$L15_DIR/file-list.md"

# 检查 architecture.md
if [ ! -f "$ARCH_FILE" ]; then
    echo "❌ 错误: architecture.md 不存在"
    echo "请先完成 shadow-l1p5-architecture"
    exit 1
fi

echo "✅ 前置检查通过"
echo "  Architecture: $ARCH_FILE"
echo "  Filelist: $FILELIST_FILE"

if [ ! -f "$FILELIST_FILE" ]; then
    echo "❌ 错误: file-list.md 不存在"
    exit 1
fi

if grep -Eq '^\| .*?-R[0-9]+' "$FILELIST_FILE"; then
    echo "✅ file-list.md 包含规则映射"
else
    echo "❌ 错误: file-list.md 缺少规则映射行"
    exit 1
fi
