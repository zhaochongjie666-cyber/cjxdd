#!/usr/bin/env bash
# reverse-gate-check.sh — 反推结果质量门禁检查
# 用法: bash reverse-gate-check.sh [slug]
#
# 检查反推生成的产物是否符合质量标准

set -euo pipefail

SLUG="${1:-}"
SHADOW_DIR=".shadow"

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
    local total=5
    
    # A1: .shadow/ 目录结构
    if [ -d "$SHADOW_DIR/business/$SLUG" ] && [ -d "$SHADOW_DIR/arch/$SLUG" ] && [ -d "$SHADOW_DIR/L5-plan/$SLUG" ]; then
        echo "✅ A1: .shadow/ 目录结构 — PASS"
        passed=$((passed + 1))
    else
        echo "❌ A1: .shadow/ 目录结构 — BLOCK (L1/L1.5/L3 目录不完整)"
    fi
    
    # A2: 业务线识别
    if [ -f "$SHADOW_DIR/bizline-report.md" ]; then
        echo "✅ A2: 业务线识别 — PASS"
        passed=$((passed + 1))
    else
        echo "❌ A2: 业务线识别 — BLOCK (未生成业务线报告)"
    fi
    
    # A3: 骨架 flow
    if [ -f "$SHADOW_DIR/business/project.flow.mermaid" ] || [ -f "$SHADOW_DIR/business/$SLUG/flow.mermaid" ]; then
        echo "✅ A3: 骨架 flow — PASS"
        passed=$((passed + 1))
    else
        echo "❌ A3: 骨架 flow — BLOCK (未生成流程图)"
    fi
    
    # A4: 置信度标注
    local phase_a_flow="$SHADOW_DIR/business/project.flow.mermaid"
    [ -f "$phase_a_flow" ] || phase_a_flow="$SHADOW_DIR/business/$SLUG/flow.mermaid"
    if [ -f "$phase_a_flow" ]; then
        if grep -q "CONF:" "$phase_a_flow"; then
            echo "✅ A4: 置信度标注 — PASS"
            passed=$((passed + 1))
        else
            echo "⚠️  A4: 置信度标注 — WARN (部分节点未标注)"
        fi
    else
        echo "❌ A4: 置信度标注 — BLOCK (流程图不存在)"
    fi
    
    # A5: L1.5 骨架
    if [ -f "$SHADOW_DIR/arch/$SLUG/architecture.md" ] && [ -f "$SHADOW_DIR/arch/$SLUG/file-list.md" ]; then
        echo "✅ A5: L1.5 骨架 — PASS"
        passed=$((passed + 1))
    else
        echo "❌ A5: L1.5 骨架 — BLOCK (architecture.md 或 file-list.md 缺失)"
    fi
    
    echo ""
    echo "Phase A 结果: $passed/$total 项通过"
    
    if [ "$passed" -eq "$total" ]; then
        echo "🟢 Phase A: PASS → 进入 Phase B"
        return 0
    elif [ "$passed" -ge 3 ]; then
        echo "🟡 Phase A: WARN → 可进入 Phase B，但需补全缺口"
        return 0
    else
        echo "🔴 Phase A: BLOCK → 必须先修复 BLOCK 项"
        return 1
    fi
}

