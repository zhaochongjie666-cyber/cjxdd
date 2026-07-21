# XDD Plan Engine 能力设计评审

## 结论

**方向正确。方案中的 Plan 语义审查项可以、也应该先加入现有 plan AIGate；完整 Plan Engine 则仍应在补齐对象关系和运行时不变量后分阶段实现。**

方案最有价值的判断，是把「工程事实」与「抵达目标的路径」分开，并把 Plan 从 Markdown 提升为可追踪、可重规划的工程对象。它也正确地区分了 Solution、Architecture、Plan、Schedule 和 Release slicing，明确拒绝在缺少容量时编造日期。这些原则值得进入 XDD 的长期设计。

这里要区分两件事：计划是否现实、是否过度设计、顺序是否错误、是否遗漏验证与恢复，正是 AIGate 应负责的语义正确性审查，可以直接增强现有 plan AIGate；Plan Object、baseline、关键路径和动态重规划则是新的运行时能力，不能仅靠增加审查 prompt 获得。

现有 `xdd-plan` skill 已经是这个 Gate 的正向开发入口：它告诉 AI 要读取哪些上游锚、怎样生成 QA Plan 和 TDD task DAG、产出什么以及如何自检。因此，增补语义检查时应同步把相同要求写进 skill 自检和 plan `desiredState`，再由 AIGate 攻击已经声明的产物，而不是另起一个 Gate 让 AI 猜标准。

## 与当前 XDD 的关系

当前 XDD 的 `plan` 不是通用项目管理计划，而是设计到代码之间的实施桥：读取 spec、architecture、wire、resilience，先冻结公开入口 QA 契约，再产生逐 Scenario、逐 RXX 的 TDD task DAG。现有下游 `execute` 还把这份计划当作唯一动态实施计划。

因此，新设计不是给现有 `plan.md` 增加几个字段，而是新增一个更高层的 Plan Engine。若直接替换，会同时破坏三项现有契约：

1. `plan.md` 的 RXX/Scenario/Implementation/Acceptance Test 追踪职责；
2. `qa-plan.md` 在实现前冻结、execute 不得反改的职责；
3. execute 按 task 更新状态、证据和 commit 的职责。

建议保留两层对象并明确命名：

```text
Delivery Plan / Development Plan Graph
  └── Work Package
       └── Execution Plan（现有 plan.md 的职责）
            └── Agent Task / TDD Step
```

Plan Engine 负责全局路径与重规划；现有 `xdd-plan` 负责把一个 ready Work Package 编译成可执行的 TDD Execution Plan。不要让一个文件重新承担所有层级。

## 做得好的部分

### 1. 对象边界基本正确

「Solution 决定怎么解决，Plan 决定怎么完成」是必要边界。Schedule 作为 Plan 的时间投影，而不是反向主导工作分解，也是正确约束。缺少容量、日历约束和工作量区间时拒绝输出具体日期，能有效避免假精确。

### 2. 双图思路适合 Controller

Engineering State Graph 表达已观察到的事实，Plan Graph 表达被批准的推进路径。Controller 同时比较 Desired State、Current State 和 Plan Baseline，才能区分：继续执行、修复当前产物、回退设计层、局部重规划或请求决策。这比无状态地生成「下一步」更稳健。

### 3. Work Package 比平铺 task 更适合多 Agent

输入、输出、依赖、能力、验收、证据和失败处理是合理的工作包边界。先声明 capability requirement，再在运行时解析 Agent/Skill/Tool，也比把计划绑定到具体模型更耐久。

### 4. Replan 强调差异而非覆盖

保留仍有效成果、标记受影响下游、生成 Plan Diff、审批新 baseline，是正确的审计模型。它能避免一次变化让系统静默重写全部计划，也符合 XDD 的「失败推动回炉」原则。

## 必须回炉的问题

### 1. 分类和层级存在自相矛盾

文中称「四类对象」，表格实际列出六类。Release Plan 一处被当作独立对象，一处又进入 `Plan.planType` 语义；Schedule 在分类中是对象，却不在 Plan 类型或独立对象模型中。

