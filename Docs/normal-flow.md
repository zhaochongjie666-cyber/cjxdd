# Normal Flow 设计文档

> Normal Flow (NF) 是 xdd 的精简版：把 10 阶段折叠为 5 个，砍掉 AIGate / Hooks / Blind Journey / Group Gates 等可选机制，保留 reconcile 范式（desired state + 硬 gate）+ Controller 状态机。本文档沿用 xdd 的设计思路：声明式 API、阶段契约、Controller 单一状态机、P 系列保障、用户旅途 5 层次。

---

## 1. TL;DR

| | |
|---|---|
| **斜杠命令** | `/normal-flow <任务>` |
| **阶段数** | 5（explore → spec → plan → implement → verify） |
| **工具数** | 6（`nf_observe`、`nf_desired_state`、`nf_difference`、`nf_submit_artifact`、`nf_advance`、`nf_rollback`） |
| **复用** | xdd 的 `XddController` + `RuntimeStore` + Audit + Harness + Policy |
| **砍掉** | AIGate、外部可编程 Hooks、Blind Journey、Group Gates、Renderers、双预算 |
| **代码量** | ~1300 行 NF（含自建 stage contract-meta 表）+ 小型共享生命周期抽象 |

**用户操作**：输 `/normal-flow <任务>`，系统按 explore → spec → plan → implement → verify 顺序跑，每个阶段 gate 通过就推进。任意阶段卡住调 `nf_rollback`。完成后自动归档。

**与 xdd 的关系**：NF 不是替代品，是「想用 xdd 但觉得 10 阶段太重」的入口。复杂项目仍用 xdd。

---

## 2. 设计原则（沿用 xdd）

| 原则 | xdd 的实现 | NF 的实现 |
|------|----------|---------|
| **声明式 API** | 每个阶段给 desiredState 列表，agent 自行调谐 | **同** |
| **Controller 单一状态机** | `XddController.dispatch(command)` 是状态转换唯一入口 | **同**：复用 XddController |
| **文件优先状态** | `runtime.json` 是 SSOT，所有读 → 改 → atomic 写 | **同**：复用 RuntimeStore |
| **阶段契约** | StageContract 编译期校验（inputs/outputs/scopes/gatePolicy/rollbackPolicy） | **同**：每阶段显式声明 contracts |
| **Gates 真把门** | 硬 gate 基于文件系统，不信任自报完成 | **同**：每个 gate 跑真实的 `requireGlobs` / `requireTestsPass` |
| **P 系列保障** | P3 Evidence First / P5 Recoverability / P6 Runtime Independence / P7 Human Governance | **保留 P3、P5、P6**；**简化 P7**（无 pendingGroupApproval） |
| **用户旅途 5 层次** | 主线 / 分支 / 迂回 / 意外 / 探索 | **同**：第 6 节详细展开 |

---

## 3. 架构

```
                          一份纯逻辑（pi 无关）
              observe-fs.ts  +  stage-diff.ts  +  gate.ts
                                       │
                                       ▼
              ┌────────────────────────────────────────────┐
              │  pi inline extension                       │
              │  extension.ts + flow.ts + tools/           │
              │  统一调 XddController.dispatch(command)    │
              └────────────────────────────────────────────┘
```

NF 没有自己的 Controller 状态机 —— **完全复用** `extensions/xdd/core/controller.ts` 的 `XddController` 类。为避免把 NF 恢复成 10 阶段 xdd run，先将 xdd 的启动/恢复生命周期抽成可注入 `stages`、extension activate 函数和用户面文案的共享 helper；`/normal-flow-resume` 绝不能调用当前固定 `STAGES` 的 `/xdd-resume` 路径。

NF 新增：

- 5 个 stage 定义（`stages.ts`）
- 6 个 `nf_*` 工具（`tools/`）
- 1 个 slash command（`flow.ts`）
- extension 事件注册（`extension.ts`）

并对共享层做以下改动：

