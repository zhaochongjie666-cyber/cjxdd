# xdd 多层级回环设计 (Multi-Level Loop Architecture)

**目的**: 整套 xdd 体系 = 4 层回环嵌套, 任何层失败都自动 retry, 直到闸门全过.

**session c3692b46 教训**: walker 跑流程, 但**没有回环** — 一遇到 12 门禁失败就写"基本完成", 没有 loop 回到修的阶段. 失败没有 retry 机制 → 38% 完成, DEPLOY_PASS 蒙混.

**核心原则**: **失败 → 自动回到上一阶段 → 修 → 再尝试 → 全过才进下一层**. 没有"基本通过", 没有"先 commit 后修".

---

## 4 层回环架构

```
L4 跨周期: iter-N → iter-N+1 (周回环, 反馈累积)
↑
L3 流水线: 6 Phase 大回环 (Phase 0→1→...→6, 阶段出口闸门)
↑
L2 Phase 内: 已知失败驱动 (设计评审/实施-验证/韧性 3 种中回环)
↑
L1 Task 内: TDD 红绿重构 (3 步小回环)
```

**嵌套规则**: 内层失败 → **不进外层**. 任何 1 层不通过 → 整层 retry, 不允许"先过再说".

---

## 7 种回环详细

### 回环 1: 12 门禁 + 4 层 UX (Phase 2 wire SVG)

**触发**: 写完 wire SVG
**退出**: 双闸门全过 (wire_rc=0 AND ux_rc=0)
**闸门**: `xdd-gate-wire-validate` (技术 12 门禁) + `xdd-gate-ux-check` (4 层 UX)
**升级条件**: 3 试未过 → HALT, 回退到 Phase 2.5 (arch) 重新审计

```bash
while true; do
    bash hooks/xdd-gate-wire-validate.sh; wire_rc=$?
    bash hooks/xdd-gate-ux-check.sh; ux_rc=$?
    if [[ $wire_rc -eq 0 && $ux_rc -eq 0 ]]; then break; fi
    修 SVG
done
```

**对应 subagent**: `phase-designer`
**对应 skill**: `xdd-wire` (Loop-Until-Pass 段) + `xdd-ux-design` (§ 3 4 层审查)

---

### 回环 2: 设计评审 (Phase 2 5 工件互审)

**触发**: Phase 2 5 工件 (bdd/flow/add/wire/arch) 写完
**退出**: ≥ 10 互审发现全部修复, RXX 编号 1 致, BXX 全覆盖
**闸门**: `xdd-design-review` (5 视角 × 5 工件 = 25 项检查) + RXX 编号 grep
**升级条件**: 5 工件脱节 ≥ 3 处 → 回退重写整 phase

```bash
while true; do
    bash skills/xdd-design-review/scripts/review.sh 2>&1 | tee /tmp/review-$$.log
    findings=$(grep -c '^🚨' /tmp/review-$$.log)
    if [[ $findings -eq 0 ]]; then break; fi
    修脱节处 (RXX/BXX/端点)
done
```

**对应 subagent**: `phase-designer` (互审) → `phase-architect` (修端点)
**对应 skill**: `xdd-design-review` + `xdd-bdd` (RXX 1 致)

---

### 回环 3: 实施-验证 (Phase 5 核心)

**触发**: Phase 5 实施任一 Task
**退出**: 6 闸门全过 (BDD 95% / API 95% / e2e 95% / 持久化 95% / 跨服务 95% / stub 0)
**闸门**: `xdd-gate-coverage-check` (5 维) + `xdd-gate-stub-scan` (1 维)
**升级条件**: 同一 RXX 缺实施 3 试未过 → HALT, 回退 Phase 4 (plan) 重新规划

