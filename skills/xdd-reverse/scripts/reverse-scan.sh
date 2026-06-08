#!/usr/bin/env bash
# reverse-scan.sh — L5 代码扫描脚本（基于 r-code-scanner.md）
# 用法: bash reverse-scan.sh [project_dir]
#
# 扫描项目代码，输出代码资产盘点报告

set -euo pipefail

PROJECT_DIR="${1:-.}"
OUTPUT_FILE="${PROJECT_DIR}/.shadow/r-scan.md"

echo "=== L5 代码扫描 ==="
echo "项目目录: $PROJECT_DIR"
echo ""

# 创建输出目录
mkdir -p "$(dirname "$OUTPUT_FILE")"

# 语言/框架检测
detect_language() {
    if [ -f "$PROJECT_DIR/package.json" ]; then
        echo "JavaScript/TypeScript (Node.js)"
    elif [ -f "$PROJECT_DIR/requirements.txt" ] || [ -f "$PROJECT_DIR/pyproject.toml" ]; then
        echo "Python"
    elif [ -f "$PROJECT_DIR/go.mod" ]; then
        echo "Go"
    elif [ -f "$PROJECT_DIR/pom.xml" ] || [ -f "$PROJECT_DIR/build.gradle" ]; then
        echo "Java"
    elif [ -f "$PROJECT_DIR/Cargo.toml" ]; then
        echo "Rust"
    else
        echo "Unknown"
    fi
}

# 统计代码规模
get_code_stats() {
    local lang="$1"
    local files=0
    local lines=0
    
    case "$lang" in
        "JavaScript/TypeScript (Node.js)")
            files=$(find "$PROJECT_DIR" -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" 2>/dev/null | wc -l)
            lines=$(find "$PROJECT_DIR" -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" 2>/dev/null | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
            ;;
        "Python")
            files=$(find "$PROJECT_DIR" -name "*.py" 2>/dev/null | wc -l)
            lines=$(find "$PROJECT_DIR" -name "*.py" 2>/dev/null | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
            ;;
        "Go")
            files=$(find "$PROJECT_DIR" -name "*.go" 2>/dev/null | wc -l)
            lines=$(find "$PROJECT_DIR" -name "*.go" 2>/dev/null | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
            ;;
        *)
            files=0
            lines=0
            ;;
    esac
    
    echo "$files $lines"
}

# 扫描入口点
find_entry_points() {
    local lang="$1"
    
    case "$lang" in
        "JavaScript/TypeScript (Node.js)")
            find "$PROJECT_DIR" -name "index.ts" -o -name "index.js" -o -name "main.ts" -o -name "main.js" -o -name "app.ts" -o -name "app.js" 2>/dev/null | head -10
            ;;
        "Python")
            find "$PROJECT_DIR" -name "main.py" -o -name "app.py" -o -name "__main__.py" 2>/dev/null | head -10
            ;;
        "Go")
            find "$PROJECT_DIR" -name "main.go" 2>/dev/null | head -10
            ;;
        *)
            echo "未识别"
            ;;
    esac
}

# 扫描模块目录
find_modules() {
    local lang="$1"
    
    case "$lang" in
        "JavaScript/TypeScript (Node.js)")
            if [ -d "$PROJECT_DIR/src" ]; then
                find "$PROJECT_DIR/src" -maxdepth 1 -type d 2>/dev/null | grep -v "^$PROJECT_DIR/src$"
            fi
            ;;
        "Python")
            if [ -d "$PROJECT_DIR/src" ]; then
                find "$PROJECT_DIR/src" -maxdepth 2 -type d -name "*" 2>/dev/null | grep -v "^$PROJECT_DIR/src$" | grep -v "__pycache__"
            fi
            ;;
        "Go")
            find "$PROJECT_DIR" -name "*.go" -path "*/cmd/*" 2>/dev/null | xargs -I {} dirname {} | sort -u | head -10
            ;;
    esac
}

# 主流程
LANG=$(detect_language)
STATS=$(get_code_stats "$LANG")
FILES=$(echo "$STATS" | cut -d' ' -f1)
LINES=$(echo "$STATS" | cut -d' ' -f2)

echo "检测到语言/框架: $LANG"
echo "代码文件数: $FILES"
echo "代码行数: $LINES"
echo ""

# 生成扫描报告
cat > "$OUTPUT_FILE" << EOF
# 代码扫描报告 — r-scan.md

> 生成时间: $(date '+%Y-%m-%d %H:%M:%S')

## 项目信息

- **语言/框架**: $LANG
- **项目目录**: $PROJECT_DIR
- **代码文件数**: $FILES
- **代码行数**: $LINES

## 入口点

EOF

find_entry_points "$LANG" | while IFS= read -r entry; do
    [ -n "$entry" ] && echo "- \`$entry\`" >> "$OUTPUT_FILE"
done

echo "" >> "$OUTPUT_FILE"
echo "## 模块清单" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "| 模块 | 路径 | 文件数 | 说明 |" >> "$OUTPUT_FILE"
echo "|------|------|--------|------|" >> "$OUTPUT_FILE"

find_modules "$LANG" | while IFS= read -r mod; do
    if [ -n "$mod" ]; then
        mod_name=$(basename "$mod")
        mod_files=$(find "$mod" -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.py" -o -name "*.go" \) 2>/dev/null | wc -l)
        echo "| $mod_name | $mod | $mod_files | 待分析 |" >> "$OUTPUT_FILE"
    fi
done

echo "" >> "$OUTPUT_FILE"
echo "## 依赖关系" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "> 从 import/require 关系推导，待 Phase B 补充" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "## 外部服务" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "| 服务 | 用途 | 调用位置 |" >> "$OUTPUT_FILE"
echo "|------|------|---------|" >> "$OUTPUT_FILE"
echo "| - | 待检测 | - |" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "---" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "**扫描完成** — 进入 Phase B 进行业务线识别和证据化补全" >> "$OUTPUT_FILE"

echo "扫描报告已生成: $OUTPUT_FILE"
echo "✅ L5 扫描完成"
