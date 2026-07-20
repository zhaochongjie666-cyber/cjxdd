# Auto Compact

自动压缩**默认关闭**，因此普通对话不会被这个扩展主动 compaction。用户显式设置阈值启用后，扩展才会在每轮 `before_agent_start`（即 pi-ai 发起 LLM 推理之前）读取当前模型的上下文占用率；达到阈值时调用 Pi 的内置 `ctx.compact()`，并等待压缩 callback 完成后再继续该轮推理。

- 默认状态：关闭（普通对话不主动压缩）
- 启用后的初始参考阈值：`90%`
- 查看状态：`/auto-compact` 或 `/auto-compact status`
- 修改阈值：`/auto-compact 80`（也接受 `80%`）
- 关闭：`/auto-compact off`
- 启用或重新启用：显式设置阈值，例如 `/auto-compact 90`

配置仅作用于当前 Pi 进程，不写入当前项目的 `.pi`。即使扩展保持关闭，Pi 自己的上下文溢出压缩仍作为兜底；主动压缩失败时也会明确告警并保留该兜底。
