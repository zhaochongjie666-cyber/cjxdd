# XDD 多层质量发现体系审查

## 1. 结论

XDD 已经不是“直接让 AI 写代码”的单点工具：十阶段 Controller、硬 Gate、AIGate、失败回退、Blind Journey 与 verify evidence gate 已形成可运行的流程骨架。按“Agent 驱动的软件工程操作系统”的目标衡量，当前成熟度约为 **3/5（流程受控，但独立裁判与运行闭环尚未工程化）**。

当前最强的能力是 **规格到验证的追踪与交付阻断**；最大结构性风险是 **Creator 与 Judge 仍可能共享模型、上下文和偏差**。项目已有不同阶段的概念角色，但角色表明确说明这是“conceptual, not multi-agent”，不能把角色名称当成独立审查已经落地。

## 2. 审查方法

本次按八层 Quality Detection Pipeline 审查：Intent、Architecture、Code Review、Independent QA、Black-box Experience、Runtime、Commit Diff 与 Bug Learning。每层分别检查输入隔离、独立责任、标准工件、硬 Gate、失败回退、正向证据和兜底攻击证据。只认仓库中已经存在的代码、测试、skill 或 agent 定义；仅有提示词或 checklist 记为“部分具备”。

## 3. 能力矩阵

| 层 | 当前证据 | 状态 | 主要缺口 |
|---|---|---:|---|
| 需求审查 | `understand` 禁读源码；`spec` 有八类场景、角色追踪和异常副作用检查；AIGate 有假设/遗漏/边界攻击 | 部分具备 | 没有独立 Requirement Reviewer；没有标准 risk report 与风险接受 Gate |
| 架构审查 | architecture 要求模块、依赖、数据流、事务、并发、安全、可观测性；AIGate 有安全/一致性/可运维/合理性攻击 | 部分具备 | 创建和语义审查可由同一模型完成；没有结构化评分及循环依赖/数据泄露机器规则集 |
| 代码审查 | execute AIGate 检查假实现、异常测试和架构一致性；verify 源码只读并阻断追踪缺口 | 部分具备 | 没有“只审不改”的 code-review 工件与 Gate；缺统一 bug taxonomy |
| 独立 QA | plan 强制 Scenario → Implementation → Acceptance Test；verify 真正执行 harness 命令 | 部分具备 | 测试仍由 execute 路径产生；没有 QA Agent 独立生成和冻结 test plan |
| 黑盒体验 | Blind Journey 分离 Actor/Judge，Actor 禁源码/DOM/API，FAIL/BLOCKED/P0/P1 阻断 verify | 核心具备 | 浏览器能力依赖 harness；skip 需要显式、可审计理由 |
| Runtime | architecture 要求日志/指标/告警；resilience 和 chaos 验证故障处理 | 设计态具备 | 没有消费 logs/metrics/traces 的 Runtime Agent、基线回归和 commit 关联 |
| Commit Review | `xdd-git-commit` 有 staged diff 准备和提交前 checklist | 薄弱 | 不是强制 Diff Analyzer；没有结构化阻断 verdict、风险等级或 bypass 审计 |
| Bug 学习闭环 | diagnose → rollback → 重做 → verify；cleanup 要求稳定结论沉淀到 design | 部分具备 | 没有结构化 Bug KB、重复缺陷匹配、预防规则生成与效果度量 |

## 4. 关键发现

### P1：独立裁判是概念，不是强制边界

`STAGE_ROLES` 虽然把阶段命名为 Requirements Analyst、System Architect、Implementer、Auditor，但这些角色是概念性的。AIGate 是独立调用，却没有强制不同 reviewer identity、隔离上下文或独立模型。因此“开发者不能评价自己”目前是行为提示，不是系统不变量。

**整改验收**：每个 verdict 记录 `creator_id`、`reviewer_id`、`model`、`context_policy` 与 `artifact_digest`；高风险阶段拒绝 `creator_id === reviewer_id`，人工 override 必须审计。

