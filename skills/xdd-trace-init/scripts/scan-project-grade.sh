#!/usr/bin/env bash
# scan-project-grade.sh — 项目档位扫描脚本
# 用法: bash scan-project-grade.sh [project_dir]
#
# 自动检测项目属于哪个档位（A/B/C/D/E）

set -euo pipefail

PROJECT_DIR="${1:-.}"
SHADOW_DIR="$PROJECT_DIR/.shadow"

echo "=== 项目档位扫描 ==="
echo "项目目录: $PROJECT_DIR"
echo ""

# 初始化评分
GRADE_SCORE=0
GRADE=""
CHECKLIST=()

# 检查函数
check_exists() {
    if [ -e "$1" ]; then
        echo "✅ $2"
        return 0
    else
        echo "❌ $2"
        return 1
    fi
}

check_contains() {
    if [ -f "$1" ] && grep -q "$2" "$1" 2>/dev/null; then
        echo "✅ $3"
        return 0
    else
        echo "❌ $3"
        return 1
    fi
}

echo "--- 档位判定检查 ---"
echo ""

# 检查 1: .shadow 目录存在
if check_exists "$SHADOW_DIR" ".shadow/ 目录存在"; then
    GRADE_SCORE=$((GRADE_SCORE + 10))
    CHECKLIST+=("shadow_dir:yes")
else
    CHECKLIST+=("shadow_dir:no")
fi
echo ""

# 检查 2: L1-business 存在且有 spec.md
L1_EXISTS=false
L1_SPEC_EXISTS=false
if [ -d "$SHADOW_DIR/L1-business" ]; then
    echo "✅ L1-business/ 目录存在"
    L1_EXISTS=true
    CHECKLIST+=("l1_dir:yes")
    
    # 检查是否有 spec.md
    SPEC_COUNT=$(find "$SHADOW_DIR/L1-business" -name "spec.md" 2>/dev/null | wc -l)
    if [ "$SPEC_COUNT" -gt 0 ]; then
        echo "✅ L1 spec.md 存在 ($SPEC_COUNT 个)"
        L1_SPEC_EXISTS=true
        GRADE_SCORE=$((GRADE_SCORE + 20))
        CHECKLIST+=("l1_spec:yes")
    else
        echo "❌ L1 spec.md 不存在"
        CHECKLIST+=("l1_spec:no")
    fi
else
    echo "❌ L1-business/ 目录不存在"
    CHECKLIST+=("l1_dir:no")
    CHECKLIST+=("l1_spec:no")
fi
echo ""

# 检查 3: L5-plan 存在且有 @implements
L5_PLAN_EXISTS=false
L5_PLAN_IMPL_EXISTS=false
if [ -d "$SHADOW_DIR/L5-plan" ]; then
    echo "✅ L5-plan/ 目录存在"
    L5_PLAN_EXISTS=true
    CHECKLIST+=("l5_plan_dir:yes")
    
    # 检查是否有 harness-plan.md
    PLAN_COUNT=$(find "$SHADOW_DIR/L5-plan" -name "harness-plan.md" 2>/dev/null | wc -l)
    if [ "$PLAN_COUNT" -gt 0 ]; then
        echo "✅ L5 Plan 有 harness-plan.md ($PLAN_COUNT 个)"
        IMPL_COUNT=$(grep -r "@implements:" "$SHADOW_DIR/L5-plan/" 2>/dev/null | wc -l || echo 0)
        if [ "$IMPL_COUNT" -gt 0 ]; then
            echo "✅ L5 Plan 有 @implements 标记 ($IMPL_COUNT 处)"
            L5_PLAN_IMPL_EXISTS=true
            GRADE_SCORE=$((GRADE_SCORE + 20))
            CHECKLIST+=("l5_plan_impl:yes")
        else
            echo "❌ L5 Plan 无 @implements 标记"
            CHECKLIST+=("l5_plan_impl:no")
        fi
    else
        echo "❌ L5 Plan 无 harness-plan.md"
        CHECKLIST+=("l5_plan_impl:no")
    fi
else
    echo "❌ L5-plan/ 目录不存在"
    CHECKLIST+=("l5_plan_dir:no")
    CHECKLIST+=("l5_plan_impl:no")
fi
echo ""

