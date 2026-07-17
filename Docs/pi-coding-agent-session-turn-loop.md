# Pi Coding Agent：Session Loop、Turn Loop 与 xdd 事件接入

> **维护约定**：修改 `extensions/xdd/` 的 Pi 生命周期、消息投递、自动推进或上下文管理前，先阅读本文；并以本机安装的 Pi 版本的 `docs/extensions.md` 和类型声明为准。本文依据 `@earendil-works/pi-coding-agent` **0.80.8** 整理。

## 1. 两层循环：Session 与 Agent/Turn

Pi 的 **Session** 是一段可持久化、可切换并可压缩的会话树；扩展在 session 生命周期中初始化或释放会话范围的资源。一次用户输入（含 extension 注入消息）会启动一个低层 **agent run**。agent run 又由一个或多个 **turn** 构成：一个 turn 是“一次 LLM 响应及其工具调用”。因此：

- `turn_end` 不等价于任务停止；它只标志当前模型响应和其工具结果结束。
- `agent_end` 表示当前低层 agent run 结束，但 Pi 仍可能自动重试、压缩后重试，或消费已排队的 follow-up 消息。
- 只有 `agent_settled` 才适合“Pi 不会自动继续执行”的状态集成；此时通常 `ctx.isIdle()` 为真。
- xdd 的持久状态不依赖聊天上下文，而写入 runtime/checkpoint；这使上下文裁剪与 compaction 可以安全地发生。

推荐的 xdd 控制闭环是：**Pi lifecycle event → `XddCommand` → `XddController` → `XddEffect` → Pi adapter**。Controller 是状态转换唯一入口；extension 负责把 Pi 事件转译为命令和执行 effect。

## 2. 消息队列：Steering 与 Follow-up

`pi.sendUserMessage()` 注入一条真正的 user message，并且总会触发 agent turn。正在 streaming 时必须指定 `deliverAs`：

| 模式 | 何时交付 | xdd 用途 |
|---|---|---|
| `steer` | 当前 assistant turn 完成其工具调用后、**下一次 LLM 调用前** | 当前工作已被硬 Gate 否定，必须立刻把模型引导到修复路径。 |
| `followUp` | agent 不再有工具调用、整个 agent run 结束后 | 阶段通过后的推进、正常的 scheduler 续跑。 |

不要把两者混用：`followUp` 不能保证下一次 LLM 调用前纠偏；`steer` 也不应用于常规阶段推进。Pi 的 `input` event 会暴露 `source: "extension"` 及 `streamingBehavior: "steer" | "followUp"`，可据此丢弃暂停期间或过期的 xdd 消息。

### 硬 Gate 失败规则

`xdd_submit_artifact` 的机械 hard Gate 失败时，extension 收到该工具的 `tool_result`，识别 `[gate N/M]` 或 `[xdd_submit_artifact]` 的失败结果，并立即发送：

```ts
pi.sendUserMessage(repairInstruction, { deliverAs: "steer" });
```

这条 steering message 必须包含当前阶段、`lastStageError` 和“修复产物后重新调用 `xdd_submit_artifact`”的明确动作。它只适用于机械 Gate；AIGate 的语义审查结果已有自身的反馈和预算逻辑，不能误触发为 hard-gate steering。

## 3. xdd 当前使用的 Pi 事件

| Pi 事件 | 时机/用途 | xdd 行为 |
|---|---|---|
| `session_start` | session startup、reload、new、resume 或 fork | 检查未完成 checkpoint，并仅用 UI 通知提示恢复。 |
| `before_agent_start` | 用户输入后、agent loop 前 | 注入当前阶段 system prompt、stage epoch，记录 model 引用；verify 时建立只读快照。 |
| `context` | 每次构造 LLM context | 以 stage epoch 截取消息并安全裁剪大工具输出。 |
| `tool_call` | 工具执行前 | 跑 `before_tools` hook，并执行阶段工具/路径策略。 |
| `tool_result` | 工具执行后 | 跑 hook、记录 bash 遥测、检查 verify 只读契约；机械 hard Gate 失败时发送 steering message。 |
| `turn_end` | 每一个 LLM response + tools 后 | 跑 `turn_end` project hook；不运行 xdd scheduler。 |
| `agent_end` | 低层 agent run 结束 | 转换为 `AGENT_ENDED`，由 Controller 决定 follow-up、compact、notify 或 abort。 |
| `session_compact` | manual/threshold/overflow compaction 后 | 作为 Pi 已完成压缩的生命周期信号；Controller 仅在未排队时恢复唯一 continuation。主动调用 `ctx.compact` 时必须通过 `onComplete` / `onError` 处理完成，不能把其同步返回值当作完成结果。 |
| `input` | 输入解析、skill/template 展开前 | 丢弃暂停的 xdd steering/continuation；仅已交付的 follow-up continuation 清除 continuation lock。`input` handler 维持 `async`，以兼容 Pi 的异步 extension runner。 |
| `session_before_tree` | `/tree` 导航前 | 提供当前 xdd 阶段摘要。 |

## 4. 实现与审查清单

1. **不要在 `turn_end` 重复调度**：它是 turn 粒度，可能导致重复 continuation；使用 `agent_end` + `continuationQueued` 去重。
2. **优先在 Controller 变更状态**：工具、command 和 event handler 不应各自复制状态机判断。
3. **发送消息前检查队列/暂停/epoch**：follow-up 必须遵守 continuation lock；steering 只用于当前可行动的失败。
4. **不要用 `ctx.ui.notify` 代替 steering**：notify 不进入模型上下文，无法纠偏下一次 LLM 调用。
5. **不要用 steering 代替停止**：用户 `/xdd-stop` 应 abort 并暂停，不能再注入工作指令。
6. **验证时覆盖实际生命周期**：至少测试 tool result 触发的 steering、`deliverAs: "steer"`、AIGate 不误触发、以及正常 `agent_end` follow-up 不回归。

## 5. 一手参考

- Pi extension lifecycle 与消息 API：<https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md>
- Pi agent/core 类型（消息队列与 session）：<https://github.com/earendil-works/pi/tree/main/packages>
- 本项目接入点：`extensions/xdd/extension.ts`、`extensions/xdd/adapters/pi-effects.ts`、`extensions/xdd/core/controller.ts`。
