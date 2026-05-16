#!/usr/bin/env bash
# init-research.sh — 初始化 L1-business 目录结构
# 用法: bash init-research.sh <slug>

set -euo pipefail

SLUG="${1:-}"
if [ -z "$SLUG" ]; then
    echo "用法: $0 <slug>"
    echo "示例: $0 user-service"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SHADOW_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
SHADOW_DIR="$PROJECT_DIR/.shadow"
L1_DIR="$SHADOW_DIR/L1-business"
INDEX_FILE="$L1_DIR/INDEX.md"

# 创建目录
mkdir -p "$L1_DIR"

# 创建 INDEX.md（如果不存在）
if [ ! -f "$INDEX_FILE" ]; then
    cat > "$INDEX_FILE" << 'EOF'
# L1 业务索引

> 业务线子目录使用 `BXX-<slug>` 格式

| B# | 业务目录 | 业务名称 | 主业务 | 状态 | 节点数 | 规则数 | 最后更新 |
|:--:|---------|---------|:-----:|:----:|:-----:|:-----:|----------|
EOF
    echo "✓ 已创建 INDEX.md"
fi

# 确定下一个 BXX 编号
get_next_bxx() {
    local max_num=0
    if [ -f "$INDEX_FILE" ]; then
        # 提取现有的 BXX 编号
        while IFS= read -r line; do
            if [[ "$line" =~ \|B([0-9]+)\| ]]; then
                local num="${BASH_REMATCH[1]}"
                if [ "$num" -gt "$max_num" ]; then
                    max_num="$num"
                fi
            fi
        done < "$INDEX_FILE"
    fi
    local next=$((max_num + 1))
    printf "B%02d" "$next"
}

BXX=$(get_next_bxx)
BIZ_DIR="$L1_DIR/${BXX}-${SLUG}"

# 创建业务目录
mkdir -p "$BIZ_DIR"

# 更新 INDEX.md
echo "| $BXX | ${BXX}-${SLUG} | $SLUG | - | 进行中 | - | - | $(date +%Y-%m-%d) |" >> "$INDEX_FILE"

echo "✓ 已初始化 L1-business 目录结构"
echo "  业务目录: $BIZ_DIR"
echo "  BXX 编号: $BXX"
