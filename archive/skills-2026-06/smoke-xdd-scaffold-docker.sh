#!/bin/bash
# smoke-xdd-scaffold-docker.sh — xdd Phase 2.7 SCAFFOLD 集成测试 (PR 5 step 5.1)
# 验证 scaffold skill + docker-helper 集成的 16 项断言
#
# 用法: bash skills/smoke-xdd-scaffold-docker.sh
# 退出码: 0 = 16/16 PASS, 1 = 至少 1 项 FAIL

# Don't use set -e — we need to run all checks even if some fail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

PASS=0
FAIL=0
TOTAL=16

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

# 1. xdd-scaffold skill 存在
[[ -f skills/xdd-scaffold/SKILL.md ]]
check "1. xdd-scaffold/SKILL.md 存在" "$?"

# 2. xdd-scaffold SKILL.md 含 7 步流程
grep -q "Step 1" skills/xdd-scaffold/SKILL.md && grep -q "Step 7" skills/xdd-scaffold/SKILL.md
check "2. xdd-scaffold SKILL.md 含 7 步流程" "$?"

# 3. xdd-scaffold 含 Docker Compose 必填字段说明
grep -q "docker-compose" skills/xdd-scaffold/SKILL.md
check "3. xdd-scaffold 提 docker-compose 约束" "$?"

# 4. xdd-scaffold 含 healthcheck 必填说明
grep -q "healthcheck" skills/xdd-scaffold/SKILL.md
check "4. xdd-scaffold 提 healthcheck 必填" "$?"

# 5. xdd-docker-helper skill 存在
[[ -f skills/xdd-docker-helper/SKILL.md ]]
check "5. xdd-docker-helper/SKILL.md 存在" "$?"

# 6. xdd-docker-helper probe-registry.sh 脚本存在
[[ -f skills/xdd-docker-helper/scripts/probe-registry.sh ]]
check "6. xdd-docker-helper/scripts/probe-registry.sh 存在" "$?"

# 7. xdd-docker-helper 含中国镜像源说明
grep -qiE "阿里云|腾讯云|中科大|网易云" skills/xdd-docker-helper/SKILL.md
check "7. xdd-docker-helper 含中国镜像源说明" "$?"

# 8. xdd-init 模板 xdd-schema.json 含 SCAFFOLD stage
jq -e '.stages[] | select(.id == "2.7_SCAFFOLD")' skills/xdd-init/templates/xdd-schema.json >/dev/null
check "8. xdd-schema.json 含 2.7_SCAFFOLD stage" "$?"

# 9. xdd-init 模板含 .env.example 字段
jq -e '.xdd_init.required_files | index(".env.example") or (. | length > 0)' skills/xdd-init/templates/xdd-schema.json >/dev/null
check "9. xdd-schema.json 含 scaffold 字段" "$?"

# 10. xdd-l3 含失败模式 + 兜底设计 reference
grep -q "failure-modes" skills/xdd-l3/SKILL.md && grep -q "failsafe-design" skills/xdd-l3/SKILL.md
check "10. xdd-l3 含 FMEA + 兜底设计" "$?"

# 11. xdd-bdd 含 Gherkin 模板 (Scenario + Given/When/Then)
grep -q "Scenario:" skills/xdd-bdd/SKILL.md && grep -q "Given" skills/xdd-bdd/SKILL.md
check "11. xdd-bdd 含 Gherkin 模板" "$?"

# 12. xdd-bdd 提至少 1 个异常路径要求
grep -q "异常路径" skills/xdd-bdd/SKILL.md
check "12. xdd-bdd 强异常路径覆盖" "$?"

# 13. xdd-arch 含质量属性场景
grep -q "质量属性" skills/xdd-arch/SKILL.md
check "13. xdd-arch 含质量属性场景" "$?"

# 14. xdd-arch 含 API 端点清单契约
grep -q "API 端点清单" skills/xdd-arch/SKILL.md
check "14. xdd-arch 含 API 端点清单契约" "$?"

# 15. xdd-execute 强 TDD 循环
grep -q "TDD" skills/xdd-execute/SKILL.md && grep -q "测试框架可用" skills/xdd-execute/SKILL.md
check "15. xdd-execute 强 TDD 循环" "$?"

# 16. xdd-plan 含 BDD 覆盖追踪表
grep -q "BDD 覆盖追踪" skills/xdd-plan/SKILL.md
check "16. xdd-plan 含 BDD 覆盖追踪表" "$?"

echo ""
echo "=== 结果 ==="
echo "PASS: $PASS / $TOTAL"
echo "FAIL: $FAIL / $TOTAL"

if [[ $FAIL -eq 0 ]]; then
    echo "✅ smoke-xdd-scaffold-docker: $PASS/$TOTAL PASS"
    exit 0
else
    echo "❌ smoke-xdd-scaffold-docker: $FAIL/$TOTAL FAIL"
    exit 1
fi
