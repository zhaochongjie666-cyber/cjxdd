#!/usr/bin/env bash
# no-stub-check.sh — 可移植存根/假实现自检（替代旧平台 stub-scan hook）
# 用法: bash skills/xdd-execute/scripts/no-stub-check.sh [文件或目录...]
#   不传参数 = 扫当前目录（排除常见无关目录）
# 退出码: 0 = 零命中; 1 = 命中存根/假实现（需修）
#
# 这是反「sham 交付」的底线自检 —— session c3692b46 教训: 60 端点只实施 23 = 38% 蒙混。
# commit 前跑，命中即修，零命中才提交。

set -uo pipefail

if [ "$#" -gt 0 ]; then
  TARGETS=("$@")
else
  TARGETS=(.)
fi

# 排除目录（依赖、构建产物、设计文档、xddd 框架自身、归档）
EXCLUDE_DIRS='node_modules|\.git|dist|build|\.next|target|venv|__pycache__|\.xdd|archive|skills|agents|docs|\.mavis|\.opencode'

# 存根模式（字面层）
STUB_PAT='(\bpass\s*$|\bTODO\b|\bFIXME\b|NotImplementedError|raise\s+NotImplemented|return\s+None\s*#\s*stub|^\s*//\s*stub|^\s*#\s*stub)'

# 假实现模式（语义层）
FAKE_PAT='(InMemoryRepository|FakeRepository|MockDatabase|mock_db|hardcoded_user|current_user\s*=\s*["\x27])'

echo "🔍 扫存根/假实现: ${TARGETS[*]}"
echo "   (排除: $EXCLUDE_DIRS)"
echo

found=0
for t in "${TARGETS[@]}"; do
  # grep -rn, 排除目录, 同时匹配两类模式
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    echo "  ❌ $line"
    found=$((found + 1))
  done < <(grep -rEn --include='*.py' --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' --include='*.go' --include='*.java' --include='*.rs' \
    --exclude-dir='node_modules' --exclude-dir='.git' --exclude-dir='dist' --exclude-dir='build' --exclude-dir='__pycache__' --exclude-dir='.xdd' --exclude-dir='archive' \
    -e "$STUB_PAT" -e "$FAKE_PAT" "$t" 2>/dev/null)
done

echo
if [ "$found" -eq 0 ]; then
  echo "✅ 零存根/假实现命中 — 可提交"
  exit 0
else
  echo "❌ 命中 $found 处存根/假实现 — 修成真实现再提交（pass/TODO/NotImplementedError/InMemoryRepository 都不行）"
  exit 1
fi