- **预算覆盖走 `XddRunnerState` 属性 setter，而不是 `StartOptions`**：现有 `StartOptions`（`core/commands.ts`）只有 `{ cwd, runId?, plan?, initialStage? }` 四个字段，没有预算字段；`startTransition` 生成的初始状态来自 `minimalRuntime()`，其内部无条件写死 `maxSelfHealPerStage: 5`、`flowRollbackLimit: 7`，与传入的 `stages` 无关。NF 的 start 流程必须照抄 `runXdd()` 对 `flowBudgetUsd` 的现成做法：`dispatch(START)` 之后立即设置 `state.maxSelfHealPerStage = 3`（非 deprecated，可直接用）；`flowRollbackLimit` 目前只有 `flowRollbackLimitTier1`/`Tier2` 两个标了 `@deprecated` 的别名 setter，NF 先借用其一，并把“给 xdd 补一个非 deprecated 的 `flowRollbackLimit` setter”列为对 xdd 的小改动项（见第 12 节）。
- `resumeFlow()` 从 checkpoint 重建**调用方传入的** stage plan 并 activate 对应 extension；session-start 检测也由 NF 自己注册。生命周期 hook 仅用于 pause/resume/归档，不向用户暴露外部可编程 hook 点。
- **显式前提（必须写进测试）**：`XddController` 构造函数、`transition()`、`currentStage()` 的 `stages` 参数默认值都是 xdd 的 `STAGES`；cwd 无 runtime.json 时收到非 START 命令，`minimalRuntime()` 更是直接硬编码 `plan: STAGES.map(...)`。这些默认值只有在“同一个 cwd 收到的第一条命令一定是 `START`”时才不会被触发。NF 的每个 `nf_*` 工具必须在 dispatch 前确认 runtime.json 已存在，不存在就报错退出，不能静默走到 Controller 的 xdd 默认兜底。

---

## 4. 5 阶段契约

沿用 xdd 的 `XddStageSpec` 结构（`role` / `skill` / `exit` / `allowedTools` / `deliverablePaths` / `inputs` / `outputs` / `readScopes` / `writeScopes` / `gatePolicy` / `rollbackPolicy` / `desiredState` / `gate`）。当前类型的 `aigateStandard` 仍是必填字段：共享类型应将其改为仅在 `aiGate.enabled` 时必填，或 NF stage 必须显式填写一个“NF 不启用 AIGate”的占位标准；不能照下方简写遗漏该字段直接实现。

`compileStageContracts`（`extensions/xdd/core/stage-contract.ts`）在阶段激活时强制校验 `inputs`、`outputs`、`readScopes`、`writeScopes`、`gatePolicy`、`hardGate`、`rollbackPolicy` 七个字段全部非空，否则抛 `StageContractError`；`outputs` 里标了 `required: true` 的 `pattern` 还必须被 `writeScopes` 覆盖。xdd 自己的 10 个阶段定义能省掉这些字段，是因为 `extensions/xdd/stages.ts` 内部有一个**未导出的私有** helper：`withStageContract()` + `CONTRACT_META` 查找表，在模块加载时把这些字段自动拼接到每个阶段上（`hardGate` 恒等于 `gate`）。这套私有机制不能被 NF import，NF 的 `stages.ts` 必须二选一：(a) 仿照同样的模式自建一份 `NF_CONTRACT_META` + `withNfStageContract()`；(b) 每个阶段手写全部字段。下面 4.1 采用 (b)，`inputs`/`outputs`/`hardGate` 均已补全。

| 阶段 | xdd 名 | role | skill | 写入 |
|------|--------|------|-------|------|
| **explore** | `understand` | Requirements Analyst | `xdd-brainstorm` | `.xdd/design/intent.md`, `.xdd/design/design.md` |
| **spec** | `spec` | API Designer | `xdd-spec` | `.xdd/design/spec/{bxx}/rules.md`, `.feature` |
| **plan** | `plan` | Project Manager | `xdd-plan` | `.xdd/runs/iter-N/plan.md` |
| **implement** | `execute` | Implementer | `xdd-execute` | source code (`src/`, `lib/`, `tests/`) |
| **verify** | `verify` | Auditor | `xdd-verify` | `.xdd/runs/iter-N/verify-report.md` |

> **为什么用 xdd 名而不是新名**：复用 `XddStageSpec.name` 字段 + runtime.json schema。display name 在 prompt 层翻译，runtime 不变。
>
> 详细映射见第 8 节。

### 4.1 explore 契约

