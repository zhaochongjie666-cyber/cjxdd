#!/usr/bin/env bash
set -euo pipefail

# check-wild-files.sh — 检测野生文件（无 @implements 标记的代码文件）
# 用法:
#   bash skills/shadow-l5-impl/scripts/check-wild-files.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SHADOW_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
SHADOW_DIR="$PROJECT_DIR/.shadow"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; NC='\033[0m'

# 代码根目录
code_roots=("$PROJECT_DIR/backend" "$PROJECT_DIR/frontend" "$PROJECT_DIR/src" "$PROJECT_DIR/app" "$PROJECT_DIR/api" "$PROJECT_DIR/lib" "$PROJECT_DIR/core" "$PROJECT_DIR/shared" "$PROJECT_DIR/common")

wild_count=0
files=()

for root in "${code_roots[@]}"; do
  [ -d "$root" ] || continue
  while IFS= read -r f; do
    files+=("$f")
  done < <(find "$root" -type f \( -name "*.py" -o -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.vue" \) 2>/dev/null | grep -v node_modules | grep -v dist | grep -v ".shadow")
done

for f in "${files[@]}"; do
  if [ -f "$f" ] && ! grep -q "@implements" "$f" 2>/dev/null; then
    wild_count=$((wild_count + 1))
    echo -e "${YELLOW}WILD${NC}: $f (无 @implements 标记)"
  fi
done

if [ "$wild_count" -eq 0 ]; then
  echo -e "${GREEN}✓ 无野生文件（所有代码文件都有 @implements 标记）${NC}"
  exit 0
else
  echo -e "${RED}✗ 发现 ${wild_count} 个野生文件（无 @implements 标记）${NC}"
  exit 1
fi
