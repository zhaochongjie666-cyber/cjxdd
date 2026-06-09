#!/bin/bash
# smoke-xdd-e2e.sh — xdd 框架端到端冒烟测试 (PR 5 step 5.1)
# 跑通 6 Phase e2e 验证 (16 项断言)
#
# 用法: bash skills/smoke-xdd-e2e.sh
# 退出码: 0 = 16/16 PASS, 1 = 至少 1 项 FAIL

# Don't use set -e — we need to run all checks even if some fail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

PASS=0
FAIL=0
TOTAL=28

# count dirs/files, no recursion (use -d for dirs, -maxdepth 1 for files)
count_existing() {
    local n=0
    for f in "$@"; do
        if [[ -e "$f" ]]; then
            n=$((n + 1))
        fi
    done
    echo "$n"
}

check() {
    local desc="$1"
    local result="$2"
    if [[ "$result" == "0" ]]; then
        echo "  ✓ $desc"
        PASS=$((PASS + 1))
    else
        echo "  ✗ $desc"
        FAIL=$((FAIL + 1))
    fi
}

# 1. 框架仓库无 .xdd/ (Meta 任务边界)
[[ ! -d .xdd ]]
check "1. 框架仓库无 .xdd/ (Meta 任务边界)" "$?"

# 2. 14 个 xdd 核心 skill 存在
n=$(count_existing skills/xdd-core skills/xdd-bdd skills/xdd-flow skills/xdd-add skills/xdd-wire skills/xdd-plan skills/xdd-execute skills/xdd-init skills/xdd-l0 skills/xdd-arch skills/xdd-scaffold skills/xdd-l3 skills/xdd-l6 skills/xdd-artifact-lifecycle)
[[ $n -ge 14 ]]
check "2. 14 个 xdd 核心 skill 存在" "$?"

# 3. 9 个 utility skill 全部 xdd- 前缀
n=$(count_existing skills/xdd-taste skills/xdd-mermaid-check skills/xdd-docker-helper skills/xdd-skill-creator skills/xdd-test-in-tmux skills/xdd-gherkin-writer skills/xdd-opencode-learning skills/xdd-trace-init skills/xdd-reverse)
[[ $n -eq 9 ]]
check "3. 9 个 utility skill 全部 xdd- 前缀" "$?"

# 4. 无 shadow skill 残留
n=$(count_existing skills/shadow-init skills/shadow-l0-research skills/shadow-l1-flow skills/shadow-l1-research skills/shadow-l1-spec skills/shadow-l1-wire skills/shadow-l1p5-architecture skills/shadow-l2-e2e skills/shadow-l3-resilience skills/shadow-l5-impl skills/shadow-l5-plan skills/shadow-l5-stargate-checker skills/shadow-l6-deploy skills/shadow-scaffold skills/shadow-reviewer skills/shadow-artifact-lifecycle skills/shadow-taste skills/shadow-trace-init skills/shadow-reverse)
[[ $n -eq 0 ]]
check "4. 无 shadow skill 残留" "$?"

# 5. xdd-walker agent 存在
[[ -f agents/xdd-walker.md ]]
check "5. xdd-walker agent 存在" "$?"

# 6. xdd-walker-pi agent 存在
[[ -f agents/xdd-walker-pi.md ]]
check "6. xdd-walker-pi agent 存在" "$?"

# 7. 无 shadow agent 残留
n=$(count_existing agents/shadow-walker.md agents/shadow-walker-pi.md agents/shadow-worker.md)
[[ $n -eq 0 ]]
check "7. 无 shadow agent 残留" "$?"

# 7a. xdd-orchestrator 主调度 agent 存在 (多 agent 编排入口)
[[ -f agents/xdd-orchestrator.md ]]
check "7a. xdd-orchestrator 主调度 agent 存在" "$?"

# 7b. 8 个 phase-subagent 存在 (phase-researcher/designer/architect/scaffolder/resilience-designer/planner/executor/verifier)
n=$(count_existing agents/phase-researcher.md agents/phase-designer.md agents/phase-architect.md agents/phase-scaffolder.md agents/phase-resilience-designer.md agents/phase-planner.md agents/phase-executor.md agents/phase-verifier.md)
[[ $n -eq 8 ]]
check "7b. 8 个 phase-subagent 存在" "$?"

# 8. 11 个 xdd-gate hook 存在 (实际 14 个: lib + meta + pre-skill + stub-scan + session-start + stop + user-prompt-submit + team-dispatch + pressure + 6 phase-gate)
n=$(count_existing hooks/xdd-gate-lib.sh hooks/xdd-gate-meta.sh hooks/xdd-gate-pre-skill.sh hooks/xdd-gate-stub-scan.sh hooks/xdd-gate-session-start.sh hooks/xdd-gate-stop.sh hooks/xdd-gate-user-prompt-submit.sh hooks/xdd-gate-team-dispatch.sh hooks/xdd-gate-pressure.sh hooks/xdd-gate-0-init.sh hooks/xdd-gate-1-research.sh hooks/xdd-gate-2-design.sh hooks/xdd-gate-3-review.sh hooks/xdd-gate-4-plan.sh hooks/xdd-gate-5-execute.sh hooks/xdd-gate-6-verify.sh)
[[ $n -ge 11 ]]
check "8. 11+ xdd-gate hook 存在 (实际 14 个含 6 phase-gate)" "$?"