```typescript
const exploreGate: XddGate = async ({ cwd }) => {
  const intentOk = await requireGlobs(cwd, [".xdd/design/intent.md"]);
  if (!intentOk.ok) return { ok: false, reason: "explore Gate: 缺少 .xdd/design/intent.md" };
  const designOk = await requireGlobsWithKeywords(
    cwd, [".xdd/design/design.md"],
    ["Selected", "Alternatives", "Assumptions", "Out of Scope", "Open Questions"], 3
  );
  if (!designOk.ok) return { ok: false, reason: "explore Gate: .xdd/design/design.md 缺少收敛决策 5 段（至少 3 段）" };
  return { ok: true };
};

{
  name: "understand",                              // xdd stage 名（与 display name 解耦）
  role: "Requirements Analyst",
  skill: "xdd-brainstorm",
  exit: "goal_complete",
  allowedTools: [...READ_TOOLS, ...WRITE_TOOLS, ...NF_TOOLS],
  deliverablePaths: [".xdd/design/intent.md", ".xdd/design/design.md"],
  inputs: [
    { pattern: "README*", required: true, description: "仓库 README/说明文档（如存在）" },
  ],
  outputs: [
    { pattern: ".xdd/design/intent.md", required: true, description: "意图锚：1 句话定位 + 可验证成功标准 + 非目标" },
    { pattern: ".xdd/design/design.md", required: true, description: "5 段收敛决策：Selected/Alternatives/Assumptions/Out of Scope/Open Questions" },
  ],
  readScopes:  ["**/*.md", ".xdd/**", "package.json", "pyproject.toml", "Cargo.toml"],
  writeScopes: [".xdd/design/**", ".xdd/runs/**"],   // 必须覆盖上面两条 outputs 的 pattern
  gatePolicy: "hard",
  // explore 是 NF 的第一个阶段（NF 没有 init 阶段），没有更早的阶段可回退；
  // 不能照抄 xdd understand 阶段的 "init"（NF plan 里不存在该 stage 名，
  // compileStageContracts 会因 rollback target 找不到而拒绝激活）。
  rollbackPolicy: { target: "none", reason: "explore 是首个阶段，无回退目标" },
  aigateStandard: "NF 不启用 AIGate；语义质量由 verify 阶段证据审查负责。",

  desiredState: [
    "已读完前序产物（仓库 README / docs/）",
    "已产出意图锚 .xdd/design/intent.md（1 句话定位 + 可验证成功标准 + 非目标）",
    "已产出 .xdd/design/design.md（5 段：Selected / Alternatives / Assumptions / Out of Scope / Open Questions）",
  ],

  gate: exploreGate,
  hardGate: exploreGate,   // StageContract 要求非空；xdd 约定 hardGate 恒等于 gate
}
```

### 4.2 spec / plan / implement / verify

类似结构，详见 `extensions/normal-flow/stages.ts`。每个阶段的 gate：

| 阶段 | Gate 硬检查 |
|------|-----------|
| **explore** | `intent.md` 存在 + `design.md` 含 5 关键词 ≥ 3 |
| **spec** | `rules.md` ≥ 100B + ≥ 1 个 `.feature` |
| **plan** | `plan.md` ≥ 100B |
| **implement** | `npm test` exit 0（go test / make test 自动检测）+ `@implements RXX` 覆盖 spec RXX |
| **verify** | `verify-report.md` ≥ 100B + `npm test` exit 0 + spec ↔ code 追溯闭合 |

---

## 5. 工具（6 个，对齐 xdd 工具语义）

每个工具的输入/输出与 xdd 对应工具一致，只是命名空间 `nf_`：

| 工具 | 对齐 xdd | 调用时机 | 用户看到什么 |
|------|---------|---------|-------------|
| `nf_observe` | `xdd_observe` | 任意 turn | 当前状态：阶段、剩余预算、磁盘产物 |
| `nf_desired_state` | `xdd_desired_state` | 阶段起手 | 本阶段 desiredState 列表 |
| `nf_difference` | `xdd_difference` | 起手 / 卡住 | 缺口分析（跑真硬 gate + 分类 desiredState） |
| `nf_submit_artifact` | `xdd_submit_artifact`（去 AIGate） | 阶段收尾 | ❌/⚠️/✅ + 剩余预算 |
| `nf_advance` | `xdd_advance` | gate 通过 | 进入下一阶段（或 run 完成） |
| `nf_rollback` | `xdd_rollback` | 预算耗尽 / 跨阶段回退 | 回退到 X 阶段 |

