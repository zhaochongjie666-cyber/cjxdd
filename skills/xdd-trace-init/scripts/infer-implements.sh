#!/usr/bin/env bash
# infer-implements.sh — @implements 推断脚本
# 用法: bash infer-implements.sh <slug> [project_dir]
#
# 从 spec.md 规则反推代码文件的 @implements 标记

set -euo pipefail

SLUG="${1:-}"
PROJECT_DIR="${2:-.}"
SHADOW_DIR="$PROJECT_DIR/.shadow"

echo "=== @implements 推断 ==="

if [ -z "$SLUG" ]; then
    echo "错误: 请提供 slug 参数" >&2
    echo "用法: bash infer-implements.sh <slug> [project_dir]" >&2
    exit 1
fi

echo "业务线: $SLUG"
echo "项目目录: $PROJECT_DIR"
echo ""

# 检查 spec.md 是否存在
SPEC_FILE="$SHADOW_DIR/L1-business/$SLUG/spec.md"
if [ ! -f "$SPEC_FILE" ]; then
    echo "错误: spec.md 不存在: $SPEC_FILE" >&2
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

# 生成推断报告
echo "## @implements 推断结果" > "$SHADOW_DIR/L1-business/$SLUG/infer-report.md"
echo "" >> "$SHADOW_DIR/L1-business/$SLUG/infer-report.md"
echo "> 生成时间: $(date '+%Y-%m-%d %H:%M:%S')" >> "$SHADOW_DIR/L1-business/$SLUG/infer-report.md"
echo "> 业务线: $SLUG" >> "$SHADOW_DIR/L1-business/$SLUG/infer-report.md"
echo "" >> "$SHADOW_DIR/L1-business/$SLUG/infer-report.md"
echo "| 规则 | 推断文件 | 策略 | 置信度 | 状态 |" >> "$SHADOW_DIR/L1-business/$SLUG/infer-report.md"
echo "|------|---------|------|--------|------|" >> "$SHADOW_DIR/L1-business/$SLUG/infer-report.md"

# 逐条规则推断
echo "正在推断规则实现..."
echo "$RULES" | while IFS= read -r rule; do
    [ -z "$rule" ] && continue
    
    # 获取规则描述（从 spec.md 中提取）
    local rule_desc
    rule_desc=$(grep -A1 "$rule" "$SPEC_FILE" 2>/dev/null | tail -1 | sed 's/^[[:space:]]*|\?\s*//' | head -c 50)
    
    # 策略 1: 文件名匹配
    local inferred_files
    inferred_files=$(infer_by_filename "$rule" "$SLUG")
    
    if [ -n "$inferred_files" ]; then
        # 高置信度：文件名匹配
        local file_list
        file_list=$(echo "$inferred_files" | tr '\n' ',' | sed 's/,$//' | sed "s|$PROJECT_DIR/||g")
        echo "| $rule | $file_list | 文件名匹配 | HIGH | 待确认 |" >> "$SHADOW_DIR/L1-business/$SLUG/infer-report.md"
    else
        # 策略 2: 内容语义匹配
        inferred_files=$(infer_by_content "$rule" "$rule_desc")
        if [ -n "$inferred_files" ]; then
            local file_list
            file_list=$(echo "$inferred_files" | tr '\n' ',' | sed 's/,$//' | sed "s|$PROJECT_DIR/||g" | head -c 100)
            echo "| $rule | $file_list | 内容语义 | MEDIUM | 需人工确认 |" >> "$SHADOW_DIR/L1-business/$SLUG/infer-report.md"
        else
            echo "| $rule | - | 无匹配 | LOW | 无法推断 |" >> "$SHADOW_DIR/L1-business/$SLUG/infer-report.md"
        fi
    fi
done

echo "" >> "$SHADOW_DIR/L1-business/$SLUG/infer-report.md"
echo "---" >> "$SHADOW_DIR/L1-business/$SLUG/infer-report.md"
echo "" >> "$SHADOW_DIR/L1-business/$SLUG/infer-report.md"
echo "## 下一步操作" >> "$SHADOW_DIR/L1-business/$SLUG/infer-report.md"
echo "" >> "$SHADOW_DIR/L1-business/$SLUG/infer-report.md"
echo "1. 查看推断报告: $SHADOW_DIR/L1-business/$SLUG/infer-report.md" >> "$SHADOW_DIR/L1-business/$SLUG/infer-report.md"
echo "2. 确认 HIGH 置信度的推断结果" >> "$SHADOW_DIR/L1-business/$SLUG/infer-report.md"
echo "3. 人工确认 MEDIUM 置信度的推断结果" >> "$SHADOW_DIR/L1-business/$SLUG/infer-report.md"
echo "4. 为 LOW 置信度的规则手动指定实现文件" >> "$SHADOW_DIR/L1-business/$SLUG/infer-report.md"
echo "5. 确认后运行: bash skills/shadow-trace-init/scripts/trace.sh coverage $SLUG" >> "$SHADOW_DIR/L1-business/$SLUG/infer-report.md"

echo ""
echo "推断报告已生成: $SHADOW_DIR/L1-business/$SLUG/infer-report.md"
echo ""
cat "$SHADOW_DIR/L1-business/$SLUG/infer-report.md"
echo ""
echo "✅ @implements 推断完成"