`Project → Outcome → Deliverable → Milestone → Work Package` 也不是稳定的树。Milestone 通常是对多个 deliverable/work package 状态的检查点，而不是 Deliverable 的子节点；一个 Deliverable 也可能跨多个 milestone 或 release。应改成有类型的图关系，而不是强制父子层级：

```text
Outcome <-contributes-to- Deliverable
Deliverable <-produced-by- Work Package
Milestone <-exits- Gate
Milestone <-includes- DeliverableSlice
Release <-includes- DeliverableSlice
```

### 2. DependencyType 混合了事实、逆关系和推导结果

`requires` 与 `blocks` 多数时候互为逆关系，同时持久化会产生不一致。`can-run-in-parallel-with` 不是前置依赖，而是从无路径依赖、能力容量和写集冲突推导出的调度结论。`shares-contract-with` 是协调关系，也不能直接参与拓扑排序。

建议持久化最小事实集合：

```typescript
type DependencyType =
  | "requires-output"
  | "must-complete-before"
  | "must-pass-gate-before"
  | "coordinates-contract-with";
```

`blocks`、parallel group 和 critical path 由编译器计算，不作为第二份事实源。每条边还需定义 `from`、`to`、原因、来源引用、required/optional 和失效策略。

### 3. 缺少运行时不变量

对象接口列了字段，却没有定义状态转换和一致性约束。至少要补齐：

- Work Package 何时从 `planned` 变为 `ready`；
- optional dependency 失败是否阻塞；
- Gate 失败后进入 `blocked`、`review` 还是生成 repair task；
- 已完成工作包的输入 baseline 改变后，何时保留、何时标 stale；
- milestone/release 的完成是存储状态还是由下游状态投影；
- 两个 Agent 写集冲突时由谁仲裁、是否自动串行；
- replan 过程中旧 baseline 上运行的 task 如何停止、完成或隔离证据；
- baseline version、对象 revision、仓库 commit 和证据版本如何绑定。

没有这些规则，Controller 无法确定性选择 ready work，也无法安全地局部重规划。

### 4. 「Plan Compiler」仍主要依赖未声明的语义推断

从 Feature 和 Architecture 自动生成 Deliverable、Work Package、依赖和 Release slice，不是普通编译；其中包含范围判断、方案判断、风险判断和价值切片。必须区分三层：

1. **机械编译**：解析 ID、建立引用、检查 schema、拓扑排序、计算覆盖率和写集冲突；
2. **语义生成**：由 skill/Agent 提议 deliverable、工作包、依赖理由和 release value；
3. **语义 Gate**：用上游目标、已批准决策和实际仓库状态攻击这些提议。

LLM 的语义提议不能因为输出了合法 JSON 就被视为「编译正确」。反过来，语义 Gate 也不能依靠 Markdown 标题或关键词来判断计划现实、不过度设计或顺序正确。

### 5. Plan AIGate 可以直接承接语义正确性审查

提案中的八个 `100%` 规则，只有一部分能机械验证：

| 检查 | Gate 类型 | 说明 |
| --- | --- | --- |
| 引用存在、ID 唯一、DAG 无环、必填字段完整 | 机械 Gate | 可由 schema/图算法确定 |
| Feature Traceability | 混合 Gate | 机械检查引用集合；语义检查 work package 是否真的覆盖 Feature |
| Deliverable/Work Package 可验收 | 语义 Gate | 不能靠存在 `acceptanceCriteria` 字段通过 |
| 依赖是否完整、顺序是否合理 | 语义 Gate | DAG 无环不代表没有漏边或错序 |
| blocker mitigation 是否有效 | 语义 Gate | 有 mitigation 文本不代表能降级或恢复 |
| Release 是否产生用户价值 | 语义 Gate | 不能靠 `userValueRef` 非空通过 |
| 计划是否现实、是否过度设计 | 语义 Gate | 必须结合仓库、能力、约束和已批准方案判断 |

