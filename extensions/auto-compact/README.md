# Auto Compact

正常路径在成功的 `xdd_advance` 工具结果（stage end）后调用一次 Pi 内置 `ctx.compact({ customInstructions, onComplete, onError })`，而不是在每个 `turn_end` 自动压缩。这样一个阶段可以自然跨越多个 turn，阶段之间则用紧凑摘要交接。

兜底路径在 `agent_end` 读取 `ctx.getContextUsage().percent`：如果一个长阶段尚未结束却已经达到当前模型 window context 的配置上限，也立即调用同一套 Pi 压缩 pipeline。压缩完成后由 Pi 的 `session_compact` 生命周期和 xdd continuation 继续流程；扩展的单实例锁阻止 stage end、上限兜底或手动命令并发发起重复压缩。

- 默认阈值：`90%`
- 查看状态：`/auto-compact` 或 `/auto-compact status`
- 修改阈值：`/auto-compact 80`（也接受 `80%`，允许范围 `1%`–`100%`）
- 关闭：`/auto-compact off`
- 重新启用：再次设置阈值
- 立即压缩：`/trigger-compact`，可在命令后附加本次摘要指令

配置仅作用于当前 Pi 进程，不写入当前项目的 `.pi`。扩展只调用 Pi 提供的压缩 pipeline，不实现第二套 summarizer；压缩失败会明确告警，Pi 自己的上下文溢出压缩仍作为兜底。
