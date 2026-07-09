@B01 @R03 @covers-G3
Feature: 验收闸认双符号
  作为 workflow 的验收判定,
  我要同时识别 ASCII 和全角两种自检清单符号,
  以便兼容各 skill 的自检段格式(skill 用 □,旧约定用 - [ ])。

  Scenario: 全角 □ 自检全过判通过
    Given 一份产出文档,内容含若干 ☑ 行且无 □ 行
    When gate 检查该文档
    Then 应判定为通过

  Scenario: 全角 □ 有未过项判未过
    Given 一份产出文档,内容至少含一行 □(未完成)
    When gate 检查该文档
    Then 应判定为未过

  Scenario: ASCII 复选框自检全过判通过
    Given 一份产出文档,内容含若干 - [x] 行且无 - [ ] 行
    When gate 检查该文档
    Then 应判定为通过

  Scenario: ASCII 复选框有未过项判未过
    Given 一份产出文档,内容至少含一行 - [ ](未完成)
    When gate 检查该文档
    Then 应判定为未过

  Scenario: 混合符号也正确判定
    Given 一份产出文档,同时含 ☑ 行和 - [ ] 行
    When gate 检查该文档
    Then 应判定为未过(因存在未完成项)

  Scenario: 文档不存在判未过
    Given 产出文档路径指向不存在的文件
    When gate 检查该文档
    Then 应判定为未过
      And 应返回 exists=False

  Scenario: 全空文档(无任何自检项)判未过
    Given 一份产出文档,既无 □/☑ 也无 - [ ]/- [x]
    When gate 检查该文档
    Then 应判定为未过(已完成数必须 > 0)
