#!/usr/bin/env bash
# check-quality.sh — L1.5 Quality 前置检查
# 用法: bash check-quality.sh <slug>

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
QUALITY_FILE="$L15_DIR/quality.md"

if [ ! -f "$QUALITY_FILE" ]; then
    echo "❌ 错误: quality.md 不存在"
    exit 1
fi

echo "=== Quality Check ==="

FAIL=0

# 检查一键启动命令
if grep -q "一键启动命令已配置" "$QUALITY_FILE" && grep -Eq 'cd .+ && |npm run dev|uv run python -m|python -m uvicorn|uvicorn |go run |spring-boot:run|docker compose up|pnpm dev|yarn dev' "$QUALITY_FILE"; then
    echo "✅ 一键启动命令已配置"
else
    echo "❌ 一键启动命令缺失或不完整"
    FAIL=$((FAIL+1))
fi

# 检查 6 维质量章节
for dim in "错误处理" "输入校验" "日志" "安全" "性能" "启动配置"; do
    if grep -q "##.*$dim" "$QUALITY_FILE"; then
        echo "✅ $dim 章节已存在"
    else
        echo "❌ $dim 章节缺失"
        FAIL=$((FAIL+1))
    fi
done

[ "$FAIL" -eq 0 ]
