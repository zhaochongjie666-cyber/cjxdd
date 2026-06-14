#!/usr/bin/env bash
# reverse-gate-check.sh — 反推结果质量门禁检查（逆向自检）
# 用法: bash reverse-gate-check.sh [slug]
#
# 检查反推生成的设计层产物是否符合质量标准

set -euo pipefail

SLUG="${1:-}"
DESIGN_DIR=".xdd/design"

echo "=== 反推结果质量门禁检查 ==="
echo ""

if [ -z "$SLUG" ]; then
    echo "错误: 请提供 slug 参数" >&2
    echo "用法: bash reverse-gate-check.sh <slug>" >&2
    exit 1
fi

# Phase A Gate: 骨架完整性
check_phase_a() {
    echo "--- Phase A: 骨架完整性检查 ---"
    local passed=0
    local total=4

    # A1: design 目录结构（spec + architecture 两锚齐全）
    if [ -d "$DESIGN_DIR/spec/$SLUG" ] && [ -d "$DESIGN_DIR/architecture/$SLUG" ]; then
        echo "✅ A1: design 目录结构 — PASS"
        passed=$((passed + 1))
    else
        echo "❌ A1: design 目录结构 — BLOCK (spec/$SLUG 或 architecture/$SLUG 不完整)"
    fi

    # A2: 业务线识别
    if [ -f "$DESIGN_DIR/bizline-report.md" ]; then
        echo "✅ A2: 业务线识别 — PASS"
        passed=$((passed + 1))
    else
        echo "❌ A2: 业务线识别 — BLOCK (未生成业务线报告)"
    fi

    # A3: 骨架 flow
    if [ -f "$DESIGN_DIR/architecture/$SLUG/flow.mermaid" ]; then
        echo "✅ A3: 骨架 flow — PASS"
        passed=$((passed + 1))
    else
        echo "❌ A3: 骨架 flow — BLOCK (未生成流程图)"
    fi

    # A4: 架构骨架（architecture.md）
    if [ -f "$DESIGN_DIR/architecture/$SLUG/architecture.md" ]; then
        echo "✅ A4: 架构骨架 — PASS"
        passed=$((passed + 1))
    else
        echo "❌ A4: 架构骨架 — BLOCK (architecture.md 缺失)"
    fi

    echo ""
    echo "Phase A 结果: $passed/$total 项通过"

    if [ "$passed" -eq "$total" ]; then
        echo "🟢 Phase A: PASS → 进入 Phase B"
        return 0
    elif [ "$passed" -ge 2 ]; then
        echo "🟡 Phase A: WARN → 可进入 Phase B，但需补全缺口"
        return 0
    else
        echo "🔴 Phase A: BLOCK → 必须先修复 BLOCK 项"
        return 1
    fi
}

