#!/usr/bin/env bash
# reverse-bizline-detect.sh — 业务线自动识别脚本（基于 r-bizline-detector.md）
# 用法: bash reverse-bizline-detect.sh [project_dir]
#
# 从代码目录结构自动识别业务线

set -euo pipefail

PROJECT_DIR="${1:-.}"
OUTPUT_FILE="${PROJECT_DIR}/.shadow/bizline-report.md"

echo "=== 业务线自动识别 ==="
echo "项目目录: $PROJECT_DIR"
echo ""

# 创建输出目录
mkdir -p "$(dirname "$OUTPUT_FILE")"

# 业务线识别规则（基于 r-bizline-detector.md）
detect_bizline() {
    local dir_name="$1"
    local confidence=""
    local biz_id=""
    
    # HIGH 置信度匹配
    if [[ "$dir_name" =~ ^(user|auth|account|profile).*$ ]]; then
        biz_id="biz-user"
        confidence="HIGH"
    elif [[ "$dir_name" =~ ^(payment|billing|checkout|invoice).*$ ]]; then
        biz_id="biz-payment"
        confidence="HIGH"
    elif [[ "$dir_name" =~ ^(order|cart|shipping|fulfillment).*$ ]]; then
        biz_id="biz-order"
        confidence="HIGH"
    elif [[ "$dir_name" =~ ^(notification|email|sms|push).*$ ]]; then
        biz_id="biz-notification"
        confidence="HIGH"
    elif [[ "$dir_name" =~ ^(search|recommend|discovery).*$ ]]; then
        biz_id="biz-search"
        confidence="HIGH"
    elif [[ "$dir_name" =~ ^(collect|ingest|scraper|crawler).*$ ]]; then
        biz_id="biz-collect"
        confidence="HIGH"
    # MEDIUM 置信度匹配
    elif [[ "$dir_name" =~ ^(admin|config|setting|management).*$ ]]; then
        biz_id="biz-admin"
        confidence="MEDIUM"
    elif [[ "$dir_name" =~ ^(analytics|report|dashboard|metrics).*$ ]]; then
        biz_id="biz-analytics"
        confidence="MEDIUM"
    elif [[ "$dir_name" =~ ^(transform|etl|pipeline|processor).*$ ]]; then
        biz_id="biz-transform"
        confidence="MEDIUM"
    elif [[ "$dir_name" =~ ^(store|warehouse|db|repository).*$ ]]; then
        biz_id="biz-store"
        confidence="MEDIUM"
    elif [[ "$dir_name" =~ ^(serve|api|query|graphql).*$ ]]; then
        biz_id="biz-serve"
        confidence="MEDIUM"
    elif [[ "$dir_name" =~ ^(orchest|schedule|dag|workflow).*$ ]]; then
        biz_id="biz-orchest"
        confidence="MEDIUM"
    elif [[ "$dir_name" =~ ^(quality|validat|audit|check).*$ ]]; then
        biz_id="biz-quality"
        confidence="MEDIUM"
    elif [[ "$dir_name" =~ ^(monitor|alert|observe|trace).*$ ]]; then
        biz_id="biz-monitor"
        confidence="MEDIUM"
    elif [[ "$dir_name" =~ ^(export|sync|distribute).*$ ]]; then
        biz_id="biz-export"
        confidence="MEDIUM"
    else
        biz_id="biz-uncategorized"
        confidence="LOW"
    fi
    
    echo "$biz_id $confidence"
}

# 扫描 src/ 或类似源码目录
scan_source_dirs() {
    local project_dir="$1"
    local source_dirs=()
    
    # 常见源码目录
    for dir in "$project_dir/src" "$project_dir/app" "$project_dir/lib" "$project_dir/server" "$project_dir/client"; do
        if [ -d "$dir" ]; then
            source_dirs+=("$dir")
        fi
    done
    
    # 如果没有找到源码目录，扫描根目录下的子目录（排除常见非源码目录）
    if [ ${#source_dirs[@]} -eq 0 ]; then
        while IFS= read -r -d '' dir; do
            local base_name=$(basename "$dir")
            # 排除常见非源码目录
            if [[ ! "$base_name" =~ ^(\.|node_modules|dist|build|__pycache__|venv|\.git|docs|tests?)$ ]]; then
                source_dirs+=("$dir")
            fi
        done < <(find "$project_dir" -maxdepth 1 -type d -print0 2>/dev/null)
    fi
    
    printf '%s\n' "${source_dirs[@]}"
}

# 生成业务线报告
echo "## 业务线识别结果" > "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "| 业务线 ID | 模块/目录 | 文件数 | 代码行数 | 置信度 | 依据 |" >> "$OUTPUT_FILE"
echo "|-----------|----------|--------|---------|--------|------|" >> "$OUTPUT_FILE"

# 扫描并识别
scan_source_dirs "$PROJECT_DIR" | while IFS= read -r src_dir; do
    if [ -n "$src_dir" ] && [ -d "$src_dir" ]; then
        # 扫描子目录
        find "$src_dir" -maxdepth 1 -type d 2>/dev/null | while IFS= read -r sub_dir; do
            if [ "$sub_dir" != "$src_dir" ]; then
                local dir_name=$(basename "$sub_dir")
                local result=$(detect_bizline "$dir_name")
                local biz_id=$(echo "$result" | cut -d' ' -f1)
                local confidence=$(echo "$result" | cut -d' ' -f2)
                local file_count=$(find "$sub_dir" -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.py" -o -name "*.go" -o -name "*.java" -o -name "*.rs" \) 2>/dev/null | wc -l)
                local line_count=0
                if [ "$file_count" -gt 0 ]; then
                    line_count=$(find "$sub_dir" -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.py" -o -name "*.go" -o -name "*.java" -o -name "*.rs" \) -exec wc -l {} + 2>/dev/null | tail -1 | awk '{print $1}')
                fi
                
                # 只记录有代码文件的目录
                if [ "$file_count" -gt 0 ]; then
                    echo "| $biz_id | $sub_dir | $file_count | $line_count | $confidence | 目录名匹配 |" >> "$OUTPUT_FILE"
                fi
            fi
        done
    fi
done

# 去重并排序
if [ -f "$OUTPUT_FILE" ]; then
    # 读取头部
    head -n 3 "$OUTPUT_FILE" > "${OUTPUT_FILE}.tmp"
    # 去重并排序数据行
    tail -n +4 "$OUTPUT_FILE" | sort -u -t'|' -k2,2 >> "${OUTPUT_FILE}.tmp"
    mv "${OUTPUT_FILE}.tmp" "$OUTPUT_FILE"
fi

echo "" >> "$OUTPUT_FILE"
echo "## 跨线连接" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "| 来源 | 目标 | 连接类型 | 依据 |" >> "$OUTPUT_FILE"
echo "|------|------|---------|------|" >> "$OUTPUT_FILE"
echo "| - | - | 待检测 | Phase B 补充 |" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "---" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "**业务线识别完成** — 进入 Phase B 进行逐业务线证据化补全" >> "$OUTPUT_FILE"

echo "业务线识别报告已生成: $OUTPUT_FILE"
echo "✅ 业务线识别完成"
