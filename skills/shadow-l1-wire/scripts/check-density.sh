#!/usr/bin/env bash
# check-density.sh — wire.svg viewBox density 自检 (实施 A4 双保险第一层)
#
# 在 L1 wire skill 写完 wire.svg 立即跑, 失败时 AI 立即改 viewBox.
# 段 5.8 (runStopGate) 是第二层事后审计, 失败必硬阻断.
#
# 退出码:
#   0 = viewBox 紧凑 (density ≥ 30%, 节点 ≥ 5)
#   1 = viewBox 过空 或 节点过少
#   2 = wire.svg 不存在
#
# 用法:
#   bash skills/shadow-l1-wire/scripts/check-density.sh <path-to-wire.svg>
#   SHADOW_DIR=... bash skills/shadow-l1-wire/scripts/check-density.sh
set -uo pipefail

WIRE_SVG="${1:-}"
if [[ -z "$WIRE_SVG" ]]; then
  # 找默认 wire.svg: 先 SHADOW_DIR/L1-business/wire.svg, 再子目录 BXX-*/wire.svg
  SHADOW_DIR="${SHADOW_DIR:-}"
  if [[ -n "$SHADOW_DIR" ]] && [[ -f "$SHADOW_DIR/L1-business/wire.svg" ]]; then
    WIRE_SVG="$SHADOW_DIR/L1-business/wire.svg"
  elif [[ -n "$SHADOW_DIR" ]] && [[ -d "$SHADOW_DIR/L1-business" ]]; then
    WIRE_SVG=$(find "$SHADOW_DIR/L1-business" -name "wire.svg" -type f 2>/dev/null | head -1 || true)
  fi
fi

if [[ -z "$WIRE_SVG" ]] || [[ ! -f "$WIRE_SVG" ]]; then
  echo "[check-density] wire.svg 找不到: ${WIRE_SVG:-"(未指定)"}" >&2
  exit 2
fi

# 抽 viewBox (用 sed 更稳)
VB=$(sed -n 's/.*<svg[^>]*viewBox[[:space:]]*=[[:space:]]*["\x27]\([0-9. \-]*\)["\x27].*/\1/p' "$WIRE_SVG" | head -1)
if [[ -z "$VB" ]]; then
  echo "[check-density] FAIL: wire.svg 缺 viewBox 属性" >&2
  exit 1
fi

# 解析 viewBox: 4 个数字 "minX minY w h"
read -r VB_MINX VB_MINY VB_W VB_H <<< "$(echo "$VB" | tr -s ' ' '\n' | head -4 | tr '\n' ' ')"
if [[ -z "$VB_W" ]] || [[ -z "$VB_H" ]] || [[ "$VB_W" == "0" ]] || [[ "$VB_H" == "0" ]]; then
  echo "[check-density] FAIL: viewBox 解析失败: '$VB'" >&2
  exit 1
fi

