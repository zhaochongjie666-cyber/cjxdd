#!/usr/bin/env bash
set -euo pipefail

# Wire Check — SVG UI/UX 契约结构与 data-node/data-rule/data-action 传导验证
# 用法: bash skills/shadow-l1-wire/scripts/check-wire.sh <slug>

SLUG="${1:-}"
[ -z "$SLUG" ] && { echo "用法: $0 <slug>"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SHADOW_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
SHADOW_DIR="$PROJECT_DIR/.shadow"
L1_DIR="$SHADOW_DIR/L1-business/BXX-$SLUG"
WIRE_SVG="$L1_DIR/wire.svg"
WIRE_HTML="$L1_DIR/wire.html"
WIRE_DIR="$L1_DIR/wire"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; NC='\033[0m'
PASS=0
FAIL=0
WARN=0

ok()   { echo -e "${GREEN}PASS${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}FAIL${NC} $1"; FAIL=$((FAIL+1)); }
warn() { echo -e "${YELLOW}WARN${NC} $1"; WARN=$((WARN+1)); }

if [ -f "$WIRE_SVG" ]; then
  ok "wire.svg 存在（正式产物）"
else
  fail "wire.svg 缺失；L1 Wire 正式产物必须是 .shadow/L1-business/wire.svg"
  [ -d "$WIRE_DIR" ] && fail "发现旧 wire/ 目录；请升级为 wire.svg，不再接受 Vue/HTML wire"
  [ -f "$WIRE_HTML" ] && fail "发现旧 wire.html；请升级为 wire.svg，不再接受 HTML wire"
  echo
  echo "=== Result: PASS=$PASS WARN=$WARN FAIL=$FAIL ==="
  exit 1
fi

wire_sources=("$WIRE_SVG")

# ── 2. 文档/组件有效性 ──
grep -qi '<svg[[:space:]>]' "$WIRE_SVG" && ok "wire.svg 包含 SVG 根节点" || fail "wire.svg 缺少 SVG 根节点"
grep -qi '</svg>' "$WIRE_SVG" && ok "wire.svg 包含 </svg>" || fail "wire.svg 缺少 </svg>"

# ── 3. data-node 属性 ──
data_node_count=$(grep -h -oE 'data-node="[^"]+"' "${wire_sources[@]}" | sort -u | wc -l | tr -d '[:space:]')
if [ "$data_node_count" -gt 0 ]; then
  ok "wire 产物包含 data-node 属性 (${data_node_count} 个唯一节点)"
else
  fail "wire 产物缺少 data-node 属性"
fi

# ── 4. 核心 UI 结构 ──
grep -qiE '<g[^>]+id="(header|sidebar|main|footer|content|nav|toolbar|form|table|list|dialog|drawer|state|empty|error|loading)' "$WIRE_SVG" \
  && ok "wire.svg 包含布局/业务分区" \
  || fail "wire.svg 缺少可解析的布局分区"

# ── 5. 规则-UI-交互 映射 ──
if grep -h -qi 'data-node="B[0-9][0-9]-N[0-9][0-9]' "${wire_sources[@]}"; then
  ok "wire 产物包含规则到 UI 的节点映射"
else
  warn "wire 产物缺少明确的规则到 UI 节点映射"
fi

if grep -h -qi 'data-rule="R[0-9][0-9]' "${wire_sources[@]}"; then
  ok "wire.svg 包含 data-rule 规则映射"
else
  fail "wire.svg 缺少 data-rule 规则映射"
fi

data_action_count=$(grep -h -oE 'data-action="[^"]+"' "${wire_sources[@]}" | sort -u | wc -l | tr -d '[:space:]')
if [ "$data_action_count" -gt 0 ]; then
  ok "wire.svg 包含 data-action 交互动作 (${data_action_count} 个唯一动作)"
else
  fail "wire.svg 缺少 data-action；无法从 SVG 识别所有可交互点"
fi

data_target_count=$(grep -h -oE 'data-target="[^"]+"' "${wire_sources[@]}" | sort -u | wc -l | tr -d '[:space:]')
if [ "$data_target_count" -gt 0 ]; then
  ok "wire.svg 包含 data-target 交互目标 (${data_target_count} 个唯一目标)"
else
  fail "wire.svg 缺少 data-target；无法传导到页面/弹窗/API/状态实现"
fi

# ── 6. 页面数量 ──
page_count=$( (grep -oE '(<g[^>]+id="(page|screen|view)[^"]*"|data-page="[^"]+")' "$WIRE_SVG" || true) | wc -l | tr -d '[:space:]' )
if [ "$page_count" -ge 1 ]; then
  ok "wire.svg 包含 ${page_count} 个页面/视图分组"
else
  fail "wire.svg 未明显声明页面/视图分组；无法通过 SVG 了解所有界面"
fi

if grep -h -qiE 'data-route="[^"]+"|route:' "${wire_sources[@]}"; then
  ok "wire.svg 包含页面路由/入口信息"
else
  warn "wire.svg 缺少页面路由/入口信息；非路由型界面可接受，但需在 metadata/desc 说明入口"
fi

# ── 7. 状态与反馈语义 ──
state_count=$(grep -h -oE 'data-state="[^"]+"' "${wire_sources[@]}" | sort -u | wc -l | tr -d '[:space:]')
if [ "$state_count" -ge 3 ]; then
  ok "wire.svg 包含 data-state 状态变体 (${state_count} 类)"
elif grep -h -iqE '空状态|成功|加载中|错误|失败|待处理|error|empty|loading|pending' "${wire_sources[@]}"; then
  warn "wire 产物体现关键状态/反馈，但建议改为 data-state 可解析标注"
else
  fail "wire 产物未明显体现关键状态/反馈"
fi

# ── 8. 代码传导摘要 ──
if grep -h -qiE '<metadata|<desc|implement:|component:|api\.|frontend/|route:' "${wire_sources[@]}"; then
  ok "wire.svg 包含 metadata/desc 或实现传导线索"
else
  warn "wire.svg 缺少 metadata/desc 实现传导摘要；下游仍需从 data-* 属性抽取"
fi

echo
echo "=== Result: PASS=$PASS WARN=$WARN FAIL=$FAIL ==="
[ "$FAIL" -eq 0 ]
