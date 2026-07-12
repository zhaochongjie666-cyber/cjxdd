# xdd (pi coding agent extension)

xdd 控制循环（[`core.md`](../../core.md)）作为 **pi coding agent inline extension** 的实现。

控制循环深度集成 pi 的 `ToolDefinition` / `XddRunnerState` / ESG / checkpoint，是
完整能力：状态机推进、自愈预算、阶段回退、断点续跑。这是 xdd driven 的唯一 runtime。

## 架构

```
                          一份纯逻辑（pi 无关）
              observe-fs.ts  +  stage-diff.ts  +  stages.ts  +  gate.ts
                                       │
                                       ▼
              ┌────────────────────────────────────────────┐
              │  pi inline extension                        │
              │  extension.ts  +  runner.ts  +  context.ts   │
              │  tools/ (11 工具)  +  checkpoint.ts           │
              │  深度集成 XddRunnerState（进度/信号/自愈预算/ESG）│
              └────────────────────────────────────────────┘
```

纯逻辑模块（`observe-fs.ts` / `stage-diff.ts` / `stages.ts` / `gate.ts`）不依赖 pi，
是观测与 Gate 的核心；extension 在其上加了 runner 状态机，构成完整控制循环。

## 工具（11 个）

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

## 运行流程

### 单次控制循环（core.md 的 while 落地）

```
agent 进入一个阶段（如 spec）
  ① xdd_observe            ← observation = observe()：内存簿记 + 磁盘快照
  ② xdd_desired_state      ← 拿到本阶段期望状态
  ③ xdd_difference         ← compare()：跑真实 stage.gate + 逐条分类，预检 diff
  ④ agent 按 diff 干活
  ⑤ xdd_submit_artifact    ← 提交产物 + 自我攻击，再跑一次 Gate；通过则记录信号
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

### 保障（P 系列）

- **P3 Evidence First**：ESG（Engineering State Graph）记 decision/evidence/review/finding/task/checkpoint。
- **P5 Recoverability**：`checkpoint.ts` 持久化 `.xdd/checkpoint.json`，`resumeFromCheckpoint` 续跑。
- **P6 Runtime Independence**：通过 `XddRuntime` adapter 接入，不直接依赖 pi 内部。
- **P7 Human Governance**：`humanApprovalHook` 在 gate 失败 / 组回退 / verify 裁决时暂停等人审。

## 激活

```ts
import { XddRunner, XddRunnerState, activateXddExtension, xddInlineExtension } from "./extensions/xdd/index.ts";

// 1. 注册 extension（经 pi 的 extensionFactories）
pi.registerExtension(xddInlineExtension);

// 2. 建 state + runner，注入 extension
const state = new XddRunnerState({ runId, cwd, userInput });
activateXddExtension(state);
const runner = new XddRunner(runtime, state, { task, maxRollbacksPerStage: 2, maxSelfHealPerStage: 3 });

// 3. 跑（runner 驱动阶段循环，tools 经 getState 闭包共享 state）
const result = await runner.run();
```

`XddRunner.run()` 驱动阶段循环；extension 的 tools 通过模块级 `stateRef`（`getState`）
闭包共享同一个 `XddRunnerState`。无 run 激活时，tools 抛错、handlers no-op。

## 测试

```bash
# 从仓库根：
<pi>/packages/coding-agent/node_modules/.bin/vitest run --root extensions xdd/
```

覆盖：gate.ts（文件系统 gate）、observe-fs.ts（磁盘观测 + 追溯覆盖）、stage-diff.ts
（真实 gate diff）、state.ts（runner 状态机/checkpoint）、stage-groups.ts（组级 Gate）、
diagnosis.ts（根因分类）、xdd-trace.ts（追溯链工具）。