# Phase B Gate: 规格质量门禁
check_phase_b() {
    echo "--- Phase B: 规格质量门禁检查 ---"
    local passed=0
    local total=6
    local flow_file="$DESIGN_DIR/architecture/$SLUG/flow.mermaid"
    local spec_file="$DESIGN_DIR/spec/$SLUG/rules.md"

    if [ ! -f "$flow_file" ]; then
        echo "❌ 流程图不存在，无法检查 Phase B"
        return 1
    fi

    # F1: BXX-NYY 编号
    if grep -qE "B[0-9]+-N[0-9]+" "$flow_file"; then
        echo "✅ F1: BXX-NYY 编号 — PASS"
        passed=$((passed + 1))
    else
        echo "⚠️  F1: BXX-NYY 编号 — WARN (未使用标准编号)"
    fi

    # F2: 节点类型覆盖
    local node_types=0
    grep -q "classDef phaseNode" "$flow_file" && node_types=$((node_types + 1))
    grep -q "classDef branchNode" "$flow_file" && node_types=$((node_types + 1))
    grep -q "classDef errorNode" "$flow_file" && node_types=$((node_types + 1))
    if [ "$node_types" -ge 2 ]; then
        echo "✅ F2: 节点类型覆盖 — PASS ($node_types 类)"
        passed=$((passed + 1))
    else
        echo "⚠️  F2: 节点类型覆盖 — WARN (仅 $node_types 类节点)"
    fi

    # F3: 异常分支
    if grep -q "errorNode" "$flow_file"; then
        echo "✅ F3: 异常分支 — PASS"
        passed=$((passed + 1))
    else
        echo "❌ F3: 异常分支 — BLOCK (无异常处理分支)"
    fi

    # F4: subgraph 拆分
    if grep -q "subgraph" "$flow_file"; then
        echo "✅ F4: subgraph 拆分 — PASS"
        passed=$((passed + 1))
    else
        echo "⚠️  F4: subgraph 拆分 — WARN (未按业务线拆分)"
    fi

    # F5: rules.md 存在性
    if [ -f "$spec_file" ]; then
        echo "✅ F5: rules.md 存在 — PASS"
        passed=$((passed + 1))
    else
        echo "❌ F5: rules.md 存在 — BLOCK (未生成规则文档)"
    fi

    # F6: 代码扫描报告
    if [ -f "$DESIGN_DIR/r-scan.md" ]; then
        echo "✅ F6: 代码扫描报告 — PASS"
        passed=$((passed + 1))
    else
        echo "⚠️  F6: 代码扫描报告 — WARN (未生成扫描报告)"
    fi

    echo ""
    echo "Phase B 结果: $passed/$total 项通过"

    if [ "$passed" -ge 5 ]; then
        echo "🟢 Phase B: PASS → 进入 Phase C"
        return 0
    elif [ "$passed" -ge 3 ]; then
        echo "🟡 Phase B: WARN → 可进入 Phase C，但需补全缺口"
        return 0
    else
        echo "🔴 Phase B: BLOCK → 必须修正后重新检查"
        return 1
    fi
}

# Phase C Gate: 追溯审计
check_phase_c() {
    echo "--- Phase C: 追溯审计检查 ---"
    local passed=0
    local total=3

    # G1: Git 仓库存在
    if [ -d ".git" ]; then
        echo "✅ G1: Git 仓库存在 — PASS"
        passed=$((passed + 1))
    else
        echo "⚠️  G1: Git 仓库存在 — WARN (非 Git 项目)"
    fi

    # G2: INDEX.md 存在
    if [ -f "$DESIGN_DIR/INDEX.md" ]; then
        echo "✅ G2: INDEX.md — PASS"
        passed=$((passed + 1))
    else
        echo "⚠️  G2: INDEX.md — WARN (未生成追溯索引)"
    fi

    # G3: 代码 @implements 标记
    local impl_count
    impl_count=$(grep -r "@implements" . --include="*.py" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" 2>/dev/null | grep -v '/.xdd/' | wc -l || echo 0)
    if [ "$impl_count" -gt 0 ]; then
        echo "✅ G3: 代码 @implements 标记 — PASS ($impl_count 处)"
        passed=$((passed + 1))
    else
        echo "⚠️  G3: 代码 @implements 标记 — WARN (无标记，需 infer-implements.sh 补全)"
    fi

    echo ""
    echo "Phase C 结果: $passed/$total 项通过"

    if [ "$passed" -eq "$total" ]; then
        echo "🟢 Phase C: PASS"
    else
        echo "🟡 Phase C: 部分通过，补全缺口后重检"
    fi

    return 0
}

# 执行检查
check_phase_a || exit 1
check_phase_b || exit 1
check_phase_c

echo ""
echo "=== 反推结果门禁检查完成 ==="
echo ""
echo "下一步:"
echo "  1. 修正 WARN/BLOCK 项"
echo "  2. 生成 INDEX.md（generate-index.sh）"
echo "  3. 跑追溯评分（scan-project-grade.sh）"
