@B02 @R03 @covers-G6
Feature: 图执行引擎(拓扑前进 + 回退循环)
  作为 workflow Web 的引擎,
  我要按 next 边拓扑序推进、按 loop 边触发回退重跑,
  以便忠实执行用户编排的图(含循环)。

  Background:
    Given 画布图: A→B→C(next 链),C 有 loop 边回 A(condition: gate_fail)
      And C 是验收闸节点(gate=true)

  Scenario: next 边拓扑序前进
    Given A/B/C 均 pending
    When 引擎推进
    Then 应先跑 A(无 next 上游)
      And A done 后跑 B
      And B done 后跑 C

  Scenario: 节点的 next 上游未全 done 不得跑
    Given A 还在 running
    When 引擎推进
    Then B 不得开始(因 A 未 done)

  Scenario: gate 未过触发回退边重跑
    Given A/B/C 已跑完,C 的 gate 未过(产出有未完成自检项)
    When 引擎检查 C 的 loop 边
    Then 应触发 loop_trigger(C → A)
      And 应把 A 及其 next 下游(B、C)重置为 pending
      And 应重新跑 A→B→C

  Scenario: gate 过了不触发回退
    Given C 的 gate 通过
    When 引擎检查 C 的 loop 边
    Then 不应触发回退
      And 应判定工作流完成

  Scenario: 回退死循环应被步数上限拦住
    Given C 的 gate 永远未过(模拟)
    When 引擎不断回退重跑
    Then 达到最大步数上限(如 200)后应停止
      And 应报告"疑似回退边死循环"

  Scenario: 上游节点失败应阻塞下游并报告
    Given A 跑失败(claude 异常退出)
    When 引擎推进
    Then B/C 应保持 pending(受阻)
      And workflow_done 应报告受阻节点列表
