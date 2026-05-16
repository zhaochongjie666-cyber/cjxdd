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

resolve_l5plan_dir() {
  local input="$1"
  if [ -d "$SHADOW_DIR/L5-plan/$input" ]; then
    printf '%s\n' "$SHADOW_DIR/L5-plan/$input"
    return 0
  fi
  local match
  match=$(find "$SHADOW_DIR/L5-plan" -maxdepth 1 -mindepth 1 -type d -name "B??-$input" | head -n 1)
  if [ -n "$match" ]; then
    printf '%s\n' "$match"
    return 0
  fi
  return 1
}

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

extract_rule_ids_from_spec() {
  grep -oE "${SLUG}-R[0-9]+" "$L1_SPEC" 2>/dev/null | sort -u
}

extract_rule_ids_from_file() {
  local file="$1"
  grep -oE "${SLUG}-R[0-9]+" "$file" 2>/dev/null | sort -u
}

extract_harness_file_list() {
  grep -E '^### 文件:' "$HARNESS_PLAN" 2>/dev/null | sed 's/### 文件: *//' | sed 's/ *$//'
}

extract_harness_rule_ids() {
  grep -oE "${SLUG}-R[0-9]+" "$HARNESS_PLAN" 2>/dev/null | sort -u
}

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; NC='\033[0m'
PASS=0
FAIL=0
WARN=0

l5_check_meta() {
  local status="$1"
  local check_id="$2"
  local severity="info"
  if [ "$status" = FAIL ]; then
    severity="high"
  elif [ "$status" = WARN ]; then
    severity="medium"
  fi
  case "$check_id" in
    l5.l1-spec.exists|l5.harness-plan.exists)
      [ "$status" = FAIL ] && severity="blocking"
      printf '%s|%s|%s\n' "upstream_contract" "$severity" "补齐 L1 spec 或 Harness 计划后重跑 L5 Gate"
      ;;
    l5.impl.exists|l5.header.*|l5.implements.consistency|l5.l1.coverage)
      printf '%s|%s|%s\n' "implementation_traceability" "$severity" "修正 Harness 计划→代码映射、文件头和规则覆盖，确保实现承接上游契约"
      ;;
    l5.stub-check)
      printf '%s|%s|%s\n' "implementation_completeness" "$severity" "移除存根代码，补齐真实实现逻辑"
      ;;
    l5.real-usability.*)
      [ "$status" = FAIL ] && severity="blocking"
      printf '%s|%s|%s\n' "real_usability" "$severity" "移除生产路径中的内存仓库、mock DB 或假登录，补齐真实持久化与认证实现"
      ;;
    l5.secret-check)
      printf '%s|%s|%s\n' "security_hygiene" "$severity" "移除硬编码 secret，改用环境变量或密钥管理方案"
      ;;
    l5.wild-file)
      printf '%s|%s|%s\n' "wild_file_detection" "$severity" "将文件加入 Harness 计划或移除野生文件"
      ;;
    *)
      printf '%s|%s|%s\n' "l5_hard_gate" "$severity" "根据该检查项补齐实现层代码后重跑 gate-check-l5.sh"
      ;;
  esac
}

