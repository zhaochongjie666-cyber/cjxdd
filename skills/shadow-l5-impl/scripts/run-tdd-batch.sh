#!/usr/bin/env bash
set -euo pipefail

# run-tdd-batch.sh — 基于 Harness 计划运行 TDD 循环
# 用法:
#   bash skills/shadow-l5-impl/scripts/run-tdd-batch.sh <slug> [batch_num]

SLUG="${1:-}"
BATCH_NUM="${2:-}"
[ -z "$SLUG" ] && { echo "用法: $0 <slug> [batch_num]"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SHADOW_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
SHADOW_DIR="$PROJECT_DIR/.shadow"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; BLUE='\033[0;34m'; NC='\033[0m'

echo -e "${BLUE}=== TDD Batch Runner (Harness): $SLUG ===${NC}"

HARNESS_PLAN=""
for f in "$SHADOW_DIR/L5-plan/$SLUG/harness-plan.md" "$SHADOW_DIR/L5-plan/B??-$SLUG/harness-plan.md"; do
  [ -f "$f" ] && HARNESS_PLAN="$f" && break
done
[ -z "$HARNESS_PLAN" ] && { echo -e "${RED}Harness 计划缺失: .shadow/L5-plan/$SLUG/harness-plan.md${NC}"; exit 1; }

echo "Harness 计划: $HARNESS_PLAN"

if [ -n "$BATCH_NUM" ]; then
  echo "目标 Batch: $BATCH_NUM"
else
  echo "目标: 全部 Batch"
fi

detect_project_type() {
  if [ -f "$PROJECT_DIR/pyproject.toml" ] || [ -f "$PROJECT_DIR/requirements.txt" ] || [ -f "$PROJECT_DIR/setup.py" ]; then
    echo "python"
  elif [ -f "$PROJECT_DIR/package.json" ]; then
    echo "node"
  else
    echo "unknown"
  fi
}

PROJECT_TYPE=$(detect_project_type)
echo "项目类型: $PROJECT_TYPE"

run_tests() {
  case "$PROJECT_TYPE" in
    python)
      if [ -f "$PROJECT_DIR/pyproject.toml" ] || [ -d "$PROJECT_DIR/tests" ] || [ -d "$PROJECT_DIR/server/tests" ]; then
        echo -e "${BLUE}运行 pytest...${NC}"
        if (cd "$PROJECT_DIR" && python -m pytest -v --tb=short 2>&1); then
          echo -e "${GREEN}✓ 所有测试通过${NC}"
          return 0
        else
          echo -e "${RED}✗ 测试失败${NC}"
          return 1
        fi
      fi
      ;;
    node)
      if [ -f "$PROJECT_DIR/package.json" ]; then
        echo -e "${BLUE}运行 npm test...${NC}"
        if (cd "$PROJECT_DIR" && npm test 2>&1); then
          echo -e "${GREEN}✓ 所有测试通过${NC}"
          return 0
        else
          echo -e "${RED}✗ 测试失败${NC}"
          return 1
        fi
      fi
      ;;
    *)
      echo -e "${YELLOW}未知项目类型，无法自动运行测试${NC}"
      return 1
      ;;
  esac
}

echo ""
echo "步骤 1: 运行测试（预期失败 - RED）"
if run_tests; then
  echo -e "${GREEN}测试已通过，进入重构阶段${NC}"
else
  echo -e "${YELLOW}测试失败（预期），开始实现代码...${NC}"
fi

echo ""
echo "TDD 循环指南（基于 Harness 计划）："
echo "1. 从 Harness 计划提取当前 Batch 的文件列表和测试断言"
echo "2. 先写测试（测试断言来自 Harness 计划）— RED"
echo "3. 写最小实现让测试通过 — GREEN"
echo "4. 重构代码 — REFACTOR"
echo "5. 当前 Batch 全部通过后进入下一个 Batch"
