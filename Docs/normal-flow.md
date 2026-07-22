# Normal Flow 设计文档

## 目标

Normal Flow 采用四阶段：`design → framework → scenarios → verify`。它不设置独立 `plan` 与 `execute`，但**不会牺牲设计完整度**：design 阶段生成与 xdd 同形的完整持久设计链，然后直接搭框架，以 TDD 完成全部 Scenario。

## 正向流程

### 1. design（runtime 名：understand）

design 是一个压缩的开发阶段，不是一个缩水的文档。它依次执行 xdd 的 understand、spec、architecture、wire、resilience 五种设计职责，并加载对应 skills：

- 需求：`intent.md`、`design.md`、`personas/`
- 规格：`spec/**/rules.md`、全部正向与兜底 `.feature`
- 架构：业务 `architecture.md`、`module-landscape.md`、`event-contract.md`、`aggregate-landscape.md`
- 交互：`wire/*.md` 及空、加载、错误、成功、确认、边界状态
- 韧性：`failure-modes.md`、`failsafe-design.md`、`resilience-test-plan.md`

所有设计产物位于 `.xdd/design/`，以 RXX 贯穿需求、场景、架构、交互和失败兜底。Gate 逐类检查产物；任何一层缺失都会给出对应正向补齐动作。

### 2. framework（runtime 名：architecture）

读取完整 design 链，按模块、事件、聚合、交互和韧性契约直接建立 `src/`、`lib/`、`app/` 或 `cmd/` 下的可运行框架。该阶段不重写设计、不生成 plan。

### 3. scenarios（runtime 名：spec）

消费 design 已冻结的 RXX 与 Gherkin Scenario，逐个执行：

1. 写失败测试并确认红；
2. 写最小实现并确认绿；
3. 重构并跑全量回归；
4. 以 `@implements RXX` 闭合源码追溯。

Gate 检查 Feature、RXX 绑定、实现覆盖和真实测试，不要求或生成 `plan.md`。

### 4. verify

逐 Scenario 主动攻击正向与兜底，写 `.xdd/runs/normal_run/verify-report.md`。测试、追溯和报告全部闭合才通过。实现问题回 scenarios；框架装配问题回 framework；设计根因应回 design 补齐完整设计链。

## Gate 与回炉

| Gate | 正向入口 | 失败后的可执行动作 |
|---|---|---|
| design | 按五种 xdd 设计职责依次产出完整链 | 补齐错误中点名的需求/规格/架构/交互/韧性产物 |
| framework | 读取完整设计链并搭代码框架 | 补对应架构端点或框架文件；设计缺口回 design |
| scenarios | 消费已有场景并逐个红绿重构 | 回到具体 RXX/Scenario 的失败测试与最小实现 |
| verify | 重跑并攻击全部场景 | 实现缺口回 scenarios；框架缺口回 framework；设计根因回 design |

任何完成声明都必须同时给出正向跑通证据与兜底攻击证据；verify 不允许软通过。
