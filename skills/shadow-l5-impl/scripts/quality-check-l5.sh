#!/usr/bin/env bash
set -euo pipefail

# quality-check-l5.sh — L5 深度代码质量分析
# 用法:
#   bash skills/shadow-l5-impl/scripts/quality-check-l5.sh <slug>

SLUG="${1:-}"
[ -z "$SLUG" ] && { echo "用法: $0 <slug>"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SHADOW_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; BLUE='\033[0;34m'; NC='\033[0m'
PASS=0; FAIL=0; WARN=0
ok()   { echo -e "${GREEN}PASS${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}FAIL${NC} $1"; FAIL=$((FAIL+1)); }
warn() { echo -e "${YELLOW}WARN${NC} $1"; WARN=$((WARN+1)); }
info() { echo -e "${BLUE}[INFO]${NC} $1"; }

# 检测项目类型
detect_project_type() {
  if [ -f "$PROJECT_DIR/pyproject.toml" ] || [ -f "$PROJECT_DIR/requirements.txt" ] || [ -f "$PROJECT_DIR/setup.py" ]; then
    echo "python"
  elif [ -f "$PROJECT_DIR/package.json" ]; then
    echo "node"
  elif [ -d "$PROJECT_DIR/backend" ] && [ -d "$PROJECT_DIR/frontend" ]; then
    echo "fullstack"
  else
    echo "unknown"
  fi
}

PROJECT_TYPE=$(detect_project_type)
info "项目类型: $PROJECT_TYPE"

# 圈复杂度检测
check_complexity() {
  echo ""
  echo "=== 1. 圈复杂度检测 ==="
  
  if [ "$PROJECT_TYPE" = "python" ] || [ "$PROJECT_TYPE" = "fullstack" ]; then
    if command -v radon &>/dev/null; then
      info "使用 radon 检测 Python 圈复杂度..."
      local cc_output
      cc_output=$(radon cc "$PROJECT_DIR" -a -n C 2>/dev/null || true)
      if [ -n "$cc_output" ]; then
        local high_cc
        high_cc=$(echo "$cc_output" | grep -E "^[A-Z] " | grep -E " [F-E] " || true)
        if [ -n "$high_cc" ]; then
          fail "发现高圈复杂度函数 (>= E):"
          echo "$high_cc" | head -10
        else
          local med_cc
          med_cc=$(echo "$cc_output" | grep -E "^[A-Z] " | grep -E " [C-D] " || true)
          if [ -n "$med_cc" ]; then
            warn "发现中等圈复杂度函数 (C-D):"
            echo "$med_cc" | head -10
          else
            ok "所有函数圈复杂度 < C"
          fi
        fi
      else
        ok "radon 未发现问题"
      fi
    else
      warn "radon 未安装，跳过 Python 圈复杂度检测 (pip install radon)"
    fi
  fi
}

# 函数长度检测
check_function_length() {
  echo ""
  echo "=== 2. 函数长度检测 ==="
  
  if [ "$PROJECT_TYPE" = "python" ] || [ "$PROJECT_TYPE" = "fullstack" ]; then
    local long_funcs
    long_funcs=$(find "$PROJECT_DIR" -name "*.py" -not -path "*/.shadow/*" -not -path "*/test*" -not -path "*/node_modules/*" -exec grep -n "^\s*def " {} + 2>/dev/null | while IFS=: read -r file line content; do
      func_name=$(echo "$content" | sed 's/.*def \([^ (]*\).*/\1/')
      start_line=$(echo "$line" | cut -d: -f1)
      end_line=$(tail -n +"$((start_line + 1))" "$file" | grep -n "^\s*def \|^\s*class " | head -1 | cut -d: -f1 || echo "")
      if [ -z "$end_line" ]; then
        end_line=$(wc -l < "$file")
      else
        end_line=$((start_line + end_line - 1))
      fi
      func_len=$((end_line - start_line))
      if [ "$func_len" -gt 50 ]; then
        echo "$file:$start_line $func_name ($func_len 行)"
      fi
    done || true)
    
    if [ -n "$long_funcs" ]; then
      local very_long
      very_long=$(echo "$long_funcs" | grep -E "\([0-9]{3,} 行\)" || true)
      if [ -n "$very_long" ]; then
        fail "发现超长函数 (> 100 行):"
        echo "$very_long" | head -10
      else
        warn "发现较长函数 (> 50 行):"
        echo "$long_funcs" | head -10
      fi
    else
      ok "所有函数长度 <= 50 行"
    fi
  fi
}

# 类型检查
check_types() {
  echo ""
  echo "=== 3. 类型检查 ==="
  
  if [ "$PROJECT_TYPE" = "python" ] || [ "$PROJECT_TYPE" = "fullstack" ]; then
    if command -v mypy &>/dev/null; then
      info "运行 mypy --strict..."
      local mypy_output
      mypy_output=$(mypy --strict "$PROJECT_DIR" 2>&1 || true)
      local error_count
      error_count=$(echo "$mypy_output" | grep -c "error:" || echo 0)
      if [ "$error_count" -gt 0 ]; then
        fail "mypy 发现 $error_count 个类型错误:"
        echo "$mypy_output" | grep "error:" | head -10
      else
        ok "mypy 类型检查通过"
      fi
    else
      warn "mypy 未安装，跳过类型检查 (pip install mypy)"
    fi
  fi
}

# 安全扫描
check_security() {
  echo ""
  echo "=== 4. 安全扫描 ==="
  
  if [ "$PROJECT_TYPE" = "python" ] || [ "$PROJECT_TYPE" = "fullstack" ]; then
    if command -v bandit &>/dev/null; then
      info "运行 bandit 安全扫描..."
      local bandit_output
      bandit_output=$(bandit -r "$PROJECT_DIR" -f txt 2>&1 || true)
      local high_issues
      high_issues=$(echo "$bandit_output" | grep -c "High:" || echo 0)
      if [ "$high_issues" -gt 0 ]; then
        fail "bandit 发现 $high_issues 个高危安全问题:"
        echo "$bandit_output" | grep -A2 "High:" | head -10
      else
        ok "bandit 安全扫描通过"
      fi
    else
      warn "bandit 未安装，跳过安全扫描 (pip install bandit)"
    fi
    
    # 基础安全模式检测
    info "执行基础安全模式检测..."
    local sql_injection
    sql_injection=$(grep -rn "execute\s*(" "$PROJECT_DIR" --include="*.py" 2>/dev/null | grep -v ".shadow" | grep -v "test" | grep -E 'f["\x27]|%s|\.format\(' || true)
    if [ -n "$sql_injection" ]; then
      fail "发现潜在 SQL 注入风险:"
      echo "$sql_injection" | head -5
    else
      ok "未发现明显 SQL 注入模式"
    fi
  fi
}

# 依赖漏洞扫描
check_dependencies() {
  echo ""
  echo "=== 5. 依赖漏洞扫描 ==="
  
  if [ "$PROJECT_TYPE" = "python" ] || [ "$PROJECT_TYPE" = "fullstack" ]; then
    if command -v pip-audit &>/dev/null; then
      info "运行 pip-audit..."
      local audit_output
      audit_output=$(pip-audit 2>&1 || true)
      local vuln_count
      vuln_count=$(echo "$audit_output" | grep -c "Found" || echo 0)
      if [ "$vuln_count" -gt 0 ]; then
        warn "pip-audit 发现已知漏洞:"
        echo "$audit_output" | head -10
      else
        ok "pip-audit 未发现已知漏洞"
      fi
    else
      warn "pip-audit 未安装，跳过依赖漏洞扫描 (pip install pip-audit)"
    fi
  fi
}

# 主流程
echo "=== L5 深度代码质量分析: $SLUG ==="
echo "项目目录: $PROJECT_DIR"

check_complexity
check_function_length
check_types
check_security
check_dependencies

echo ""
echo "=== 质量分析结果: PASS=$PASS WARN=$WARN FAIL=$FAIL ==="

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}⛔ 质量分析未通过，存在 $FAIL 个 FAIL 项${NC}"
  exit 1
else
  echo -e "${GREEN}✅ 质量分析通过${NC}"
  if [ "$WARN" -gt 0 ]; then
    echo -e "${YELLOW}⚠️  存在 $WARN 个警告项，建议修正${NC}"
  fi
  exit 0
fi
