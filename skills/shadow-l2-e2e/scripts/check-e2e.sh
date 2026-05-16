#!/usr/bin/env bash
set -euo pipefail

SLUG="${1:-}"
[ -z "$SLUG" ] && { echo "用法: $0 <slug>"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SHADOW_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
SHADOW_DIR="$PROJECT_DIR/.shadow"
source "$PROJECT_DIR/skills/shadow-l1-flow/scripts/iter-helpers.sh"
gate_init_checks
trap gate_cleanup_checks EXIT
L1_DIR="$SHADOW_DIR/L1-business/$SLUG"
SPEC_FILE="$L1_DIR/spec.md"
FLOW_FILE=""
for f in "$SHADOW_DIR/L1-business/project.flow.mermaid" "$SHADOW_DIR/L1-business/flow.mermaid" "$L1_DIR/flow.mermaid" "$L1_DIR/${SLUG}.flow.mermaid"; do
  [ -f "$f" ] && FLOW_FILE="$f" && break
done
L2_FILE=""
for f in \
  "$SHADOW_DIR/L2-e2e/$SLUG/e2e.md" \
  "$SHADOW_DIR/L2-e2e/$SLUG/${SLUG}.e2e.md" \
  "$SHADOW_DIR/L2-e2e/${SLUG}.e2e.md" \
  "$SHADOW_DIR/L2-e2e/e2e.md"; do
  [ -f "$f" ] && L2_FILE="$f" && break
done

extract_section() {
  local file="$1"
  local section="$2"
  awk -v section="$section" '
    $0 ~ "^##[[:space:]]+([0-9]+(\\.[0-9]+)*\\.?[[:space:]]+)?" section "[[:space:]]*$" { in_section=1; next }
    in_section && /^##[[:space:]]+/ { exit }
    in_section { print }
  ' "$file"
}

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; NC='\033[0m'
PASS=0
FAIL=0
WARN=0

l2_check_meta() {
  local status="$1"
  local check_id="$2"
  local severity="info"
  if [ "$status" = FAIL ]; then
    severity="high"
  elif [ "$status" = WARN ]; then
    severity="medium"
  fi
  case "$check_id" in
    l2.l1-spec.exists|l2.l1-flow.exists|l2.e2e.exists)
      [ "$status" = FAIL ] && severity="blocking"
      printf '%s|%s|%s\n' "upstream_inputs" "$severity" "补齐 L1/L2 输入文件后重跑 L2 E2E Gate"
      ;;
    l2.lines|l2.section.exists)
      printf '%s|%s|%s\n' "scenario_structure" "$severity" "补齐 e2e.md 的必要章节和文档规模"
      ;;
    l2.covers.exists|l2.covers.valid|l2.covers.bind-count|l2.category.coverage)
      printf '%s|%s|%s\n' "traceability" "$severity" "修正 @covers 和规则分类覆盖，确保 L2 承接全部关键 L1 规则"
      ;;
    l2.l1-handoff.*|l2.e2e-handoff.*)
      printf '%s|%s|%s\n' "handoff_absorption" "$severity" "根据 spec.md 的 给 L2 的输入，补齐 e2e.md 的 L1 交接吸收（验收）"
      ;;
    l2.l1-signal|l2.assertion.vague-words)
      printf '%s|%s|%s\n' "assertion_quality" "$severity" "强化断言和业务信号，避免模糊场景说明"
      ;;
    l2.production.acceptance)
      printf '%s|%s|%s\n' "production_acceptance" "$severity" "补齐生产级验收闭环：业务、数据、权限、状态、异常、UX、集成、运维、性能、证据"
      ;;
    l2.user-journey|l2.dimension.coverage)
      printf '%s|%s|%s\n' "user_journey_coverage" "$severity" "补齐用户画像、旅程图和 11-14 维覆盖"
      ;;
    l2.completeness.bizline|l2.completeness.page|l2.completeness.interaction|l2.completeness.api)
      printf '%s|%s|%s\n' "coverage_completeness" "$severity" "根据四层覆盖完整性缺口补充 e2e 场景"
      ;;
    *)
      printf '%s|%s|%s\n' "l2_hard_gate" "$severity" "根据该检查项补齐 E2E 文档后重跑 check-e2e.sh"
      ;;
  esac
}

