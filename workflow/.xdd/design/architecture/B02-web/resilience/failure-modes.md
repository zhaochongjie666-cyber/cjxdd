# 失败模式(FMEA)— B02-web

> 可视化编排前端的失败模式。与 B01-cli 共享 claude/subprocess 失败(F01~F04),特化 SSE/并发/图执行场景。

| FXX | 失败模式 | 影响 | 触发条件 | 检测方式 | 关联 RXX |
|---|---|---|---|---|---|
| **F01** | claude 子进程超时 | 节点卡死,run 不推进 | 模型慢/限流 | engine select 心跳 > 3000s | B02-R03 |
| **F02** | claude 非 success | 节点 failed | rc≠0 / subtype≠success | parser_msg 解析 | B02-R03 |
| **F03** | SSE 客户端断开 | 浏览器看不到进度 | 网络抖动/关页 | EventSource onerror | B02-R04 |
| **F04** | 回退边死循环 | run 永不结束 | gate 永远不过 | 引擎步数 ≥ 200 | B02-R03 |
| **F05** | 上游节点失败阻塞下游 | 部分 node 永远 pending | next 上游 failed | 引擎找 runnable 失败 | B02-R03 |
| **F06** | graph.json 损坏 | 加载失败 | 非法 JSON | json.loads 抛异常 | B02-R01 |
| **F07** | 并发 run 资源争抢 | 多 run 互相拖慢 | 用户连点开始 | 每 run 独立线程 | — |
| **F08** | 浏览器 Drawflow API 调错 | 节点更新失败 | 调不存在的方法 | JS console 报错 | B02-R01 |
| **F09** | stop 不及时(节点秒退) | 停止命中已结束 run | 节点跑太快 | run.finished 检查 | B02-R03 |
| **F10** | FastAPI server 崩溃 | 全部 run 丢失 | 未捕获异常 | uvicorn 重启 | — |

## 维度覆盖

| 维度 | FXX |
|---|---|
| 外部依赖(claude) | F01 F02 |
| 通信(SSE) | F03 |
| 流程(图执行) | F04 F05 F09 |
| 数据(graph.json) | F06 |
| 并发 | F07 |
| 前端 | F08 |
| 进程 | F10 |

≥ 6 维 ✅。

## 与 B01-cli 共享失败

F01(claude 超时)、F02(claude 非 success)与 B01-cli F02/F03 同源(共享 claude_runner),兜底也共享。

## 严重度

- **P0**:F10(server 崩)
- **P1**:F01 F02 F03 F05 F06 F07 F09
- **P2**:F04(死循环上限兜底)
- 前端 F08 归 JS 错误处理
