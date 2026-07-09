# 事件契约(event-contract)— workflow

> workflow 没有消息中间件/领域事件总线。这里的"事件" = **图引擎 → SSE → 浏览器**的推送事件,
> 以及 CLI 的 **logging** 输出。所有事件契约集中在这定义,前后端 1:1 对齐。

## SSE 事件契约(B02-web)

引擎跑图时,经 `/api/run/{run_id}/stream` 推送以下事件。每条 `data` 是 JSON。

| event 类型 | 触发时机 | data 字段 | 消费方 |
|---|---|---|---|
| `node_start` | 节点开始执行 | `{node, ts}` | 画布徽章→running |
| `node_log` | claude stream-json 产出文本 | `{node, text, ts}` | 日志面板追加 |
| `node_done` | 节点跑完(含 gate 判定) | `{node, success, passed, gate, gate_stats, skipped?, ts}` | 画布徽章→passed/failed |
| `node_reset` | 回退边触发,节点重置 pending | `{node, ts}` | 画布徽章→idle |
| `loop_trigger` | 回退边条件满足 | `{from, to, condition, ts}` | 画布高亮回退边 |
| `workflow_done` | 全部节点完成/停止/出错 | `{stopped, blocked?, error?, reason?, ts}` | 状态栏 + 解锁按钮 |

### 字段语义(不变量)

- `node`:节点的**逻辑 id**(graph.json 的 id),非 Drawflow 的 dom id。
- `passed`:仅当 `gate=true` 时由 gate_check 决定;`gate=false` 时默认 true(claude 返回 success 即过)。
- `gate_stats`:`{completed, incomplete, exists}` 三字段。
- `ts`:ISO8601 秒级。

### 顺序保证

事件按**引擎产生顺序**追加到 `handle.events`(单调),SSE 客户端按到达顺序消费。
不保证跨 run 的全局顺序(每个 run 独立队列)。

## CLI 事件(B01-cli)

CLI 无 SSE,事件经 logging 输出到 stdout + `<task_dir>/log/workflow.log`。

| 日志事件 | 内容 |
|---|---|
| 节点开始 | `▶ Agent: <name> (Model: <model>)` |
| 节点流式 | claude stream-json 解析后的文本(parser_msg) |
| 验收判定 | `验收状态: 已完成=N, 未完成=M (verify-report.md)` |
| iter 迁移 | `=== iter 迁移: iter-N → iter-(N+1) ===` |
| 完成 | `🎉 xdd workflow 全部完成` |

## 与 spec 对齐

SSE 事件类型与 `spec/B02-web/sse-stream.feature` 的 Scenario 一一对应。
gate_stats 字段与 `spec/B01-cli/gate-dual-symbol.feature` 的通过条件一致。