百分比还必须声明分母和权威来源。例如 Feature coverage 的分母是当前 approved Feature baseline，而不是所有历史 Feature；`N/A` 必须有责任人、理由和审批，不能从分母中静默删除。

### 6. 现有 plan AIGate 已有正向入口；新增 Plan Engine Gate 时继续保持配对

对当前 Execution Plan，`xdd-plan` skill、plan `desiredState`、`plan.md`/`qa-plan.md` 输出和 AIGate 已构成正向入口与审查配对。因此本次可以直接加入语义攻击项，并同步增强 skill 自检。以下更高层入口是未来新增 Plan Graph/baseline Gate 时需要交付的配对，而不是阻止当前 AIGate 增强的前置条件：

```text
xdd-development-plan skill
  Input: approved outcome/feature/solution/architecture baseline + repo observation
  Action: 生成 deliverable → 分解 WP → 声明 typed dependency → 声明 evidence/gate
  Output: plan object + graph + unresolved decisions
  Self-check: schema、引用、DAG、覆盖集合、写集冲突、无容量不排期
```

Gate 的失败也必须返回可执行修复信息，而不是「Feature Traceability 未达到 100%」：

```yaml
finding:
  subject: WP-023
  failed_semantic: dependency_completeness
  evidence: WP-023 consumes API v2 but no approved contract-producing predecessor exists
  repair_action: add a contract-freeze work package or change WP-023 input to an existing contract
  return_to: development-plan/dependency-analysis
  affected: [WP-023, WP-031, M-02]
```

### 7. Attacker 的独立性表述需要修正

「Writer 与 Attacker 不共享上下文」应理解为不共享 Writer 的隐式推理和自我辩护，而不是不共享事实。Attacker 必须读取同一组权威输入：approved Feature、Solution decision、Architecture baseline、仓库观察、能力清单、计划产物和机械检查结果。否则它无法判断漏项、错序或过度设计。

还应固定 attack rubric/version 和输出结构，避免 reviewer 改名或 prompt 漂移导致 baseline 不可重现。

### 8. 正向和兜底还没有对称闭环

提案列出了异常触发器，但没有把每类失败映射到恢复动作和验证证据。至少要覆盖：

| 场景 | 正向行为 | 兜底行为 | 攻击证据 |
| --- | --- | --- | --- |
| 外部 capability 可用 | resolver 分配执行者 | 不可用时选替代能力、降级或请求决策 | 注入 capability unavailable，验证不错误启动 WP |
| dependency 正常 | 输出解锁下游 | 失败时阻塞受影响子图，保留无关 ready WP | 注入 dependency failure，验证局部而非全局停摆 |
| Gate 通过 | 推进 milestone | 失败时生成有目标的 repair task 并回到正确阶段 | 注入语义缺口，验证 remediation 可执行 |
| baseline 未变化 | 继续执行 | 变化时 stale 传播，隔离旧证据 | 修改 Feature revision，验证影响集准确 |
| replan 成功 | 批准新 baseline | replan/审批失败时保留旧 baseline，不静默覆盖 | 中断 replan，验证旧计划仍可审计和恢复 |

### 9. Release 和 Schedule 应后置，但接口需提前留好

最小落地顺序把 Release/Schedule 放在最后是合理的。但 M1 的对象模型仍需预留 deliverable slice、effort distribution、capacity calendar 和 release value reference 的扩展点，避免后续破坏 baseline schema。

「关键路径」也不能只凭依赖图得到可信结论。没有 effort range 时最多输出拓扑最长链或 dependency-critical candidates；有 duration/effort 与 capacity 后才能称为时间意义上的 critical path。

### 10. 文档本身需要清理

用户提供的方案正文完整重复了一次；「输入/输出」列表中有 `-依赖` 排版错误；若作为正式 ADR/设计稿，应先去重并统一术语、对象数量、关系方向和状态命名，否则后续 skill 与 schema 会各自解释。

## 建议的最小可落地设计

### Phase 0：先增强现有 plan AIGate，再冻结新引擎契约