l2_record() {
  local status="$1" check_id="${2:-}" message="$3" evidence="${4:-}"
  local meta category severity remediation
  meta=$(l2_check_meta "$status" "$check_id")
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

ok()   { echo -e "${GREEN}PASS${NC} $1"; PASS=$((PASS+1)); l2_record PASS "${2:-}" "$1" "${3:-}"; }
fail() { echo -e "${RED}FAIL${NC} $1"; FAIL=$((FAIL+1)); l2_record FAIL "${2:-}" "$1" "${3:-}"; }
warn() { echo -e "${YELLOW}WARN${NC} $1"; WARN=$((WARN+1)); l2_record WARN "${2:-}" "$1" "${3:-}"; }

check_file() {
  local file="$1"; local label="$2"
  if [ -f "$file" ]; then ok "$label 存在" "${3:-l2.file.exists}" "$file"; else fail "$label 缺失: $file" "${3:-l2.file.exists}" "$file"; fi
}

extract_l1_rule_ids() {
  grep -oE "${SLUG}-R[0-9]+" "$SPEC_FILE" 2>/dev/null | sort -u
}

extract_l2_cover_ids() {
  grep -oE "@covers:[[:space:]]*${SLUG}-R[0-9]+" "$L2_FILE" 2>/dev/null | grep -oE "${SLUG}-R[0-9]+" | sort -u
}

extract_l1_rule_ids_by_category() {
  local pattern="$1"
  awk -v pat="$pattern" '
    BEGIN {
      IGNORECASE = 1
    }
    /^### / {
      rule = ""
      if (match($0, /[A-Za-z0-9_-]+-R[0-9]+/)) {
        rule = substr($0, RSTART, RLENGTH)
      }
      next
    }
    rule != "" && tolower($0) ~ tolower(pat) {
      print rule
    }
  ' "$SPEC_FILE" | sort -u
}

check_sections() {
  [ -f "$L2_FILE" ] || return 0
  local sections=("验收目标" "用户画像" "用户旅程" "前置环境" "测试数据" "覆盖矩阵" "真实场景" "断言" "证据采集" "失败定位" "业务线覆盖" "页面覆盖" "交互点覆盖" "覆盖完整性")
  for s in "${sections[@]}"; do
    if grep -Eq "^##[[:space:]]+([0-9]+\.[[:space:]]*)?${s}" "$L2_FILE"; then
      ok "e2e.md 包含章节: $s" "l2.section.exists" "$s"
    else
      fail "e2e.md 缺少章节: $s" "l2.section.exists" "$s"
    fi
  done
}

check_line_count() {
  [ -f "$L2_FILE" ] || return 0
  local lines
  lines=$(wc -l < "$L2_FILE" | tr -d '[:space:]')
  if [ "$lines" -gt 40 ]; then ok "e2e.md 行数 > 40" "l2.lines" "$lines"; else fail "e2e.md 行数不足: $lines <= 40" "l2.lines" "$lines"; fi
}

