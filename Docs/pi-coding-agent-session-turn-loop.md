# Pi Coding Agent：Session Loop、Turn Loop 与 xdd 事件接入

> **维护约定**：修改 `extensions/xdd/` 的 Pi 生命周期、消息投递、自动推进或上下文管理前，先阅读本文；并以本机安装的 Pi 版本的 `docs/extensions.md` 和类型声明为准。本文依据 `@earendil-works/pi-coding-agent` **0.80.8** 整理。

## 1. 两层循环：Session 与 Agent/Turn

Pi 的 **Session** 是一段可持久化、可切换并可压缩的会话树；扩展在 session 生命周期中初始化或释放会话范围的资源。一次用户输入（含 extension 注入消息）会启动一个低层 **agent run**。agent run 又由一个或多个 **turn** 构成：一个 turn 是“一次 LLM 响应及其工具调用”。因此：

- `turn_end` 不等价于任务停止；它只标志当前模型响应和其工具结果结束。
- `agent_end` 表示当前低层 agent run 结束，但 Pi 仍可能自动重试、压缩后重试，或消费已排队的 follow-up 消息。
- `agent_end` 不是“Pi 绝不会继续”的信号；xdd 在这里仅在没有 pending message 时安排自己的 follow-up，并把 provider retry 交给 Pi。若 Pi API 提供 `agent_settled`，它适合做纯观测，不应与 xdd continuation 双重调度。
- xdd 的持久状态不依赖聊天上下文，而写入 runtime/checkpoint；这使上下文裁剪与 compaction 可以安全地发生。

推荐的 xdd 控制闭环是：**Pi lifecycle event → `XddCommand` → `XddController` → `XddEffect` → Pi adapter**。Controller 是状态转换唯一入口；extension 负责把 Pi 事件转译为命令和执行 effect。

## 2. 消息队列：Steering 与 Follow-up

`pi.sendUserMessage()` 注入一条真正的 user message，并且总会触发 agent turn。正在 streaming 时必须指定 `deliverAs`：

| 模式 | 何时交付 | xdd 用途 |
|---|---|---|
| `steer` | 当前 assistant turn 完成其工具调用后、**下一次 LLM 调用前** | 统一 AIGate 对产物作出“未通过、仍可修复” verdict 时，强制下一次模型调用进入修复路径。 |
| `followUp` | agent 不再有工具调用、整个 agent run 结束后 | 阶段通过后的推进、正常的 scheduler 续跑。 |

不要把两者混用：`followUp` 不能保证下一次 LLM 调用前纠偏；`steer` 不应用于阶段推进。Pi 的 `input` event 会暴露 `source: "extension"` 及 `streamingBehavior: "steer" | "followUp"`；xdd 用它丢弃暂停期间的 AIGate repair steering 或 continuation，且只在已投递 continuation 时释放 continuation lock。

### 统一 AIGate 失败规则

`xdd_submit_artifact` 将机械检查结果作为统一 AIGate 的必需输入；机械检查不再单独产生 `[gate N/M]` verdict。AIGate 是唯一的分支决策者：通过 verdict 走正常 `agent_end` + follow-up，模型调用 `xdd_advance` 进入下一阶段；未通过且仍有预算时，extension 从 `tool_result` 识别 `[AIGate N/M]` 并立即发送 `deliverAs: "steer"`。这条 repair steering 必须包含当前阶段、`lastStageError`，并要求阅读审查建议、修复产物后重新调用 `xdd_submit_artifact`，不得推进下一阶段。

语义失败会消耗该阶段的 AIGate 预算；模型/网络/格式等审查基础设施失败不会消耗预算。预算耗尽时，verdict 阶段要求诊断或回退；非 verdict 阶段当前产品策略为记录告警后软通过。该策略不是“已经自动修复成功”。

## 3. xdd 当前使用的 Pi 事件