第一步可立即把范围现实性、错误顺序、可观察证据、正向/兜底、并行冲突和显式回炉加入现有 plan AIGate；相同要求必须同步进入 `xdd-plan` 自检和 plan `desiredState`。随后再为新引擎产出：

- Plan ontology：对象、typed edges、ID、revision、baseline 和状态机；
- 与现有 Execution Plan/QA Plan 的兼容边界；
- 一份正向 development-plan skill；
- 一份版本化 semantic attacker rubric；
- Gate finding/remediation 机器契约。

退出证据：用一个小型真实 Feature 正向生成计划；再分别注入漏 Feature、错依赖、无效 mitigation、无用户价值 release，证明语义 Gate 能拒绝并给出正确回炉动作。

### Phase 1：Plan Object 与机械编译器

只实现 schema、revision、baseline、引用检查、DAG、覆盖集合、写集冲突和 ready predicate。不实现 Schedule，不自动生成 Release。

退出证据：合法计划可 baseline；循环、悬空引用、重复 ID、缺输出和冲突写集均被机械 Gate 精确拒绝。

### Phase 2：Development Plan 语义生成与 Gate

从 approved Feature/Architecture 和 repository observation 生成 deliverable/WP 提案；AIGate 结合机械结果审查范围、可验收性、依赖完整性、正向/兜底和过度设计。

退出证据必须成对：一个完整方案可通过；每类语义缺口可失败；每次失败都指向 `development-plan`、`dependency-analysis`、`architecture` 或 `resilience` 中的具体修复动作。

### Phase 3：现有 Execution Plan 适配

选择一个 ready WP，调用现有 `xdd-plan` 生成冻结 QA 契约和 TDD task；执行证据回写 WP，而不是让全局 Plan 与实施 checklist 竞争同一个 `plan.md`。

### Phase 4：局部重规划

实现 revision diff、影响传播、stale、证据保留和新 baseline 审批。先验证 Feature/Architecture 变化两类，暂不覆盖所有运行指标触发器。

### Phase 5：Release 与 Schedule

在实际 effort calibration 和 capacity 数据存在后，再实现价值切片、三点估算和日历投影。无容量时保持显式拒绝日期输出。

## 推荐的 Gate 结构

```text
Positive development skill
  ↓ produces declared plan object + self-check evidence
Mechanical precheck
  ↓ schema / refs / DAG / coverage candidates / write conflicts
Semantic Plan Attack
  ↓ scope / decomposition / missing dependencies / evidence quality / recovery
Actionable findings
  ├── repair in development-plan
  ├── return to solution/architecture/resilience
  └── request human decision
Re-submit changed subgraph
  ↓
Baseline approval
```

机械 Gate 不评价「现实」「价值」「合理」；语义 Gate 不重新发明未声明的验收标准。两者都只检查正向 skill 已声明的 desired state、产物和证据。

## 最终评价

| 维度 | 评价 |
| --- | --- |
| 战略方向 | 高：双图、typed plan、replan、能力解析均值得投入 |
| 与现有 XDD 兼容性 | 中低：尚未区分全局 Plan Graph 与现有 TDD Execution Plan |
| 对象模型成熟度 | 中：字段较全，但关系、revision、状态不变量不足 |
| Gate 设计成熟度 | 中：现有 AIGate/skill 已有配对，可立即承接语义检查；新 Plan Graph Gate 仍需 remediation 契约 |
| 正向/兜底闭环 | 中低：列出风险和触发器，但失败注入、恢复动作和证据未闭环 |
| 可分阶段落地性 | 中高：采用 Phase 0→对象/机械编译→语义 Gate→执行适配→replan 可控 |

**建议立即合并对现有 plan AIGate 的语义增强，同时只批准完整 Plan Engine 的契约设计，不直接铺开全部运行时能力。** 下一步先用“合格计划能通过、错误范围/顺序/兜底能失败且返回修复动作”的测试攻击新增 AIGate，再冻结 Plan ontology、Execution Plan 兼容边界和 baseline 状态机。
