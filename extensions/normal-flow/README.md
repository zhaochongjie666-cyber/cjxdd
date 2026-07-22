# Normal Flow (NF)

Normal Flow 是 xdd 的直接交付路径：**framework → scenarios → verify**。它不再设置 plan 和 execute 阶段；先读取架构文档搭出代码框架，再在同一个 scenarios 阶段逐条以 TDD 完成全部正向与兜底场景，最后攻击验证。

设计文档：[`Docs/normal-flow.md`](../../Docs/normal-flow.md)。

## 用法

```text
/normal-flow <任务描述>
/normal-flow-resume
/normal-flow-stop
```

## 三阶段

1. **framework (`architecture`)**：读取用户架构文档、README 和工程约束，固化 `.xdd/design/architecture/normal/architecture.md`，直接搭出可运行代码框架。
2. **scenarios (`spec`)**：列全 RXX/Gherkin 正向与兜底 Scenario，逐个执行红→绿→重构，要求测试通过且每条规则有 `@implements RXX`。不产出 plan。
3. **verify (`verify`)**：重跑并攻击全部 Scenario，写验证报告。实现缺口回 scenarios，架构根因回 framework。

每个 Gate 都有明确正向动作；失败信息会指出应修复的场景或回炉阶段。runtime 仍复用 xdd Controller，但使用独立的 `normal-flow-runtime.json`。
