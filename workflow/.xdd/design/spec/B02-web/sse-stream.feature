@B02 @R04 @covers-G6
Feature: SSE 实时推送执行进度
  作为 workflow Web 的浏览器端,
  我要经 SSE 实时收到节点执行事件,
  以便看到节点状态变化和 claude 流式日志。

  Scenario: 启动执行返回 run_id
    Given 一个已保存编排图的 task_dir
    When 请求启动执行
    Then 应返回一个 run_id
      And 应在后台启动图引擎

  Scenario: SSE 推送节点开始事件
    Given 一个正在执行的 run
    When 引擎开始跑某节点
    Then SSE 应推送 event: node_start
      And data 含该节点 id

  Scenario: SSE 推送节点流式日志
    Given 一个正在跑的节点
    When claude 的 stream-json 产出文本
    Then SSE 应推送 event: node_log
      And data 含节点 id 和文本片段

  Scenario: SSE 推送节点完成事件含 gate 结果
    Given 一个验收闸节点跑完
    When 引擎判定 gate 结果
    Then SSE 应推送 event: node_done
      And data 含 passed 字段(通过/未过)

  Scenario: SSE 推送回退触发和工作流完成
    Given 引擎触发了一条回退边
    Then SSE 应推送 event: loop_trigger(含 from/to)
    Given 全部节点完成
    Then SSE 应推送 event: workflow_done

  Scenario: 停止执行应 kill 当前节点并结束
    Given 一个正在执行的 run
    When 用户请求停止
    Then 应 kill 当前 claude 子进程
      And SSE 应推送 workflow_done(stopped=true)