**与 xdd 工具的关键差异**：`nf_submit_artifact` **不调用 AIGate**。只有硬 gate（filesystem check）。语义审查靠硬 gate 的关键词 / 字节数下限。

---

## 6. 运行流程（用户视角）

### 6.1 单次控制循环

```
   agent 进入一个阶段（如 spec）
     ① nf_observe          ← 当前状态（内存 + 磁盘）
     ② nf_desired_state    ← 本阶段目标
     ③ nf_difference       ← 跑真 gate + 算缺口
     ④ agent 按缺口工作（read / write / edit / bash）
     ⑤ nf_submit_artifact  ← 提交产物 + 硬 gate
     ⑥ nf_advance          ← gate 通过后推进
        卡住：nf_rollback  ← 回到上一个干净阶段
   任意时刻：runtime.json  ← 状态唯一可信源（落盘）
```

### 6.2 跨阶段串联

```
/normal-flow <task>
   ↓
explore → spec → plan → implement → verify
                                     ↓
                                  runComplete=true
                                     ↓
                              自动归档 runs/iter-N → .xdd/archive/
```

### 6.3 主线时间线（示例："给 web app 加 OAuth 登录"）

```
T+0     用户：/normal-flow 给 web app 加 OAuth 登录
        系统：自动装载 xdd-brainstorm skill，agent 写 intent.md + design.md
T+5m    agent：nf_desired_state → 列出 explore 的目标
        agent：nf_difference → 空 diff = 通过
        agent：nf_submit_artifact → explore gate 通过 → nf_advance

T+10m   spec 阶段
        装载 xdd-spec
        agent：写 rules.md + .feature
        agent：nf_submit_artifact → spec gate 通过 → nf_advance

T+15m   plan 阶段
        装载 xdd-plan
        agent：写 plan.md
        agent：nf_submit_artifact → plan gate 通过 → nf_advance

T+25m   implement 阶段
        装载 xdd-execute
        agent：写代码（含 @implements RXX 标注）+ 测试
        agent：npm test → exit 0
        agent：nf_submit_artifact → implement gate 通过 → nf_advance

T+35m   verify 阶段
        装载 xdd-verify
        agent：跑 npm test → exit 0
        agent：写 verify-report.md（逐 RXX 验证证据）
        agent：nf_submit_artifact → verify gate 通过（verdict=pass）

T+40m   runComplete=true → 自动归档
        用户看到：
          ┌────────────────────────────────────────────┐
          │ Normal Flow 完成                             │
          │ - 13 RXX 全部实现（@implements 标注齐全）   │
          │ - npm test 全过                              │
          │ - 归档：.xdd/archive/iter-1.md              │
          └────────────────────────────────────────────┘
```

用户净投入：3 分钟（输一次 + 等）。系统产出：完整 spec + 计划 + 测试覆盖的实现 + 设计文档。

---

## 7. 用户旅途 5 层次

### 7.1 主线

`/normal-flow <task>` → 5 阶段顺序推进 → verify 通过 → 自动归档。

### 7.2 分支（辅助能力）

- **可观察的跳过**：NF 没有 `wire` 阶段。默认不允许用 prompt 跳过任一 NF 阶段；`nf_advance` 必须先收到对应 hard gate 的完成信号。未来若增加可跳阶段，必须在 stage contract 中声明 `skippableWhen`，并由 Controller 可观察的文件/配置条件、audit 事件和用户面原因共同证明。
- **指定 rollback target**：调 `nf_rollback` 时传 targetStage，默认由 Controller 推断
- **状态查询**：任何 turn 调 `nf_observe` 看完整状态

### 7.3 迂回（暂停 / 恢复）

```
场景：pi 在 explore 阶段误关

T+0    重新启动 pi
       session_start hook 检测到 checkpoint：
         "[NF] 检测到未完成的 run（run-1742...）。输入 /normal-flow-resume 恢复"
T+30s  用户：/normal-flow-resume
       系统：读 .xdd/runtime.json → 重建 state → bump epoch → queue follow-up
       agent：继续 explore 阶段
```

