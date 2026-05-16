#!/usr/bin/env bash
set -euo pipefail

# L1 Gate Check — 结构硬校验
# 用法:
#   bash skills/shadow-l1-flow/scripts/gate-check-l1.sh <slug>

SLUG="${1:-}"
[ -z "$SLUG" ] && { echo "用法: $0 <slug>"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SHADOW_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
SHADOW_DIR="$PROJECT_DIR/.shadow"
source "$PROJECT_DIR/skills/shadow-l1-flow/scripts/iter-helpers.sh"
gate_init_checks
trap gate_cleanup_checks EXIT
L1_DIR="$SHADOW_DIR/L1-business/$SLUG"
INDEX_FILE="$SHADOW_DIR/L1-business/INDEX.md"
SPEC_FILE="$L1_DIR/spec.md"
RESEARCH_FILE="$L1_DIR/research.md"
WIRE_SVG="$SHADOW_DIR/L1-business/wire.svg"
WIRE_FILE="$L1_DIR/wire.html"
WIRE_DIR="$L1_DIR/wire"
FLOW_FILE=""
for f in "$SHADOW_DIR/L1-business/project.flow.mermaid" "$SHADOW_DIR/L1-business/flow.mermaid" "$L1_DIR/flow.mermaid" "$L1_DIR/${SLUG}.flow.mermaid"; do
  [ -f "$f" ] && FLOW_FILE="$f" && break
done

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; NC='\033[0m'
PASS=0
FAIL=0
WARN=0

l1_check_meta() {
  local status="$1"
  local check_id="$2"
  local severity="info"
  if [ "$status" = FAIL ]; then
    severity="high"
  elif [ "$status" = WARN ]; then
    severity="medium"
  fi
  case "$check_id" in
    l1.research.handoff*|l1.research.downstream*|l1.research.open-questions)
      printf '%s|%s|%s\n' "research_quality" "$severity" "补齐 research.md 的下游交接和阻塞风险说明后重跑 L1 Gate"
      ;;
    l1.research.*)
      [ "$status" = FAIL ] && severity="blocking"
      printf '%s|%s|%s\n' "research_quality" "$severity" "补齐 research.md 的深度、章节和方案对比后重跑 L1 Gate"
      ;;
    l1.spec.required-section|l1.spec.rule-*|l1.spec.vague-words|l1.spec.handoff-section)
      printf '%s|%s|%s\n' "spec_contract" "$severity" "修正 spec.md 的规则编号、必需章节或模糊描述后重跑"
      ;;
    l1.spec.recommended-section|l1.spec.impl-signal)
      printf '%s|%s|%s\n' "spec_quality" "$severity" "补强 spec.md 的实现信号和推荐章节，降低下游理解偏差"
      ;;
    l1.index.*)
      [ "$status" = FAIL ] && severity="blocking"
      printf '%s|%s|%s\n' "catalog_index" "$severity" "补齐 L1-business/INDEX.md，并登记当前 slug"
      ;;
    l1.flow.render|l1.flow.result-node|l1.flow.error-branch|l1.flow.header|l1.flow.exists|l1.flow.triangle-links)
      printf '%s|%s|%s\n' "flow_contract" "$severity" "修正 project.flow.mermaid 的结构、结果节点或渲染问题后重跑"
      ;;
    l1.wire.*)
      printf '%s|%s|%s\n' "wire_contract" "$severity" "补齐 wire.svg 的 SVG 根节点、布局分区、完整页面清单、data-node/data-rule/data-action/data-target 映射和关键状态反馈"
      ;;
    *)
      printf '%s|%s|%s\n' "l1_hard_gate" "$severity" "根据该检查项补齐 L1 输入后重跑 gate-check-l1.sh"
      ;;
  esac
}

l1_record() {
  local status="$1" check_id="${2:-}" message="$3" evidence="${4:-}"
  local meta category severity remediation
  meta=$(l1_check_meta "$status" "$check_id")
  category="${meta%%|*}"
  meta="${meta#*|}"
  severity="${meta%%|*}"
  remediation="${meta#*|}"
  case "$severity" in
    info|low|medium|high|blocking) ;;
    *)
      if [ "$status" = FAIL ]; then
        severity="high"
      elif [ "$status" = WARN ]; then
        severity="medium"
      else
        severity="info"
      fi
      ;;
  esac
  gate_record_check "$status" "$check_id" "$message" "$evidence" "$category" "$severity" "$remediation"
}

