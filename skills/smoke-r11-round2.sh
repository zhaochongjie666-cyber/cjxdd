#!/usr/bin/env bash
# smoke-r11-round2.sh — 验证 P0-X Round 2 升级正确性 (16 项断言)
# 跟 smoke-scaffold-docker.sh 风格一致: 跑过即升级完成, exit 0 = 全 PASS
set -uo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$REPO_ROOT"

PASS=0
FAIL=0
section() { echo ""; echo "[$1] $2"; }
ok()   { echo "  PASS  $1"; PASS=$((PASS+1)); }
fail() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

# ───────── 1. runner 脚本存在且可执行 ─────────
section 1 "run-production-scenarios.sh"
[[ -f "$REPO_ROOT/skills/shadow-l6-deploy/scripts/run-production-scenarios.sh" ]] \
  && ok "1.a runner 脚本存在" || fail "1.a runner 脚本缺失"
[[ -x "$REPO_ROOT/skills/shadow-l6-deploy/scripts/run-production-scenarios.sh" ]] \
  && ok "1.b runner 脚本可执行" || fail "1.b runner 脚本无 +x 权限"
bash -n "$REPO_ROOT/skills/shadow-l6-deploy/scripts/run-production-scenarios.sh" 2>/dev/null \
  && ok "1.c runner 脚本 bash 语法 OK" || fail "1.c runner 脚本 bash 语法错"
grep -q "E2E_USER_ENGINEER" "$REPO_ROOT/skills/shadow-l6-deploy/scripts/run-production-scenarios.sh" \
  && ok "1.d runner 校验真实账号 env" || fail "1.d runner 缺真实账号 env 校验"
grep -q "prod-config-hash" "$REPO_ROOT/skills/shadow-l6-deploy/scripts/run-production-scenarios.sh" \
  && ok "1.e runner 写 prod-config-hash (L4 防复用)" || fail "1.e runner 缺 prod-config-hash"

# ───────── 2. gate R11 Round 2 升级 ─────────
section 2 "gate-check-lifecycle.sh R11 Round 2 升级"
GATE="$REPO_ROOT/skills/shadow-artifact-lifecycle/scripts/gate-check-lifecycle.sh"
grep -q "is_new_project" "$GATE" \
  && ok "2.a 含 is_new_project 分叉变量" || fail "2.a 缺 is_new_project"
grep -q "LIFECYCLE.md.*存在" "$GATE" \
  && ok "2.b 含 LIFECYCLE.md 缺席 = 老项目判定" || fail "2.b 缺 LIFECYCLE.md 判定"
grep -q "production-scenarios @production:" "$GATE" \
  && ok "2.c L2 内容正则 (L2 layer)" || fail "2.c 缺 L2 正则"
grep -q "summary.json" "$GATE" \
  && ok "2.d L3 evidence summary.json 校验" || fail "2.d 缺 L3 校验"
grep -q "prod-config-hash" "$GATE" \
  && ok "2.e L4 hash 校验 (防 marker 复用)" || fail "2.e 缺 L4 校验"
grep -q "R11 Round 2 硬门禁" "$GATE" \
  && ok "2.f 新项目硬门禁触发段" || fail "2.f 缺硬门禁触发"

# ───────── 3. R3 联动 prod-evidence ─────────
section 3 "R3 evidence_archive 联动 prod-evidence"
grep -q "prod-evidence" "$GATE" \
  && ok "3.a R3 find 模式含 prod-evidence" || fail "3.a R3 未联动 prod-evidence"

# ───────── 4. schema 登记 ─────────
section 4 "shadow-schema.json 登记 2 工件"
SCHEMA="$REPO_ROOT/skills/shadow-init/templates/shadow-schema.json"
if command -v jq >/dev/null 2>&1; then
  jq -e '.lifecycle_artifacts.artifacts[] | select(.id=="production-scenarios-config")' "$SCHEMA" >/dev/null 2>&1 \
    && ok "4.a production-scenarios-config 工件登记" || fail "4.a 缺 production-scenarios-config"
  jq -e '.lifecycle_artifacts.artifacts[] | select(.id=="production-scenarios-evidence")' "$SCHEMA" >/dev/null 2>&1 \
    && ok "4.b production-scenarios-evidence 工件登记" || fail "4.b 缺 production-scenarios-evidence"
else
  fail "4.a/4.b 跳 (jq 未装)"
fi