# Phase B Gate: F1-F11 质量门禁
check_phase_b() {
    echo "--- Phase B: F1-F11 质量门禁检查 ---"
    local passed=0
    local total=11
    local flow_file="$SHADOW_DIR/business/project.flow.mermaid"
    [ -f "$flow_file" ] || flow_file="$SHADOW_DIR/business/$SLUG/flow.mermaid"
    local spec_file="$SHADOW_DIR/business/$SLUG/spec.md"
    
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
    
    # F2: 6类节点齐全 (简化检查)
    local node_types=0
    grep -q "classDef phaseNode" "$flow_file" && node_types=$((node_types + 1))
    grep -q "classDef branchNode" "$flow_file" && node_types=$((node_types + 1))
    grep -q "classDef errorNode" "$flow_file" && node_types=$((node_types + 1))
    if [ "$node_types" -ge 3 ]; then
        echo "✅ F2: 节点类型覆盖 — PASS ($node_types/6)"
        passed=$((passed + 1))
    else
        echo "⚠️  F2: 节点类型覆盖 — WARN (仅 $node_types/6 类节点)"
    fi
    
    # F3: 异常分支 (检查是否有 errorNode 类)
    if grep -q "errorNode" "$flow_file"; then
        echo "✅ F3: 异常分支 — PASS"
        passed=$((passed + 1))
    else
        echo "❌ F3: 异常分支 — BLOCK (无异常处理分支)"
    fi
    
    # F4: 状态转换标注
    if grep -qE "S[0-9]+.*→.*S[0-9]+" "$flow_file"; then
        echo "✅ F4: 状态转换标注 — PASS"
        passed=$((passed + 1))
    else
        echo "⚠️  F4: 状态转换标注 — WARN (未标注状态转换)"
    fi
    
    # F5: subgraph 拆分
    if grep -q "subgraph" "$flow_file"; then
        echo "✅ F5: subgraph 拆分 — PASS"
        passed=$((passed + 1))
    else
        echo "⚠️  F5: subgraph 拆分 — WARN (未按业务线拆分)"
    fi
    
    # F6: L1 配色
    if grep -q "classDef phaseNode fill:#" "$flow_file"; then
        echo "✅ F6: L1 配色 — PASS"
        passed=$((passed + 1))
    else
        echo "❌ F6: L1 配色 — BLOCK (未使用 L1 配色方案)"
    fi
    
    # F7: 置信度分布 (统计 CONF: 标记)
    local conf_count=$(grep -c "CONF:" "$flow_file" 2>/dev/null || echo 0)
    if [ "$conf_count" -gt 5 ]; then
        echo "✅ F7: 置信度标注 — PASS ($conf_count 处标注)"
        passed=$((passed + 1))
    else
        echo "⚠️  F7: 置信度标注 — WARN (仅 $conf_count 处标注)"
    fi
    
    # F8: 节点描述 (检查是否有模糊命名)
    if grep -E "\[.*处理.*\]" "$flow_file" 2>/dev/null | head -1 > /dev/null; then
        echo "⚠️  F8: 节点描述 — WARN (发现模糊命名'处理')"
    else
        echo "✅ F8: 节点描述 — PASS"
        passed=$((passed + 1))
    fi
    
    # F9: spec.md 存在性
    if [ -f "$spec_file" ]; then
        echo "✅ F9: spec.md 存在 — PASS"
        passed=$((passed + 1))
    else
        echo "❌ F9: spec.md 存在 — BLOCK (未生成规格文档)"
    fi
    
    # F10: 代码证据链 (简化检查)
    if [ -f "$SHADOW_DIR/r-scan.md" ]; then
        echo "✅ F10: 代码扫描报告 — PASS"
        passed=$((passed + 1))
    else
        echo "⚠️  F10: 代码扫描报告 — WARN (未生成扫描报告)"
    fi
    
    # F11: 测试缺口清单
    if [ -f "$SHADOW_DIR/${SLUG}-evidence-audit.md" ]; then
        echo "✅ F11: 证据审计表 — PASS"
        passed=$((passed + 1))
    else
        echo "⚠️  F11: 证据审计表 — WARN (未生成证据明细表)"
    fi
    
    echo ""
    echo "Phase B 结果: $passed/$total 项通过"
    
    if [ "$passed" -ge 9 ]; then
        echo "🟢 Phase B: PASS → 进入 Phase C"
        return 0
    elif [ "$passed" -ge 6 ]; then
        echo "🟡 Phase B: WARN → 可进入 Phase C，但需补全缺口"
        return 0
    else
        echo "🔴 Phase B: BLOCK → 必须修正后重新检查"
        return 1
    fi
}

# Phase C Gate: Git 审计
check_phase_c() {
    echo "--- Phase C: Git 审计检查 ---"
    local passed=0
    local total=5
    
    # G1: 变更历史扫描
    if [ -d ".git" ]; then
        echo "✅ G1: Git 仓库存在 — PASS"
        passed=$((passed + 1))
    else
        echo "⚠️  G1: Git 仓库存在 — WARN (非 Git 项目)"
    fi
    
    # G2-G6: 简化检查
    echo "⚠️  G2: 热点标注 — WARN (需 Phase C 完成后标注)"
    echo "⚠️  G3: 置信度终审 — WARN (需 Phase C 完成后统计)"
    echo "⚠️  G4: Git 历史 column — WARN (需 Phase C 完成后补充)"
    echo "⚠️  G5: 时序一致 — WARN (需 Phase C 完成后验证)"
    
    echo ""
    echo "Phase C 结果: $passed/$total 项通过"
    echo "🟡 Phase C: 待 Git 审计完成后验证"
    
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
echo "  2. 进入 Phase C Git 审计"
echo "  3. 生成最终审计报告"
