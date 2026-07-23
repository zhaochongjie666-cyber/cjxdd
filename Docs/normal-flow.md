# Normal Flow 设计文档

## 目标

Normal Flow 采用四阶段：`design → framework → scenarios → verify`。它不设置独立 `plan` 与 `execute`，但**不会牺牲设计完整度**：design 阶段生成与 xdd 同形的完整持久设计链，然后直接搭框架，以 TDD 完成全部 Scenario。

## 正向流程

### 1. design（runtime 名：understand）

design 是一个压缩的开发阶段，不是一个缩水的文档。它组合需求、规格、架构、前端、交互、韧性与测试环境设计职责，并加载对应 skills：

- 需求：`intent.md`、`design.md`、`personas/`
- 业务：`business-process.md`，覆盖用户旅程和管理员审核、配置、权限、异常与审计流程
- 体验：`experience.md`，定义页面信息层级、视觉方向、组件，以及全部交互状态
- 规格：`spec/**/rules.md`、全部正向与兜底 `.feature`
- 架构：业务 `architecture.md`、`module-landscape.md`、`event-contract.md`、`aggregate-landscape.md` 与可度量的 `performance.md`
- 交互：`wire/*.md` 及空、加载、错误、成功、确认、边界状态
- 韧性：`failure-modes.md`、`failsafe-design.md`、`resilience-test-plan.md`
- 运维：`operations.md`，定义指标、日志、trace、告警、debug/runbook、回滚和人工/AI 接管边界
- 测试环境：`test-environment.md`，定义 Docker 拓扑、测试数据库/外部依赖、migration/seed、healthcheck、隔离清理和一键测试入口

所有设计产物位于 `.xdd/design/`，以 RXX 贯穿需求、场景、架构、交互和失败兜底。design 是 AI coding 必须坚守的冻结契约：Gate 逐类检查产物和关键设计维度，任何一层缺失都会给出对应正向补齐动作，三次快速自愈耗尽后也不能带病推进。

### 2. framework（runtime 名：architecture）

读取完整 design 链，按模块、事件、聚合、交互和韧性契约直接建立 `src/`、`lib/`、`app/` 或 `cmd/` 下的可运行框架。同步生成 `Dockerfile.test`、`compose.test.yaml` 和 `scripts/test-in-docker`：test runner、数据库及其他依赖都由 Compose 封装，具备 healthcheck、migration/seed、隔离数据和失败清理。该阶段不重写设计、不生成 plan。

### 3. scenarios（runtime 名：spec）

消费 design 已冻结的 RXX 与 Gherkin Scenario，逐个执行：

1. 通过 `scripts/test-in-docker` 在干净、隔离且依赖就绪的容器环境中写失败测试并确认红；
2. 写最小实现并确认绿；
3. 重构并跑全量回归；
4. 以 `@implements RXX` 闭合源码追溯。

Gate 检查 Feature、RXX 绑定、实现覆盖和真实测试，不要求或生成 `plan.md`。

### 4. verify

逐 Scenario 主动攻击正向与兜底，从干净环境运行 `scripts/test-in-docker`，在 `.xdd/runs/normal_run/verify-report.md` 记录镜像构建、依赖就绪、数据库 migration/seed、隔离、测试和失败清理证据，并用 `operations-handoff.md` 交付部署、监控、告警、诊断、runbook、回滚及人工/AI 运维接管方式。测试、追溯、报告和交接全部闭合才通过。实现问题回 scenarios；框架装配或测试环境问题回 framework；设计根因应回 design 补齐完整设计链。

## Gate 与回炉

| Gate | 正向入口 | 失败后的可执行动作 |
|---|---|---|
| design | 按需求、业务、体验、规格、架构、交互、韧性、运维与测试环境职责产出完整链 | 补齐错误中点名的设计产物或 Docker/数据库测试环境决策 |
| framework | 读取完整设计链，搭代码框架和 Docker 测试环境 | 补对应架构端点、Dockerfile.test、Compose 服务、数据库 healthcheck/migration/seed 或一键测试脚本；设计缺口回 design |
| scenarios | 消费已有场景并逐个红绿重构 | 回到具体 RXX/Scenario 的失败测试与最小实现 |
| verify | 重跑并攻击全部场景 | 实现缺口回 scenarios；框架缺口回 framework；设计根因回 design |

任何完成声明都必须同时给出正向跑通证据与兜底攻击证据；verify 不允许软通过。