l5_record() {
  local status="$1" check_id="${2:-}" message="$3" evidence="${4:-}"
  local meta category severity remediation
  meta=$(l5_check_meta "$status" "$check_id")
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

ok()   { echo -e "${GREEN}PASS${NC} $1"; PASS=$((PASS+1)); l5_record PASS "${2:-}" "$1" "${3:-}"; }
fail() { echo -e "${RED}FAIL${NC} $1"; FAIL=$((FAIL+1)); l5_record FAIL "${2:-}" "$1" "${3:-}"; }
warn() { echo -e "${YELLOW}WARN${NC} $1"; WARN=$((WARN+1)); l5_record WARN "${2:-}" "$1" "${3:-}"; }

L1_DIR="$(resolve_l1_dir "$SLUG" || true)"
L1_SPEC="${L1_DIR:-$SHADOW_DIR/L1-business/$SLUG}/spec.md"
L5PLAN_DIR="$SHADOW_DIR/L5-plan"
L5PLAN_SLUG_DIR="$(resolve_l5plan_dir "$SLUG" || true)"
HARNESS_PLAN=""
for f in \
  "$L5PLAN_DIR/$SLUG/harness-plan.md" \
  "$L5PLAN_SLUG_DIR/harness-plan.md"; do
  [ -f "$f" ] && HARNESS_PLAN="$f" && break
done

L15_DIR="$SHADOW_DIR/L1.5-architecture"
L15_SLUG_DIR="$(resolve_l15_dir "$SLUG" || true)"

TEST_FOUND=false
for d in "$PROJECT_DIR/server/tests" "$PROJECT_DIR/tests" "$PROJECT_DIR/client/src/__tests__" "$PROJECT_DIR/frontend/src/__tests__" "$PROJECT_DIR/src/__tests__"; do
  [ -d "$d" ] && TEST_FOUND=true && break
done

check_harness_to_real_mapping() {
  local missing=0
  while read -r file; do
    [ -z "$file" ] && continue
    if [ -f "$PROJECT_DIR/$file" ]; then
      ok "真实代码存在: $file" "l5.impl.exists" "$file"
    else
      fail "缺少真实代码: $file" "l5.impl.exists" "$file"
      missing=1
    fi
  done < <(extract_harness_file_list)
  [ "$missing" -eq 0 ] || true
}

check_headers() {
  while read -r file; do
    [ -z "$file" ] && continue
    [ -f "$PROJECT_DIR/$file" ] || continue
    local real="$PROJECT_DIR/$file"
    local missing=0
    grep -Eq 'L1:' "$real" || { fail "$(basename "$real") 缺少 L1: 头" "l5.header.l1" "$file"; missing=1; }
    grep -Eq 'L5-Plan:' "$real" || { fail "$(basename "$real") 缺少 L5-Plan: 头" "l5.header.l5plan" "$file"; missing=1; }
    grep -Eq '@implements:' "$real" || { fail "$(basename "$real") 缺少 @implements:" "l5.header.implements" "$file"; missing=1; }
    [ "$missing" -eq 0 ] && ok "$(basename "$real") 文件头完整" "l5.header.complete" "$file"
  done < <(extract_harness_file_list)
}

check_implements_consistency() {
  local harness_ids
  harness_ids=$(extract_harness_rule_ids | tr '\n' ' ')
  while read -r file; do
    [ -z "$file" ] && continue
    [ -f "$PROJECT_DIR/$file" ] || continue
    local code_ids
    code_ids=$(extract_rule_ids_from_file "$PROJECT_DIR/$file" | tr '\n' ' ')
    if [ -n "$code_ids" ]; then
      ok "$(basename "$file") @implements 存在" "l5.implements.consistency" "$file"
    else
      fail "$(basename "$file") 缺少 @implements 规则 ID" "l5.implements.consistency" "$file"
    fi
  done < <(extract_harness_file_list)
}

check_l1_coverage() {
  mapfile -t l1_ids < <(extract_rule_ids_from_spec)
  local all_code_ids
  all_code_ids=$(find "$PROJECT_DIR" -type f \( -name '*.py' -o -name '*.ts' -o -name '*.js' -o -name '*.tsx' -o -name '*.jsx' -o -name '*.vue' -o -name '*.go' -o -name '*.rs' -o -name '*.java' \) -not -path '*/.shadow/*' -exec grep -hroE '[A-Za-z0-9_-]+-R[0-9]+' {} + 2>/dev/null | sort -u || true)
  if [ -z "$all_code_ids" ]; then fail "代码中未发现任何 ${SLUG}-Rxx 引用" "l5.l1.coverage"; return; fi
  local missing
  missing=$(comm -23 <(printf '%s\n' "${l1_ids[@]}" | sort -u) <(printf '%s\n' "$all_code_ids" | sed '/^$/d' | sort -u) || true)
  if [ -z "$missing" ]; then ok "L5 实现覆盖全部 L1 规则 (${#l1_ids[@]} 条)" "l5.l1.coverage" "${#l1_ids[@]}"; else fail "L5 缺失 L1 规则实现: $(echo "$missing" | tr '\n' ' ')" "l5.l1.coverage" "$(echo "$missing" | tr '\n' ' ')"; fi
}

check_stub_and_secret() {
  local stubs secrets files_str
  files_str=$(extract_harness_file_list | xargs -I{} printf '%s/%s\n' "$PROJECT_DIR" {} 2>/dev/null | tr '\n' ' ')
  stubs=$(extract_harness_file_list | while read -r file; do
    [ -z "$file" ] && continue
    [ -f "$PROJECT_DIR/$file" ] || continue
    grep -En '^\s*pass\s*$|return None\s*$|raise NotImplementedError|TODO|return \{\s*\}\s*$|return \[\s*\]\s*$|return ""\s*$|return data\s*$|return result\s*$|console\.log\(|print\(.*占位\)|return self\s*$' "$PROJECT_DIR/$file" 2>/dev/null || true
  done || true)
  [ -z "$stubs" ] && ok "未发现明显存根" "l5.stub-check" || { fail "发现明显存根" "l5.stub-check" "$(echo "$stubs" | head -5 | tr '\n' ';')"; echo "$stubs" | head -20; }

  secrets=$(extract_harness_file_list | while read -r file; do
    [ -z "$file" ] && continue
    [ -f "$PROJECT_DIR/$file" ] || continue
    grep -En 'dev-secret-key|change-me-in-production|minioadmin' "$PROJECT_DIR/$file" 2>/dev/null || true
  done || true)
  [ -z "$secrets" ] && ok "未发现硬编码 secret" "l5.secret-check" || { fail "发现硬编码 secret" "l5.secret-check" "$(echo "$secrets" | head -5 | tr '\n' ';')"; echo "$secrets" | head -20; }
}

check_real_usability_red_flags() {
  local memory_repo fake_auth
  memory_repo=$(extract_harness_file_list | while read -r file; do
    [ -z "$file" ] && continue
    [ -f "$PROJECT_DIR/$file" ] || continue
    grep -En 'InMemoryRepository|MemoryRepository|FakeRepository|MockRepository|in_memory_repository|memory_repo|mock_repo|fake_repo' "$PROJECT_DIR/$file" 2>/dev/null || true
  done || true)
  if [ -z "$memory_repo" ]; then
    ok "未发现生产实现绑定内存/mock repository" "l5.real-usability.persistence"
  else
    fail "发现生产实现疑似绑定内存/mock repository" "l5.real-usability.persistence" "$(echo "$memory_repo" | head -5 | tr '\n' ';')"
    echo "$memory_repo" | head -20
  fi

  fake_auth=$(extract_harness_file_list | while read -r file; do
    [ -z "$file" ] && continue
    [ -f "$PROJECT_DIR/$file" ] || continue
    grep -En 'current_user\s*=\s*\{|return\s+\{.*user_id|return\s+\{.*role|user_id.*test_|mock_user|fake_user|verify_token.*TODO|TODO.*auth|bypass.*auth' "$PROJECT_DIR/$file" 2>/dev/null || true
  done || true)
  if [ -z "$fake_auth" ]; then
    ok "未发现明显假登录/硬编码用户" "l5.real-usability.auth"
  else
    fail "发现疑似假登录/硬编码用户" "l5.real-usability.auth" "$(echo "$fake_auth" | head -5 | tr '\n' ';')"
    echo "$fake_auth" | head -20
  fi
}

check_wild_files() {
  local harness_files
  harness_files=$(extract_harness_file_list | sort -u)
  for top_dir in backend server src frontend client; do
    [ -d "$PROJECT_DIR/$top_dir" ] || continue
    find "$PROJECT_DIR/$top_dir" -type f -not -path '*/\.*' -not -path '*/node_modules/*' -not -path '*/__pycache__/*' \
      \( -name '*.py' -o -name '*.ts' -o -name '*.js' -o -name '*.vue' -o -name '*.go' \
         -o -name '*.rs' -o -name '*.java' -o -name '*.jsx' -o -name '*.tsx' \) | while read code_file; do
      local rel="${code_file#$PROJECT_DIR/}"
      if ! echo "$harness_files" | grep -qF "$rel"; then
        warn "野生文件（不在 Harness 计划中）: $rel" "l5.wild-file" "$rel"
      fi
    done
  done
}

check_file_volume() {
  local thin=0
  while read -r file; do
    [ -z "$file" ] && continue
    [ -f "$PROJECT_DIR/$file" ] || continue
    local lines
    lines=$(wc -l < "$PROJECT_DIR/$file" 2>/dev/null || echo "0")
    if [ "$lines" -lt 10 ]; then
      fail "文件体量不足: $file（仅 ${lines} 行）" "l5.file-volume" "$file (${lines} lines)"
      thin=1
    elif [ "$lines" -lt 20 ]; then
      warn "文件偏薄: $file（${lines} 行）" "l5.file-volume" "$file (${lines} lines)"
    fi
  done < <(extract_harness_file_list)
  [ "$thin" -eq 0 ] && ok "所有实现文件体量充足" "l5.file-volume" || true
}

check_method_body_depth() {
  local shallow_count=0
  while read -r file; do
    [ -z "$file" ] && continue
    [ -f "$PROJECT_DIR/$file" ] || continue
    local real="$PROJECT_DIR/$file"
    case "$file" in
      *.py)
        local suspect
        suspect=$(python3 -c "
import re, sys
with open(sys.argv[1]) as f:
    lines = f.readlines()
in_func = False
func_start = 0
indent = 0
body_lines = 0
for i, line in enumerate(lines, 1):
    stripped = line.rstrip()
    if re.match(r'^\s*(def |async def )', stripped) and not stripped.strip().startswith('#'):
        if in_func and body_lines < 2 and func_start > 0:
            print(f'{func_start}: function body < 2 lines (only {body_lines})')
        in_func = True
        func_start = i
        indent = len(stripped) - len(stripped.lstrip())
        body_lines = 0
    elif in_func:
        if stripped == '' or stripped.strip().startswith('#') or stripped.strip().startswith('\"\"\"'):
            continue
        cur_indent = len(stripped) - len(stripped.lstrip()) if stripped.strip() else indent + 1
        if cur_indent > indent:
            body_lines += 1
        else:
            if body_lines < 2 and func_start > 0:
                print(f'{func_start}: function body < 2 lines (only {body_lines})')
            in_func = False
            func_start = 0
if in_func and body_lines < 2 and func_start > 0:
    print(f'{func_start}: function body < 2 lines (only {body_lines})')
" "$real" 2>/dev/null || true)
        if [ -n "$suspect" ]; then
          fail "$(basename "$file") 有浅方法体（< 2 行逻辑）: $(echo "$suspect" | head -3 | tr '\n' ';')" "l5.method-depth" "$file"
          shallow_count=$((shallow_count + 1))
        fi
        ;;
      *.ts|*.js|*.tsx|*.jsx|*.vue)
        local arrow_suspect
        arrow_suspect=$(grep -En '=>\s*\{[^}]*\}\s*[,;]?$|=>\s*[^{]*[,;]?$' "$real" 2>/dev/null | grep -v 'import\|export\|interface\|type ' | head -5 || true)
        if [ -n "$arrow_suspect" ]; then
          warn "$(basename "$file") 可能有浅箭头函数: $(echo "$arrow_suspect" | head -3 | tr '\n' ';')" "l5.method-depth" "$file"
        fi
        ;;
    esac
  done < <(extract_harness_file_list)
  [ "$shallow_count" -eq 0 ] && ok "未发现明显浅方法体" "l5.method-depth" || true
}

