#!/usr/bin/env bash
set -euo pipefail

# run-e2e-smoke.sh — E2E 冒烟测试
# 用法:
#   bash skills/shadow-l6-deploy/scripts/run-e2e-smoke.sh <slug> [base_url]

SLUG="${1:-}"
BASE_URL="${2:-http://localhost:3000}"

[ -z "$SLUG" ] && { echo "用法: $0 <slug> [base_url]"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SHADOW_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
SHADOW_DIR="$PROJECT_DIR/.shadow"
L2_FILE="$SHADOW_DIR/L2-e2e/$SLUG/e2e.md"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo "=== E2E 冒烟测试: $SLUG ==="
echo "Base URL: $BASE_URL"
echo ""

[ -f "$L2_FILE" ] || { echo -e "${RED}✗ L2 e2e.md 不存在: $L2_FILE${NC}"; exit 1; }

# 提取 L2 场景
echo "从 $L2_FILE 提取场景..."
SCENES=$(grep -E "^### 场景|^## 场景" "$L2_FILE" | head -5)
[ -z "$SCENES" ] && { echo -e "${YELLOW}⚠ 未找到场景定义${NC}"; exit 0; }

echo ""
echo "发现的场景:"
echo "$SCENES"
echo ""

# 基础冒烟测试
echo "=== 执行基础冒烟测试 ==="

# 1. 首页检查
HOME_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/" 2>/dev/null || echo "000")
if [ "$HOME_STATUS" = "200" ]; then
  echo -e "${GREEN}✓ 首页可访问 (HTTP 200)${NC}"
else
  echo -e "${RED}✗ 首页访问失败 (HTTP $HOME_STATUS)${NC}"
fi

# 2. 健康检查端点
HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/health" 2>/dev/null || echo "000")
if [ "$HEALTH_STATUS" = "200" ]; then
  echo -e "${GREEN}✓ 健康检查端点可访问 (HTTP 200)${NC}"
else
  echo -e "${YELLOW}⚠ 健康检查端点: HTTP $HEALTH_STATUS${NC}"
fi

# 3. API 前缀检查
API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api" 2>/dev/null || echo "000")
if [ "$API_STATUS" != "000" ] && [ "$API_STATUS" != "404" ]; then
  echo -e "${GREEN}✓ API 端点可访问 (HTTP $API_STATUS)${NC}"
else
  echo -e "${YELLOW}⚠ API 端点: HTTP $API_STATUS${NC}"
fi

echo ""
echo "=== 冒烟测试完成 ==="
echo "完整 E2E 测试请在部署报告第 7 节执行"
