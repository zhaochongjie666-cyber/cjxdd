#!/usr/bin/env bash
# scan-project-grade.sh — 项目档位扫描脚本（逆向 Phase C）
# 用法: bash scan-project-grade.sh [project_dir]
#
# 自动检测项目的设计层完整度档位（A/B/C/D/E）

set -euo pipefail

PROJECT_DIR="${1:-.}"
DESIGN_DIR="$PROJECT_DIR/.xdd/design"

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

echo "--- 档位判定检查 ---"
echo ""

# 检查 1: .xdd/design 目录存在
if check_exists "$DESIGN_DIR" ".xdd/design/ 目录存在"; then
    GRADE_SCORE=$((GRADE_SCORE + 10))
    CHECKLIST+=("design_dir:yes")
else
    CHECKLIST+=("design_dir:no")
fi
echo ""

# 检查 2: spec 存在且有 rules.md
SPEC_EXISTS=false
SPEC_RULES_EXISTS=false
if [ -d "$DESIGN_DIR/spec" ]; then
    echo "✅ spec/ 目录存在"
    SPEC_EXISTS=true
    CHECKLIST+=("spec_dir:yes")

    # 检查是否有 rules.md
    RULES_COUNT=$(find "$DESIGN_DIR/spec" -name "rules.md" 2>/dev/null | wc -l)
    if [ "$RULES_COUNT" -gt 0 ]; then
        echo "✅ rules.md 存在 ($RULES_COUNT 个)"
        SPEC_RULES_EXISTS=true
        GRADE_SCORE=$((GRADE_SCORE + 20))
        CHECKLIST+=("spec_rules:yes")
    else
        echo "❌ rules.md 不存在"
        CHECKLIST+=("spec_rules:no")
    fi
else
    echo "❌ spec/ 目录不存在"
    CHECKLIST+=("spec_dir:no")
    CHECKLIST+=("spec_rules:no")
fi
echo ""

# 检查 3: architecture 存在且有 architecture.md
ARCH_EXISTS=false
if [ -d "$DESIGN_DIR/architecture" ]; then
    ARCH_COUNT=$(find "$DESIGN_DIR/architecture" -name "architecture.md" 2>/dev/null | wc -l)
    if [ "$ARCH_COUNT" -gt 0 ]; then
        echo "✅ architecture.md 存在 ($ARCH_COUNT 个)"
        ARCH_EXISTS=true
        GRADE_SCORE=$((GRADE_SCORE + 20))
        CHECKLIST+=("arch:yes")
    else
        echo "❌ architecture.md 不存在"
        CHECKLIST+=("arch:no")
    fi
else
    echo "❌ architecture/ 目录不存在"
    CHECKLIST+=("arch:no")
fi
echo ""

# 检查 4: 代码中有 @implements
CODE_IMPL_EXISTS=false
CODE_IMPL_COUNT=$(grep -r "@implements" "$PROJECT_DIR" --include="*.py" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" 2>/dev/null | grep -v "/.xdd/" | wc -l || echo 0)
if [ "$CODE_IMPL_COUNT" -gt 0 ]; then
    echo "✅ 代码有 @implements 标记 ($CODE_IMPL_COUNT 处)"
    CODE_IMPL_EXISTS=true
    GRADE_SCORE=$((GRADE_SCORE + 20))
    CHECKLIST+=("code_impl:yes")
else
    echo "❌ 代码无 @implements 标记"
    CHECKLIST+=("code_impl:no")
fi
echo ""

# 检查 5: INDEX.md 存在
INDEX_EXISTS=false
if [ -f "$DESIGN_DIR/INDEX.md" ]; then
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
if [ -f "$DESIGN_DIR/TRACE.md" ]; then
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
if [ -d "$DESIGN_DIR" ]; then
    # 检查是否有旧式平铺结构（根目录散落 *.spec.md / *.flow.mermaid）
    OLD_STYLE=$(find "$DESIGN_DIR" -maxdepth 1 \( -name "*.spec.md" -o -name "*.flow.mermaid" \) 2>/dev/null | head -1)
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

# 档位判定逻辑：spec + architecture + 代码标记 三要素
if [ "$SPEC_RULES_EXISTS" = true ] && [ "$ARCH_EXISTS" = true ] && [ "$CODE_IMPL_EXISTS" = true ]; then
    # 档位 A: 完整项目，看是否缺索引
    if [ "$INDEX_EXISTS" = true ] && [ "$TRACE_EXISTS" = true ]; then
        GRADE="A+"
        echo "🟢 档位 A+: 完整项目（所有追溯组件就绪）"
    else
        GRADE="A"
        echo "🟢 档位 A: 完整项目，缺索引（需要生成 INDEX.md + TRACE.md）"
    fi
elif [ "$SPEC_RULES_EXISTS" = true ] && { [ "$ARCH_EXISTS" = false ] || [ "$CODE_IMPL_EXISTS" = false ]; }; then
    # 档位 B: 有 spec，缺架构或标记
    GRADE="B"
    echo "🟡 档位 B: 有 spec，缺架构或代码标记（需要补全 architecture + @implements）"
elif [ "$CODE_IMPL_EXISTS" = true ] && { [ "$SPEC_RULES_EXISTS" = false ] || [ "$SPEC_EXISTS" = false ]; }; then
    # 档位 C: 有代码标记，缺设计整理
    GRADE="C"
    echo "🟡 档位 C: 有代码标记，缺整理（需要从 @implements 反推 spec）"
elif [ ! -d "$DESIGN_DIR" ]; then
    # 档位 D: 野生项目
    GRADE="D"
    echo "🔴 档位 D: 野生项目（需要完整逆向工程）"
else
    # 档位 B-: 有部分 design 但无标记
    GRADE="B-"
    echo "🔴 档位 B-: 有部分 .xdd/design 但追溯链不完整"
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
        echo "  1. 运行 bash skills/xdd-reverse/scripts/trace.sh coverage 验证追溯链完整性"
        echo "  2. 定期运行档位扫描做全局审查"
        ;;
    B)
        echo "项目需要补全架构和 @implements 标记，建议:"
        echo "  1. 运行 infer-implements.sh 推断 @implements"
        echo "  2. 确认推断结果并补到代码"
        echo "  3. 补全 architecture.md（若缺）"
        echo "  4. 生成 INDEX.md + TRACE.md"
        ;;
    C)
        echo "项目需要整理 spec 文档，建议:"
        echo "  1. 从代码 @implements 反推 rules.md"
        echo "  2. 整理 spec 目录结构"
        echo "  3. 生成 INDEX.md + TRACE.md"
        ;;
    D)
        echo "项目需要完整逆向工程，建议:"
        echo "  1. 调用 xdd-reverse 进行完整逆向"
        echo "  2. 完成后回到档位 A 流程生成索引"
        ;;
    B-)
        echo "项目追溯链不完整，建议:"
        echo "  1. 检查缺失的 .xdd/design 层级"
        echo "  2. 补全 spec rules 和 architecture"
        echo "  3. 建立完整的追溯链"
        ;;
    *+E)
        echo "项目需要结构标准化，建议:"
        echo "  1. 备份现有 .xdd/design 目录"
        echo "  2. 按标准重新整理目录（spec/{bxx-slug}/ + architecture/{bxx-slug}/）"
        echo "  3. 重新生成 INDEX.md + TRACE.md"
        ;;
esac

echo ""
echo "✅ 项目档位扫描完成"