实现：复用 xdd runtime 的 `pauseNotified` / `continuationEpoch` / `paused` 字段和 `RESUME` 状态转换；NF 自己通过 `resumeFlow({ stages: NF_STAGES, activate: activateNormalFlowExtension })` 重建 5 阶段 in-memory plan。不得复用会固定装载 `STAGES` 和 xdd extension 的 `/xdd-resume` handler。

### 7.4 意外（失败处理）

```
agent 写完产物 → nf_submit_artifact
  └─ 硬 Gate 跑真实检查（filesystem 真实存在 + 字节数 + 关键字）
       │
       ├─ Gate 通过 → 写信号 + advance
       │
       └─ Gate 失败 → agent 看到错误文本
              │
              ├─ 自愈预算剩（默认 3 次）
              │   agent 重做 → 重提 → 仍可继续
              │
              └─ 自愈预算耗尽
                    ├─ verify 阶段：自动消耗 flow 回退预算（默认 7 次）→ 回退到 implement
                    └─ 其他阶段：软通过到下一阶段（记录告警 audit）
```

**示例：spec 阶段 rules.md Gate 失败**

```
attempt 1: rules.md 只有 80B → Gate 要求 ≥ 100B → FAIL
  self-heal budget: 3 → 还剩 3
attempt 2: agent 补充规则到 130B → Gate ✓ → PASS
```

**示例：verify 阶段 requireTestsPass 失败**

```
attempt 1: npm test exit 1 → FAIL（5 测试失败）
  budget 3 → 还剩 3
attempt 2: agent 修了 3 个实现 bug → 重提 → exit 0 → PASS
```

### 7.5 探索（状态查询）

- `nf_observe` → 当前阶段、产物状态、剩余预算、disk 产物
- `nf_difference` → 哪些 desiredState 已满足 / 哪些还需自检
- `.xdd/runtime.json` 直接查看（schema v3，所有字段含义见 `Docs/pi-coding-agent-session-turn-loop.md`）
- `.xdd/archive/iter-N.md` → 历史 run 摘要

---

## 8. 阶段 display name ↔ xdd stage name 映射

| NF display | xdd stage name | 出现在 |
|------------|---------------|--------|
| explore | `understand` | `XddStageSpec.name` |
| spec | `spec` | `XddStageSpec.name` |
| plan | `plan` | `XddStageSpec.name` |
| implement | `execute` | `XddStageSpec.name` |
| verify | `verify` | `XddStageSpec.name` |

**为什么用 xdd 名**：复用 `XddStageSpec` 类型 + `XddRunnerState.plan[].stageName` 字段，不引入新 type literal。runtime.json 完全兼容。

**translation 发生在哪里**：
- `extension.ts` 的 `before_agent_start` hook：调用 `buildStagePrompt()` 时把 `stage.name` 翻译成 display name
- 工具响应：`nf_observe` 输出时把内部名映射回 display name
- 用户 prompt / xdd_observe 文本：始终显示 display name

---

## 9. 保障（沿用 xdd P 系列，简化 P7）

### 9.1 P3 Evidence First

- `runtime.json` 记录每次 `nf_submit_artifact` 的 `submittedArtifacts` + `esg[]` 节点
- `nf_observe` 输出 ledger 摘要（最近 5 条 attempt + pass/fail）
- 不写入 design/（保持 design/ 是持久设计锚）

### 9.2 P5 Recoverability

- `runtime.json` 原子写入（`atomicWriteJson` 的 tmp + rename）
- session_start hook 检测未完成 run → `ctx.ui.notify` 提示 `/normal-flow-resume`
- `/normal-flow-resume` 重建 state、bump continuationEpoch、queue follow-up
- **已知缺口**：xdd 自己的 `session_start` hook（`extensions/xdd/extension.ts`）只要 `readCheckpoint(process.cwd())` 有返回值就提示 `/xdd-resume`，不区分该 checkpoint 是不是 NF 建的。两个 extension 按仓库 `AGENTS.md` 是一起装进 `~/.pi/agent/extensions` 的，这条缺口是真实存在的，缓解方式见第 13 节

### 9.3 P6 Runtime Independence

- NF 不绑 pi 内部细节（`flow.ts` 只通过 `ExtensionAPI` 接口调用）
- `XddController` 的 dispatch/transition 主路径不知道是 NF 还是 xdd 在用（`stages` 全程作为参数传递）；但 `minimalRuntime()` 和几处默认参数仍隐式硬编码 xdd 的 `STAGES`（见第 3 节“显式前提”），只要 NF 保证每个 cwd 的首条命令一定是 `START`，这一层“不知道”就成立
- 切换 run 上下文（换 cwd）只需要重新 activate

