# Normal Flow (NF)

Normal Flow 是 xdd 的直接交付路径：**design → framework → scenarios → verify**。它不设置独立 plan/execute，但 design 会生成与 xdd 同形的完整设计链；之后直接搭代码框架，并在 scenarios 阶段逐条 TDD 完成全部正向与兜底场景。

设计文档：[`Docs/normal-flow.md`](../../Docs/normal-flow.md)。

## 用法

```text
/normal-flow <任务描述>
/normal-flow-resume
/normal-flow-stop
```

## 四阶段

1. **design (`understand`)**：组合 xdd-brainstorm/spec/architecture/wire/resilience skills，生成需求、规格、架构、交互、韧性完整设计链。
2. **framework (`architecture`)**：消费完整 `.xdd/design/`，直接搭出可运行框架，不写 plan。
3. **scenarios (`spec`)**：按已设计的 RXX/Gherkin Scenario 逐个红→绿→重构，测试通过且每条规则有 `@implements RXX`。
4. **verify (`verify`)**：重跑并攻击全部 Scenario；实现缺口回 scenarios，设计根因回 design。

每个 Gate 都有明确正向动作，失败信息会指出应补哪层设计、哪个场景或哪个回炉阶段。runtime 继续复用 xdd Controller，但使用独立的 `normal-flow-runtime.json`。