check_test_mock_density() {
  local mock_heavy=0
  local test_files
  test_files=$(extract_harness_file_list | grep -iE 'test|spec|__test__' || true)
  [ -z "$test_files" ] && { warn "Harness 计划无测试文件，跳过 mock 密度检查" "l5.test-mock-density"; return; }

  while read -r file; do
    [ -z "$file" ] && continue
    [ -f "$PROJECT_DIR/$file" ] || continue
    local real="$PROJECT_DIR/$file"

    local mock_count
    mock_count=$(grep -cE 'Mock\(|mock\(|patch\(|vi\.mock\(|jest\.mock\(|jest\.fn\(|createMock\|\.mock\(' "$real" 2>/dev/null || echo "0")
    local assert_count
    assert_count=$(grep -cE 'assert |expect\(|assertEqual|assertThat|should\(|self\.assert' "$real" 2>/dev/null || echo "0")

    if [ "$assert_count" -gt 0 ] && [ "$mock_count" -gt 0 ]; then
      local ratio=$((mock_count * 100 / assert_count))
      if [ "$ratio" -gt 80 ]; then
        fail "测试文件 mock 过密: $file（mock=$mock_count, assert=$assert_count, 比值=${ratio}%）" "l5.test-mock-density" "$file"
        mock_heavy=$((mock_heavy + 1))
      elif [ "$ratio" -gt 50 ]; then
        warn "测试文件 mock 偏多: $file（mock=$mock_count, assert=$assert_count, 比值=${ratio}%）" "l5.test-mock-density" "$file"
      fi
    elif [ "$mock_count" -gt 0 ] && [ "$assert_count" -eq 0 ]; then
      fail "测试文件只有 mock 无断言: $file（mock=$mock_count, assert=0）" "l5.test-mock-density" "$file"
      mock_heavy=$((mock_heavy + 1))
    fi
  done < <(echo "$test_files")
  [ "$mock_heavy" -eq 0 ] && ok "测试 mock 密度在合理范围" "l5.test-mock-density" || true
}