# 算 <g transform="translate(x,y)"> 的 min/max x/y
MINX=$(grep -oE '<g\s+transform\s*=\s*["'\'']translate\(\s*-?[0-9.]+\s*,\s*-?[0-9.]+\s*\)["'\'']' "$WIRE_SVG" | grep -oE 'translate\(\s*-?[0-9.]+\s*,\s*-?[0-9.]+' | awk -F'[(,]' '{print $2}' | sort -n | head -1)
MAXX=$(grep -oE '<g\s+transform\s*=\s*["'\'']translate\(\s*-?[0-9.]+\s*,\s*-?[0-9.]+\s*\)["'\'']' "$WIRE_SVG" | grep -oE 'translate\(\s*-?[0-9.]+\s*,\s*-?[0-9.]+' | awk -F'[(,]' '{print $2}' | sort -n | tail -1)
MINY=$(grep -oE '<g\s+transform\s*=\s*["'\'']translate\(\s*-?[0-9.]+\s*,\s*-?[0-9.]+\s*\)["'\'']' "$WIRE_SVG" | grep -oE 'translate\(\s*-?[0-9.]+\s*,\s*-?[0-9.]+' | awk -F'[(,]' '{print $3}' | sort -n | head -1)
MAXY=$(grep -oE '<g\s+transform\s*=\s*["'\'']translate\(\s*-?[0-9.]+\s*,\s*-?[0-9.]+\s*\)["'\'']' "$WIRE_SVG" | grep -oE 'translate\(\s*-?[0-9.]+\s*,\s*-?[0-9.]+' | awk -F'[(,]' '{print $3}' | sort -n | tail -1)

if [[ -z "$MINX" ]] || [[ -z "$MAXX" ]]; then
  # 没 <g translate> — 走绝对坐标 fallback, 见下面
  MINX=""
  MAXX=""
  MINY=""
  MAXY=""
fi

# 算 density (awk 浮点, 取整 %)
if [[ -n "$MINX" ]] && [[ -n "$MAXX" ]]; then
  USED_W=$(awk -v a="$MAXX" -v b="$MINX" 'BEGIN { w=a-b; if (w<1) w=1; print w }')
  USED_H=$(awk -v a="$MAXY" -v b="$MINY" 'BEGIN { h=a-b; if (h<1) h=1; print h }')
  DENSITY_PCT=$(awk -v u="$USED_W" -v v="$USED_H" -v w="$VB_W" -v h="$VB_H" 'BEGIN { printf "%d", (u*v)/(w*h)*100 }')
  HAS_G_TRANSLATE=1
else
  # 没 <g translate>, 改用绝对 <rect x y> / <text x y> 估 bbox
  RECT_XS=$(grep -oE '<rect[^>]*\sx\s*=\s*["'\'']?[-0-9.]+' "$WIRE_SVG" | grep -oE 'x\s*=\s*["'\'']?[-0-9.]+' | grep -oE '[-0-9.]+' | sort -n | head -1)
  RECT_XE=$(grep -oE '<rect[^>]*\sx\s*=\s*["'\'']?[-0-9.]+' "$WIRE_SVG" | grep -oE 'x\s*=\s*["'\'']?[-0-9.]+' | grep -oE '[-0-9.]+' | sort -n | tail -1)
  TEXT_XS=$(grep -oE '<text[^>]*\sx\s*=\s*["'\'']?[-0-9.]+' "$WIRE_SVG" | grep -oE 'x\s*=\s*["'\'']?[-0-9.]+' | grep -oE '[-0-9.]+' | sort -n | head -1)
  TEXT_XE=$(grep -oE '<text[^>]*\sx\s*=\s*["'\'']?[-0-9.]+' "$WIRE_SVG" | grep -oE 'x\s*=\s*["'\'']?[-0-9.]+' | grep -oE '[-0-9.]+' | sort -n | tail -1)
  # 取 min(s) max(e) across rect + text
  ALL_MIN=$(printf "%s\n%s\n" "$RECT_XS" "$TEXT_XS" | sort -n | head -1)
  ALL_MAX=$(printf "%s\n%s\n" "$RECT_XE" "$TEXT_XE" | sort -n | tail -1)
  if [[ -n "$ALL_MIN" ]] && [[ -n "$ALL_MAX" ]]; then
    USED_W=$(awk -v a="$ALL_MAX" -v b="$ALL_MIN" 'BEGIN { w=a-b; if (w<1) w=1; print w }')
    USED_H="$USED_W"  # 简化: 用宽作高 (相对值够判定)
    DENSITY_PCT=$(awk -v u="$USED_W" -v v="$USED_H" -v w="$VB_W" -v h="$VB_H" 'BEGIN { printf "%d", (u*v)/(w*h)*100 }')
    HAS_G_TRANSLATE=0
  else
    echo "[check-density] FAIL: wire.svg 没有任何 <g translate> 或 <rect/text x=...> 元素" >&2
    exit 1
  fi
fi

# 数节点 (二次检查, 跟 viewBox 大小无关)
NODE_COUNT=$(grep -oE '<(rect|text|g|line|polyline|path|polygon|ellipse|circle)\b' "$WIRE_SVG" | wc -l)

echo "viewBox: ${VB_W}x${VB_H}, used: ${USED_W}x${USED_H}, density=${DENSITY_PCT}%, 节点=${NODE_COUNT}, g_translate=$([ -n "$HAS_G_TRANSLATE" ] && [ "$HAS_G_TRANSLATE" = "1" ] && echo yes || echo no)"

# 判定
if [[ "$DENSITY_PCT" -lt 30 ]] || [[ "$NODE_COUNT" -lt 5 ]]; then
  echo "[check-density] FAIL: viewBox 过空 (density=${DENSITY_PCT}% < 30% 或 节点 < 5)" >&2
  echo "  修复指引:" >&2
  echo "    1) 重设 viewBox = (max_x-min_x) × (max_y-min_y) + 10% padding" >&2
  echo "       算出 used=${USED_W}x${USED_H} → viewBox=\"0 0 ${USED_W} ${USED_H}\"" >&2
  echo "    2) 或加 padding: viewBox=\"-50 -50 $(awk -v w="$USED_W" 'BEGIN{print w+100}') $(awk -v h="$USED_H" 'BEGIN{print h+100}')\"" >&2
  echo "    3) 节点 < 5 → 加更多 <rect>/<text>/<g> 元素 (页面块 + 状态 + 交互)" >&2
  exit 1
fi

echo "[check-density] ✓ viewBox 紧凑 (density=${DENSITY_PCT}%, 节点=${NODE_COUNT})"
exit 0
