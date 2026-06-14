#!/usr/bin/env bash
# infer-implements.sh — @implements 推断脚本（逆向 Phase C）
# 用法: bash infer-implements.sh <slug> [project_dir]
#
# 从 rules.md 规则反推代码文件的 @implements 标记

set -euo pipefail

SLUG="${1:-}"
PROJECT_DIR="${2:-.}"
DESIGN_DIR="$PROJECT_DIR/.xdd/design"
REPORT_FILE="$DESIGN_DIR/spec/$SLUG/infer-report.md"

echo "=== @implements 推断 ==="

if [ -z "$SLUG" ]; then
    echo "错误: 请提供 slug 参数" >&2
    echo "用法: bash infer-implements.sh <slug> [project_dir]" >&2
    exit 1
fi

echo "业务线: $SLUG"
echo "项目目录: $PROJECT_DIR"
echo ""

# 检查 rules.md 是否存在
SPEC_FILE="$DESIGN_DIR/spec/$SLUG/rules.md"
if [ ! -f "$SPEC_FILE" ]; then
    echo "错误: rules.md 不存在: $SPEC_FILE" >&2
    exit 1
fi

# 提取规则列表
echo "正在提取规则列表..."
RULES=$(grep -oE "${SLUG}-R[0-9]+" "$SPEC_FILE" | sort -u)
RULE_COUNT=$(echo "$RULES" | wc -l)
echo "发现 $RULE_COUNT 条规则"
echo ""

# 推断策略 1: 文件名匹配
infer_by_filename() {
    local rule="$1"
    local rule_keywords="$2"
    
    # 扫描常见代码目录
    for code_dir in "$PROJECT_DIR/src" "$PROJECT_DIR/app" "$PROJECT_DIR/lib" "$PROJECT_DIR/server"; do
        if [ -d "$code_dir" ]; then
            # 按关键词匹配文件名
            for keyword in $rule_keywords; do
                find "$code_dir" -type f \( -name "*.py" -o -name "*.ts" -o -name "*.tsx" -o -name "*.js" \) \
                    -iname "*$keyword*" 2>/dev/null | head -5
            done
        fi
    done
}

# 推断策略 2: 内容语义匹配
infer_by_content() {
    local rule="$1"
    local rule_desc="$2"
    
    # 提取描述中的关键词
    local keywords=$(echo "$rule_desc" | tr -s '[:space:]' '\n' | grep -E "^[a-zA-Z_]+" | head -5 | tr '\n' ' ')
    
    for code_dir in "$PROJECT_DIR/src" "$PROJECT_DIR/app" "$PROJECT_DIR/lib" "$PROJECT_DIR/server"; do
        if [ -d "$code_dir" ]; then
            for keyword in $keywords; do
                find "$code_dir" -type f \( -name "*.py" -o -name "*.ts" -o -name "*.tsx" -o -name "*.js" \) \
                    -exec grep -l "$keyword" {} + 2>/dev/null | head -3
            done
        fi
    done
}

# 创建输出目录
mkdir -p "$(dirname "$REPORT_FILE")"

# 生成推断报告
echo "## @implements 推断结果" > "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "> 生成时间: $(date '+%Y-%m-%d %H:%M:%S')" >> "$REPORT_FILE"
echo "> 业务线: $SLUG" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "| 规则 | 推断文件 | 策略 | 置信度 | 状态 |" >> "$REPORT_FILE"
echo "|------|---------|------|--------|------|" >> "$REPORT_FILE"

# 逐条规则推断
echo "正在推断规则实现..."
echo "$RULES" | while IFS= read -r rule; do
    [ -z "$rule" ] && continue

    # 获取规则描述（从 rules.md 中提取）
    local rule_desc
    rule_desc=$(grep -A1 "$rule" "$SPEC_FILE" 2>/dev/null | tail -1 | sed 's/^[[:space:]]*|\?\s*//' | head -c 50)

    # 策略 1: 文件名匹配
    local inferred_files
    inferred_files=$(infer_by_filename "$rule" "$SLUG")

    if [ -n "$inferred_files" ]; then
        # 高置信度：文件名匹配
        local file_list
        file_list=$(echo "$inferred_files" | tr '\n' ',' | sed 's/,$//' | sed "s|$PROJECT_DIR/||g")
        echo "| $rule | $file_list | 文件名匹配 | HIGH | 待确认 |" >> "$REPORT_FILE"
    else
        # 策略 2: 内容语义匹配
        inferred_files=$(infer_by_content "$rule" "$rule_desc")
        if [ -n "$inferred_files" ]; then
            local file_list
            file_list=$(echo "$inferred_files" | tr '\n' ',' | sed 's/,$//' | sed "s|$PROJECT_DIR/||g" | head -c 100)
            echo "| $rule | $file_list | 内容语义 | MEDIUM | 需人工确认 |" >> "$REPORT_FILE"
        else
            echo "| $rule | - | 无匹配 | LOW | 无法推断 |" >> "$REPORT_FILE"
        fi
    fi
done

echo "" >> "$REPORT_FILE"
echo "---" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "## 下一步操作" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "1. 查看推断报告: $REPORT_FILE" >> "$REPORT_FILE"
echo "2. 确认 HIGH 置信度的推断结果" >> "$REPORT_FILE"
echo "3. 人工确认 MEDIUM 置信度的推断结果" >> "$REPORT_FILE"
echo "4. 为 LOW 置信度的规则手动指定实现文件" >> "$REPORT_FILE"
echo "5. 确认后运行: bash skills/xdd-reverse/scripts/trace.sh coverage $SLUG" >> "$REPORT_FILE"

echo ""
echo "推断报告已生成: $REPORT_FILE"
echo ""
cat "$REPORT_FILE"
echo ""
echo "✅ @implements 推断完成"