### P1：缺少独立 QA 工件与前置冻结

现有 plan/execute/verify 强制 Feature 场景闭环和真实命令执行，但 test plan 没有作为开发前的独立、只读输入被冻结，开发路径可同时设计实现和“刚好通过实现”的测试。

**整改验收**：新增 `qa-plan`，至少含 happy/rejection/boundary/concurrency/dependency-failure/load-applicability 六类；execute 只读，QA reviewer 才能修改；verify 检查每条 case 的运行证据或有责任人的不适用裁决。

### P1：运行时质量发现尚未闭环

架构要求设计 observability，resilience 要求 chaos，但交付后没有持续消费日志、指标和 trace 的 Agent，也没有从异常回指 commit 的标准事件。

**整改验收**：定义脱敏的 `runtime-observation` adapter；输出 incident 与结构化 finding；finding 进入 Difference，调度 rollback/hotfix，并验证恢复后的基线。

### P1：Commit Review 不是发布 Gate

git skill 能准备规范提交并提供 checklist，但没有独立 Diff Analyzer verdict，也没有权限、安全、迁移、破坏性 API、密钥和测试删除等规则。

**整改验收**：commit/release 前产出 `commit-review.json`；P0/P1 阻断、P2 需接受理由；verdict 绑定 tree hash，diff 改变后失效。

### P2：缺少 Bug Knowledge Base

现有 diagnose/rollback 可完成单次失败闭环，cleanup 也要求把稳定结论沉淀到 design，但缺少可检索的缺陷模式和预防规则生命周期。

**整改验收**：定义 `bug-pattern.yaml`，包含 type、symptom、root_cause、detection、fix、prevention、evidence、scope、first_seen 与 recurrence_count；新 finding 先相似匹配，修复后生成或更新 lint、architecture rule 或 test。

### P2：AIGate 角度目录缺少唯一性约束

模型 verdict 用角度名作稳定标识，但目录此前没有阻止同一阶段注册同名角度。重复项会浪费审查预算并使 verdict 对齐产生歧义。本次加入启动时唯一性校验与回归测试；一旦出现重复，立即失败而不是带病审查。

## 5. 推荐目标状态：XDD Quality Pipeline v1

```text
Feature
  -> Requirement Creator
  -> Requirement Reviewer [risk report gate]
  -> Architecture Creator
  -> Architecture Reviewer [architecture verdict gate]
  -> QA Planner [frozen test plan]
  -> Implementer
  -> Code Reviewer [read-only verdict]
  -> Test + Security Judges
  -> Blind Journey Actor -> Acceptance Judge
  -> Release Decision [aggregate gate]
  -> Runtime Observer -> Incident/Difference -> rollback/hotfix
```

### 统一 Reviewer 工件

```yaml
schema_version: 1
review_type: requirement | architecture | code | qa | security | commit | runtime
artifact_digest: sha256:...
creator_id: ...
reviewer_id: ...
context_policy: isolated | black_box | full
verdict: pass | fail | blocked | inconclusive
score: 0
findings:
  - id: F-001
    severity: P0 | P1 | P2
    category: permission | concurrency | recovery | requirement_gap | other
    evidence: ...
    rollback_target: understand | spec | architecture | wire | resilience | execute
positive_path_evidence: []
fallback_attack_evidence: []
overrides: []
```

### Release Decision 必要条件

1. 所有必需 verdict 与当前 artifact digest 匹配。
2. creator 与 reviewer 满足独立性策略；人工 override 有身份、理由和时间。
3. P0/P1 为零；P2 均有处置或风险接受。
4. 正向证据覆盖核心用户旅程。
5. 兜底攻击证据覆盖权限、依赖失败、恢复和关键边界。
6. 修复导致旧 verdict 失效，并强制 reviewer 再攻击。

## 6. 分批落地

### 第一批：把独立裁判变成系统不变量