### 9.4 P7 Human Governance（简化）

- **不实现 pendingGroupApproval**（组 gate 砍掉了）
- 失败时只有两个选项：
  - **verify 阶段**：自动消耗 flow 预算回退（人类不需要介入，除非预算耗尽）
  - **其他阶段**：软通过（人类不需要介入；audit 记录告警）
- 真实需要人工的场景：**自愈预算耗尽 + verify 也耗尽** → run 失败，提示用户决定（重启 run 或修复产物）

### 9.5 预算默认值

| 预算 | 默认值 | 配置位置 |
|------|-------|---------|
| 自愈预算（每阶段） | 3 | NF start 流程在 `dispatch(START)` 后 `state.maxSelfHealPerStage = 3`（`XddRunnerState` setter，不是 `StartOptions`） |
| Flow 回退预算（整个 run） | 7 | 与 xdd 默认值相同，通常无需覆盖；如需显式设置走 `state.flowRollbackLimitTier1 = 7`（`@deprecated` 别名，暂无干净 setter） |
| 流 USD 预算 | $500 | `XDD_FLOW_BUDGET_USD` env（xdd/NF 共用同一个环境变量） |

---

## 10. 与 xdd 的差异（明确表）

| | xdd | NF |
|---|-----|-----|
| 阶段数 | 10 | 5 |
| 自愈预算/阶段 | 5 | 3 |
| AIGate | ✅（10 min timeout，per stage） | ❌ |
| 双预算（hard + ai） | ✅ | ❌（只 hard_gate） |
| Group Gates | ✅（4 组） | ❌ |
| 外部可编程 Hooks | ✅（4 hook points） | ❌ |
| 内部生命周期事件（暂停/恢复/归档） | ✅ | ✅（最小必需） |
| Blind Journey | ✅ | ❌ |
| Renderers（TUI） | ✅ | ❌ |
| Stage role 数量 | 10 角色 | 5 角色 |
| `pendingGroupApproval` | 死代码（实现保留） | 不实现 |
| 总 LoC | ~7500 | ~1300 + 小型共享生命周期抽象 |

**为什么砍**：
- **AIGate**：单次 10 分钟超时 + 高 LLM 成本，对"快 + 简单"场景是负担；需要时切到 xdd
- **外部可编程 Hooks**：简单流不需要外部可编程介入点；但 pause/resume/归档仍需要最小的内部生命周期事件
- **Group Gates**：5 阶段不需要组级聚合
- **Blind Journey**：仅 UI 项目需要
- **Renderers**：非必需
- **双预算**：NF 只跑硬 gate，不需要 ai_gate 预算独立
- **PendingGroupApproval**：组 gate 移除后无需求

---

## 11. 文件布局

```
extensions/normal-flow/
├── README.md                   # 用户面使用文档（启动 / 命令 / 故障排查）
├── index.ts                    # re-export + default factory
├── extension.ts                # pi InlineExtension factory（事件 + 工具注册）
├── flow.ts                     # /normal-flow、/normal-flow-resume 等命令 + start/resume 流程
├── stages.ts                   # 5 阶段定义（role / skill / gate / desiredState）
├── gate.ts                     # re-export 硬 gate helpers + NF-specific
├── types.ts                    # NormalFlow 类型别名（薄）
└── tools/
    ├── index.ts                # createNfTools(getState) → 6 工具
    ├── nf-observe.ts
    ├── nf-desired-state.ts
    ├── nf-difference.ts
    ├── nf-submit-artifact.ts   # 不调用 AIGate
    ├── nf-advance.ts
    └── nf-rollback.ts
```

约 **1300 行**（其中 stages.ts 350 行，含 NF 自建的 contract-meta 补全表 / 6 tools 600 行 / extension+flow 250 行 / 共享 lifecycle 抽象与测试约 150 行）。不含直接 re-export `context.ts`/`epoch-slicer.ts`/`context-prune.ts`/`skill-loader.ts` 等纯函数 helper 的胶水代码（预计 <50 行）。

---

## 12. 复用映射（NF 依赖的 xdd 模块）

