@B02 @R01 @covers-G6 @covers-G7
Feature: 编排图用节点+边建模
  作为 workflow Web 的使用者,
  我要在画布上增删/编辑节点,每个节点可完全自定义,
  以便编排任意 xdd 节点组合。

  Scenario: 加载默认图得到八节点
    Given 一个尚未保存 graph.json 的 task_dir
    When 请求加载编排图
    Then 应返回默认图,含 8 个节点(brainstorm..verify)
      And 每个节点含 id/name/skill/output_doc/model/extra/gate 七字段

  Scenario: 拖拽添加自定义节点
    Given 画布已加载
    When 用户拖拽一个"自定义节点"模板到画布
    Then 画布应新增一个节点
      And 该节点 skill/output_doc/model/extra 可任意填写

  Scenario: 保存编排图落盘
    Given 画布上有若干节点和边
    When 用户点击保存
    Then 应将编排图序列化为 graph.json
      And 应落到 <task_dir>/.xdd/graph.json

  Scenario: 重复节点 id 应被校验拒绝
    Given 用户编辑的图含两个相同 id 的节点
    When 请求保存该校验
    Then 应返回错误"节点 id 重复"
      And 不得落盘

  Scenario: 节点缺必填字段应被校验拒绝
    Given 一个节点缺 name 或 skill 字段
    When 请求校验该图
    Then 应返回错误指明缺失字段