check_covers_validity() {
  [ -f "$L2_FILE" ] || return 0
  [ -f "$SPEC_FILE" ] || return 0
  mapfile -t l1_ids < <(extract_l1_rule_ids)
  mapfile -t l2_ids < <(extract_l2_cover_ids)
  if [ ${#l2_ids[@]} -eq 0 ]; then fail "e2e.md 无 @covers 规则 ID" "l2.covers.exists"; return; fi
  ok "e2e.md 提取到 @covers 规则 ID ${#l2_ids[@]} 个" "l2.covers.exists" "${#l2_ids[@]}"
  local invalid
  invalid=$(comm -23 <(printf '%s\n' "${l2_ids[@]}" | sort -u) <(printf '%s\n' "${l1_ids[@]}" | sort -u) || true)
  if [ -z "$invalid" ]; then ok "@covers ID 全部合法" "l2.covers.valid"; else fail "存在非法 @covers ID: $(echo "$invalid" | tr '\n' ' ')" "l2.covers.valid" "$(echo "$invalid" | tr '\n' ' ')"; fi
}

check_required_keywords() {
  [ -f "$L2_FILE" ] || return 0
  local patterns=("错误码|error|429|403|401|404|500" "状态|status" "权限|角色|越权|管理员|租户" "日志|审计|事件|通知" "超时|重试|重复提交|边界|失败|异常")
  local labels=("错误码/错误结果" "状态验证" "权限/角色" "依赖/副作用" "异常/边界")
  local i
  for i in "${!patterns[@]}"; do
    if grep -Eiq "${patterns[$i]}" "$L2_FILE"; then
      ok "e2e.md 包含 L1 消费线索: ${labels[$i]}" "l2.l1-signal" "${labels[$i]}"
    else
      fail "e2e.md 缺少明显的 L1 消费线索: ${labels[$i]}" "l2.l1-signal" "${labels[$i]}"
    fi
  done
}

check_vague_assertions() {
  [ -f "$L2_FILE" ] || return 0
  local vague_count
  vague_count=$( (grep -Eo "功能正常|显示正确|无异常|符合预期|成功即可|正确返回|正常工作" "$L2_FILE" 2>/dev/null || true) | wc -l | tr -d '[:space:]' )
  if [ "$vague_count" -eq 0 ]; then ok "断言无明显模糊词" "l2.assertion.vague-words" "0"; else fail "断言存在模糊词 ${vague_count} 处" "l2.assertion.vague-words" "$vague_count"; fi
}

check_production_acceptance() {
  [ -f "$L2_FILE" ] || return 0
  local patterns=(
    "真实用户|真实角色|P0|主流程|工作流"
    "数据|持久化|查询|导出|回溯|重启"
    "登录|权限|授权|越权|审计"
    "状态|处理中|成功|失败|取消|返工|partial|pending|running"
    "异常|重试|恢复|重复提交|并发|部分失败|超时"
    "反馈|下一步|错误原因|修正|截图"
    "前端|API|后端|DB|数据库|对象存储|队列|外部服务"
    "日志|trace|request id|告警|回滚|修复"
    "数据量|并发|性能|批量|任务量"
    "证据|network|截图|DB|存储|报告"
  )
  local labels=(
    "业务闭环"
    "数据闭环"
    "权限闭环"
    "状态闭环"
    "异常闭环"
    "UX闭环"
    "集成闭环"
    "运维闭环"
    "性能闭环"
    "证据闭环"
  )
  local i
  for i in "${!patterns[@]}"; do
    if grep -Eiq "${patterns[$i]}" "$L2_FILE"; then
      ok "e2e.md 包含生产级验收: ${labels[$i]}" "l2.production.acceptance" "${labels[$i]}"
    else
      fail "e2e.md 缺少生产级验收: ${labels[$i]}" "l2.production.acceptance" "${labels[$i]}"
    fi
  done
}

check_labeled_items() {
  local file="$1"
  local section="$2"
  local check_prefix="$3"
  shift 3
  local block
  block="$(extract_section "$file" "$section")"
  if [ -z "$block" ]; then
    fail "$(basename "$file") 缺少章节: $section" "${check_prefix}.section" "$section"
    return
  fi
  ok "$(basename "$file") 包含章节: $section" "${check_prefix}.section" "$section"
  local label
  for label in "$@"; do
    if printf '%s\n' "$block" | grep -Eq "^[[:space:]]*-[[:space:]]*${label}：[^[]|^[[:space:]]*-[[:space:]]*${label}：[[:space:]]*[^[]"; then
      ok "$(basename "$file") 已回应 ${label}" "${check_prefix}.label" "$label"
    else
      fail "$(basename "$file") 缺少或未实质回应 ${label}" "${check_prefix}.label" "$label"
    fi
  done
}

check_trace_covers_by_category() {
  [ -f "$SPEC_FILE" ] || return 0
  [ -f "$L2_FILE" ] || return 0

  mapfile -t l1_ids < <(grep -oE "${SLUG}-R[0-9]+" "$SPEC_FILE" | sort -u)
  mapfile -t l2_cover_ids < <(grep -oE "${SLUG}-R[0-9]+" "$L2_FILE" | sort -u)

  local l2_set
  l2_set=$(printf '%s\n' "${l2_cover_ids[@]}" | sort -u)

  local categories=("错误|error|429|403|401|404|500|拒绝|失败" "状态|status|transit" "权限|角色|越权|管理员|tenant" "日志|审计|事件|通知|副作用|retry|timeout")
  local cat_labels=("错误/异常规则" "状态迁移规则" "权限/角色规则" "依赖/副作用规则")
  local i
  for i in "${!categories[@]}"; do
    local cat_ids
    cat_ids=$(extract_l1_rule_ids_by_category "${categories[$i]}" || true)
    if [ -z "$cat_ids" ]; then
      warn "L1 无 ${cat_labels[$i]}（可能不适用）" "l2.category.coverage" "${cat_labels[$i]}"
      continue
    fi
    local cat_count
    cat_count=$(echo "$cat_ids" | wc -l | tr -d '[:space:]')
    local uncovered
    uncovered=$(comm -23 <(echo "$cat_ids") <(echo "$l2_set") || true)
    if [ -z "$uncovered" ]; then
      ok "@covers 覆盖全部 L1 ${cat_labels[$i]} ($cat_count 条)" "l2.category.coverage" "${cat_labels[$i]}:$cat_count"
    else
      local miss_count
      miss_count=$(echo "$uncovered" | wc -l | tr -d '[:space:]')
      fail "@covers 未覆盖 L1 ${cat_labels[$i]}: 缺 $miss_count/$cat_count 条 — $(echo "$uncovered" | tr '\n' ' ')" "l2.category.coverage" "${cat_labels[$i]}:$miss_count/$cat_count"
    fi
  done
}

check_minimum_trace() {
  [ -f "$L2_FILE" ] || return 0
  local binds
  binds=$(grep -Ec "@covers:" "$L2_FILE" || true)
  if [ "$binds" -ge 4 ]; then ok "@covers 绑定数量充足 ($binds)" "l2.covers.bind-count" "$binds"; else fail "@covers 绑定过少: $binds < 4" "l2.covers.bind-count" "$binds"; fi
}

check_user_journey_coverage() {
  [ -f "$L2_FILE" ] || return 0
  local all_patterns=(
    "用户画像|核心目标|使用频率|技能水平|生产数据特征"
    "用户旅程|旅程图|浏览器操作|用户可见反馈|可能分支"
    "导航|菜单|点击.*跳转|导航栏"
    "反馈|loading|toast|空状态|成功提示|错误原因|notification"
    "误操作|误点|误删|双击|撤销|后退|刷新"
    "会话|关闭.*标签|重新打开|断点|续作|会话过期"
  )
  local all_labels=("用户画像" "用户旅程图" "浏览器导航步骤" "UX反馈验证" "用户误操作" "会话连续性")
  local i
  for i in "${!all_patterns[@]}"; do
    if grep -Eiq "${all_patterns[$i]}" "$L2_FILE"; then
      ok "e2e.md 包含用户旅程覆盖: ${all_labels[$i]}" "l2.user-journey" "${all_labels[$i]}"
    else
      fail "e2e.md 缺少用户旅程覆盖: ${all_labels[$i]}" "l2.user-journey" "${all_labels[$i]}"
    fi
  done
}

check_new_dimensions() {
  [ -f "$L2_FILE" ] || return 0
  local dim_patterns=("会话连续性|会话恢复|断点续作|关闭.*标签" "用户误操作|误删|双击.*提交|撤销|后退" "环境多样|浏览器.*兼容|网络条件|屏幕" "UX反馈|loading|空状态|成功提示|错误反馈|toast")
  local dim_labels=("维度11:会话连续性" "维度12:用户误操作" "维度13:环境多样性" "维度14:UX反馈点")
  local i
  for i in "${!dim_patterns[@]}"; do
    if grep -Eiq "${dim_patterns[$i]}" "$L2_FILE"; then
      ok "覆盖矩阵包含 ${dim_labels[$i]}" "l2.dimension.coverage" "${dim_labels[$i]}"
    else
      warn "覆盖矩阵可能缺少 ${dim_labels[$i]}（纯后端项目可 N/A）" "l2.dimension.coverage" "${dim_labels[$i]}"
    fi
  done
}

check_browser_operations() {
  [ -f "$L2_FILE" ] || return 0
  local browser_patterns=("浏览器|browser|点击.*按钮|输入框|下拉|拖拽|页面跳转|loading|toast|弹窗|表单|Playwright")
  if grep -Eiq "$browser_patterns" "$L2_FILE"; then
    ok "e2e.md 使用浏览器操作语言描述场景" "l2.browser-ops" "browser-language"
  else
    fail "e2e.md 未使用浏览器操作语言（缺少：点击按钮/输入框/页面跳转/toast 等关键词）" "l2.browser-ops" "browser-language"
  fi
}

check_coverage_completeness() {
  [ -f "$L2_FILE" ] || return 0
  local completeness_sections=("业务线覆盖" "页面覆盖" "交互点覆盖" "API.*端点覆盖")
  local completeness_labels=("业务线覆盖表" "页面覆盖表" "交互点覆盖表" "API端点覆盖表")
  local i
  for i in "${!completeness_sections[@]}"; do
    if grep -Eq "^##+.*${completeness_sections[$i]}" "$L2_FILE"; then
      ok "e2e.md 包含四层覆盖章节: ${completeness_labels[$i]}" "l2.completeness" "${completeness_labels[$i]}"
    else
      fail "e2e.md 缺少四层覆盖章节: ${completeness_labels[$i]}" "l2.completeness" "${completeness_labels[$i]}"
    fi
  done
}

check_wire_page_coverage() {
  [ -f "$L2_FILE" ] || return 0
  local WIRE_FILE=""
  for f in "$SHADOW_DIR/L1-business/wire.svg" "$SHADOW_DIR/L1-business/${SLUG}/wire.svg" "$SHADOW_DIR/L1-business/${SLUG}/${SLUG}.wire.svg"; do
    [ -f "$f" ] && WIRE_FILE="$f" && break
  done
  if [ -z "$WIRE_FILE" ]; then
    warn "wire.svg 未发现，跳过页面覆盖校验" "l2.completeness.page" "wire.svg not found"
    return
  fi
  ok "wire.svg 已发现: ${WIRE_FILE#$PROJECT_DIR/}" "l2.completeness.page" "$WIRE_FILE"
  local pages
  pages=$(grep -oE 'data-page="[^"]+"' "$WIRE_FILE" 2>/dev/null | sort -u | sed 's/data-page="//;s/"//' || true)
  if [ -z "$pages" ]; then
    pages=$(grep -oE 'id: page-[^[:space:]]+' "$WIRE_FILE" 2>/dev/null | sort -u | sed 's/id: //' || true)
  fi
  if [ -z "$pages" ]; then
    warn "wire.svg 中未提取到 data-page 或 page id" "l2.completeness.page" "no-pages"
    return
  fi
  local total=0 covered=0
  while IFS= read -r page; do
    total=$((total+1))
    if grep -qi "$page" "$L2_FILE"; then
      covered=$((covered+1))
      ok "页面覆盖: $page → e2e.md 中已出现" "l2.completeness.page" "$page"
    else
      fail "页面缺口: $page → e2e.md 中未出现" "l2.completeness.page" "$page"
    fi
  done <<< "$pages"
  echo "  页面覆盖: $covered/$total"
}

check_wire_interaction_coverage() {
  [ -f "$L2_FILE" ] || return 0
  local WIRE_FILE=""
  for f in "$SHADOW_DIR/L1-business/wire.svg" "$SHADOW_DIR/L1-business/${SLUG}/wire.svg" "$SHADOW_DIR/L1-business/${SLUG}/${SLUG}.wire.svg"; do
    [ -f "$f" ] && WIRE_FILE="$f" && break
  done
  [ -n "$WIRE_FILE" ] || return 0
  local actions
  actions=$(grep -oE 'data-action="[^"]+"' "$WIRE_FILE" 2>/dev/null | sort -u | sed 's/data-action="//;s/"//' || true)
  if [ -z "$actions" ]; then
    actions=$(grep -oE 'action: [^[:space:]]+' "$WIRE_FILE" 2>/dev/null | sort -u | sed 's/action: //' || true)
  fi
  [ -z "$actions" ] && return 0
  local total=0 covered=0
  while IFS= read -r action; do
    total=$((total+1))
    if grep -qi "$action" "$L2_FILE"; then
      covered=$((covered+1))
      ok "交互覆盖: $action → e2e.md 中已出现" "l2.completeness.interaction" "$action"
    else
      warn "交互缺口: $action → e2e.md 中未出现" "l2.completeness.interaction" "$action"
    fi
  done <<< "$actions"
  echo "  交互覆盖: $covered/$total"
}

check_l1_backtrack() {
  [ -f "$L2_FILE" ] || return 0
  if grep -qi 'L1 回溯清单' "$L2_FILE"; then
    local pending
    pending=$(grep -c '待回溯' "$L2_FILE" 2>/dev/null || echo "0")
    if [ "$pending" -gt 0 ]; then
      warn "L1 回溯清单有 $pending 项待回溯（需 Agent Worker 派 L1 Research 更新）" "l2.l1-backtrack.pending" "count:$pending"
    else
      ok "L1 回溯清单存在且无待回溯项" "l2.l1-backtrack.exists" "clear"
    fi
  else
    warn "e2e.md 缺少'L1 回溯清单'章节" "l2.l1-backtrack.missing" "section"
  fi
}

echo "=== L2 E2E Check: $SLUG ==="
[ -f "$SPEC_FILE" ] && ok "L1 spec.md 已发现" "l2.l1-spec.exists" "$SPEC_FILE" || fail "L1 spec.md 缺失: $SPEC_FILE" "l2.l1-spec.exists" "$SPEC_FILE"
[ -n "$FLOW_FILE" ] && ok "L1 flow.mermaid 已发现: $(basename "$FLOW_FILE")" "l2.l1-flow.exists" "$FLOW_FILE" || warn "L1 flow.mermaid 未发现" "l2.l1-flow.exists"
[ -n "$L2_FILE" ] && ok "L2 e2e.md 已发现: ${L2_FILE#$PROJECT_DIR/}" "l2.e2e.exists" "${L2_FILE#$PROJECT_DIR/}" || fail "L2 e2e.md 未发现" "l2.e2e.exists"
[ -n "$L2_FILE" ] && check_file "$L2_FILE" "e2e.md" "l2.e2e.exists"
check_line_count
check_sections
check_covers_validity
check_minimum_trace
check_required_keywords
check_production_acceptance
check_vague_assertions
check_trace_covers_by_category
check_user_journey_coverage
check_new_dimensions
check_browser_operations
check_coverage_completeness
check_wire_page_coverage
check_wire_interaction_coverage
check_l1_backtrack
if [ -f "$SPEC_FILE" ]; then
  check_labeled_items "$SPEC_FILE" "给 L2 的输入" "l2.l1-handoff" \
    "主路径" "失败路径" "权限/角色场景" "状态断言" "错误码/失败信号"
fi
if [ -f "$L2_FILE" ]; then
  check_labeled_items "$L2_FILE" "L1 交接吸收（验收）" "l2.e2e-handoff" \
    "主路径承接" "失败路径承接" "权限/角色场景承接" "状态断言承接" "错误码/失败信号承接"
fi

echo
echo "=== Result: PASS=$PASS WARN=$WARN FAIL=$FAIL ==="
if [ "$FAIL" -eq 0 ]; then
  exit 0
else
  exit 1
fi
