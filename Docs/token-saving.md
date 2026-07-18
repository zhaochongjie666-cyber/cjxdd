# Token 节省研究与落地方案

本文聚焦 xdd / normal-flow 在 Pi 会话里的 token 消耗。结论：**默认仍应把语义压缩交给 Pi Pipeline AI**，xdd 只做不破坏 tool-call 配对的安全裁剪；当用户明确要省 token 时，通过环境变量启用更激进但有下限保护的上下文文本预算。

## 现状

- `sliceByEpoch` 先按 `stageEpoch` 截掉前一阶段消息，避免跨阶段历史反复进入模型。
- `pruneContextMessages` 默认移除历史 assistant thinking，并把超过阈值的历史 tool 输出替换成 stub，同时保留 tool call / result 元数据。
- Pi 自带 compaction 负责语义总结；xdd 的 compaction instructions 只声明必须保留的目标、阶段、Gate 失败、已改文件、未完成任务和 Harness 变化。

## Token 浪费来源

1. 大量 `bash` / `read` 输出滞留在历史上下文中。
2. 普通 user / assistant 长文本没有触发 Pi compaction 前，会继续占用窗口。
3. 为了 provider 兼容性，不能简单删除单侧 tool message，否则会触发 tool_use / tool_result 配对错误。
4. 阶段推进后如果没有按 epoch 切片，会把上一阶段设计/执行细节重复带入下一阶段。

## 正向策略

- **阶段隔离优先**：继续依赖 `stageEpoch` 切片，前序阶段结论必须落盘到 `.xdd` 产物，而不是依赖聊天历史。
- **大工具输出 stub 化**：历史 tool result 超过阈值就用固定短文本替代，保留 id、role、name、`isError` 等配对/错误元数据。
- **按需启用文本总预算**：新增 `XDD_CONTEXT_TEXT_BUDGET`，只有设置后才对历史普通文本做总量上限裁剪；默认不启用，避免替代 Pi 语义压缩。
- **按需调低工具阈值**：新增 `XDD_TOOL_RESULT_STUB_THRESHOLD`，用于把历史工具输出更早替换为 stub。

## 兜底策略

- `XDD_CONTEXT_TEXT_BUDGET` 最低钳制为 `4000` 字符，避免误配置成极小值导致当前任务材料丢失。
- `XDD_TOOL_RESULT_STUB_THRESHOLD` 最低钳制为 `200` 字符，避免短错误信息被过早压缩。
- 当前 turn 和最新 user 指令始终保留，防止模型忘记正在处理的请求。
- tool call / result 配对元数据不删除；孤儿 tool_result 会转成普通文本，避免 provider 拒绝请求。
- 非法、空值、非正数环境变量会被忽略，回退到默认安全行为。

## 推荐配置

```bash
# 温和省 token：保留较多历史文本，只压大输出
export XDD_CONTEXT_TEXT_BUDGET=60000
export XDD_TOOL_RESULT_STUB_THRESHOLD=1200

# 激进省 token：适合长时间自动流程；确保关键结论已落盘
export XDD_CONTEXT_TEXT_BUDGET=20000
export XDD_TOOL_RESULT_STUB_THRESHOLD=600
```

## 验证清单

- 正向：设置预算后，历史大文本会被 stub，最新用户请求仍完整保留。
- 兜底：非法环境变量被忽略；过小预算会被钳制；tool call / result 配对仍保持有效。
- 攻击：模拟孤儿 OpenAI / Anthropic tool_result，确认会降级为普通文本而不是破坏 provider 请求。

## Design 阶段文档交接

Design 子阶段（`understand` / `spec` / `architecture` / `wire` / `resilience`）的可信上下文是落盘文档，而不是上一轮工具输出。进入这些阶段时，context hook 会把模型上下文折叠为：

1. 当前阶段 `inputs` 声明的文档摘录；
2. 最新 user / steering 消息；
3. 不再携带历史 assistant tool call 与 tool result。

这样做等价于“AI Gate / Gate 通过后把阶段交接物固化为文档，再把下一设计阶段上下文切换到文档”。`execute` / `cleanup` / `verify` 不启用该策略，因为代码实现、测试输出、失败日志和当前编辑轨迹本身就是后续判断的重要上下文。

兜底边界：文档交接有总字符上限和单文件上限；如果文档不存在或 glob 没解析到文件，则退回原始上下文，避免空上下文启动阶段。信息不足时，阶段 prompt 仍要求 agent 主动 `read` 对应文件补齐。
