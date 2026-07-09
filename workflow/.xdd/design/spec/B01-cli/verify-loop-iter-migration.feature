@B01 @R04 @R05 @covers-G4 @covers-G5
Feature: 验收循环走 iter 迁移
  作为 workflow 的调度器,
  我要在 verify 验收未过时忠实 xdd 的 iter 迁移机制,
  以便保留历史 iter 产物、不污染 design/ 持久锚。

  Background:
    Given workflow 已跑完第一轮八节点,当前为 iter-1
      And verify-report.md 的自检有未过项

  Scenario: verify 未过触发 iter 迁移到 iter-2
    Given .xdd/current-iteration 内容为 "iter-1"
    When workflow 检测到 verify 验收未过
    Then 应调用 xdd-init --iter 2
      And runs/iter-1/ 应原地保留(作历史快照)
      And 应新建 runs/iter-2/ 空工作区
      And .xdd/current-iteration 应更新为 "iter-2"
      But design/ 目录应保持不动(持久锚)

  Scenario: 迁移后在 iter-2 重跑 plan→execute→verify
    Given 已迁移到 iter-2
    When workflow 修复未过项
    Then 应在 iter-2 重跑 plan(产 runs/iter-2/plan/)
      And 应在 iter-2 重跑 execute(产 runs/iter-2/audits/build.md)
      And 应在 iter-2 重跑 verify(产 runs/iter-2/verify-report.md)
      But 不得在 iter-1 内乱落 loop_main_N/ 目录

  Scenario: 迭代直到 verify 通过
    Given iter-2 的 verify 仍未过
    When workflow 继续验收循环
    Then 应继续迁移到 iter-3
      And 直到某一 iter 的 verify 自检全过才结束

  Scenario: 达到最大 iter 上限应停止并报告
    Given 验收循环已达上限(如 iter-5)
    When verify 仍未过
    Then workflow 应停止
      And 应输出报告说明"达到最大 iter,疑似无法收敛"
      But 不得无限循环
