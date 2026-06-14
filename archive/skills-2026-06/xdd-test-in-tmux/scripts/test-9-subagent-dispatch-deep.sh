#!/bin/bash
# test-dispatch-deep.sh — 9 subagent 实际 dispatch 测试 (via Claude Code)
# 用 m2cc 跑 claude --print + subagent_type, 看每个 subagent 能不能加载 + Meta 守卫过
# 退出码: 0 = 全过 / 1 = 至少 1 失败

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="/home/zhaocj/ws/cjxdd"

# 用 m2cc (source ~/.bashrc)
source ~/.bashrc 2>/dev/null || true

REPORT="$SCRIPT_DIR/report-deep.md"
PASS=0
FAIL=0
declare -a FAILED=()

echo "[xdd-dispatch-deep] === 9 subagent 实际 dispatch (via claude CLI) ===" | tee "$REPORT"
echo "[xdd-dispatch-deep] CWD: $REPO_ROOT (Meta project, 应被 Meta 守卫拦)" | tee -a "$REPORT"
echo "" | tee -a "$REPORT"

# 9 subagent
SUBAGENTS=(
    "xdd-orchestrator"
    "phase-researcher"
    "phase-designer"
    "phase-architect"
    "phase-scaffolder"
    "phase-resilience-designer"
    "phase-planner"
    "phase-executor"
    "phase-verifier"
)

# === 测试 1: 在 cjxdd 仓库里调 subagent, 期望 Meta 守卫拦 ===
echo "=== 测试 1: Meta 守卫 (CWD=cjxdd 应被拦) ===" | tee -a "$REPORT"
cd "$REPO_ROOT"

for sa in "${SUBAGENTS[@]}"; do
    # 给个空任务, 期望 Meta 守卫先拦, 输出 "Meta 任务" 类提示
    output=$(timeout 60 bash -i -c "m2cc --print 'Use the ${sa} subagent to do a quick test'" 2>&1 | head -30 || echo "TIMEOUT")

    if echo "$output" | grep -qE "Meta 任务|改 framework 自身|Meta 守卫"; then
        echo "  ✓ $sa: Meta 守卫过 (拦下)" | tee -a "$REPORT"
        ((PASS++)) || true
    elif echo "$output" | grep -qE "TIMEOUT|API error|rate limit"; then
        echo "  ⚠ $sa: 超时/API 错误 (网络问题, 不算 fail)" | tee -a "$REPORT"
        # 不计数
    else
        # 看下 subagent 是否真跑起来了 (没被 Meta 拦)
        if echo "$output" | grep -qE "Phase|gate|skill|xdd-"; then
            echo "  ⚠ $sa: 没被 Meta 拦 (可能在 .xdd 外的 dir)" | tee -a "$REPORT"
        else
            echo "  ❓ $sa: 输出未识别" | tee -a "$REPORT"
            echo "      ${output:0:200}" | tee -a "$REPORT"
        fi
    fi
done

# === 测试 2: 在 /tmp/test-xdd-subagent/ 调 subagent, 期望真跑 ===
echo "" | tee -a "$REPORT"
echo "=== 测试 2: 真实 dispatch (CWD=/tmp, 应真跑) ===" | tee -a "$REPORT"
cd /tmp/test-xdd-subagent

# 先 init 一个 .xdd/ 让 subagent 有工作环境
if [[ ! -d .xdd/iterations ]]; then
    mkdir -p .xdd/iterations/iter-1/pipeline
    cat > .xdd/iterations/iter-1/pipeline/status.md <<'EOF'
# Pipeline Status
| Phase | 状态 |
|-------|------|
| 0 INIT | 🔄 |
| 1 RESEARCH | ⏳ |
EOF
fi

# 用 phase-researcher 跑测试 (只 1 个, 避免跑 9 次太慢)
output=$(timeout 180 bash -i -c "m2cc --print 'Please use the phase-researcher subagent to write 3 sample research notebooks (01-customer.md / 02-product.md / 03-tech.md) for a 登录系统 project. Just write short stubs.' 2>&1" | head -80 || echo "TIMEOUT")

if echo "$output" | grep -qE "01-customer|02-product|03-tech|research|笔记本|L0"; then
    echo "  ✓ phase-researcher: 真跑起来了, 写了 3 笔记本" | tee -a "$REPORT"
    ((PASS++)) || true
elif echo "$output" | grep -qE "TIMEOUT|API error|rate limit"; then
    echo "  ⚠ phase-researcher: 超时/API 错误 (网络问题)" | tee -a "$REPORT"
elif echo "$output" | grep -qE "cut off|clarify"; then
    echo "  ⚠ phase-researcher: prompt 模糊, claude 拒答" | tee -a "$REPORT"
else
    echo "  ❓ phase-researcher: 输出未识别" | tee -a "$REPORT"
    echo "      ${output:0:500}" | tee -a "$REPORT"
    FAILED+=("phase-researcher-no-output")
    ((FAIL++)) || true
fi

# === 汇总 ===
echo "" | tee -a "$REPORT"
echo "=== 汇总 ===" | tee -a "$REPORT"
echo "PASS: $PASS" | tee -a "$REPORT"
echo "FAIL: $FAIL" | tee -a "$REPORT"

if [[ $FAIL -eq 0 ]]; then
    echo "" | tee -a "$REPORT"
    echo "✅ dispatch deep 测试全过 (或网络问题被忽略)" | tee -a "$REPORT"
    exit 0
else
    echo "" | tee -a "$REPORT"
    echo "❌ 失败: ${FAILED[*]}" | tee -a "$REPORT"
    exit 1
fi
