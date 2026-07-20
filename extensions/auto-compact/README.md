# Auto Compact

在每轮 `before_agent_start`（即 pi-ai 发起 LLM 推理之前）读取当前模型的上下文占用率。达到阈值时调用 Pi 的内置 `ctx.compact()`，并等待压缩 callback 完成后再继续该轮推理。

- 默认阈值：`90%`
- 查看状态：`/auto-compact` 或 `/auto-compact status`
- 修改阈值：`/auto-compact 80`（也接受 `80%`）
- 关闭：`/auto-compact off`
- 重新启用：再次设置阈值

配置仅作用于当前 Pi 进程，不写入当前项目的 `.pi`。压缩失败会明确告警，并保留 Pi 自己的上下文溢出压缩作为兜底。