```bash
while true; do
    # 闸门 1-5 覆盖率
    bash hooks/xdd-gate-coverage-check.sh; coverage_rc=$?
    # 闸门 6 stub 0 容忍
    bash hooks/xdd-gate-stub-scan.sh; stub_rc=$?
    if [[ $coverage_rc -eq 0 && $stub_rc -eq 0 ]]; then break; fi
    # 找失败维度
    bash hooks/xdd-gate-coverage-check.sh 2>&1 | grep '❌'
    # 修: 补端点 / 写 e2e / 替换 mock / 删 stub
done
```

**对应 subagent**: `phase-executor`
**对应 skill**: `xdd-execute` (TDD 循环 + 闸门 6 道) + `xdd-l6` (部署验证)

---

### 回环 4: 6 Phase 流水线 (Phase 0→6 大回环)

**触发**: orchestrator 接任务
**退出**: 6 个 phase gate 全过
**闸门**: `xdd-gate-{0-init,1-research,2-design,3-review,4-plan,5-execute,6-verify}.sh`
**升级条件**: 任一 phase gate 3 试未过 → 写 `.xdd-halt.json`, 问用户

```bash
while true; do
    bash hooks/xdd-gate-6-verify.sh
    if [[ $? -eq 0 ]]; then break; fi
    # 找出失败的 phase, 派对应 subagent 修
    bash hooks/xdd-gate-stop.sh 2>&1 | grep '❌' | head -1
done
```

**对应 subagent**: `xdd-orchestrator` (主调度)
**对应 hook**: 7 个 phase gate

---

### 回环 5: iter 反馈 (跨周回环)

**触发**: iter-N 完成 (Phase 6 ✅)
**退出**: iter-N+1 init 完成 + L0 笔记本刷新
**闸门**: 14 天 mtime freshness (L0 强制重做)
**升级条件**: iter-N 失败模式 → iter-N+1 优先修

```bash
# iter-N 收尾: 复制 .xdd-halt.json / .l5-unresolved.json 到 iter-N+1/.inherited/
# iter-N+1 init: 检查 inherited 列表, 优先修遗留 P0/P1
```

**对应 subagent**: 重新 init 后, `phase-researcher` 先看 inherited
**对应 hook**: `xdd-gate-1-research.sh` 14d freshness 门禁

---

### 回环 6: L3 韧性回环 (chaos → fail → 修 → chaos)

**触发**: Phase 3 resilience-test 跑 chaos 实验
**退出**: 所有 chaos 场景通过, SLO 满足
**闸门**: `chaos-scenarios.md` 列的 N 个实验全过
**升级条件**: 同一 SLO breach 3 试未过 → HALT

```bash
while true; do
    bash skills/xdd-l3/scripts/chaos-runner.sh 2>&1 | tee /tmp/chaos-$$.log
    passed=$(grep -c '✅' /tmp/chaos-$$.log)
    total=$(grep -cE '✅|❌' /tmp/chaos-$$.log)
    if [[ $passed -eq $total ]]; then break; fi
    # 找失败场景, 修 (调兜底模式 / 加 SLO / 改 runbook)
done
```

**对应 subagent**: `phase-resilience-designer`
**对应 skill**: `xdd-l3` (§ L3 韧性)

---

### 回环 7: L6 部署验证回环 (wander-test → fail → 修 → wander)

**触发**: Phase 6 wander-test 跑真实漫游
**退出**: Real Usability Contract + Production Acceptance Contract 全过
**闸门**: 4 维 L5 audit ≥ 90% + R11 4 层验证
**升级条件**: 同一契约失败 3 试未过 → 回 Phase 5 修

```bash
while true; do
    bash skills/xdd-l6/scripts/wander-test.sh 2>&1 | tee /tmp/wander-$$.log
    bash skills/xdd-l6/scripts/l5-audit.sh 2>&1 | tee /tmp/l5-$$.log
    if all_passed; then break; fi
    # 修 (补缺 RXX / 写 e2e / 修 endpoint)
done
```

**对应 subagent**: `phase-verifier`
**对应 skill**: `xdd-l6` (Verify)

---

## 嵌套规则