# ───────── 5. L2 端 ─────────
section 5 "L2 端 production-scenarios 框架"
L2_SKILL="$REPO_ROOT/skills/shadow-l2-e2e/SKILL.md"
grep -q "9\.1\.0" "$L2_SKILL" \
  && ok "5.a L2 SKILL.md version 升 9.1.0" || fail "5.a L2 SKILL.md version 未升"
grep -q "### 9\. 穷尽式生产场景" "$L2_SKILL" \
  && ok "5.b L2 SKILL.md 含 §9 穷尽式生产场景" || fail "5.b L2 SKILL.md 缺 §9"
[[ -f "$REPO_ROOT/skills/shadow-l2-e2e/templates/production-scenarios.md" ]] \
  && ok "5.c templates/production-scenarios.md 存在" || fail "5.c 缺 production-scenarios 模板"
[[ -f "$REPO_ROOT/skills/shadow-l2-e2e/references/production-scenario-contract.md" ]] \
  && ok "5.d references/production-scenario-contract.md 存在" || fail "5.d 缺 production-scenario-contract"
grep -q "check_production_scenarios" "$REPO_ROOT/skills/shadow-l2-e2e/scripts/check-e2e.sh" \
  && ok "5.e check-e2e.sh 含 check_production_scenarios" || fail "5.e check-e2e.sh 缺"

# ───────── 6. L6 端 ─────────
section 6 "L6 端 Phase 5.8"
L6_SKILL="$REPO_ROOT/skills/shadow-l6-deploy/SKILL.md"
grep -q "7\.4\.0" "$L6_SKILL" \
  && ok "6.a L6 SKILL.md version 升 7.4.0" || fail "6.a L6 SKILL.md version 未升"
grep -q "Phase 5\.8" "$L6_SKILL" \
  && ok "6.b L6 SKILL.md 含 Phase 5.8 段" || fail "6.b L6 SKILL.md 缺 Phase 5.8"
grep -q "Phase 5\.8" "$REPO_ROOT/skills/shadow-l6-deploy/references/phase-detail-7-9.md" \
  && ok "6.c phase-detail-7-9.md 含 Phase 5.8 详细" || fail "6.c 缺 Phase 5.8 详细"

# ───────── 7. 文档 ─────────
section 7 "CLAUDE.md + README 文档"
CLAUDE="$REPO_ROOT/CLAUDE.md"
grep -q "P0-X Round 2" "$CLAUDE" \
  && ok "7.a CLAUDE.md §9 标注 Round 2" || fail "7.a CLAUDE.md §9 未标 Round 2"
grep -q "新项目硬阻断" "$CLAUDE" \
  && ok "7.b CLAUDE.md §9 强调新项目硬阻断" || fail "7.b CLAUDE.md §9 未强调硬阻断"
grep -q "LIFECYCLE\.md 缺席" "$CLAUDE" \
  && ok "7.c CLAUDE.md §9 含零迁移策略" || fail "7.c 缺零迁移策略"
grep -q "穷尽式生产场景" "$REPO_ROOT/README.md" \
  && ok "7.d README.md 含穷尽式生产场景节" || fail "7.d README.md 缺"

# ───────── 8. 老/新项目分叉行为验证 ─────────
section 8 "老/新项目分叉行为 (端到端)"
TMPDIR_OLD=$(mktemp -d /tmp/r11-old-XXXXXX)
TMPDIR_NEW=$(mktemp -d /tmp/r11-new-XXXXXX)
trap "rm -rf $TMPDIR_OLD $TMPDIR_NEW" EXIT

# 8.a 老项目: 无 LIFECYCLE.md, 放任意 marker, 应 advisory exit 0
mkdir -p "$TMPDIR_OLD/.shadow/iterations/iter-1/L6-deploy/x"
touch "$TMPDIR_OLD/.shadow/iterations/iter-1/L6-deploy/x/smoke-test-passed"
# 注: set -o pipefail 会让子 shell 继承, 导致 bash 1 + grep 0 时子 shell 退出 1.
#      用临时 set +o pipefail 隔离.
set +o pipefail
( cd "$TMPDIR_OLD" && PROJECT_ROOT="$TMPDIR_OLD" bash "$GATE" 2>&1 | grep -E "R11 真实烟雾测试" >/dev/null )
ec_grep=$?
set -o pipefail
[[ "$ec_grep" -eq 0 ]] \
  && ok "8.a 老项目 advisory 输出" || fail "8.a 老项目未输出 advisory (ec_grep=$ec_grep)"