ok()   { echo -e "${GREEN}PASS${NC} $1"; PASS=$((PASS+1)); l1_record PASS "${2:-}" "$1" "${3:-}"; }
fail() { echo -e "${RED}FAIL${NC} $1"; FAIL=$((FAIL+1)); l1_record FAIL "${2:-}" "$1" "${3:-}"; }
warn() { echo -e "${YELLOW}WARN${NC} $1"; WARN=$((WARN+1)); l1_record WARN "${2:-}" "$1" "${3:-}"; }

check_file() {
  local file="$1"; local label="$2"
  local check_id="${3:-l1.file.exists}"
  if [ -f "$file" ]; then ok "$label 存在" "$check_id" "$file"; else fail "$label 缺失: $file" "$check_id" "$file"; fi
}

count_rule_ids() {
  grep -oE "${SLUG}-R[0-9]+" "$SPEC_FILE" 2>/dev/null | sort -u
}

check_rule_sequence() {
  [ -f "$SPEC_FILE" ] || return 0
  mapfile -t rules < <(count_rule_ids)
  if [ ${#rules[@]} -eq 0 ]; then fail "spec.md 无规则 ID" "l1.spec.rule-ids" "$SPEC_FILE"; return; fi
  local i=1
  local bad=0
  for r in "${rules[@]}"; do
    local expect
    expect=$(printf "%s-R%02d" "$SLUG" "$i")
    if [ "$r" != "$expect" ]; then
      bad=1
      break
    fi
    i=$((i+1))
  done
  [ $bad -eq 0 ] && ok "规则 ID 连续无跳号 (${#rules[@]} 条)" "l1.spec.rule-sequence" "${#rules[@]}" || fail "规则 ID 不连续或格式不一致" "l1.spec.rule-sequence" "$SPEC_FILE"
}

check_required_sections() {
  [ -f "$SPEC_FILE" ] || return 0
  local missing=0
  local sections=(
    "业务目标"
    "角色"
    "可观测状态"
    "验收路径"
  )
  for s in "${sections[@]}"; do
    if grep -Eq "^## .*${s}" "$SPEC_FILE"; then
      ok "spec.md 包含章节: $s" "l1.spec.required-section" "$s"
    else
      fail "spec.md 缺少章节: $s" "l1.spec.required-section" "$s"
      missing=1
    fi
  done

  local recommended=(
    "核心对象与状态"
    "异常与边界"
    "数据约束"
    "外部依赖与副作用"
    "实现提醒"
  )
  for s in "${recommended[@]}"; do
    if grep -Eq "^## .*${s}" "$SPEC_FILE"; then
      ok "spec.md 包含推荐章节: $s" "l1.spec.recommended-section" "$s"
    else
      warn "spec.md 缺少推荐章节: $s" "l1.spec.recommended-section" "$s"
    fi
  done

  local handoff=(
    "给 L1.5 的输入"
    "给 L2 的输入"
    "给 L5 的输入"
  )
  for s in "${handoff[@]}"; do
    if grep -Eq "^## .*${s}" "$SPEC_FILE"; then
      ok "spec.md 包含交接章节: $s" "l1.spec.handoff-section" "$s"
    else
      fail "spec.md 缺少交接章节: $s" "l1.spec.handoff-section" "$s"
      missing=1
    fi
  done
}

check_research_depth() {
  [ -f "$RESEARCH_FILE" ] || return 0
  local lines
  lines=$(wc -l < "$RESEARCH_FILE" | tr -d '[:space:]')
  if [ "$lines" -ge 50 ]; then ok "research.md 行数 >= 50" "l1.research.lines" "$lines"; else fail "research.md 行数不足: $lines < 50" "l1.research.lines" "$lines"; fi

  local checks=(
    "流程:流程|业务背景|现有系统"
    "实现:实现|方案|技术"
    "技术选型:技术选型|选型|决策"
    "调研结论:调研结论|结论|总结"
    "风险:风险|约束"
  )
  for item in "${checks[@]}"; do
    local label="${item%%:*}"
    local pattern="${item#*:}"
    if grep -Eq "^## .*(${pattern})" "$RESEARCH_FILE"; then
      ok "research.md 包含章节: $label" "l1.research.section" "$label"
    else
      fail "research.md 缺少章节: $label" "l1.research.section" "$label"
    fi
  done

  local compare_count
  compare_count=$(grep -Ec "方案 A|方案A|方案 B|方案B" "$RESEARCH_FILE" || true)
  if [ "$compare_count" -ge 2 ]; then ok "research.md 包含方案对比" "l1.research.comparison" "$compare_count"; else fail "research.md 缺少足够的方案对比" "l1.research.comparison" "$compare_count"; fi

  if grep -Eq "^## .*下游交接" "$RESEARCH_FILE"; then
    ok "research.md 包含下游交接总章节" "l1.research.downstream-summary" "下游交接"
  else
    fail "research.md 缺少下游交接总章节" "l1.research.downstream-summary" "$RESEARCH_FILE"
  fi

  local handoff_sections=("给 L1.5" "给 L2" "给 L5")
  for s in "${handoff_sections[@]}"; do
    if grep -Eq "^###+ .*${s}" "$RESEARCH_FILE"; then
      ok "research.md 包含下游交接: $s" "l1.research.handoff-section" "$s"
    else
      fail "research.md 缺少下游交接: $s" "l1.research.handoff-section" "$s"
    fi
  done

  if grep -Eq "^###+ .*风险|^## .*风险与约束" "$RESEARCH_FILE"; then
    ok "research.md 显式记录风险/阻塞项" "l1.research.open-questions" "风险"
  else
    fail "research.md 未显式记录风险/阻塞项" "l1.research.open-questions" "$RESEARCH_FILE"
  fi
}

check_flow_basic() {
  [ -n "$FLOW_FILE" ] || { fail "project.flow.mermaid 缺失" "l1.flow.exists"; return; }
  ok "project.flow.mermaid 存在" "l1.flow.exists" "$FLOW_FILE"
  if [ "$(basename "$FLOW_FILE")" != "project.flow.mermaid" ]; then
    warn "使用旧版 flow 文件名，建议迁移到 .shadow/L1-business/project.flow.mermaid" "l1.flow.legacy-name" "$FLOW_FILE"
  fi

  if head -1 "$FLOW_FILE" | grep -q "flowchart"; then ok "project.flow.mermaid 头部正确" "l1.flow.header" "$FLOW_FILE"; else fail "project.flow.mermaid 缺少 flowchart 头" "l1.flow.header" "$FLOW_FILE"; fi
  if grep -q "resultNode" "$FLOW_FILE"; then ok "project.flow.mermaid 包含 resultNode" "l1.flow.result-node" "$FLOW_FILE"; else fail "project.flow.mermaid 缺少 resultNode" "l1.flow.result-node" "$FLOW_FILE"; fi

  local has_error_branch
  has_error_branch=$(grep -Ec "\|否\||错误|失败|超时|重试|异常|429|4[0-9]{2}|5[0-9]{2}" "$FLOW_FILE" || true)
  if [ "$has_error_branch" -gt 0 ]; then ok "project.flow.mermaid 包含异常/错误分支" "l1.flow.error-branch" "$has_error_branch"; else fail "project.flow.mermaid 缺少异常/错误分支" "l1.flow.error-branch" "$FLOW_FILE"; fi

  local has_flow_signal
  has_flow_signal=$(grep -Ec "HTTP|RPC|query:|write:|read:|event:|external:|POST |GET |PUT |PATCH |DELETE " "$FLOW_FILE" || true)
  if [ "$has_flow_signal" -gt 0 ]; then ok "project.flow.mermaid 包含接口/数据/事件流转标注" "l1.flow.data-api-signal" "$has_flow_signal"; else fail "project.flow.mermaid 缺少接口/数据/事件流转标注" "l1.flow.data-api-signal" "$FLOW_FILE"; fi

  local mermaid_check=""
  for candidate in \
    "$PROJECT_DIR/skills/shadow-l1-flow/scripts/mmdc-check.sh" \
    "$PROJECT_DIR/skills/mermaid-check/scripts/mmdc_check.sh"; do
    if [ -x "$candidate" ]; then
      mermaid_check="$candidate"
      break
    fi
  done

  if [ -n "$mermaid_check" ]; then
    if "$mermaid_check" "$SHADOW_DIR" >/tmp/l1_mmdc.out 2>&1; then
      ok "Mermaid 渲染验证通过" "l1.flow.render" "$mermaid_check"
    else
      fail "Mermaid 渲染验证失败" "l1.flow.render" "$mermaid_check"
      tail -20 /tmp/l1_mmdc.out || true
    fi
  else
    fail "Mermaid 渲染脚本缺失" "l1.flow.render"
  fi

  local triangle_check="$PROJECT_DIR/skills/shadow-l1-flow/scripts/check-triangle-links.sh"
  if [ -x "$triangle_check" ]; then
    if "$triangle_check" "$SLUG" >/tmp/l1_triangle.out 2>&1; then
      ok "L1 三角链接校验通过" "l1.flow.triangle-links" "$triangle_check"
    else
      fail "L1 三角链接校验失败" "l1.flow.triangle-links" "$triangle_check"
      tail -20 /tmp/l1_triangle.out || true
    fi
  else
    fail "三角链接校验脚本缺失" "l1.flow.triangle-links" "$triangle_check"
  fi
}

check_wire_artifact() {
  if [ -f "$WIRE_SVG" ]; then
    ok "wire.svg 存在（正式产物）" "l1.wire.svg.exists" "$WIRE_SVG"
    grep -qi '<svg[[:space:]>]' "$WIRE_SVG" && ok "wire.svg 包含 SVG 根节点" "l1.wire.svg-root" "$WIRE_SVG" || fail "wire.svg 缺少 SVG 根节点" "l1.wire.svg-root" "$WIRE_SVG"
    grep -qi '</svg>' "$WIRE_SVG" && ok "wire.svg 包含闭合根节点" "l1.wire.svg-close" "$WIRE_SVG" || fail "wire.svg 缺少 </svg>" "l1.wire.svg-close" "$WIRE_SVG"
    grep -qiE '<g[^>]+id="(header|sidebar|main|footer|content|nav|toolbar|form|table|list|dialog|drawer|state|empty|error|loading)' "$WIRE_SVG" \
      && ok "wire.svg 包含可解析布局分区" "l1.wire.structure" "$WIRE_SVG" \
      || fail "wire.svg 缺少可解析布局分区" "l1.wire.structure" "$WIRE_SVG"
    grep -qi 'data-node="B[0-9][0-9]-N[0-9][0-9]' "$WIRE_SVG" && ok "wire.svg 包含 data-node 映射" "l1.wire.data-node" "$WIRE_SVG" || fail "wire.svg 缺少 data-node 映射" "l1.wire.data-node" "$WIRE_SVG"
    grep -qi 'data-rule="R[0-9][0-9]' "$WIRE_SVG" && ok "wire.svg 包含 data-rule 映射" "l1.wire.data-rule" "$WIRE_SVG" || fail "wire.svg 缺少 data-rule 映射" "l1.wire.data-rule" "$WIRE_SVG"
    grep -qi 'data-action="[^"]\+"' "$WIRE_SVG" && ok "wire.svg 包含 data-action 交互动作" "l1.wire.data-action" "$WIRE_SVG" || fail "wire.svg 缺少 data-action；无法识别所有可交互点" "l1.wire.data-action" "$WIRE_SVG"
    grep -qi 'data-target="[^"]\+"' "$WIRE_SVG" && ok "wire.svg 包含 data-target 交互目标" "l1.wire.data-target" "$WIRE_SVG" || fail "wire.svg 缺少 data-target；无法传导到页面/弹窗/API/状态实现" "l1.wire.data-target" "$WIRE_SVG"
    grep -qiE '(<g[^>]+id="(page|screen|view)[^"]*"|data-page="[^"]+")' "$WIRE_SVG" && ok "wire.svg 包含页面/视图分组" "l1.wire.pages" "$WIRE_SVG" || fail "wire.svg 缺少页面/视图分组；无法通过 SVG 了解所有界面" "l1.wire.pages" "$WIRE_SVG"
    grep -qiE 'data-state="[^"]+"' "$WIRE_SVG" && ok "wire.svg 包含 data-state 状态标注" "l1.wire.data-state" "$WIRE_SVG" || fail "wire.svg 缺少 data-state 状态标注" "l1.wire.data-state" "$WIRE_SVG"
  else
    if [ -d "$WIRE_DIR" ] || [ -f "$WIRE_FILE" ]; then
      fail "wire.svg 缺失；L1 Wire 正式产物必须是 .shadow/L1-business/wire.svg" "l1.wire.svg.exists" "$WIRE_SVG"
      [ -d "$WIRE_DIR" ] && fail "发现旧 wire/ 目录；请升级为 wire.svg" "l1.wire.unsupported-dir" "$WIRE_DIR"
      [ -f "$WIRE_FILE" ] && fail "发现旧 wire.html；请升级为 wire.svg" "l1.wire.unsupported-html" "$WIRE_FILE"
    else
      warn "wire.svg 缺失（若为纯后端/Skill 可接受；有用户交互则必须补齐）" "l1.wire.svg.exists" "$WIRE_SVG"
    fi
  fi

  if [ -f "$WIRE_SVG" ]; then
    if grep -qi '空状态\|成功\|加载中\|错误\|失败\|待处理\|error\|empty\|loading\|pending\|data-state="normal"\|data-state="loading"\|data-state="empty"\|data-state="error"' "$WIRE_SVG"; then
      ok "wire.svg 体现关键状态/反馈" "l1.wire.feedback-state" "$WIRE_SVG"
    else
      fail "wire.svg 缺少关键状态/反馈表达" "l1.wire.feedback-state" "$WIRE_SVG"
    fi
    if grep -qiE '<metadata|<desc|implement:|component:|api\.|frontend/|route:' "$WIRE_SVG"; then
      ok "wire.svg 包含实现传导摘要或线索" "l1.wire.implementation-hints" "$WIRE_SVG"
    else
      warn "wire.svg 缺少 metadata/desc 实现传导摘要" "l1.wire.implementation-hints" "$WIRE_SVG"
    fi
  fi
}

check_index() {
  [ -f "$INDEX_FILE" ] || { fail "INDEX.md 缺失" "l1.index.exists"; return; }
  ok "INDEX.md 存在" "l1.index.exists" "$INDEX_FILE"
  if grep -q "| $SLUG |" "$INDEX_FILE"; then ok "INDEX.md 包含当前 slug" "l1.index.slug" "$SLUG"; else fail "INDEX.md 缺少当前 slug 索引行" "l1.index.slug" "$SLUG"; fi
  local star_count
  star_count=$(grep -o "⭐" "$INDEX_FILE" 2>/dev/null | wc -l | tr -d '[:space:]')
  if [ "$star_count" -eq 1 ]; then ok "INDEX.md 主业务标记唯一" "l1.index.primary-star" "$star_count"; else warn "INDEX.md 主业务标记数量异常: $star_count" "l1.index.primary-star" "$star_count"; fi
}

check_impl_readiness_keywords() {
  [ -f "$SPEC_FILE" ] || return 0
  local need=("错误码|error" "状态" "验收" "权限" "数据" "依赖")
  for k in "${need[@]}"; do
    local label="$k"
    if grep -Eiq "$k" "$SPEC_FILE"; then
      ok "spec.md 包含实现关键信息: $label" "l1.spec.impl-signal" "$label"
    else
      warn "spec.md 缺少明显的实现关键信息: $label" "l1.spec.impl-signal" "$label"
    fi
  done
}

check_vague_words() {
  [ -f "$SPEC_FILE" ] || return 0
  local vague_count
  vague_count=$( (grep -Eo "相关|必要时|适当|做校验|处理异常|返回结果|系统处理|系统进行|触发通知" "$SPEC_FILE" 2>/dev/null || true) | wc -l | tr -d '[:space:]' )
  if [ "$vague_count" -eq 0 ]; then ok "spec.md 无明显模糊词" "l1.spec.vague-words" "0"; else fail "spec.md 存在模糊词 ${vague_count} 处（相关/必要时/适当/做校验/处理异常/返回结果）" "l1.spec.vague-words" "$vague_count"; fi
}

echo "=== L1 Gate Check: $SLUG ==="
check_file "$RESEARCH_FILE" "research.md" "l1.research.exists"
[ -n "$FLOW_FILE" ] && ok "project.flow.mermaid 文件已发现: $(basename "$FLOW_FILE")" "l1.flow.exists" "$FLOW_FILE" || fail "project.flow.mermaid 文件未发现" "l1.flow.exists"
check_file "$SPEC_FILE" "spec.md" "l1.spec.exists"
check_index
check_research_depth
check_required_sections
check_rule_sequence
check_flow_basic
check_wire_artifact
check_impl_readiness_keywords
check_vague_words

echo
echo "=== Result: PASS=$PASS WARN=$WARN FAIL=$FAIL ==="
if [ "$FAIL" -eq 0 ]; then
  exit 0
else
  exit 1
fi
