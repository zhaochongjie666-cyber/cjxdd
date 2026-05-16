#!/usr/bin/env bash
# check-architecture.sh — L1.5 Architecture 前置检查
# 用法: bash check-architecture.sh <slug>

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

# 检查 L1 Gate 通过
L1_GATE=""
for candidate in \
    "$SHADOW_DIR/.gate/l1.${SLUG}.passed" \
    "$SHADOW_DIR/.gate/l1.${SLUG#B??-}.passed"; do
    if [ -f "$candidate" ]; then
        L1_GATE="$candidate"
        break
    fi
done
if [ -z "$L1_GATE" ]; then
    echo "❌ 错误: L1 Gate 未通过 (缺少 $L1_GATE)"
    echo "请先完成 L1 并通过 Gate"
    exit 1
fi

# 检查 L1 产出
L1_DIR="$(resolve_l1_dir "$SLUG" || true)"
if [ -z "$L1_DIR" ]; then
    echo "❌ 错误: L1 业务目录不存在: $SLUG"
    exit 1
fi
SPEC_FILE="$L1_DIR/spec.md"
FLOW_FILE=""
for f in "$SHADOW_DIR/L1-business/project.flow.mermaid" "$SHADOW_DIR/L1-business/flow.mermaid" "$L1_DIR/flow.mermaid" "$L1_DIR/${SLUG}.flow.mermaid"; do
    [ -f "$f" ] && FLOW_FILE="$f" && break
done
WIRE_DIR="$L1_DIR/wire"
WIRE_SVG="$L1_DIR/wire.svg"

if [ ! -f "$SPEC_FILE" ]; then
    echo "❌ 错误: L1 spec.md 不存在: $SPEC_FILE"
    exit 1
fi

if [ -z "$FLOW_FILE" ]; then
    echo "❌ 错误: L1 project.flow.mermaid 不存在"
    exit 1
fi

echo "✅ 前置检查通过"
echo "  L1 Gate: $L1_GATE"
echo "  Spec: $SPEC_FILE"
echo "  Flow: $FLOW_FILE"
if [ -f "$WIRE_SVG" ]; then
    echo "  Wire: $WIRE_SVG"
    if ! grep -qi 'data-action="[^"]\+"' "$WIRE_SVG"; then
        echo "❌ 错误: wire.svg 缺少 data-action，无法传导 UI 交互契约"
        exit 1
    fi
    if ! grep -qi 'data-target="[^"]\+"' "$WIRE_SVG"; then
        echo "❌ 错误: wire.svg 缺少 data-target，无法传导页面/弹窗/API/状态目标"
        exit 1
    fi
    if ! grep -qiE '(<g[^>]+id="(page|screen|view)[^"]*"|data-page="[^"]+")' "$WIRE_SVG"; then
        echo "❌ 错误: wire.svg 缺少页面/视图分组，无法生成前端文件清单"
        exit 1
    fi
elif [ -d "$WIRE_DIR" ]; then
    echo "❌ 错误: wire/ 不再作为 L1 Wire 产物，请升级为 wire.svg"
    exit 1
elif [ -f "$L1_DIR/wire.html" ]; then
    echo "❌ 错误: wire.html 不再作为 L1 Wire 产物，请升级为 wire.svg"
    exit 1
else
    echo "  Wire: N/A"
fi