# 检查 4: 代码中有 @implements
CODE_IMPL_EXISTS=false
CODE_IMPL_COUNT=$(grep -r "@implements:" "$PROJECT_DIR" --include="*.py" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" 2>/dev/null | grep -v ".shadow" | wc -l || echo 0)
if [ "$CODE_IMPL_COUNT" -gt 0 ]; then
    echo "✅ L5 代码有 @implements 标记 ($CODE_IMPL_COUNT 处)"
    CODE_IMPL_EXISTS=true
    GRADE_SCORE=$((GRADE_SCORE + 20))
    CHECKLIST+=("l5_impl:yes")
else
    echo "❌ L5 代码无 @implements 标记"
    CHECKLIST+=("l5_impl:no")
fi
echo ""

# 检查 5: INDEX.md 存在
INDEX_EXISTS=false
if [ -f "$SHADOW_DIR/L1-business/INDEX.md" ]; then
    echo "✅ INDEX.md 存在"
    INDEX_EXISTS=true
    GRADE_SCORE=$((GRADE_SCORE + 10))
    CHECKLIST+=("index:yes")
else
    echo "❌ INDEX.md 不存在"
    CHECKLIST+=("index:no")
fi
echo ""

# 检查 6: TRACE.md 存在
TRACE_EXISTS=false
if [ -f "$SHADOW_DIR/L1-business/TRACE.md" ]; then
    echo "✅ TRACE.md 存在"
    TRACE_EXISTS=true
    GRADE_SCORE=$((GRADE_SCORE + 10))
    CHECKLIST+=("trace:yes")
else
    echo "❌ TRACE.md 不存在"
    CHECKLIST+=("trace:no")
fi
echo ""

# 检查 7: 目录结构是否标准（档位 E 检查）
STANDARD_STRUCTURE=true
if [ -d "$SHADOW_DIR" ]; then
    # 检查是否有旧式平铺结构
    OLD_STYLE=$(find "$SHADOW_DIR" -maxdepth 1 -name "*.spec.md" -o -name "*.flow.mermaid" 2>/dev/null | head -1)
    if [ -n "$OLD_STYLE" ]; then
        echo "⚠️  检测到旧式平铺结构（档位 E 需要标准化）"
        STANDARD_STRUCTURE=false
        CHECKLIST+=("structure:old")
    else
        echo "✅ 目录结构为标准格式"
        CHECKLIST+=("structure:standard")
    fi
else
    CHECKLIST+=("structure:none")
fi
echo ""

# 判定档位
echo "--- 档位判定 ---"
echo ""

# 档位判定逻辑
if [ "$L1_SPEC_EXISTS" = true ] && [ "$L5_PLAN_IMPL_EXISTS" = true ] && [ "$CODE_IMPL_EXISTS" = true ]; then
    # 档位 A: 完整项目，缺索引
    if [ "$INDEX_EXISTS" = true ] && [ "$TRACE_EXISTS" = true ]; then
        GRADE="A+"
        echo "🟢 档位 A+: 完整项目（所有追溯组件就绪）"
    else
        GRADE="A"
        echo "🟢 档位 A: 完整项目，缺索引（需要生成 INDEX.md + TRACE.md）"
    fi
elif [ "$L1_SPEC_EXISTS" = true ] && ([ "$L5_PLAN_IMPL_EXISTS" = false ] || [ "$CODE_IMPL_EXISTS" = false ]); then
    # 档位 B: 有设计，缺标记
    GRADE="B"
    echo "🟡 档位 B: 有设计，缺标记（需要补全 @implements）"
elif [ "$CODE_IMPL_EXISTS" = true ] && ([ "$L1_SPEC_EXISTS" = false ] || [ "$L1_EXISTS" = false ]); then
    # 档位 C: 有代码标记，缺整理
    GRADE="C"
    echo "🟡 档位 C: 有代码标记，缺整理（需要整理 L1 spec）"
elif [ ! -d "$SHADOW_DIR" ]; then
    # 档位 D: 野生项目
    GRADE="D"
    echo "🔴 档位 D: 野生项目（需要完整逆向工程）"
else
    # 档位 B-: 有部分 .shadow 但无标记
    GRADE="B-"
    echo "🔴 档位 B-: 有部分 .shadow 但无标记（需要补全追溯链）"
fi

# 档位 E 检测（结构标准化）
if [ "$STANDARD_STRUCTURE" = false ]; then
    echo "⚠️  档位 E: 需要结构标准化（存在旧式目录结构）"
    if [ "$GRADE" = "D" ]; then
        GRADE="D+E"
    else
        GRADE="${GRADE}+E"
    fi
fi

echo ""
echo "评分: $GRADE_SCORE/100"
echo ""

# 输出建议
echo "--- 建议操作 ---"
echo ""

case "$GRADE" in
    A|A+)
        echo "项目状态良好，建议:" 
        echo "  1. 运行 bash skills/shadow-trace-init/scripts/trace.sh coverage 验证追溯链完整性"
        echo "  2. 定期运行 shadow-project-audit 进行全局审查"
        ;;
    B)
        echo "项目需要补全 @implements 标记，建议:"
        echo "  1. 运行 infer-implements.sh 推断 @implements"
        echo "  2. 确认推断结果并写入 L5 plan 和代码"
        echo "  3. 生成 INDEX.md + TRACE.md"
        ;;
    C)
        echo "项目需要整理 L1 文档，建议:"
        echo "  1. 从代码 @implements 反推 L1 spec"
        echo "  2. 整理 L1-business 目录结构"
        echo "  3. 生成 INDEX.md + TRACE.md"
        ;;
    D)
        echo "项目需要完整逆向工程，建议:"
        echo "  1. 调用 shadow-reverse 进行完整逆向"
        echo "  2. 完成后回到档位 A 流程生成索引"
        ;;
    B-)
        echo "项目追溯链不完整，建议:"
        echo "  1. 检查缺失的 .shadow 层级"
        echo "  2. 补全 L1 spec 和 L5 plan"
        echo "  3. 建立完整的追溯链"
        ;;
    *+E)
        echo "项目需要结构标准化，建议:"
        echo "  1. 备份现有 .shadow 目录"
        echo "  2. 按档位 E 标准重新整理目录"
        echo "  3. 重新生成 INDEX.md + TRACE.md"
        ;;
esac

echo ""
echo "✅ 项目档位扫描完成"
