# 兜底设计(failsafe)— B02-web

> Web 特化兜底。claude subprocess 兜底(超时/非 success)与 B01-cli 共享(claude_runner),此处聚焦 SSE/图执行/并发。

| 兜底模式 | 应对的失败 | 实现位置 | 机制 |
|---|---|---|---|
| **SSE 自动重连** | @failure-mode-F03 客户端断开 | 浏览器 EventSource | 浏览器原生重连;run 未 finished 则继续推(events 队列保留) |
| **事件队列补播** | @failure-mode-F03 重连后补看 | `engine.RunHandle.events` | events 单调追加;重连从断点 idx 后推 |
| **死循环步数上限** | @failure-mode-F04 回退永不收敛 | `engine.run_graph` | 总步数 ≥ 200 停止 + 报告"疑似死循环" |
| **上游失败阻塞报告** | @failure-mode-F05 下游受阻 | `engine.run_graph` | 无 runnable 且有 pending → workflow_done 报 blocked 列表 |
| **graph.json 容错** | @failure-mode-F06 损坏 | `graph_io.load_graph` | json 解析失败回退默认图 + 警告 |
| **并发 run 隔离** | @failure-mode-F07 资源争抢 | `engine.RunHandle`(每 run 独立线程+subprocess) | 线程隔离,events 各自队列 |
| **停止幂等** | @failure-mode-F09 节点秒退 | `engine.RunHandle.stop` + finished 检查 | 已 finished 则停止无效(无害);运行中则 kill subprocess |
| **claude 兜底(共享)** | @failure-mode-F01/F02 | `claude_runner.run_agent_stream`(同 B01) | 超时 kill / 非 success 标节点 failed |

## 决策树

### SSE 断连(@failure-mode-F03)
```
EventSource onerror
  → run 已 finished? → 关闭(正常结束)
  → run 运行中? → 浏览器自动重连 → 从 events[idx] 补播 → 继续
```

### 回退死循环(@failure-mode-F04)
```
节点 done → 检查 loop 边
  → condition 满足 → 重置目标+下游 → steps++
    → steps ≥ 200? → 停止 + workflow_done(reason="疑似死循环")
    → < 200? → 继续
  → condition 不满足 → 推进
```