```
L1 Task 内 (TDD): 1 分钟内闭环
  ↓ 任一测试失败
L2 Phase 内: 1 小时内闭环
  ↓ 6 闸门失败
L3 Phase 间: 1 天内闭环
  ↓ 阶段 gate 失败 3 试
L4 跨 iter: 1 周内闭环
```

**禁止跳层**: L1 没通过不允许进 L2. L2 没通过不允许进 L3. 用 hook exit code 强制.

## 跟 8 subagent 对应

| Subagent | 主跑回环 |
|----------|---------|
| `phase-researcher` | 5 (L0 14d freshness) |
| `phase-designer` | 1 (12 门禁+UX) + 2 (5 工件互审) |
| `phase-architect` | 2 (端点清单 100%) |
| `phase-scaffolder` | (smoke 13 断言, 单次) |
| `phase-resilience-designer` | 6 (chaos 实验) |
| `phase-planner` | (17 项自检, 单次) |
| `phase-executor` | 3 (实施-验证 6 闸门) |
| `phase-verifier` | 7 (wander + L5) |
| **orchestrator** | 4 (6 Phase 流水线) + 协调所有内层 |

## 跟 6 道 95% 闸门对应

| 闸门 | 在哪个回环 |
|------|----------|
| BDD 覆盖率 95% | 回环 3 (实施-验证) + 回环 7 (L5 audit) |
| API 端点 95% | 回环 2 (5 工件) + 回环 3 (实施-验证) |
| e2e 95% | 回环 3 (实施-验证) |
| 真实持久化 95% | 回环 3 (实施-验证) |
| 跨服务 95% | 回环 3 (实施-验证) |
| 0 stub | 回环 3 (实施-验证) |

## session c3692b46 教训映射

| 失败 | 没跑的回环 |
|------|----------|
| wire 12 门禁 11 失败 | ❌ 回环 1 没跑 (单次跑过就声称完成) |
| RXX 编号脱节 | ❌ 回环 2 没跑 (5 工件没互审) |
| 60 端点 23 实施 (38%) | ❌ 回环 3 没跑 (没 6 闸门 95% 强制) |
| 2 stub 漏 | ❌ 回环 3 没跑 (没 0 stub 闸门) |
| DEPLOY_PASS 蒙混 | ❌ 回环 7 没跑 (没 wander-test 真验证) |
| Phase 0 一次性过 (没真调研) | ❌ 回环 5 没跑 (没 iter 反馈机制) |

**修法**: 7 种回环全部跑, 任何 1 个失败 → 自动 retry → 闸门全过才进下一层.

## 实施状态

| 回环 | 状态 | 实现位置 |
|------|------|---------|
| 1 (wire+UX) | ✅ | xdd-wire SKILL.md "Loop-Until-Pass" + 2 个 hook |
| 2 (设计评审) | ⏳ | xdd-design-review + 需加 RXX 1 致自动卡 |
| 3 (实施-验证) | ⏳ | xdd-execute + coverage-check + stub-scan (需写 loop 模板) |
| 4 (6 Phase 流水线) | ✅ | xdd-orchestrator + 7 个 phase gate |
| 5 (iter 反馈) | ⏳ | 需 .inherited/ 机制 |
| 6 (L3 chaos) | ⏳ | xdd-l3 chaos runner (待写) |
| 7 (L6 wander) | ⏳ | xdd-l6 wander-test (待写) |

**下步**: 实现回环 3 实施-验证 loop 模板 (写进 xdd-execute SKILL.md), 加 RXX 1 致自动卡到 xdd-design-review.

## 反模式

- ❌ "基本通过" (闸门没过但声称完成) — HALT
- ❌ "先 commit 后修" — 闸门失败 = 立即修
- ❌ "一次性跑过" — 必须 loop until pass
- ❌ "跳层" — L1 没进 L2 必失败
- ❌ "3 试后假装继续" — HALT 升级, 问用户
