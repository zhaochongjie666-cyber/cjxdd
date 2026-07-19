# Dynamic Plan：执行阶段 Grill 循环

> 本文件是本次任务的活计划。每完成一步立即更新状态和证据；实现与事实不符时先改计划，再继续执行。

## 目标

让 `xdd-execute` 在执行任务时持续维护原计划文件，并通过 Grill 自问同时攻击正向路径与兜底路径，而不是只在开始时读取一份静态计划。

## 计划

- [x] **P1 基线审计**：定位 plan 生成、执行、build agent 与 verify gate 的现有约束。
  - 证据：`xdd-plan` 已定义 checkbox 状态；`xdd-execute` 只零散要求更新 step，缺少事实变化后的重规划协议。
- [x] **P2 协议设计**：定义单一事实源、更新时机、Grill 问题、变更边界和恢复规则。
  - Grill：是否会鼓励执行者偷偷改变需求？否；结构性变化仍须回炉到 plan/design，执行者只记录事实与提出重规划。
- [x] **P3 落地实现**：同步修改 plan 模板、execute skill 与 phase-build agent。
  - 证据：三处均声明唯一动态计划、即时写证据、Grill 与结构性回炉边界。
- [x] **P4 攻击验证**：用静态检查验证三处约束一致，并运行项目测试。
  - Plan update (2026-07-19): Fact: 全量 `bun test` 为 380 pass / 25 fail / 10 errors，失败集中于既有 extension 契约漂移与缺少 `typebox`，本次仅改 Markdown；Grill: 是否应把无关基线失败包装成本次成功？否；Decision: 保留失败证据，并追加与计划动态状态直接相关的 verify-gate 定向测试及项目 smoke；Impact: 若定向测试失败则回炉本实现。
  - Evidence: `bun test xdd/evidence/verify-gate.test.ts` → PASS（16 pass / 0 fail），证明动态 checkbox 不破坏 verify 的未完成计划拦截。
  - Evidence: `pi --model MiniMax/MiniMax-M3 -p hi` → WARN（环境未安装 `pi` 命令）。
- [x] **P5 交付**：复核 diff、提交并创建 PR。
  - Evidence: `git diff --check` → PASS；变更范围仅含动态计划协议、执行 agent 同步与本活计划。
- [x] **P6 Feature 场景闭环**：逐个消费 spec 阶段的 `.feature` Scenario，建立 Scenario → Task → 实现落点 → 验收测试 → Evidence 闭环，并用 Verify Gate 拒绝漏映射。
  - Plan update (2026-07-19): Fact: 现有文档虽要求 `Feature:` 字段，但自动 Gate 只校验 RXX ↔ `@implements`；Grill: 仅靠提示能否保证“每个 Scenario 都指明能实现”？不能；Decision: 增加可执行 `FEATURE_SCENARIO_GAP` Gate 和正反测试，同时强化 plan/execute/verify 契约；Impact: 有 Feature 文件却漏掉任一 Scenario 的项目不能通过 verify。
  - Evidence: `bun test xdd/evidence` → PASS（18 pass / 0 fail）；正向覆盖 Scenario + Scenario Outline 完整映射，兜底攻击漏映射并确认返回 `FEATURE_SCENARIO_GAP`。

## 决策日志

| 时点 | 拷问 | 决策 |
|---|---|---|
| 基线后 | 新建另一份运行时计划是否合理？ | 不合理，会形成双重事实源；执行时原地更新当前业务线的 `plan.md`。本文件仅记录本仓库改造任务。 |
| 基线后 | 动态是否等于任意改需求？ | 否。进度、证据、微调可直接写；接口、依赖、文件范围、RXX 等结构变化必须标阻塞并回炉重规划。 |

## 验证矩阵

| 路径 | 攻击方式 | 预期 |
|---|---|---|
| 正向 | task 开始、步骤完成、测试通过 | plan 状态和证据及时落盘，可从中断处恢复 |
| 兜底 | 测试失败、假设失效、范围变化 | 先记录证据并 Grill；结构性变化阻塞并回炉，不静默漂移 |
| 防伪 | 只在最后批量勾选 | 明确禁止，完成声明必须由命令证据支撑 |
