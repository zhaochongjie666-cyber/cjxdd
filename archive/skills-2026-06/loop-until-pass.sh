#!/bin/bash
# loop-until-pass.sh — 回环 3 实施-验证 loop until pass
# 6 闸门全过才退出, 任一失败自动 retry, 3 试未过 HALT
# 详见 skills/xdd-execute/SKILL.md "Loop-Until-Pass" 段 + docs/LOOP-DESIGN.md

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../../hooks/xdd-gate-lib.sh
HOOK_LIB="$(cd "$SCRIPT_DIR/../../.." && pwd)/hooks/xdd-gate-lib.sh"
# 实施 #20 (放水 4 修): chaos-runner 绝对路径 (loop 在 product cwd 跑, skills/ 相对路径找不到)
CHAOS_RUNNER="$(cd "$SCRIPT_DIR/../../.." && pwd)/skills/xdd-l3/scripts/chaos-runner.sh"
if [[ -f "$HOOK_LIB" ]]; then
    source "$HOOK_LIB"
    if is_meta_project 2>/dev/null; then
        echo "[xdd] (Meta 项目, 框架自身, 跳过 loop-until-pass)"
        exit 0
    fi
fi

ITER=0
# 实施 #17 (放水 3 修): halt_after 从 .xdd/scale.md 读 (破 hardcode 3)
SCALE_HALT_AFTER=$(read_scale_field halt_after 2>/dev/null || echo 1)
MAX_ITER="${XDD_LOOP_MAX_ITER:-${SCALE_HALT_AFTER:-3}}"
REPORT=".xdd/reports/exec-loop-$(date +%Y%m%d-%H%M%S).log"
mkdir -p .xdd/reports

echo "[xdd] === 回环 3 实施-验证 (max iter: $MAX_ITER, halt_after from scale.md: $SCALE_HALT_AFTER) ===" | tee "$REPORT"

while [[ $ITER -lt $MAX_ITER ]]; do
    ITER=$((ITER + 1))
    echo "" | tee -a "$REPORT"
    echo "=== iter $ITER / $MAX_ITER ===" | tee -a "$REPORT"

    # 闸门 0: L3 chaos 真注入 (实施 #20, 放水 4 修: 5 类 chaos, L 规模 ≥ 5, S/M ≥ 3)
    bash "$CHAOS_RUNNER" 2>&1 | tee -a "$REPORT"
    chaos_rc=${PIPESTATUS[0]}

    # 闸门 1-5: 5 维覆盖率 (BDD/API/e2e/持久化/跨服务)
    bash hooks/xdd-gate-coverage-check.sh 2>&1 | tee -a "$REPORT"
    coverage_rc=${PIPESTATUS[0]}

    # 闸门 6: 0 stub
    bash hooks/xdd-gate-stub-scan.sh 2>&1 | tee -a "$REPORT"
    stub_rc=${PIPESTATUS[0]}

    # 全过 (0+0+0) 才出 loop
    if [[ $chaos_rc -eq 0 && $coverage_rc -eq 0 && $stub_rc -eq 0 ]]; then
        echo "" | tee -a "$REPORT"
        echo "[xdd] ✓ 回环 3 实施-验证通过 (iter $ITER, 含 chaos 闸门)" | tee -a "$REPORT"
        echo "[xdd]   报告: $REPORT"
        exit 0
    fi

    # 找失败维度
    echo "" | tee -a "$REPORT"
    echo "--- 失败分析 (iter $ITER) ---" | tee -a "$REPORT"
    [[ $chaos_rc -ne 0 ]] && echo "❌ L3 chaos 闸门失败 ($chaos_rc)" | tee -a "$REPORT"
    bash hooks/xdd-gate-coverage-check.sh 2>&1 | grep '❌' | tee -a "$REPORT" || true
    [[ $stub_rc -ne 0 ]] && echo "❌ stub 闸门失败 ($stub_rc)" | tee -a "$REPORT"

    echo "" | tee -a "$REPORT"
    echo "--- 等修代码 (iter $ITER) ---" | tee -a "$REPORT"
    echo "phase-executor 修: 补端点 / 写 e2e / 替换 mock / 删 stub / 加 chaos 兜底" | tee -a "$REPORT"
    echo "修完手动重跑此 loop" | tee -a "$REPORT"
done

# 3 试未过 → HALT
echo "" | tee -a "$REPORT"
echo "[xdd] ❌ 回环 3 失败: $MAX_ITER 试未过, 写 .xdd/gates/.xdd-halt.json" | tee -a "$REPORT"

# 实施 #17 (放水 3 修): 路径统一 .xdd/gates/.xdd-halt.json 跟 schema line 239 一致
HALT_PATH=".xdd/gates/.xdd-halt.json"
mkdir -p .xdd/gates

# 实施 #17 (放水 3 修): halt 时把 5 Execute 标 🚧 halted, 替代"✅⚠️ done with gaps"弱标签
update_stage_status "5 Execute" "🚧 halted" 2>/dev/null || true
echo "[xdd] 5 Execute → 🚧 halted (status.md 状态机硬替换)" | tee -a "$REPORT"

cat > "$HALT_PATH" <<EOF
{
  "phase": "5",
  "stage": "EXECUTE",
  "loop": "3-impl-verify",
  "attempts": $MAX_ITER,
  "halt_after_scale": $SCALE_HALT_AFTER,
  "reason": "6 闸门 $MAX_ITER 试未过",
  "last_log": "$REPORT",
  "suggested_retreat": "回 Phase 4 plan 重新规划 (RXX 映射错 / 端点清单漏)",
  "created_at": "$(date -Iseconds)"
}
EOF

echo "[xdd] $HALT_PATH 已写, 等用户决策" | tee -a "$REPORT"
exit 1
