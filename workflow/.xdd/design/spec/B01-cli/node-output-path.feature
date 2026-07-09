@B01 @R01 @covers-G1 @covers-G5
Feature: 八节点产出路径忠实 skill
  作为 workflow 的使用者,
  我要每个节点跑完后产物落在 skill 真实声明的路径,
  以便下游 skill 能按约定路径读到上游产物。

  # 真实产出路径对照表见 rules.md「八节点产出路径对照」。

  Scenario: spec 节点产出落到业务线子目录
    Given 一个已跑完 brainstorm 的 task_dir,且存在 design/design.md
    When workflow 执行 spec 节点
    Then 产出应落在 design/spec/_landscape.md
      And 产出应落在 design/spec/{bxx-slug}/business.md
      And 产出应落在 design/spec/{bxx-slug}/rules.md
      And 至少有一个 design/spec/{bxx-slug}/*.feature 文件
      But 不应落在 design/spec/rules.md(扁平旧路径)

  Scenario Outline: 各节点产出路径正确
    Given 节点为 "<node>"
    When workflow 执行该节点
    Then 产出应落在 "<expected_path>" 之下
      And 不得落在硬编码的旧错路径

    Examples:
      | node         | expected_path                                   |
      | brainstorm   | design/intent.md 与 design/design.md            |
      | architecture | design/architecture/{bxx-slug}/architecture.md  |
      | resilience   | design/architecture/{bxx-slug}/resilience/      |
      | plan         | runs/iter-N/plan/{bxx-slug}/plan.md             |
      | verify       | runs/iter-N/verify-report.md                    |

  Scenario: 纯后端项目跳过 wire 节点
    Given task_dir 是纯后端项目(无前端)
    When workflow 执行到 wire 节点
    Then workflow 应跳过 wire 节点
      And 不产生 design/wire/ 产物
      And 继续执行下游节点

  Scenario: 节点产出落到错误路径应被 verify 拒绝
    Given 某节点把产物落到了硬编码旧路径(如 design/spec/rules.md 扁平路径)
    When verify 检查该节点产出
    Then 应判定该节点未过(产出路径不符合 skill 真实产出)
      And 应在验收报告记录路径不符

