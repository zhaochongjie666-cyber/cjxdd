# XDD 原流程与质量流水线演进复盘

## 结论

新流程没有替换原 XDD 的十阶段状态机，也没有把 Pi Coding Agent 降级成固定规则执行器。原流程继续负责「理解 → 设计 → 实现 → 验证 → 回炉」；新增模块只把 QA、独立审查、运行时反馈和发布裁决变成可审计工件。

为保证切实可用，本轮补了两个兼容性缺口：没有可部署 runtime 的库/CLI 项目不再因缺 baseline 被硬阻断；`xdd_release_decision` 会自动刷新 Quality Score，旧调用顺序无需增加强制步骤。

## 原流程与当前流程差异

| 维度 | 原 XDD 流程 | 当前流程 | 保留的兼容性 |
|---|---|---|---|
| 主控制流 | 固定十阶段、Controller 管理 advance/rollback/预算 | 十阶段和 Controller 不变 | 没有新增状态或改变阶段顺序 |
| 语义审查 | AIGate 给出阶段判断，结果主要存在当前上下文 | verdict 绑定 artifact digest 并持久化 | AIGate 仍是有预算的软 Gate，小细节不会无限回炉 |
| QA | verify 阶段由实现上下文补测试 | plan 前冻结 QA 契约，verify 逐项举证 | 仍由 Pi 原生推理生成和执行测试，不引入外部 QA 服务 |
| 代码/提交审查 | 依赖阶段 AIGate 和 Git skill | 增加只读 code review 与 staged diff review | 复用当前 Pi 模型的隔离上下文，不要求第二套模型凭证 |
| 发布 | verify Gate 通过即可完成 | Release Decision 聚合 QA、review、runtime、HEAD | `xdd_release_decision` 仍是一个工具调用，并自动生成评分 |
| Runtime | 没有统一闭环 | 可选 baseline/observation/incident | 无 runtime 能力时明确软跳过，不伪造观测、不阻断库项目 |
| 学习 | 失败主要留在 run/design 文档 | 确认根因进入跨 run Bug KB 和 prevention rule | 只有带修复证据的结论才能学习，Agent 仍负责根因推理 |
| 质量衡量 | 以 Gate/测试结果为主 | 增加可解释 Quality Score | 分数只排序优化项；P1 和机械失败仍由原 Gate 阻断 |

## 本轮发现并修复的实用性问题

1. `xdd_bug_learn` 已注册但未进入任何阶段的 `allowedTools`，实际运行会被 policy 拒绝。现在它只在 verify 可用，并只写 `.xdd/knowledge/**`。
2. Runtime Observability 曾被最终 Release Decision 无条件要求，导致没有线上 runtime 的库、CLI、脚手架项目无法完成。现在「未配置 baseline」表示不适用软跳过；一旦写入 baseline，latest/incident 和 HEAD 绑定仍严格执行。
3. Quality Score 如果成为新的必调工具，会破坏旧 Agent 的调用顺序。现在显式调用可查看优化项，但 `xdd_release_decision` 也会自动刷新评分。
4. 低质量分不应制造新一轮细节修改循环。Quality Score 因此是解释型软信号；缺证据、P1、脏工作区和过期 digest 继续由 Release Decision 的既有硬检查负责。

## 仍未覆盖的缺口

### P1：下一步必须补

1. ✅ **旧 run 迁移**：`xdd_migrate_quality` 仅接受缺少新版创建标记、且已经越过 plan 的旧运行；生成绑定 run identity 的审计 manifest，只豁免已经过去、无法诚实补造的冻结 QA/阶段 review，当前和未来 Gate 仍严格执行。新版 run 永远不能申请 legacy waiver。
2. ✅ **Prevention Rule 主动注入**：阶段 Agent、AIGate、Code/Commit Review 与 Runtime Incident 会按阶段风险类别检索最多 5 条相关历史规则；注入结果记录 Pattern ID 与 context digest，不相关规则允许 N/A，避免历史知识变成无关返工。
3. **真实端到端回归**：模块测试覆盖了机械行为，但当前容器缺模型凭证，尚未完成一次从 `/xdd` 到最终 release 的真实全流程演练。

### P2：需要持续优化

1. Quality Score 的 evidence coverage 当前按关键工件是否存在计数，尚未细化到每个 Feature Scenario/QA-ID 的加权覆盖。
2. MTTR 只有 runtime incident 与 `xdd_bug_learn source.id=deploymentId` 可关联时才计算；没有样本时明确显示 `null` 且不扣分，避免伪精确。
3. Runtime adapter 当前接收调用者提供的 logs/metrics/traces，尚未提供 OpenTelemetry、Prometheus 或云监控连接器。
4. Bug Knowledge Base 是项目级 JSON；大型团队后续需要并发写入、归档、保留周期和跨仓库治理。

## 可用性验收标准

- 原有十阶段顺序、Controller 生命周期工具和 rollback 语义保持不变。
- 新质量工具不得绕过 `allowedTools`，也不得写入 `.pi`。
- 没有 runtime 的项目可以完成；配置 runtime 后，P1 和陈旧 HEAD 观测必须被阻断。
- AIGate 与 Quality Score 均不得因普通细节无限循环；P0/P1、机械失败和证据造假不得软放行。
- 每个新增强制工件都必须提供旧 run 的迁移或兼容策略，才可以宣称 XDD v1.0 对既有项目无损升级。