check_cross_validate() {
  echo ""
  echo "=== 三方交叉校验（architecture ↔ harness ↔ 实际文件） ==="
  if bash "$SCRIPT_DIR/cross-validate-sources.sh" "$SLUG" 2>&1; then
    ok "三方交叉校验通过" "l5.cross-validate" "architecture ⊇ harness ⊇ 实际文件"
  else
    fail "三方交叉校验未通过（Harness 计划可能遗漏 architecture.md 声明的文件）" "l5.cross-validate" "运行 cross-validate-sources.sh 查看详情"
  fi
}

echo "=== L5 Gate Check: $SLUG ==="
[ -f "$L1_SPEC" ] && ok "L1 spec.md 已发现" "l5.l1-spec.exists" "$L1_SPEC" || fail "L1 spec.md 缺失: $L1_SPEC" "l5.l1-spec.exists" "$L1_SPEC"
if [ -n "$HARNESS_PLAN" ]; then
  ok "Harness 计划已发现" "l5.harness-plan.exists" "$HARNESS_PLAN"
else
  fail "Harness 计划缺失: .shadow/L5-plan/$SLUG/harness-plan.md" "l5.harness-plan.exists" "$L5PLAN_DIR/$SLUG/harness-plan.md"
fi
$TEST_FOUND && ok "测试文件目录已发现" "l5.tests.exists" || warn "未发现测试文件目录" "l5.tests.exists"

if [ -n "$HARNESS_PLAN" ]; then
  check_harness_to_real_mapping
  check_headers
  check_implements_consistency
  check_l1_coverage
  check_stub_and_secret
  check_real_usability_red_flags
  check_wild_files
  check_file_volume
  check_method_body_depth
  check_test_mock_density
  check_cross_validate
fi

echo
echo "=== Result: PASS=$PASS WARN=$WARN FAIL=$FAIL ==="
if [ "$FAIL" -eq 0 ]; then
  exit 0
else
  exit 1
fi
