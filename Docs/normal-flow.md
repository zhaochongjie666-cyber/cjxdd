# Normal Flow 设计文档

## 目标

Normal Flow 采用三阶段：`framework → scenarios → verify`。删除独立 `plan` 与 `execute`；流程不是先写计划再执行，而是拿架构文档直接搭框架，然后用 TDD 完成所有 Scenario。

## 正向流程

### 1. framework（runtime 名：architecture）

读取用户给出的架构文档、README、现有工程约束，产出 `.xdd/design/architecture/normal/architecture.md`，并直接建立 `src/`、`lib/`、`app/` 或 `cmd/` 下的可运行框架。Gate 同时检查架构锚与代码框架，避免只交文档。

### 2. scenarios（runtime 名：spec）

从需求和架构端点列全 RXX 与 Gherkin Scenario，包括 happy path 及失败、拒绝、冲突、无权限、依赖不可用和边界。每个 Scenario 依次执行：

1. 写失败测试并确认红；
2. 写最小实现并确认绿；
3. 重构并跑全量回归；
4. 以 `@implements RXX` 闭合源码追溯。

Gate 检查规则、Feature、RXX 绑定、实现覆盖和真实测试，不要求或生成 `plan.md`。

### 3. verify

逐 Scenario 主动攻击正向与兜底，写 `.xdd/runs/normal_run/verify-report.md`。测试、追溯和报告全部闭合才通过。实现问题回 scenarios 继续 TDD；架构根因回 framework 重搭。

## Gate 与回炉

| Gate | 正向入口 | 失败后的可执行动作 |
|---|---|---|
| framework | 读架构输入并搭代码框架 | 补架构端点或对应框架文件 |
| scenarios | 列全场景并逐个红绿重构 | 回到具体 RXX/Scenario 的失败测试与最小实现 |
| verify | 重跑并攻击全部场景 | 实现缺口回 scenarios；架构根因回 framework |

任何完成声明都必须同时给出正向跑通证据与兜底攻击证据；verify 不允许软通过。
