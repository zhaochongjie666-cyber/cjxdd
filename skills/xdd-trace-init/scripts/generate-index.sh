#!/usr/bin/env bash
# generate-index.sh — INDEX.md 生成脚本
# 用法: bash generate-index.sh [project_dir]
#
# 自动生成 L1 业务索引

set -euo pipefail

PROJECT_DIR="${1:-.}"
SHADOW_DIR="$PROJECT_DIR/.shadow"
INDEX_FILE="$SHADOW_DIR/L1-business/INDEX.md"

echo "=== INDEX.md 生成 ==="
echo "项目目录: $PROJECT_DIR"
echo ""

# 检查 .shadow 目录
if [ ! -d "$SHADOW_DIR/L1-business" ]; then
    echo "错误: $SHADOW_DIR/L1-business 目录不存在" >&2
    exit 1
fi

# 创建输出目录
mkdir -p "$(dirname "$INDEX_FILE")"

# 生成 INDEX.md 头部
cat > "$INDEX_FILE" << EOF
# L1 业务索引

> 自动生成于 $(date '+%Y-%m-%d %H:%M:%S') · 追溯初始化

| 业务 Slug | 业务名称 | 主业务 | 状态 | 规则数 | 代码覆盖 | 测试覆盖 | 创建时间 | 最后更新 |
|-----------|---------|:------:|:----:|:------:|:--------:|:--------:|----------|----------|
EOF

# 扫描每个业务线
for slug_dir in "$SHADOW_DIR/L1-business"/*/; do
    [ -d "$slug_dir" ] || continue
    [ "$(basename "$slug_dir")" = "INDEX.md" ] && continue
    [ "$(basename "$slug_dir")" = "TRACE.md" ] && continue
    
    local slug
    slug=$(basename "$slug_dir")
    
    local spec_file="$slug_dir/spec.md"
    local rule_count=0
    local impl_count=0
    local test_count=0
    local code_coverage="0/0"
    local test_coverage="0/0"
    local status="🟡 pending"
    local main_biz=""
    
    # 统计规则数
    if [ -f "$spec_file" ]; then
        rule_count=$(grep -oE "${slug}-R[0-9]+" "$spec_file" 2>/dev/null | sort -u | wc -l || echo 0)
    fi
    
    # 统计 @implements 覆盖（from L5-plan)
    if [ -d "$SHADOW_DIR/L5-plan/$slug" ]; then
        impl_count=$(grep -r "@implements:.*${slug}-R" "$SHADOW_DIR/L5-plan/$slug/" 2>/dev/null | wc -l || echo 0)
    fi
    
    # 统计 @covers 覆盖
    for test_dir in "$PROJECT_DIR/tests" "$PROJECT_DIR/src/__tests__" "$PROJECT_DIR/server/tests"; do
        if [ -d "$test_dir" ]; then
            test_count=$((test_count + $(grep -r "@covers:.*${slug}-R" "$test_dir" 2>/dev/null | wc -l || echo 0)))
        fi
    done
    
    # 计算覆盖率
    if [ "$rule_count" -gt 0 ]; then
        code_coverage="${impl_count}/${rule_count}"
        test_coverage="${test_count}/${rule_count}"
        
        # 判定状态
        if [ "$impl_count" -eq "$rule_count" ] && [ "$test_count" -eq "$rule_count" ]; then
            status="✅ passed"
        elif [ "$impl_count" -eq "$rule_count" ]; then
            status="🟡 impl-ok"
        elif [ "$impl_count" -gt 0 ]; then
            status="🟠 partial"
        else
            status="❌ no-impl"
        fi
    fi
    
    # 主业务标记（暂时留空，后续手动指定或按规则数自动选择）
    # 默认规则最多的业务线为主业务
    
    echo "| $slug | $slug | $main_biz | $status | $rule_count | $code_coverage | $test_coverage | auto | $(date '+%Y-%m-%d') |" >> "$INDEX_FILE"
done

echo "" >> "$INDEX_FILE"
echo "---" >> "$INDEX_FILE"
echo "" >> "$INDEX_FILE"
echo "## 使用说明" >> "$INDEX_FILE"
echo "" >> "$INDEX_FILE"
echo "- **主业务**: 标记 ⭐ 的业务线为主要业务" >> "$INDEX_FILE"
echo "- **状态**: ✅ passed | 🟡 impl-ok | 🟠 partial | ❌ no-impl" >> "$INDEX_FILE"
echo "- **代码覆盖**: @implements 标记的规则数 / 总规则数" >> "$INDEX_FILE"
echo "- **测试覆盖**: @covers 标记的规则数 / 总规则数" >> "$INDEX_FILE"
echo "" >> "$INDEX_FILE"
echo "## 追溯矩阵" >> "$INDEX_FILE"
echo "" >> "$INDEX_FILE"
echo "运行 \`bash skills/shadow-trace-init/scripts/trace.sh matrix > TRACE.md\` 生成完整追溯矩阵" >> "$INDEX_FILE"

echo "INDEX.md 已生成: $INDEX_FILE"
echo ""
echo "下一步:"
echo "  1. 指定主业务线（在 ⭐ 列标记）"
echo "  2. 运行: bash skills/shadow-trace-init/scripts/trace.sh matrix > $SHADOW_DIR/L1-business/TRACE.md"
echo "  3. 运行: bash skills/shadow-trace-init/scripts/trace.sh coverage <slug> 查看各业务线覆盖详情"
echo ""
echo "✅ INDEX.md 生成完成"
