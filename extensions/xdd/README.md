# xdd (pi coding agent extension)

xdd 控制循环（[`core.md`](../../core.md)）作为 **pi coding agent inline extension** 的实现。

控制循环现在由 Controller Core 统一拥有状态转换；pi inline extension 和 headless 测试适配器都只把事件翻译成 `XddCommand` 并执行 `XddEffect`。`XddRunnerState` 保留为运行状态兼容 facade，真实推进/回退不再由独立 runner 状态机负责。

## 架构

```
                          一份纯逻辑（pi 无关）
              observe-fs.ts  +  stage-diff.ts  +  stages.ts  +  gate.ts
                                       │
                                       ▼
              ┌────────────────────────────────────────────┐
              │  pi inline extension                        │
              │  extension.ts + adapters/pi-* + context.ts │
              │  adapters/headless-controller.ts + checkpoint.ts │
              │  统一调 XddController.dispatch(command)          │
              └────────────────────────────────────────────┘
```

纯逻辑模块（`observe-fs.ts` / `stage-diff.ts` / `stages.ts` / `gate.ts`）不依赖 pi，
是观测与 Gate 的核心；extension 与 headless adapter 在其上共享同一个 Controller Core，避免生产和测试各有一套推进/回退状态机。

## 核心与质量工具

控制循环工具（对齐 core.md）：

| 工具 | core.md 阶段 | 作用 |
|------|-------------|------|
| `xdd_observe` | `observe()` | 当前状态（内存簿记 + 真实磁盘快照，磁盘为准） |
| `xdd_desired_state` | desiredState | 当前阶段的期望状态 + 所属阶段组 Gate |
| `xdd_difference` | `compare() -> diff` | 真实硬 Gate 预检 + desiredState 逐条分类（不靠关键词猜） |
| `xdd_next_task` | `scheduler(diff)` | Controller 给唯一下一步指令 |
| `xdd_submit_artifact` | `execute + checkpoint` | 提交产物 + 自我攻击，触发 Gate，写 ESG |
| `xdd_advance` | 推进 | 通过 Gate 后进下一阶段（组级 Gate 强制回退） |
| `xdd_rollback` | 回退 | 回更早阶段重做（超上限拒绝） |
| `xdd_diagnose` | 反思 | 上报失败根因层（intent/spec/arch/.../test-gap） |
| `xdd_trace` | 追溯覆盖 | spec RXX vs 代码 `@implements`：未实现 / 孤儿标注（追溯闭环健康度） |
| `xdd_list_skills` | 装载 | 列可用 xdd skill |
| `xdd_load_skill` | 装载 | 把 skill SKILL.md 注入阶段 system prompt |
| `xdd_commit_review` | 提交审查 | 用 Pi 隔离上下文只读审查 staged diff，绑定 index tree/diff digest，变化后强制重审 |
| `xdd_release_decision` | 发布裁决 | 聚合阶段 review、QA、Code/Commit Review、verify evidence 与 HEAD tree，生成最终 RELEASE/BLOCK |
| `xdd_runtime_observe` | 运行观测 | 通过 runtime-independent adapter 记录脱敏 logs/metrics/traces，对比基线并生成 incident |
| `xdd_bug_learn` | 缺陷学习 | 在根因、修复与证据确认后沉淀跨 run bug pattern，并生成对应 prevention rule |
| `xdd_quality_score` | 质量评分 | 聚合重复缺陷、escaped defects、恢复时间、override 与证据覆盖率，输出非阻塞改进优先级 |
| `xdd_migrate_quality` | 旧运行迁移 | 仅为升级前且已越过 plan 的 active run 生成审计 waiver；不豁免当前和未来阶段 |

Bug KB 中与当前阶段相关的 prevention rule 会自动进入 Agent/AIGate/Commit Review/Runtime 上下文；每次最多 5 条，命中的 Pattern ID 记录在 `prevention-injections.json`，不需要人工调用额外工具。

### 全流程预算

xdd 默认把一个流程的 Pi 已报告 LLM 费用限制为 **$500 USD**。启动前可通过 `XDD_FLOW_BUDGET_USD` 配置，例如 `XDD_FLOW_BUDGET_USD=75 pi`。预算和已用 tokens/费用持久化在 `.xdd/runtime.json`，恢复时不会因环境变量变化而意外改变原 run 的上限；达到上限后流程暂停，不再自动发起下一轮模型调用。

`.xdd/runtime.json` 是当前 checkpoint，不是永久事件日志。ESG 只保留最近 500 个节点；较旧版本留下的超长 ESG 会在下一次保存时自动裁剪。需长期保留的验证证据必须写入并提交 artifact 文件，不能只依赖 runtime 中的审计窗口。