1. ✅ 已增加统一 verdict schema、确定性 artifact digest、P0/P1、正向证据与兜底证据策略校验。
2. ✅ AIGate 通过后以隔离审查身份生成 verdict，并原子持久化到当前 run 的 `reviews/{stage}.json`；产物变化会让旧 verdict 失效。
3. ✅ `xdd_advance` 在推进所有启用 AIGate 的阶段前重新计算 digest 并校验 verdict；缺失、过期、自审或证据不全会拒绝推进。AIGate 保持软 Gate：严格审查达到预算后保留 fail/inconclusive findings 和审计 override，不再围绕小细节无限循环。
4. ✅ 直接复用 Pi 当前模型的原生推理能力，以隔离 prompt/context 执行 reviewer；不强制引入第二套模型、凭证或外部 Agent 基础设施。

### 第二批：补齐 QA 与 Commit Gate

1. ✅ plan 阶段已在开发前生成并冻结 qa-plan.md：精确覆盖 Feature Scenario，对六类风险逐项决策；execute 不得反改，verify 必须逐 QA-ID 提交 PASS 证据。
2. ✅ execute AIGate 已作为只读 Code Reviewer：强制提交生产源码，覆盖空值/并发/资源/授权注入/错误处理/架构漂移，生成绑定源码 digest 的 code-review.json；源码变化会使报告失效。
3. ✅ 已提供 xdd_commit_review：只读审查 staged diff，绑定 index tree + patch digest，覆盖权限删除/测试弱化/密钥/迁移/契约/韧性；diff 变化自动失效，高风险不可 override，普通细节三轮后软放行。
4. ✅ 已提供 xdd_release_decision：聚合阶段 reviews、冻结 QA、Code Review、Commit Review、verify evidence 与 HEAD tree；任一上游变化都会使 release-decision.json 失效，最终推进不再接受单 Agent 口头宣布。

### 第三批：运行时与学习闭环

1. ✅ 已接入 runtime-independent observability adapter：脱敏 logs/metrics/traces，绑定 deployment/HEAD，对比稳定基线生成 incident；P1 阻断 Release Decision，P2 保持软告警。
2. ✅ incident 已携带 desired/current/tasks Difference；P1 自动写入 XDD diagnose 根因层，要求 execute/resilience 回炉、重新部署并再次观测。
3. ✅ 已建立跨 run 的 bug-pattern schema、确定性指纹、重复模式匹配器和 prevention rule 生成器；只接收 Agent 完成根因分析且带修复证据的学习记录，避免把猜测写入知识库。
4. ✅ Quality Score 已使用重复率、escaped defects、恢复时间、override 数量与证据覆盖率；低分提供可解释优化项而不形成第二个无限硬 Gate，真正的 P1/机械失败仍由 Release Decision 阻断。
5. ✅ 已提供旧 active run 的审计迁移：只对升级前且越过 plan 的运行豁免不可追溯补造的历史工件，新 run、当前阶段和未来阶段不能借迁移绕过 Gate。
6. ✅ Bug KB prevention rules 已主动注入阶段执行、AIGate、Commit Review 与 Runtime Incident；每次注入限制为最多 5 条并审计 Pattern ID/context digest，不相关规则允许 N/A，防止规则膨胀拖慢正常交付。

## 7. “正向和兜底”判定

- **正向是否跑通？** 框架已有从 Feature/规则到公开入口验收、真实 harness 命令和 Blind Journey 的证据要求，核心骨架成立。
- **兜底是否被攻击过？** spec、resilience、verify、chaos、Blind Journey、commit 与 runtime 已覆盖异常/权限/恢复攻击；下一步仍需让历史 prevention rule 主动进入新一轮审查上下文。
- **失败是否推动回炉重造？** diagnose/rollback 已支持按根因回退；下一步必须让所有 finding 携带 rollback target，并在 artifact digest 变化后强制重新审查，才能把“回炉重造”从提示词升级为状态机约束。
