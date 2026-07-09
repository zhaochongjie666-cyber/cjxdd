# 恢复剧本(runbook)— B02-web

> Web 端故障诊断。每步具体命令/操作,区分自动 vs 人工。

## 症状 1:浏览器看不到节点进度更新

**立即动作**(人工):
- F12 → Network → 看 `/api/run/{id}/stream` 的 SSE 连接状态。
- F12 → Console → 看有无 EventSource 报错。
**根因**:SSE 断连(@failure-mode-F03)。
**恢复**:
- 刷新页面 → 重新订阅 SSE → events 补播(队列保留)。
- run 后台不受影响(`GET /api/runs` 确认 alive)。
**自动**:EventSource 浏览器原生重连。

## 症状 2:run 跑了很久不结束,日志反复"回退触发"

**立即动作**(人工):
```bash
curl -s http://localhost:8000/api/runs | python -m json.tool   # 看哪个 run 在跑
```
- 看日志里 `loop_trigger` 出现次数。
**根因**:回退边死循环(@failure-mode-F04),gate 永远不过。
**恢复**:
- 点 ⏹ 停止(stop_event kill subprocess)。
- 检查 verify 节点产出为何 gate 不过(看 `<task_dir>/.xdd/runs/iter-N/verify-report.md`)。
- 修 gate 条件或节点产出后重跑。
**自动**:步数达 200 自动停 + 报告"疑似死循环"。

## 症状 3:节点一直 pending,部分跑不动

**立即动作**(人工):
- 看画布哪些节点是 ❌(failed),哪些还是 ○(pending)。
- `GET /api/run/{id}/stream` 重放看 node_done 事件。
**根因**:上游节点 failed 阻塞下游(@failure-mode-F05)。
**恢复**:
- 看 failed 节点的日志(`log/claude/*.log`)定位失败原因。
- 修该节点(改配置/重试)后,它 done 才会解锁下游。
**自动**:workflow_done 报 blocked 列表。

## 症状 4:加载图报错或显示乱

**立即动作**(人工):
```bash
cat <task_dir>/.xdd/graph.json | python -m json.tool   # 检查 JSON 合法性
```
**根因**:graph.json 损坏(@failure-mode-F06)。
**恢复**:
- 备份后删 graph.json → 加载回退默认图。
- 或人工修 JSON。
**自动**:load_graph 解析失败回退默认图 + 警告。

## 症状 5:点开始没反应 / 报 500

**立即动作**(人工):
```bash
curl -s http://localhost:8000/api/runs                    # server 是否活着
tail -f <task_dir>/log/workflow.log                        # 后端日志
```
**根因**:server 崩溃(@failure-mode-F10)或 task_dir 无效。
**恢复**:
- server 挂了 → `python -m workflow.web.server` 重启(runs 丢失,后台 run 也丢)。
- task_dir 无效 → 404,检查路径。

## 症状 6:浏览器 console 报 Drawflow 错误

**立即动作**(人工):
- F12 → Console → 看具体错误(如 `updateNodeHtml is not a function`)。
**根因**:Drawflow API 调错(@failure-mode-F08,旧版踩过的坑)。
**恢复**:
- 该 API 不存在 → 改用直接 DOM 操作(app.js 已规避)。
- 查 Drawflow 版本文档确认 API。

## 症状 7:并发跑多个 run 变慢

**根因**:并发 run 资源争抢(@failure-mode-F07),subprocess 抢 CPU。
**恢复**:
- 等(每 run 独立线程,会各自完成)。
- 或停掉多余的(`POST /api/run/{id}/stop`)。
**说明**:单机本地工具,并发本就有限,非 bug。

## 回滚路径

- **graph 回滚**:graph.json 改坏 → 删之 → 加载默认图重新编辑。
- **run 回滚**:run 无法"回滚",只能停止重开(run_id 是一次性的)。