### AIGate 主 turn 审查

`xdd_submit_artifact` 不再另起一次 LLM 请求。首次提交通过硬 Gate 后，工具输出包含提交声明、产物路径、机械结果、完整必审角度、历史 findings 和一次性 `reviewToken` 的 review summary；extension 以 `deliverAs: "steer"` 把攻击任务送回当前主 turn。主 turn 读取真实产物和跨阶段契约，逐项攻击正向与兜底后，以 `mainTurnReview` 重提。工具会校验 token 与当前阶段/声明/磁盘指纹的绑定，并拒绝缺少或重复角度、全部 `N/A`、无证据以及总判断和逐角度判断矛盾的 review，防止跳过 steer、复用旧审查或用 summary 自我宣布完成。

## 运行流程

### 单次控制循环（core.md 的 while 落地）

```
agent 进入一个阶段（如 spec）
  ① xdd_observe            ← observation = observe()：内存簿记 + 磁盘快照
  ② xdd_desired_state      ← 拿到本阶段期望状态
  ③ xdd_difference         ← compare()：跑真实 stage.gate + 逐条分类，预检 diff
  ④ agent 按 diff 干活
  ⑤ xdd_submit_artifact    ← 跑硬 Gate并生成 review summary；steer 在主 turn 完成攻击后携 mainTurnReview 重提
  ⑥ xdd_advance            ← 推进下一阶段（组末尾会跑组级 Gate）
     卡住：xdd_diagnose 记根因 -> xdd_rollback 回退 -> 沿链重做
  任意时刻：xdd_trace       ← 追溯链覆盖（design -> RXX -> @implements 健康度）
```

关键：`xdd_difference` 与 `xdd_submit_artifact` 跑的是**同一个真实硬 Gate**
（`gate.ts`：`requireGlobs` / `requireGlobsWithKeywords` / `requireGlobsWithMinSize` /
`gitHasChanges`）。所以 agent 提交前就能拿到 truthful 预检 -- core.md 原则 3
（Gate 决定推进，不许模型自宣布完成）的兑现。

### 跨阶段串联

```
init -> understand -> spec -> architecture -> wire -> resilience
  -> plan -> execute -> cleanup -> verify
每阶段重复 ①..⑥；desiredState + gate 在 stages.ts 按阶段定义。
```

### 阶段组（4 个宏观 Gate）

组边界与执行顺序连续：discovery(0-2) -> architecture(3-5) -> implementation(6-8) -> verification(9)。

| 组 | 阶段 | 组级 Gate | 回退目标 |
|---|---|---|---|
| discovery | init, understand, spec | Gate 1: design.md + spec rules.md + .feature | init |
| architecture | architecture, wire, **resilience** | Gate 2: architecture.md + resilience/failure-modes.md + git | architecture |
| implementation | plan, execute, cleanup | Gate 3: plan.md + git | plan |
| verification | verify | Gate 4: spec rules.md + verify-report.md | verify |

> **resilience 归属说明**：resilience 在 architecture 组（不在 discovery），因为 `xdd-resilience` skill 依赖 architecture（"韧性是架构的延伸"）。core.md 阶段一.6 的 "Feature 级可靠性" 由 spec 阶段的已知/未知四象限 desiredState 兜底；深度 FMEA + 韧性测试计划在 architecture 组（post-architecture）做。这让组边界与执行顺序连续，Gate 1 不再晚于 Gate 2 触发。

### 两种执行模型的颗粒度映射

xdd 有两种执行模型，颗粒度不同但流程对齐：

| core.md Phase | extension 组（10 阶段，程序化 gate） | agents phase（6 phase，checklist 自检） |
|---|---|---|
| Phase 1 需求研究/规格收敛 | discovery: init / understand / spec | brainstorm(understand) + design(spec 部分) |
| Phase 2 架构设计+系统韧性 | architecture: architecture / wire / resilience | design(architecture/wire 部分) + resilience |
| Phase 3 代码实现+清理 | implementation: plan / execute / cleanup | plan + build(execute+cleanup) |
| Phase 4 验证交付 | verification: verify | verify |

**颗粒度差异是模型适配的**：
- **extension**（细粒度）：10 阶段每阶段有程序化 gate，自动化控制循环需细粒度截断（spec gate 不过不进 architecture）。
- **agents**（粗粒度）：6 phase 每 phase 有 checklist，LLM 驱动用 phase 级自检（phase-design 合并 spec+architecture+wire 一次产出全部 BXX）。
- **spec 归属**：extension 放 discovery(Phase 1)，agents 放 phase-design(跨 Phase 1+2)——agents 把 spec+architecture+wire 合并设计，phase 内顺序仍 spec->architecture->wire，仅缺组间硬 gate（由 phase 末 checklist 兜底）。
- **cleanup 归属**：extension 独立阶段（softPass gate），agents 折进 phase-build（装 xdd-execute + xdd-cleanup，实现后即清理）。

