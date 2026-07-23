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

1. **design (`understand`)**：组合 brainstorm/spec/architecture/frontend/wire/resilience skills，先确定用户体验、业务与管理员流程、页面视觉、性能架构、运维监控/debug，以及 Docker 测试拓扑、数据库和外部依赖，再生成可冻结的完整设计链。
2. **framework (`architecture`)**：消费完整 `.xdd/design/`，直接搭出可运行框架，同时用 `Dockerfile.test`、`compose.test.yaml` 和 `scripts/test-in-docker` 准备隔离的测试运行时、数据库、migration/seed 与 healthcheck，不写 plan。
3. **scenarios (`spec`)**：在 Docker 测试环境中按已设计的 RXX/Gherkin Scenario 逐个红→绿→重构，测试通过且每条规则有 `@implements RXX`。
4. **verify (`verify`)**：重跑并攻击全部 Scenario；实现缺口回 scenarios，设计根因回 design。

每个 Gate 都有明确正向动作，失败信息会指出应补哪层设计、哪个场景或哪个回炉阶段。runtime 继续复用 xdd Controller，但使用独立的 `normal-flow-runtime.json`。

## 迭代策略

- 每个阶段有 **3 次**快速自愈预算。design 是后续 AI coding 的冻结契约，缺少业务流程、前端体验、性能架构或运维设计时绝不软通过；framework/scenarios 才可在记录问题后单向推进形成原型。
- 除 verify 外，阶段不能跳回前序阶段。verify 可以按根因回到 scenarios、framework 或 design，再沿 `design → framework → scenarios → verify` 的正向顺序完成下一轮优化。
- 同一 Normal Flow 最多允许 **8 次** verify 回炉迭代；阶段预算与流程预算在跨进程恢复时仍按该策略生效。
- verify 完成时同时交付验证报告与运维交接说明，使成果可以交给人工或 AI 运维继续部署、monitor、debug 和回滚。