| Normal Flow 符号 | 来源 |
|------------------|------|
| `XddController`, `transition`, `ControllerError` | `extensions/xdd/core/controller.ts` |
| `XddCommand`, `RunStatus`, `StartOptions` | `extensions/xdd/core/commands.ts` |
| `XddEffect` | `extensions/xdd/core/effects.ts` |
| `XddRunnerState` | `extensions/xdd/types.ts` |
| `XddStageSpec`, `STAGE_ROLES` | `extensions/xdd/types.ts` |
| `RuntimeStore`, `atomicWriteJson` | `extensions/xdd/storage/runtime-store.ts` |
| `migrateRuntimeState`, `RUNTIME_SCHEMA_VERSION` | `extensions/xdd/storage/runtime-migrations.ts` |
| `requireGlobs` / `requireGlobsWithKeywords` / `requireGlobsWithMinSize` / `requireTestsPass` / `requirePatternInSource` / `runBuild` | `extensions/xdd/gate.ts` |
| `projectAuditEvent`, `buildAuditView`, `renderAuditView` | `extensions/xdd/audit/projector.ts` |
| `XddAuditEvent` | `extensions/xdd/audit/events.ts` |
| `HarnessStore`, `XddHarness`, `serializeHarnessYaml` | `extensions/xdd/harness/store.ts` |
| `conciseHarness` | `extensions/xdd/harness/schema.ts` |
| `enforceToolCallPolicy` | `extensions/xdd/policy/tool-policy.ts` |
| `checkStagePathAccess` | `extensions/xdd/policy/path-policy.ts` |
| `applyStageBashPolicy` | `extensions/xdd/policy/bash-policy.ts` |
| `buildActiveStageSystemPrompt` | `extensions/xdd/context.ts` |
| `sliceByEpoch`, `EPOCH_MARKER_PREFIX` | `extensions/xdd/epoch-slicer.ts` |
| `pruneContextMessages` | `extensions/xdd/context-prune.ts` |
| `loadXddSkills` | `extensions/xdd/skill-loader.ts` |
| `resolveGlobs`, `hasGlobMeta` | `extensions/xdd/glob-resolver.ts` |
| `configuredFlowBudgetUsd`, `assistantFlowUsage` | `extensions/xdd/flow-budget.ts` |
| `controllerInitScaffold`, `hasInitializedXddSkeleton` | `extensions/xdd/init-scaffold.ts`（NF 没有 init 阶段，靠这个建 `.xdd/` 骨架） |
| `resumeFlow`（新增共享 helper） | 从 `extensions/xdd/run.ts` 提取；注入 stages / activate / 文案 |
| `NF_CONTRACT_META`, `withNfStageContract`（NF 新增，非 xdd 复用） | `extensions/normal-flow/stages.ts`；仿照 xdd `stages.ts` 内私有的 `CONTRACT_META`/`withStageContract` 模式自建，用来补全 `inputs`/`outputs`/`hardGate`（详见第 4 节） |

**新增量**：5 个 stage 定义（含各自的 contract-meta 补全）、6 个 nf_* 工具、start/resume 命令、extension 事件 wiring，以及可参数化的共享 lifecycle helper。`context.ts`/`epoch-slicer.ts`/`context-prune.ts`/`skill-loader.ts` 等纯函数 helper 可直接 re-export；`extension.ts` 本身（事件注册 + `stateRef` 单例）仍需要 NF 自己写一份，不能跨模块共享同一个 `stateRef`。

---