### 保障（P 系列）

- **P3 Evidence First**：ESG（Engineering State Graph）记 decision/evidence/review/finding/task/checkpoint。
- **P5 Recoverability**：`checkpoint.ts` 持久化 `.xdd/checkpoint.json`，`resumeFromCheckpoint` 续跑。
- **上下文溢出恢复**：Pi 仍负责判断压缩时机与保留最近消息；活跃 xdd run 在 `session_before_compact` 从持久化流程状态生成有界、无需模型请求的 handoff，避免提供商已拒绝超长上下文时压缩请求再次失败。
- **P6 Runtime Independence**：通过 `XddRuntime` adapter 接入，不直接依赖 pi 内部。
- **P7 Human Governance**：`humanApprovalHook` 在 gate 失败 / 组回退 / verify 裁决时暂停等人审。

## 激活

```ts
import { HeadlessXddController, XddRunnerState, activateXddExtension, xddInlineExtension } from "./extensions/xdd/index.ts";

// 1. 注册 extension（经 pi 的 extensionFactories）
pi.registerExtension(xddInlineExtension);

// 2. 生产路径：pi command/event/tool handler 创建 XddCommand，交给 Controller dispatch
const state = new XddRunnerState({ runId, cwd, userInput });
activateXddExtension(state);

// 3. 测试/脚本路径：headless adapter 使用同一个 Controller Core，同步记录 effects
const headless = new HeadlessXddController(cwd);
const result = headless.dispatch({ type: "START", task, options: { cwd, runId } });
```

生产 `/xdd` 不再启动独立 `XddRunner.run()` 循环；pi 自身 turn cycle 触发的 command/event/tool handler 统一调用 Controller。extension 的 tools 仍通过模块级 `stateRef`（`getState`）读取运行 facade；无 run 激活时，tools 抛错、handlers no-op。

## 测试

```bash
# 从仓库根：
<pi>/packages/coding-agent/node_modules/.bin/vitest run --root extensions xdd/
```

覆盖：gate.ts（文件系统 gate）、observe-fs.ts（磁盘观测 + 追溯覆盖）、stage-diff.ts
（真实 gate diff）、core/controller.ts（唯一状态转换）、adapters/headless-controller.ts（测试适配器）、stage-groups.ts（组级 Gate）、
diagnosis.ts（根因分类）、xdd-trace.ts（追溯链工具）。T13 回归还覆盖空仓库/遗留仓库启动、understand 人审、provider error、verify 写保护、runtime 重启恢复、暂停恢复和 continuation lock 释放。

## Verify 自愈闭环（runtime v4）

verify 失败耗尽本地修复预算后，Controller 原子创建唯一 `HealingCase`，记录结构化 failure、负责范围、内容摘要 baseline、关闭条件和 generation。回炉后应先调用 `xdd_next_task`；它会把该 case 放在普通 desiredState 之前，并给出明确的正向修复入口。

负责阶段提交时必须携带 `healing` payload：`failureId`、负责范围内的 `changedPaths`、实际运行的 `commands`、引用 failureId 的 `evidencePaths` 和修复摘要。仅 touch、更新时间戳、修改 cleanup evidence 或 owner scope 外文件会被拒绝。原机械检查通过后 case 才进入 `ready-for-reverify`。

重新进入 verify 时，`xdd_submit_artifact` 由 Controller 重跑 Harness 并写入绑定 `verifyGeneration`、`healingCaseId` 和源码/设计/计划摘要的 `VerifyReceipt`。旧 evidence、旧 review 或 receipt 后源码变化都会返回可执行的 stale/subject-mismatch 修复动作。完整 verify 与 release checks 通过后，`xdd_advance` 才关闭 case。

`xdd_reset_budget` 默认不恢复 rollback allowance。显式恢复必须提供至少 20 字符原因并确认风险；active HealingCase 存在时拒绝恢复。`lifetimeRollbackCount` 与 reset history 永不清零并进入质量评分。

灰度开关 `XDD_HEALING_CASES=observe|enforce` 默认为 `enforce`。`observe` 仅降级 closure/freshness 的流程阻断，HealingCase、generation、摘要和审计仍持续写入；不得用开关恢复旧 evidence 的可信度。
