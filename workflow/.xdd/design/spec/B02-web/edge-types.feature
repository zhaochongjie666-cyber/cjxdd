@B02 @R02 @covers-G6
Feature: 边分 next 和 loop 两类
  作为 workflow Web 的使用者,
  我要画前进边(next)和回退边(loop),
  以便定义节点顺序和循环。

  Scenario: next 边表示拓扑前进
    Given 画布上有节点 A 和 B
    When 用户从 A 拉一条 next 边到 B
    Then 图应记录 {from:A, to:B, type:next}
      And B 应等待 A 完成后才执行

  Scenario: loop 边表示回退循环
    Given 画布上有节点 verify 和 execute
    When 用户按住 Shift 从 verify 拉一条边到 execute
    Then 图应记录 {from:verify, to:execute, type:loop, condition:gate_fail}
      And verify 未过时应触发回退重跑 execute

  Scenario: loop 边可从任意节点拉到上游任意节点
    Given 画布上有节点 A→B→C 的 next 链
    When 用户从 C 拉一条 loop 边到 A
    Then 应允许该回退边(C 回退到 A)
      And 该边 condition 默认为 gate_fail

  Scenario: next 边成环应被校验拒绝
    Given 用户编辑的图含 A→B→A 的 next 环
    When 请求校验该图
    Then 应返回错误"next 边存在环(回退请用 loop 类型)"
      And 提示改用 loop 类型

  Scenario Outline: 边类型合法值
    Given 一条边的 type 字段为 "<type>"
    When 校验该图
    Then 校验应 <result>

    Examples:
      | type | result   |
      | next | 通过     |
      | loop | 通过     |
      | foo  | 不通过   |