## 13. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 与 xdd 共享 `runtime.json` 导致冲突 | 启动时检查 `state.plan[].stageName` 是否全部 ∈ `{understand, spec, plan, execute, verify}`，否则提示「cwd 已被 xdd run 占用，请先 /xdd-stop 或新开 cwd」 |
| **xdd 自己的 `session_start` 对 NF 的 checkpoint 提示错误的 `/xdd-resume`** | `readCheckpoint(process.cwd())` 不区分 runtime.json 归属；给 `extensions/xdd/extension.ts` 的 session_start 加一条「`plan[].stageName` 若全部 ∈ NF 阶段集合就不提示 `/xdd-resume`，改提示 `/normal-flow-resume`」的判断（或在 runtime.json 加一个 `flow: "xdd" \| "nf"` 标记，两侧 session_start 都读它）；这是需要对 xdd 现有代码做的小改动，不是 NF 单侧能兜住的 |
| **`XddController` 默认参数仍隐式绑定 xdd 的 `STAGES`** | `minimalRuntime()`、构造函数、`transition()` 的 `stages` 缺省值都是 `STAGES`；只在“cwd 无 runtime.json 时收到非 START 命令”这一边界情况触发。NF 每个 `nf_*` 工具 dispatch 前必须确认 runtime.json 已存在，不存在就报错，不允许静默走 Controller 默认兜底；验证清单新增专项测试（第 14 节） |
| 砍掉 AIGate 后语义漏洞靠硬 gate 抓不到 | 硬 gate 已覆盖「文件存在 + 字节数 + 关键词」；AIGate 抓的「AI 味 / 实现细节冒充业务规则」等留给 verify 阶段人工 review |
| 5 阶段对复杂项目粒度过粗 | 复杂项目用 xdd；NF 定位为「快 + 简单」场景，文档中明确说明 |
| 自愈预算 3 次太少 | 3 次 = 1 次原始 + 2 次重试；如需更多可在 start 流程里把 `state.maxSelfHealPerStage` 设成更大的值 |
| display name ↔ xdd stage name 映射造成日志混淆 | 所有用户面（prompt / tool 输出 / 文档）使用 display name；runtime.json 保留 xdd 名（向后兼容） |
| checkpoint 恢复错误装载 xdd 的 10 阶段 | `resumeFlow` 强制注入 `NF_STAGES` 和 NF activate 函数；跨进程恢复测试断言 plan 恒为 5 阶段 |
| NF 预算意外继承 xdd 的 5 次/7 次默认值 | start 流程在 `dispatch(START)` 后显式设置 `state.maxSelfHealPerStage = 3`（`flowRollbackLimit` 默认值本就是 7，无需覆盖）；启动和恢复测试断言 runtime 预算不漂移 |

---

## 14. 验证清单（实现后必跑）

- [ ] `extension.ts` 注册 6 个工具 + 1 个 slash 命令，无 TS 编译错
- [ ] 5 个 NF stage 定义通过 TypeScript 类型检查和 `compileStageContracts()`（含 `inputs`/`outputs`/`hardGate` 补全、`outputs` 的 `required` pattern 被 `writeScopes` 覆盖）；`aigateStandard` 的占位标准有单测
- [ ] `explore` 阶段的 `rollbackPolicy.target` 为 `"none"`（不是 `"init"`）且能通过 `compileStageContracts` 的 rollback 校验
- [ ] `stages.ts` 的 5 个 gate 全部能在空仓库上「应失败」
- [ ] 故意写空 `intent.md` → explore gate 报缺 `design.md`
- [ ] `npm test` 在 `implement` 阶段失败时，gate 报 exit code + stderr 前 800 字
- [ ] verify 阶段 3 次 hard-gate budget 耗尽后，触发自动 ROLLBACK 到 implement；flow rollback 预算为 7
- [ ] 关闭 pi 后重新启动 → checkpoint 提示恢复 → `/normal-flow-resume` 重建且只重建 5 阶段 plan
- [ ] 启动、暂停、恢复后 `maxSelfHealPerStage=3`、`flowRollbackLimit=7` 不变（通过 `state.maxSelfHealPerStage` setter 验证，不是 `StartOptions`）
- [ ] 同 cwd 已有 xdd run 时启动 NF → 提示冲突并拒绝启动
- [ ] 在无 `runtime.json` 的 cwd 上直接调用非 START 的 `nf_*` 工具 → 报错，不静默创建 xdd 10 阶段 plan
- [ ] xdd 和 NF 同时安装时，对一个 NF 创建的 checkpoint 重启 pi → 不出现「/xdd-resume」的误导提示

---

## 15. 一手参考

- xdd 状态机 / 生命周期：`Docs/pi-coding-agent-session-turn-loop.md`
- xdd 设计决策（5 阶段用户旅途）：`extensions/xdd/USER-JOURNEY.md`
- xdd 阶段契约（compile-time validation）：`extensions/xdd/core/stage-contract.ts`
- xdd stage 定义样板：`extensions/xdd/stages.ts`
- xdd refactor 设计（含已识别问题清单）：`docs/refactor.md`
- Pi extension API：<https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md>