| Pi 事件 | 时机/用途 | xdd 行为 |
|---|---|---|
| `session_start` | session startup、reload、new、resume 或 fork | 检查未完成 checkpoint，并仅用 UI 通知提示恢复。 |
| `before_agent_start` | 用户输入后、agent loop 前 | 注入当前阶段 system prompt、stage epoch，记录 model 引用；verify 时建立只读快照。 |
| `context` | 每次构造 LLM context | 以 stage epoch 截取消息并安全裁剪大工具输出。 |
| `tool_call` | 工具执行前 | 跑 `before_tools` hook，并执行阶段工具/路径策略。 |
| `tool_result` | 工具执行后 | 跑 hook、记录 bash 遥测、检查 verify 只读契约；统一 AIGate 的可修复失败发送 repair steering。 |
| `turn_end` | 每一个 LLM response + tools 后 | 跑 `turn_end` project hook；不运行 xdd scheduler。 |
| `agent_end` | 低层 agent run 结束 | 转换为 `AGENT_ENDED`，由 Controller 决定 follow-up、compact、notify 或 abort。 |
| `session_compact` | manual/threshold/overflow compaction 后 | 作为 Pi 已完成压缩的生命周期信号；Controller 仅在未排队时恢复唯一 continuation。主动调用 `ctx.compact` 时必须通过 `onComplete` / `onError` 处理完成，不能把其同步返回值当作完成结果。 |
| `input` | 输入解析、skill/template 展开前 | 丢弃暂停的 AIGate repair steering / xdd continuation；仅已交付的 follow-up continuation 清除 continuation lock。`input` handler 维持 `async`，以兼容 Pi 的异步 extension runner。 |
| `session_before_tree` | `/tree` 导航前 | 提供当前 xdd 阶段摘要。 |

## 4. 压缩/长上下文裁剪边界：复用 Pi Pipeline AI

xdd **不实现自己的对话压缩器**，也不调用外部总结模型来重写历史上下文；压缩能力由 Pi/Pipeline AI 的 session pipeline 拥有：

- 主动压缩：`XddController` 只在 `agent_end` 看到 Pi 暴露的 `ctx.getContextUsage().percent` 达到阈值后发出 `COMPACT` effect；adapter 调用 Pi 的 `ctx.compact({ customInstructions, onComplete, onError })`。
- 完成信号：无论主动压缩还是 Pi manual/threshold/overflow compaction，xdd 都只消费 `session_compact` / callback 完成信号，再向 Controller 派发 `COMPACTION_DONE`。
- 压缩内容：xdd 只提供 `customInstructions`，说明必须保留目标、阶段、`stageEpoch`、Gate 失败、已修改文件、未完成任务和 Harness 变化；实际摘要/压缩由 Pi Pipeline AI 完成。
- 长上下文裁剪：`context` hook 中的 `sliceByEpoch` + `pruneContextMessages` 是进入 Pi LLM context 前的安全适配层，只做“按阶段 epoch 截取、去掉历史 thinking、把历史大 bash/text 输出替换成 stub、修复孤儿 tool_result”。它不总结语义，不替代 Pi compaction，也不删除工具配对元数据。
- 状态来源：xdd 的可修复点在 runtime/checkpoint、Controller command/effect、阶段产物与 Gate 证据中；聊天上下文只承载当前 turn 的执行材料。因此 XDD 失败应回到对应阶段/Gate/Controller 修，而不是在自建压缩摘要里找原因。

审查原则：能绑定 Pi Turn Loop / Pipeline AI 的能力必须绑定；只有 Pi 不提供的基础能力（例如阶段 epoch slicer、tool-result 安全 stub、Gate evidence）才由 xdd 自己写。

## 5. 实现与审查清单

1. **不要在 `turn_end` 重复调度**：它是 turn 粒度，可能导致重复 continuation；使用 `agent_end` + `continuationQueued` 去重。
2. **优先在 Controller 变更状态**：工具、command 和 event handler 不应各自复制状态机判断。
3. **发送消息前检查队列/暂停/epoch**：follow-up 必须遵守 continuation lock；AIGate steering 只能用于当前可修复的失败，且不释放该锁。
4. **不要用 `ctx.ui.notify` 代替 steering**：notify 不进入模型上下文，无法把 AIGate repair 强制放到下一次 LLM 调用前。
5. **不要用 steering 代替停止**：用户 `/xdd-stop` 应 abort 并暂停，不能再注入工作指令。
6. **验证时覆盖实际生命周期**：至少测试 AIGate 可修复失败触发 `deliverAs: "steer"`、AIGate 通过的正常 `agent_end` follow-up、预算耗尽不误 steering、以及 Controller 对所有 rollback 入口执行同一上限。

## 6. 一手参考

- Pi extension lifecycle 与消息 API：<https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md>
- Pi agent/core 类型（消息队列与 session）：<https://github.com/earendil-works/pi/tree/main/packages>
- 本项目接入点：`extensions/xdd/extension.ts`、`extensions/xdd/adapters/pi-effects.ts`、`extensions/xdd/core/controller.ts`。
