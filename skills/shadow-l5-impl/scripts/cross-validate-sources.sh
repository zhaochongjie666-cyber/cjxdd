#!/usr/bin/env bash
set -euo pipefail

# cross-validate-sources.sh — 三方交叉校验
# 验证 architecture.md 文件清单 ⊇ harness-plan.md 文件列表 ⊇ 实际代码文件
# 防止 Harness 计划遗漏 architecture.md 中声明的文件
#
# 用法:
#   bash skills/shadow-l5-impl/scripts/cross-validate-sources.sh <slug>

SLUG="${1:-}"
[ -z "$SLUG" ] && { echo "用法: $0 <slug>"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SHADOW_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
SHADOW_DIR="$PROJECT_DIR/.shadow"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; NC='\033[0m'
PASS=0; FAIL=0; WARN=0
ok()   { echo -e "${GREEN}PASS${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}FAIL${NC} $1"; FAIL=$((FAIL+1)); }
warn() { echo -e "${YELLOW}WARN${NC} $1"; WARN=$((WARN+1)); }

resolve_l15_dir() {
  local input="$1"
  if [ -d "$SHADOW_DIR/L1.5-architecture/$input" ]; then
    printf '%s\n' "$SHADOW_DIR/L1.5-architecture/$input"
    return 0
  fi
  local match
  match=$(find "$SHADOW_DIR/L1.5-architecture" -maxdepth 1 -mindepth 1 -type d -name "B??-$input" 2>/dev/null | head -n 1)
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
  match=$(find "$SHADOW_DIR/L5-plan" -maxdepth 1 -mindepth 1 -type d -name "B??-$input" 2>/dev/null | head -n 1)
  if [ -n "$match" ]; then
    printf '%s\n' "$match"
    return 0
  fi
  return 1
}

L15_DIR="$(resolve_l15_dir "$SLUG" || true)"
L15_ARCH="${L15_DIR:-$SHADOW_DIR/L1.5-architecture/$SLUG}/architecture.md"
L5PLAN_SLUG_DIR="$(resolve_l5plan_dir "$SLUG" || true)"
HARNESS_PLAN=""
for f in \
  "$SHADOW_DIR/L5-plan/$SLUG/harness-plan.md" \
  "$L5PLAN_SLUG_DIR/harness-plan.md"; do
  [ -f "$f" ] && HARNESS_PLAN="$f" && break
done

echo "=== 三方交叉校验: $SLUG ==="
echo "architecture.md: $L15_ARCH"
echo "harness-plan.md: $HARNESS_PLAN"
echo ""

# --- 1. 从 architecture.md 提取文件清单 ---
echo "--- 1. architecture.md 文件清单 ---"

ARCH_FILES=""
if [ -f "$L15_ARCH" ]; then
  ok "architecture.md 存在"
  # 提取文件清单章节中的文件路径
  # 支持多种格式：`- path/to/file.py` 或 `| path/to/file.ts |` 或代码块中的路径
  ARCH_FILES=$(python3 -c "
import re, sys
with open(sys.argv[1], 'r') as f:
    content = f.read()
files = set()
# 模式1: markdown 表格行中的路径 | path/to/file |
for m in re.finditer(r'\|\s*([a-zA-Z0-9_./-]+\.(py|ts|js|tsx|jsx|vue|go|rs|java|sql|yaml|yml))\s*\|', content):
    files.add(m.group(1).strip())
# 模式2: 列表项中的路径 - path/to/file 或 `path/to/file`
for m in re.finditer(r'[-*]\s*`?([a-zA-Z0-9_./-]+\.(py|ts|js|tsx|jsx|vue|go|rs|java|sql|yaml|yml))`?', content):
    files.add(m.group(1).strip())
# 模式3: 文件清单章节 ## 文件清单 后的所有路径
in_file_list = False
for line in content.split('\n'):
    if re.match(r'^#+\s*文件清单', line):
        in_file_list = True
        continue
    if in_file_list and line.startswith('#'):
        in_file_list = False
    if in_file_list:
        for m in re.finditer(r'[a-zA-Z0-9_./-]+\.(py|ts|js|tsx|jsx|vue|go|rs|java|sql|yaml|yml)', line):
            candidate = m.group(0)
            if not candidate.startswith(('http://', 'https://', 'node_modules')):
                files.add(candidate)
for f in sorted(files):
    print(f)
" "$L15_ARCH" 2>/dev/null || echo "")
else
  fail "architecture.md 缺失: $L15_ARCH"
fi

ARCH_COUNT=$(echo "$ARCH_FILES" | grep -c '.' || echo "0")
echo "architecture.md 声明文件: $ARCH_COUNT 个"

# --- 2. 从 harness-plan.md 提取文件列表 ---
echo ""
echo "--- 2. harness-plan.md 文件列表 ---"

HARNESS_FILES=""
if [ -n "$HARNESS_PLAN" ]; then
  ok "harness-plan.md 存在"
  HARNESS_FILES=$(grep -E '^### 文件:' "$HARNESS_PLAN" 2>/dev/null | sed 's/### 文件: *//' | sed 's/ *$//' || echo "")
else
  fail "harness-plan.md 缺失"
fi

HARNESS_COUNT=$(echo "$HARNESS_FILES" | grep -c '.' || echo "0")
echo "harness-plan.md 列出文件: $HARNESS_COUNT 个"

# --- 3. 核心检查: architecture ⊇ harness（Harness 不能遗漏架构文件） ---
echo ""
echo "--- 3. 核心校验: architecture ⊇ harness ---"

if [ -n "$ARCH_FILES" ] && [ -n "$HARNESS_FILES" ]; then
  # 找出 harness 有但 architecture 没有的（harness 自创的文件，可能是合理的）
  HARNESS_EXTRA=$(comm -23 <(echo "$HARNESS_FILES" | sort -u) <(echo "$ARCH_FILES" | sort -u) || true)
  if [ -n "$HARNESS_EXTRA" ]; then
    echo "Harness 计划中存在但 architecture.md 未声明的文件（可能合理，如测试文件）:"
    echo "$HARNESS_EXTRA" | while read -r f; do echo "  + $f"; done
  fi

  # 关键检查: architecture 有但 harness 没有的（遗漏！）
  ARCH_MISSING_IN_HARNESS=$(comm -23 <(echo "$ARCH_FILES" | sort -u) <(echo "$HARNESS_FILES" | sort -u) || true)
  if [ -n "$ARCH_MISSING_IN_HARNESS" ]; then
    MISSING_COUNT=$(echo "$ARCH_MISSING_IN_HARNESS" | grep -c '.' || echo "0")
    fail "architecture.md 声明了 $MISSING_COUNT 个文件但 Harness 计划未列出（遗漏！）:"
    echo "$ARCH_MISSING_IN_HARNESS" | while read -r f; do echo "  ✗ $f"; done
    echo ""
    echo "  这些文件在 architecture.md 中被规划但在 Harness 计划中被遗漏，"
    echo "  意味着 L5 Impl agent 不会实现它们。这是虚假通过的核心原因。"
  else
    ok "Harness 计划覆盖了 architecture.md 中声明的所有文件"
  fi
else
  warn "无法执行交叉校验（缺少 architecture.md 或 harness-plan.md）"
fi

# --- 4. 核心检查: harness 文件 ⊆ 实际代码文件（计划文件都有实现） ---
echo ""
echo "--- 4. 核心校验: harness 文件全部有实现 ---"

if [ -n "$HARNESS_FILES" ]; then
  IMPL_MISSING=0
  while read -r file; do
    [ -z "$file" ] && continue
    if [ -f "$PROJECT_DIR/$file" ]; then
      LINES=$(wc -l < "$PROJECT_DIR/$file" 2>/dev/null || echo "0")
      if [ "$LINES" -lt 10 ]; then
        fail "实现文件体量不足: $file（仅 ${LINES} 行，至少需要 10 行）"
        IMPL_MISSING=$((IMPL_MISSING + 1))
      fi
    else
      fail "实现文件缺失: $file"
      IMPL_MISSING=$((IMPL_MISSING + 1))
    fi
  done < <(echo "$HARNESS_FILES")
  [ "$IMPL_MISSING" -eq 0 ] && ok "Harness 计划中所有文件都已实现且体量充足"
fi

# --- 5. 全局文件计数对比 ---
echo ""
echo "--- 5. 全局计数对比 ---"

TOTAL_ARCH=$ARCH_COUNT
TOTAL_HARNESS=$HARNESS_COUNT
TOTAL_IMPL=$(echo "$HARNESS_FILES" | while read -r f; do
  [ -z "$f" ] && continue
  [ -f "$PROJECT_DIR/$f" ] && echo "1"
done | wc -l || echo "0")

echo "| 来源 | 文件数 |"
echo "|------|--------|"
echo "| architecture.md 声明 | $TOTAL_ARCH |"
echo "| harness-plan.md 计划 | $TOTAL_HARNESS |"
echo "| 实际已实现 | $TOTAL_IMPL |"

if [ "$TOTAL_ARCH" -gt 0 ] && [ "$TOTAL_HARNESS" -gt 0 ]; then
  COVERAGE=$((TOTAL_HARNESS * 100 / TOTAL_ARCH))
  if [ "$COVERAGE" -lt 80 ]; then
    fail "Harness 计划仅覆盖 architecture.md 声明文件的 ${COVERAGE}%（< 80% 阈值）"
  elif [ "$COVERAGE" -lt 100 ]; then
    warn "Harness 计划覆盖 architecture.md 声明文件的 ${COVERAGE}%（未 100% 覆盖）"
  else
    ok "Harness 计划 100% 覆盖 architecture.md 声明文件"
  fi
fi

echo ""
echo "=== 三方交叉校验结果: PASS=$PASS WARN=$WARN FAIL=$FAIL ==="
if [ "$FAIL" -eq 0 ]; then
  exit 0
else
  exit 1
fi
