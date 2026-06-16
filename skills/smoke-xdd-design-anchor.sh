#!/usr/bin/env bash
# smoke-xdd-design-anchor.sh — 验证 xdd 深度重构后的三层骨架 + 平台中立
# 跑: bash skills/smoke-xdd-design-anchor.sh
# 全过 = 重构没破坏核心约束。check() 约定: 0 = PASS。

set -uo pipefail
PASS=0; FAIL=0; TOTAL=0
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

check() {  # check "描述" <exit>  其中 0 = PASS
  TOTAL=$((TOTAL+1))
  if [ "$2" = 0 ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "  ❌ $1"; fi
}

echo "=== xdd 三层骨架 smoke ==="

# 1. 17 skill 存在
miss=0
for s in xdd-init xdd-understand xdd-spec xdd-architecture xdd-wire xdd-resilience xdd-plan xdd-execute xdd-backend xdd-frontend xdd-verify xdd-reverse xdd-mermaid-check xdd-docker-helper xdd-skill-creator xdd-gherkin-plus xdd-git-commit; do
  [ -f "skills/$s/SKILL.md" ] || { echo "  缺 skill: $s"; miss=1; }
done
n=$(ls -d skills/*/ 2>/dev/null | wc -l)
{ [ "$n" -eq 17 ] && [ "$miss" = 0 ]; }; check "1. 正好 17 个 skill (实际 $n)" "$?"

# 2. 8 agent 存在
miss=0
for a in xdd-walker xdd-orchestrator phase-understand phase-design phase-resilience phase-plan phase-build phase-verify; do
  [ -f "agents/$a.md" ] || { echo "  缺 agent: $a"; miss=1; }
done
n=$(ls agents/*.md 2>/dev/null | wc -l)
{ [ "$n" -eq 8 ] && [ "$miss" = 0 ]; }; check "2. 正好 8 个 agent (实际 $n)" "$?"

# 3. SKILL.md 全 <500 行
over=0
for f in skills/*/SKILL.md; do
  lines=$(wc -l < "$f")
  [ "$lines" -ge 500 ] && { echo "  $f = $lines 行 (≥500)"; over=1; }
done
check "3. 所有 SKILL.md < 500 行" "$over"

# 4. 🔥 零平台耦合 (排除 smoke 脚本自身 + archive)
coupling=$(grep -rIl 'xdd-gate\|hooks/xdd\|plugins/' agents/ skills/ 2>/dev/null \
  | grep -v '/archive/' | grep -v 'smoke-xdd' | wc -l)
check "4. 零平台耦合 (agents/+skills/ 无 xdd-gate/hooks/plugins, 实际 $coupling)" "$coupling"

# 5. 旧 .xdd 结构零残留 (排除 smoke + 解释性"砍掉/不再"文字 + archive)
residue=$(grep -rIn '\.xdd/baseline\|\.xdd/scale\.md\|xdd-schema\.json\|\.xdd/gates\|iterations/iter\|\.xdd-halt' agents/ skills/ 2>/dev/null \
  | grep -v '/archive/' | grep -v 'smoke-xdd' | grep -vE '砍掉|不再|无 hook|无 5-marker|无闸门' | wc -l)
check "5. 零旧 .xdd 结构残留 (实际 $residue)" "$residue"

# 6. 平台层已归档
{ [ ! -d hooks ] && [ ! -d plugins ] && [ ! -d commands ]; }; check "6. hooks/plugins/commands 已移出仓库根" "$?"

# 7. 每个 skill 有 name frontmatter
badname=0
for f in skills/*/SKILL.md; do
  grep -q '^name:' "$f" || { echo "  $f 缺 name"; badname=1; }
done
check "7. 每个 SKILL.md 有 name frontmatter" "$badname"

# 8. walker/orchestrator 不声明 tools 字段
tools=$(grep -c '^tools:' agents/xdd-walker.md agents/xdd-orchestrator.md 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')
check "8. walker/orchestrator 不声明 tools 字段 (实际 $tools)" "$tools"

# 9. init.sh 生成正确结构 (check 约定 0=PASS, 所以 missing=1 表失败)
rm -rf /tmp/xdd-smoke-init && mkdir -p /tmp/xdd-smoke-init && cd /tmp/xdd-smoke-init
bash "$ROOT/skills/xdd-init/scripts/init.sh" >/dev/null 2>&1
missing=0
for p in .xdd/design/spec .xdd/design/architecture .xdd/design/wire .xdd/design/notes \
         .xdd/design/intent.md .xdd/design/design.md \
         .xdd/runs/iter-1/status.md .xdd/runs/iter-1/plan .xdd/runs/iter-1/audits \
         .xdd/current-iteration .xdd/WORKFLOW.md; do
  [ -e "$p" ] || { echo "  init 漏: $p"; missing=1; }
done
check "9. init.sh 生成 design/(含 notes) + runs/iter-1/(status/plan/audits) + current-iteration + WORKFLOW.md" "$missing"
cd "$ROOT"

# 10. no-stub-check.sh bash 语法正确
bash -n skills/xdd-execute/scripts/no-stub-check.sh 2>/dev/null; check "10. no-stub-check.sh bash 语法正确" "$?"

# 11. 通用 install.sh 存在
[ -f install.sh ]; check "11. 通用 install.sh 存在" "$?"

# 12. install.sh 不软链 hooks/plugins/commands/settings (查 ln -s 行, 非解释文字)
badlink=$(grep -E 'ln -s' install.sh 2>/dev/null | grep -cE 'hooks|plugins|commands|settings' || true)
badlink=${badlink:-0}
check "12. install.sh 不软链 hooks/plugins/commands/settings (坏软链行 $badlink)" "$badlink"

# 13. 追溯锚贯穿链 (check 0=PASS, miss=1 表失败)
miss=0
grep -q 'intent' skills/xdd-understand/SKILL.md || miss=1
grep -q 'RXX' skills/xdd-spec/SKILL.md || miss=1
grep -q '@implements RXX' skills/xdd-execute/SKILL.md || miss=1
grep -q 'plan' skills/xdd-plan/SKILL.md || miss=1
check "13. 追溯锚贯穿链 (understand.intent → spec.RXX → plan → execute.@implements)" "$miss"

echo
if [ "$FAIL" -eq 0 ]; then
  echo "✅ smoke-xdd-design-anchor: $PASS/$TOTAL PASS"
  exit 0
else
  echo "❌ smoke-xdd-design-anchor: $FAIL/$TOTAL FAIL"
  exit 1
fi