set +e
( cd "$TMPDIR_OLD" && PROJECT_ROOT="$TMPDIR_OLD" bash "$GATE" >/dev/null 2>&1 )
ec_old=$?
set -e
[[ "$ec_old" -eq 0 ]] \
  && ok "8.b 老项目 exit 0 (零破坏)" || fail "8.b 老项目 exit=$ec_old, 破坏零迁移"

# 8.b 新项目: 有 LIFECYCLE.md, 无 marker, 应 FAIL exit 1
mkdir -p "$TMPDIR_NEW/.shadow/iterations/iter-1/L6-deploy/x"
touch "$TMPDIR_NEW/.shadow/LIFECYCLE.md"
set +o pipefail
( cd "$TMPDIR_NEW" && PROJECT_ROOT="$TMPDIR_NEW" bash "$GATE" 2>&1 | grep -E "R11 真实烟雾测试: FAIL \(新项目无 L6-deploy marker" >/dev/null )
ec_grep=$?
set -o pipefail
[[ "$ec_grep" -eq 0 ]] \
  && ok "8.c 新项目无 marker → R11 FAIL 输出" || fail "8.c 新项目无 marker 未触发 FAIL (ec_grep=$ec_grep)"
set +e
( cd "$TMPDIR_NEW" && PROJECT_ROOT="$TMPDIR_NEW" bash "$GATE" >/dev/null 2>&1 )
ec=$?
set -e
[[ "$ec" -eq 1 ]] \
  && ok "8.d 新项目 exit 1 (硬门禁触发)" || fail "8.d 新项目 exit=$ec (预期 1)"

# 8.c 新项目: 有 LIFECYCLE.md, 有 Round 2 marker + evidence, 应 pass
mkdir -p "$TMPDIR_NEW/.shadow/iterations/iter-1/L6-deploy/x/prod-evidence"
echo "2026-06-07T10:00:00+00:00 | production-scenarios @production: 4 passed | prod-config-hash=deadbeef" \
  > "$TMPDIR_NEW/.shadow/iterations/iter-1/L6-deploy/x/smoke-test-passed"
echo "deadbeef" > "$TMPDIR_NEW/.shadow/iterations/iter-1/L6-deploy/x/prod-evidence/prod-config-hash.txt"
echo '{"passed":4,"failed":0}' > "$TMPDIR_NEW/.shadow/iterations/iter-1/L6-deploy/x/prod-evidence/summary.json"
# mtime < 7 天, 默认新文件; chmod 444 防 R3 抢先 FAIL
chmod 444 "$TMPDIR_NEW/.shadow/iterations/iter-1/L6-deploy/x/prod-evidence/"* \
       "$TMPDIR_NEW/.shadow/iterations/iter-1/L6-deploy/x/smoke-test-passed"
# 同时建 .r3_warn_count=0 防 R3 累计触发
echo 0 > "$TMPDIR_NEW/.shadow/.r3_warn_count"
set +o pipefail
( cd "$TMPDIR_NEW" && PROJECT_ROOT="$TMPDIR_NEW" bash "$GATE" 2>&1 | grep -E "R11 真实烟雾测试: pass" >/dev/null )
ec_grep=$?
set -o pipefail
[[ "$ec_grep" -eq 0 ]] \
  && ok "8.e 新项目完整 marker + evidence → R11 pass" || fail "8.e 新项目完整 marker 未通过 R11 (ec_grep=$ec_grep)"

# 8.d 新项目: marker 是 Round 1 形态 (pytest-style), 应 FAIL (L2 内容错)
TMPDIR_R1=$(mktemp -d /tmp/r11-r1-XXXXXX)
mkdir -p "$TMPDIR_R1/.shadow/iterations/iter-1/L6-deploy/x"
echo "2026-06-07T10:00:00+00:00 | 69/69 pytest PASS" > "$TMPDIR_R1/.shadow/iterations/iter-1/L6-deploy/x/smoke-test-passed"
touch "$TMPDIR_R1/.shadow/LIFECYCLE.md"
set +e
( cd "$TMPDIR_R1" && PROJECT_ROOT="$TMPDIR_R1" bash "$GATE" >/dev/null 2>&1 )
ec_r1=$?
set -e
[[ "$ec_r1" -eq 1 ]] \
  && ok "8.f 新项目 Round 1 marker (pytest) → exit 1 (硬阻断)" || fail "8.f Round 1 marker 未被拒, exit=$ec_r1"
rm -rf "$TMPDIR_R1"

# ───────── 9. 总结 ─────────
echo ""
echo "=== 总结: $PASS PASS, $FAIL FAIL ==="
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
