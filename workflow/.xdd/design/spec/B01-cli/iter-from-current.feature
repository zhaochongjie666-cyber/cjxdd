@B01 @R06 @covers-G8
Feature: iter 号从 current-iteration 读取
  作为 workflow 的调度器,
  我要从 .xdd/current-iteration 读取当前 iter 号,
  以便所有节点产物路径用真实 iter 而非硬编码的 1。

  Scenario: 正常读取 iter 号
    Given .xdd/current-iteration 内容为 "iter-4"
    When workflow 读取当前 iter
    Then 解析出的 iter 数字应为 4

  Scenario Outline: 各种 iter 号格式
    Given .xdd/current-iteration 内容为 "<content>"
    When workflow 读取当前 iter
    Then 解析出的 iter 数字应为 "<expected>"

    Examples:
      | content | expected |
      | iter-1  | 1        |
      | iter-12 | 12       |

  Scenario: current-iteration 不存在时回退默认
    Given .xdd/current-iteration 文件不存在
    When workflow 读取当前 iter
    Then 应回退为默认 iter 1
      And 应输出警告

  Scenario: current-iteration 内容异常时回退默认
    Given .xdd/current-iteration 内容为 "garbage"(无可解析数字)
    When workflow 读取当前 iter
    Then 应回退为默认 iter 1
      And 应输出警告
