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
| **砍掉** | AIGate、Hooks、Blind Journey、Group Gates、Renderers、双预算 |
| **代码量** | ~1000 行（xdd 的 ~7500 行的 1/7） |

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

NF 没有自己的 Controller 状态机 —— **完全复用** `extensions/xdd/core/controller.ts` 的 `XddController` 类。NF 只新增：

- 5 个 stage 定义（`stages.ts`）
- 6 个 `nf_*` 工具（`tools/`）
- 1 个 slash command（`flow.ts`）
- extension 事件注册（`extension.ts`）

---

## 4. 5 阶段契约

沿用 xdd 的 `XddStageSpec` 结构（`role` / `skill` / `exit` / `allowedTools` / `deliverablePaths` / `inputs` / `outputs` / `readScopes` / `writeScopes` / `gatePolicy` / `rollbackPolicy` / `desiredState` / `gate`）。

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
{
  name: "understand",                              // xdd stage 名（与 display name 解耦）
  role: "Requirements Analyst",
  skill: "xdd-brainstorm",
  exit: "goal_complete",
  allowedTools: [...READ_TOOLS, ...WRITE_TOOLS, ...NF_TOOLS],
  readScopes:  ["**/*.md", ".xdd/**", "package.json", "pyproject.toml", "Cargo.toml"],
  writeScopes: [".xdd/design/**", ".xdd/runs/**"],
  gatePolicy: "hard",
  rollbackPolicy: { target: "init", reason: "explore 默认回退到 init" },

  desiredState: [
    "已读完前序产物（仓库 README / docs/）",
    "已产出意图锚 .xdd/design/intent.md（1 句话定位 + 可验证成功标准 + 非目标）",
    "已产出 .xdd/design/design.md（5 段：Selected / Alternatives / Assumptions / Out of Scope / Open Questions）",
  ],

  gate: async ({ cwd }) => {
    const intentOk = await requireGlobs(cwd, [".xdd/design/intent.md"]);
    if (!intentOk.ok) return { ok: false, reason: "explore Gate: 缺少 .xdd/design/intent.md" };
    const designOk = await requireGlobsWithKeywords(
      cwd, [".xdd/design/design.md"],
      ["Selected", "Alternatives", "Assumptions", "Out of Scope", "Open Questions"], 3
    );
    if (!designOk.ok) return { ok: false, reason: "explore Gate: .xdd/design/design.md 缺少收敛决策 5 段（至少 3 段）" };
    return { ok: true };
  },
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

- **跳过 stage**：在 prompt 中明确"跳过 wire"，通过 `nf_advance` 手动推进（gate 失败时不会强制阻断）
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

实现：复用 xdd 的 `pauseNotified` / `continuationEpoch` / `paused` 机制（Controller 已有），不需要 NF 重新实现。

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

### 9.3 P6 Runtime Independence

- NF 不绑 pi 内部细节（`flow.ts` 只通过 `ExtensionAPI` 接口调用）
- `XddController` 不知道是 NF 还是 xdd 在用
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
| 自愈预算（每阶段） | 3 | `types.ts` `maxSelfHealPerStage` |
| Flow 回退预算（整个 run） | 7 | `runtime.json` `flowRollbackLimit` |
| 流 USD 预算 | $500 | `XDD_FLOW_BUDGET_USD` env |

---

## 10. 与 xdd 的差异（明确表）

| | xdd | NF |
|---|-----|-----|
| 阶段数 | 10 | 5 |
| 自愈预算/阶段 | 5 | 3 |
| AIGate | ✅（10 min timeout，per stage） | ❌ |
| 双预算（hard + ai） | ✅ | ❌（只 hard_gate） |
| Group Gates | ✅（4 组） | ❌ |
| Hooks | ✅（4 hook points） | ❌ |
| Blind Journey | ✅ | ❌ |
| Renderers（TUI） | ✅ | ❌ |
| Stage role 数量 | 10 角色 | 5 角色 |
| `pendingGroupApproval` | 死代码（实现保留） | 不实现 |
| 总 LoC | ~7500 | ~1000 |

**为什么砍**：
- **AIGate**：单次 10 分钟超时 + 高 LLM 成本，对"快 + 简单"场景是负担；需要时切到 xdd
- **Hooks**：简单流不需要外部可编程介入点
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
├── flow.ts                     # /normal-flow 等斜杠命令 + start 流程
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

约 **1000 行**（其中 stages.ts 300 行 / 6 tools 600 行 / extension+flow 200 行 / 其他 100 行）。

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

**新增量**：5 个 stage 定义、6 个 nf_* 工具、1 个 slash command、extension 事件 wiring。其他文件大部分 re-export。

---

## 13. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 与 xdd 共享 `runtime.json` 导致冲突 | 启动时检查 `state.plan[].stageName` 是否全部 ∈ `{understand, spec, plan, execute, verify}`，否则提示「cwd 已被 xdd run 占用，请先 /xdd-stop 或新开 cwd」 |
| 砍掉 AIGate 后语义漏洞靠硬 gate 抓不到 | 硬 gate 已覆盖「文件存在 + 字节数 + 关键词」；AIGate 抓的「AI 味 / 实现细节冒充业务规则」等留给 verify 阶段人工 review |
| 5 阶段对复杂项目粒度过粗 | 复杂项目用 xdd；NF 定位为「快 + 简单」场景，文档中明确说明 |
| 自愈预算 3 次太少 | 3 次 = 1 次原始 + 2 次重试；如需更多可在 `runtime.json` 调 `maxSelfHealPerStage` |
| display name ↔ xdd stage name 映射造成日志混淆 | 所有用户面（prompt / tool 输出 / 文档）使用 display name；runtime.json 保留 xdd 名（向后兼容） |

---

## 14. 验证清单（实现后必跑）

- [ ] `extension.ts` 注册 6 个工具 + 1 个 slash 命令，无 TS 编译错
- [ ] `stages.ts` 的 5 个 gate 全部能在空仓库上「应失败」
- [ ] 故意写空 `intent.md` → explore gate 报缺 `design.md`
- [ ] `npm test` 在 `implement` 阶段失败时，gate 报 exit code + stderr 前 800 字
- [ ] verify 阶段 5 次 budget 耗尽后，触发自动 ROLLBACK 到 implement
- [ ] 关闭 pi 后重新启动 → checkpoint 提示恢复 → `/normal-flow-resume` 续跑
- [ ] 同 cwd 已有 xdd run 时启动 NF → 提示冲突并拒绝启动

---

## 15. 一手参考

- xdd 状态机 / 生命周期：`Docs/pi-coding-agent-session-turn-loop.md`
- xdd 设计决策（5 阶段用户旅途）：`extensions/xdd/USER-JOURNEY.md`
- xdd 阶段契约（compile-time validation）：`extensions/xdd/core/stage-contract.ts`
- xdd stage 定义样板：`extensions/xdd/stages.ts`
- xdd refactor 设计（含已识别问题清单）：`docs/refactor.md`
- Pi extension API：<https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md>