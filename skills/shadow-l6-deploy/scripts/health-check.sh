#!/usr/bin/env bash
set -euo pipefail

# health-check.sh — 服务健康检查
# 用法:
#   bash skills/shadow-l6-deploy/scripts/health-check.sh <port> [timeout_seconds]

PORT="${1:-}"
TIMEOUT="${2:-60}"

[ -z "$PORT" ] && { echo "用法: $0 <port> [timeout_seconds]"; exit 1; }

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo "=== 健康检查: localhost:$PORT ==="
echo "超时时间: ${TIMEOUT}秒"
echo ""

# 计算尝试次数 (每 5 秒检查一次)
ATTEMPTS=$((TIMEOUT / 5))
[ $ATTEMPTS -lt 1 ] && ATTEMPTS=1

for i in $(seq 1 $ATTEMPTS); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT}/health" 2>/dev/null || echo "000")
  
  if [ "$STATUS" = "200" ]; then
    echo -e "${GREEN}✓ 健康检查通过 (HTTP $STATUS)${NC}"
    echo "尝试次数: $i"
    exit 0
  else
    echo -e "${YELLOW}等待中... 尝试 $i/$ATTEMPTS (HTTP $STATUS)${NC}"
    sleep 5
  fi
done

echo -e "${RED}✗ 健康检查失败: 服务未在 ${TIMEOUT} 秒内就绪${NC}"
exit 1
