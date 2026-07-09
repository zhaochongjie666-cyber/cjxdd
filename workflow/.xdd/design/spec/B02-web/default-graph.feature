@B02 @R06 @covers-G1 @covers-G5
Feature: 默认图从八节点定义派生
  作为 workflow Web 的新用户,
  我要在没有自定义编排时拿到开箱即用的默认图,
  以便直接点开始就能跑通 xdd 全链。

  Scenario: 全新 task_dir 加载得到默认八节点图
    Given 一个没有 graph.json 的 task_dir
    When 请求加载编排图
    Then 应返回默认图
      And 节点数为 8(brainstorm/spec/architecture/wire/resilience/plan/execute/verify)
      And 节点产出路径应与 B01 的 build_nodes 一致(忠实 skill)

  Scenario: 默认图含 verify→execute 回退边
    Given 加载的默认图
    When 检查其边
    Then 应含一条 loop 边 from verify to execute
      And 该边 condition 为 gate_fail

  Scenario: 已保存的 graph.json 优先于默认图
    Given task_dir 已有自定义 graph.json(改过节点)
    When 请求加载编排图
    Then 应返回已保存的自定义图
      But 不得返回默认图覆盖之

  Scenario: 默认图校验通过(无 next 环)
    Given 加载的默认图
    When 校验该图
    Then 应无错误(默认图的 next 边构成 DAG)

  Scenario: graph.json 损坏应回退默认图并警告
    Given task_dir 的 graph.json 内容是非法 JSON
    When 请求加载编排图
    Then 应回退返回默认八节点图
      And 应输出警告:graph.json 解析失败,用默认图

