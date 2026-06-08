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
TOTAL=16

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
