# 混沌场景(chaos)— B02-web

> Web 特化混沌。注入用 JS/进程手段(无 docker)。每场景带 `@chaos @failure-mode-FXX @Pn @covers-B02-RXX` Gherkin。

## 场景 1:SSE 断连重连(@failure-mode-F03)

```gherkin
@chaos @failure-mode-F03 @P1 @covers-B02-R04
Feature: SSE 中途断开
  Scenario: 跑到一半网络断开
    Given 一个正在执行的 run,浏览器已订阅 SSE
    When 注入: 浏览器 offline(或关 DevTools 模拟断网)
    Then EventSource onerror 触发
      And run 应继续在后台跑(不受浏览器影响)
    When 网络恢复
    Then EventSource 自动重连
      And 应从断点补播未消费的 events
      And 节点状态不丢失
```
注入:浏览器 DevTools → Network → Offline,或 `navigator.serviceWorker` 拦截。

## 场景 2:回退死循环(@failure-mode-F04)

```gherkin
@chaos @failure-mode-F04 @P2 @covers-B02-R03
Feature: 回退边无限触发
  Scenario: verify gate 永远不过
    Given 画布图: A→B→C(gate)→loop→A
    When monkeypatch gate_check 永返回 False
    Then 引擎应不断回退重跑 A/B/C
      And 步数累计
    Then 达 200 步后停止
      And workflow_done reason="疑似回退边死循环"
      But 不得无限循环
```
注入:测试 monkeypatch / 造一个 verify 产出永远含 □。

## 场景 3:上游失败阻塞(@failure-mode-F05)

```gherkin
@chaos @failure-mode-F05 @P1 @covers-B02-R03
Feature: 上游失败阻塞下游
  Scenario: A 节点 claude 异常退出
    Given 图 A→B→C
    When A 的 claude 子进程被 kill -9
    Then A 标 failed
      And B、C 应保持 pending(因 next 上游未 done)
      And workflow_done 应报告 blocked=[B,C]
      But 不应跑 B、C
```
注入:`kill -9 <pid>`。

## 场景 4:graph.json 损坏(@failure-mode-F06)

```gherkin
@chaos @failure-mode-F06 @P1 @covers-B02-R01
Feature: graph.json 解析失败
  Scenario: graph.json 是非法 JSON
    Given .xdd/graph.json 内容为 "{broken"
    When 请求 GET /api/graph
    Then 应回退返回默认八节点图
      And 应在日志警告"graph.json 解析失败"
      But 不应 500 报错
```
注入:`echo '{broken' > .xdd/graph.json`。

## 场骤 5:并发 run(@failure-mode-F07)

```gherkin
@chaos @failure-mode-F07 @P1
Feature: 同时跑多个 run
  Scenario: 连续点两次开始
    Given 一个 run 正在跑
    When 再次 POST /api/run
    Then 应返回新的 run_id
      And 两个 run 各自独立线程
      And 各自 events 队列不串扰
      And SSE 各订阅各的 run_id
```
注入:浏览器连点 / curl 连发两次 POST /api/run。

## 场景 6:停止命中已结束 run(@failure-mode-F09)

```gherkin
@chaos @failure-mode-F09 @P1 @covers-B02-R03
Feature: 停止幂等
  Scenario: 节点秒退后点停止
    Given run 已 finished(节点跑完了)
    When POST /api/run/{id}/stop
    Then 应返回 stopped=true(幂等无害)
      But 不应报错
```
注入:run 完成后调 stop。
