#!/usr/bin/env bash
# extract-wire-struct.sh — 从 wire.svg 提取 UI/UX 契约结构
# 用法: bash extract-wire-struct.sh <slug>

set -euo pipefail

SLUG="${1:-}"
if [ -z "$SLUG" ]; then
    echo "用法: $0 <slug>"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SHADOW_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
SHADOW_DIR="$PROJECT_DIR/.shadow"

resolve_l1_dir() {
    local input="$1"
    if [ -d "$SHADOW_DIR/L1-business/$input" ]; then
        printf '%s\n' "$SHADOW_DIR/L1-business/$input"
        return 0
    fi
    local match
    match=$(find "$SHADOW_DIR/L1-business" -maxdepth 1 -mindepth 1 -type d -name "B??-$input" | head -n 1)
    if [ -n "$match" ]; then
        printf '%s\n' "$match"
        return 0
    fi
    return 1
}

L1_DIR="$(resolve_l1_dir "$SLUG" || true)"
[ -n "$L1_DIR" ] || { echo "⚠️  L1 业务目录不存在"; exit 0; }
WIRE_DIR="$L1_DIR/wire"
WIRE_SVG="$L1_DIR/wire.svg"

wire_sources=()
if [ -f "$WIRE_SVG" ]; then
    wire_sources+=("$WIRE_SVG")
elif [ -d "$WIRE_DIR" ]; then
    echo "❌ wire/ 不再作为 L1 Wire 产物；请升级为 wire.svg" >&2
    exit 1
elif [ -f "$L1_DIR/wire.html" ]; then
    echo "❌ wire.html 不再作为 L1 Wire 产物；请升级为 wire.svg" >&2
    exit 1
else
    echo "⚠️  wire 产物不存在 (纯后端项目可跳过)"
    exit 0
fi

echo "=== Wire Structure Extraction ==="
echo ""

echo "Nodes:"
grep -h -oE 'data-node="[^"]*"' "${wire_sources[@]}" | sed 's/data-node="//;s/"//' | sort -u | while read -r node; do
    [ -n "$node" ] && echo "  - $node"
done

echo ""
echo "Pages:"
grep -h -oE 'data-page="[^"]*"|id="(page|screen|view)[^"]*"' "${wire_sources[@]}" 2>/dev/null | sort -u | while read -r page; do
    [ -n "$page" ] && echo "  - $page"
done

echo ""
echo "Routes:"
grep -h -oE 'data-route="[^"]*"' "${wire_sources[@]}" 2>/dev/null | sed 's/data-route="//;s/"//' | sort -u | while read -r route; do
    [ -n "$route" ] && echo "  - $route"
done

echo ""
echo "Actions:"
grep -h -oE 'data-action="[^"]*"' "${wire_sources[@]}" 2>/dev/null | sed 's/data-action="//;s/"//' | sort -u | while read -r action; do
    [ -n "$action" ] && echo "  - $action"
done

echo ""
echo "Targets:"
grep -h -oE 'data-target="[^"]*"' "${wire_sources[@]}" 2>/dev/null | sed 's/data-target="//;s/"//' | sort -u | while read -r target; do
    [ -n "$target" ] && echo "  - $target"
done

echo ""
echo "States:"
grep -h -oE 'data-state="[^"]*"|WireBadge[^>]*|badge-[^"]*|id="(normal|empty|error|loading|pending|success)[^"]*"' "${wire_sources[@]}" 2>/dev/null | sort | uniq -c | while read -r count state; do
    echo "  - $state: $count"
done
