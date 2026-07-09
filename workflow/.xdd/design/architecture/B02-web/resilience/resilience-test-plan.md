# 韧性测试计划 — B02-web

> Web 特化测试。自动化 pytest(后端引擎/SSE)+ 浏览器手工(前端)。

| FXX 失败模式 | 自动化(pytest) | 手工(浏览器/curl) | 巡检项 |
|---|---|---|---|
| F01 claude 超时 | monkeypatch select,timeout=1s | — | log/claude/*.log |
| F02 claude 非 success | mock stream-json error | `kill -9 <pid>` | rc |
| F03 SSE 断连 | pytest-sse 模拟断开重连 | DevTools Offline | events 补播 |
| F04 死循环 | monkeypatch gate_check False | 造 verify 产物含 □ | 步数计数 |
| F05 上游失败阻塞 | mock A 失败,断言 B/C pending | `kill -9` 某节点 | workflow_done.blocked |
| F06 graph.json 损坏 | 写非法 JSON,断言回退默认 | `echo '{broken'` | 警告日志 |
| F07 并发 run | 连发 POST /api/run 两次 | 浏览器连点 | run 隔离 |
| F08 Drawflow API | — | JS console 检查 | console 错误 |
| F09 停止幂等 | run finished 后调 stop | curl stop | stopped=true |
| F10 server 崩溃 | 未捕获异常测试 | — | uvicorn 重启 |

## 后端自动化测试组织

```
web/tests/  (A7 execute 时建)
├── test_engine.py          # F04/F05 图执行拓扑+回退+死循环
├── test_graph_io.py        # F06 graph.json 容错
├── test_server.py          # F03 SSE / F07 并发 / F09 停止
└── test_gate.py            # 共享(同 B01)
```

## 前端手工测试

- F03 SSE:DevTools Network → Offline 5s → Online,看节点状态是否补齐。
- F07 并发:连点两次"开始",看是否两个 run 独立跑。
- F08 Drawflow:console 看有无 `editor.updateNodeHtml is not a function`(旧版踩过的坑)。

## 覆盖目标

- P0(F10):server 不崩(未捕获异常兜底)。
- P1(F01~F03/F05~F07/F09):自动化优先。
- P2(F04):自动化(死循环上限)。
