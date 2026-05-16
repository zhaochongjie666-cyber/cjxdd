#!/usr/bin/env bash
# check-depth.sh — 检查 research.md 深度要求
# 用法: bash check-depth.sh <slug>

set -euo pipefail

SLUG="${1:-}"
if [ -z "$SLUG" ]; then
    echo "用法: $0 <slug>"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SHADOW_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
RESEARCH_FILE="$PROJECT_DIR/.shadow/L1-business/BXX-$SLUG/research.md"

if [ ! -f "$RESEARCH_FILE" ]; then
    echo "❌ 错误: research.md 不存在: $RESEARCH_FILE"
    exit 1
fi

# 统计行数（排除 Markdown 标记和空行）
LINE_COUNT=$(grep -v '^[[:space:]]*$' "$RESEARCH_FILE" | grep -v '^[#|`-]' | wc -l)

# 统计章节数（## 开头的标题）
CHAPTER_COUNT=$(grep -c '^## ' "$RESEARCH_FILE" || echo 0)

# 检查方案对比
SCHEME_COUNT=$(grep -c '方案[0-9]*\|方案 [0-9]*\|方案一\|方案二' "$RESEARCH_FILE" || echo 0)

echo "=== Research Depth Check ==="
echo ""
echo "文件: $RESEARCH_FILE"
echo "总行数: $LINE_COUNT (要求 ≥ 50)"
echo "章节数: $CHAPTER_COUNT (要求 ≥ 5)"
echo "方案数: $SCHEME_COUNT (要求 ≥ 2)"
echo ""

PASS=0
WARN=0

if [ "$LINE_COUNT" -ge 50 ]; then
    echo "✅ 总行数检查通过"
    PASS=$((PASS + 1))
else
    echo "⚠️  总行数不足 (当前: $LINE_COUNT, 需要: ≥ 50)"
    WARN=$((WARN + 1))
fi

if [ "$CHAPTER_COUNT" -ge 5 ]; then
    echo "✅ 章节数检查通过"
    PASS=$((PASS + 1))
else
    echo "⚠️  章节数不足 (当前: $CHAPTER_COUNT, 需要: ≥ 5)"
    WARN=$((WARN + 1))
fi

if [ "$SCHEME_COUNT" -ge 2 ]; then
    echo "✅ 方案对比检查通过"
    PASS=$((PASS + 1))
else
    echo "⚠️  方案对比不足 (当前: $SCHEME_COUNT, 需要: ≥ 2)"
    WARN=$((WARN + 1))
fi

for section in "下游交接" "给 L1.5" "给 L2" "给 L3-L5"; do
    if grep -Eq "^###+ .*${section}|^## .*${section}" "$RESEARCH_FILE"; then
        echo "✅ 包含章节: $section"
        PASS=$((PASS + 1))
    else
        echo "⚠️  缺少章节: $section"
        WARN=$((WARN + 1))
    fi
done

echo ""
echo "=== Result: PASS=$PASS WARN=$WARN ==="

[ $WARN -eq 0 ] && exit 0 || exit 1
