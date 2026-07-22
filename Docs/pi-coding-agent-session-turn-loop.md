# Pi Coding Agent：Session、Agent Run、Turn 与 XDD 接入

> **维护约定**：修改 `extensions/xdd/` 的 Pi 生命周期、消息投递、provider error、自动推进或上下文管理前，先读本文；并以本机安装版本的 `docs/extensions.md`、`dist/core/agent-session.js` 和 `pi-agent-core/dist/agent-loop.js` 为准。本文依据 `@earendil-works/pi-coding-agent` **0.80.10** 整理。

## 1. 四个边界不能混用

Pi 由内向外有四个边界：Provider request、Turn、low-level agent run，以及负责 retry、compaction 和 extension continuation 的 AgentSession recovery cycle。

- `turn_end` 只说明当前响应及工具执行结束。
- `agent_end` 只说明一个 low-level run 结束；Pi 仍可能 retry、compact 后 retry 或消费 follow-up。
- `agent_settled` 才说明 Pi 不会再自动 retry、compact 或消费 continuation。
- XDD 阶段状态持久化在 `.xdd/runtime.json`，不依赖聊天上下文。

推荐接入链：`Pi lifecycle event → XddCommand → XddController → XddEffect → Pi adapter`。

## 2. Pi 的 turn loop

```text
user / continuation → agent_start → turn_start → provider request
  ├─ toolUse → toolCall/toolResult → turn_end → 下一 turn
  ├─ stop/length → turn_end，按队列继续或结束
  └─ error/aborted → 不执行 error message 中的 toolCall → agent_end
```

工具的 `toolResult(isError=true)` 不是 provider error：它会进入上下文，模型在下一 turn 修正工具调用。流式响应最终为 error 时，半截 toolCall 不执行；retry 是新的 provider request。

### 2.1 Steering 与 follow-up

| 模式 | 交付点 | XDD 用途 |
|---|---|---|
| `steer` | 当前工具执行完、下一 provider request 前 | AIGate 可修复失败。 |
| `followUp` | agent 原本将结束时 | 阶段推进和 scheduler continuation。 |

`ctx.ui.notify` 不进入模型上下文，不能代替 steer/follow-up。

## 3. Pi 的外层恢复循环

```typescript
await agent.prompt(messages);
while (await handlePostAgentRun()) await agent.continue();
await emitAgentSettled();
```

处理顺序是 provider retry、retry exhausted、overflow/threshold compaction、extension 消息，最后才发 `agent_settled`。默认普通 retry 为 3 次，延迟 2s、4s、8s。明确的 context overflow 走 compact 后至多一次重试；429、overloaded 和普通 5xx 先走普通 retry。XDD 的 `session_before_compact` 只提供本地有界 handoff，不决定 cut point 或 retry。

## 4. Provider error 的 XDD 正确接法

不得在 extension `agent_end(error)` 中宣布最终失败、暂停或提示 `/xdd-resume`，因为 Pi 外层恢复尚未结束。当前实现采用两段式处理：

```text
agent_end(error) → 内存缓存 pendingProviderError，不改阶段状态
agent_end(non-error) → 清暂态错误，正常调度
agent_settled + pendingProviderError → Controller 最终化 provider error 并原子暂停
```

最终状态为 `status=paused`、`paused=true`、`stageOutcome=provider_error`、`continuationQueued=false`。`RESUME` 恢复 provider error 前的阶段边界，清除错误并只排一个匹配边界的 follow-up。

### 4.1 429/余额不足例外

匹配 `429 + insufficient balance/quota/credits` 时，XDD 保留无限延迟重试策略：在 low-level `agent_end` 交给 Controller 排 follow-up，3 秒指数退避并封顶 3 分钟。普通 rate limit 仍由 Pi 原生 retry/settled 处理。

## 5. XDD 当前使用的 Pi 事件

| Pi 事件 | XDD 行为 |
|---|---|
| `session_start` | 检查未完成 runtime/checkpoint，只做 UI 提示。 |
| `before_agent_start` | 注入阶段 prompt；verify 建快照。 |
| `tool_call` / `tool_result` | 执行策略、遥测、写保护和 AIGate steer。 |
| `turn_end` | 只跑 project hook，不调 scheduler。 |
| `agent_end(error)` | 暂存错误；余额不足例外按 XDD 策略入队。 |
| `agent_end(non-error)` | 清暂态错误并正常 continuation。 |
| `agent_settled` | 最终化仍存在的 provider error。 |
| `input` | 丢弃暂停或过期 continuation，按 epoch 释放锁。 |
| `session_before_compact` | 提供 provider-free handoff。 |
| `session_before_tree` | 提供阶段摘要。 |

## 6. 实现与审查清单

1. 不在 `turn_end` 调 scheduler。
2. 不在 `agent_end(error)` 宣布最终失败。
3. retry 成功必须清除暂态错误。
4. 用户 stop 优先于随后到达的 `agent_settled`。
5. provider pause 与 `/xdd-resume` 必须成对测试并保留阶段边界。
6. error assistant message 中的 partial toolCall 不得执行。
7. follow-up 必须遵守 paused、epoch 和 continuation lock。
8. AIGate repair 用 steer，阶段推进用 followUp，UI 信息用 notify。
9. compaction 时机只由 Pi 决定。
10. 覆盖暂态错误、settled 暂停、retry 成功、用户 stop、resume、阶段变更、429 例外测试。

## 7. 一手参考

- Pi lifecycle/API：本机 `@earendil-works/pi-coding-agent/docs/extensions.md`
- Pi 外层恢复：`dist/core/agent-session.js`
- Pi 低层 turn loop：`node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js`
- XDD 接入：`extensions/xdd/extension.ts`
- XDD 状态转换：`extensions/xdd/core/controller.ts`
- XDD effect 投递：`extensions/xdd/adapters/pi-effects.ts`