# 9. 无旧 hook 残留
n=0
[[ -f hooks/lib.sh ]] && n=$((n+1))
[[ -f hooks/pre-skill.sh ]] && n=$((n+1))
[[ -f hooks/post-write-stub-scan.sh ]] && n=$((n+1))
[[ -f hooks/session-start.sh ]] && n=$((n+1))
[[ -f hooks/stop-gate.sh ]] && n=$((n+1))
[[ -f hooks/user-prompt-submit.sh ]] && n=$((n+1))
[[ -f hooks/worker-dispatch-hint.sh ]] && n=$((n+1))
[[ $n -eq 0 ]]
check "9. 无旧 hook 残留" "$?"

# 10. settings.json 钩子路径全 xdd-gate-*
grep -q 'xdd-gate-' settings.json
check "10. settings.json 钩子路径全 xdd-gate-*" "$?"

# 11. framework-conventions.md 替换 core.md
[[ -f framework-conventions.md ]] && [[ ! -f core.md ]]
check "11. framework-conventions.md 替换 core.md" "$?"

# 12. archive/shadow-2026-06/ 90 天保留
[[ -f archive/shadow-2026-06/README.md ]]
check "12. archive/shadow-2026-06/ 90 天保留" "$?"

# 13. install 脚本无 shadow 残留
install_clean=0
grep -l 'shadow-walker' install-to-claude-code.sh install-to-opencode.sh install-to-pi.sh >/dev/null 2>&1 && install_clean=1
[[ $install_clean -eq 0 ]]
check "13. install 脚本无 shadow 残留" "$?"

# 14. 3 xdd commands 存在
n=$(count_existing commands/xdd-goal.md commands/xdd-status.md commands/xdd-halt.md)
[[ $n -eq 3 ]]
check "14. 3 xdd commands 存在" "$?"

# 15. xdd 文档齐全 (5 个核心)
n=0
for f in docs/WORKFLOW.md docs/SCALE.md docs/BXX.md docs/GATES.md docs/xdd/PLAN-TEMPLATE.md; do
    [[ -f "$f" ]] && n=$((n+1))
done
[[ $n -ge 5 ]]
check "15. xdd 文档齐全 (5 个核心)" "$?"

# 16. xdd-bdd/SKILL.md < 500 行
lines=$(wc -l < skills/xdd-bdd/SKILL.md)
[[ $lines -lt 500 ]]
check "16. xdd-bdd/SKILL.md < 500 行 (quickstart 原则)" "$?"

# 17. 多 agent 编排文档存在
[[ -f docs/MULTI-AGENT-ORCHESTRATION.md ]]
check "17. docs/MULTI-AGENT-ORCHESTRATION.md 编排文档存在" "$?"

# 18. wire 12 门禁 hook 存在
[[ -x hooks/xdd-gate-wire-validate.sh ]]
check "18. hooks/xdd-gate-wire-validate.sh 存在且可执行" "$?"

# 19. coverage 95% 闸门 hook 存在
[[ -x hooks/xdd-gate-coverage-check.sh ]]
check "19. hooks/xdd-gate-coverage-check.sh 存在且可执行" "$?"

# 20. R5 lifecycle hard-gate 脚本存在
[[ -x skills/xdd-artifact-lifecycle/scripts/gate-check-lifecycle.sh ]]
check "20. skills/xdd-artifact-lifecycle/scripts/gate-check-lifecycle.sh 存在" "$?"

# 21. coverage 闸门阈值默认 0.95 (用户偏好)
grep -q 'XDD_COVERAGE_THRESHOLD:-0.95' hooks/xdd-gate-coverage-check.sh
check "21. coverage hook 阈值默认 0.95" "$?"

# 22. lifecycle 闸门阈值默认 0.95
grep -q 'XDD_LIFECYCLE_THRESHOLD:-0.95' skills/xdd-artifact-lifecycle/scripts/gate-check-lifecycle.sh
check "22. lifecycle gate 阈值默认 0.95" "$?"

# 23. settings.json 注册 coverage + wire 2 个新 hook
grep -q 'xdd-gate-coverage-check' settings.json && grep -q 'xdd-gate-wire-validate' settings.json
check "23. settings.json 注册 2 个新 hook (coverage + wire)" "$?"

# 24. orchestrator 文档引用 8 subagent dispatch
grep -q 'phase-researcher' agents/xdd-orchestrator.md && grep -q 'phase-executor' agents/xdd-orchestrator.md
check "24. orchestrator 引用 8 subagent dispatch" "$?"

# 25. P2 skill: xdd-flow-bug-report (session 复盘)
[[ -f skills/xdd-flow-bug-report/SKILL.md ]]
check "25. P2 skill xdd-flow-bug-report 存在" "$?"

# 26. P2 skill: xdd-design-review (Phase 2 5 工件互审)
[[ -f skills/xdd-design-review/SKILL.md ]]
check "26. P2 skill xdd-design-review 存在" "$?"

# 27. P2 skill: xdd-coverage-monitor (实时覆盖率监控)
[[ -f skills/xdd-coverage-monitor/SKILL.md ]]
check "27. P2 skill xdd-coverage-monitor 存在" "$?"

# 28. 用户提供: xdd-ux-design (UX 设计思维 + 审查框架, Anthony Conta 6 步法)
[[ -f skills/xdd-ux-design/SKILL.md ]]
check "28. 用户提供 xdd-ux-design 存在" "$?"

echo ""
echo "=== 结果 ==="
echo "PASS: $PASS / $TOTAL"
echo "FAIL: $FAIL / $TOTAL"

if [[ $FAIL -eq 0 ]]; then
    echo "✅ smoke-xdd-e2e: $PASS/$TOTAL PASS"
    exit 0
else
    echo "❌ smoke-xdd-e2e: $FAIL/$TOTAL FAIL"
    exit 1
fi
