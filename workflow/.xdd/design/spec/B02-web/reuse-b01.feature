@B02 @R05 @covers-G1 @covers-G3 @covers-G7
Feature: Web 复用 B01 的节点定义和 gate
  作为 workflow Web 的引擎,
  我要 import 复用 B01(cli)的节点定义和验收闸,
  以便不平行实现、保持单一真理源。

  Scenario: 引擎 import 节点定义模块
    Given B01 的节点定义模块已实现(nodes)
    When Web engine 启动
    Then engine 应能 import 到 build_nodes 等节点定义函数
      And 默认图应从该模块派生(与 CLI 一致)

  Scenario: 引擎复用 gate_check
    Given B01 的 gate 已实现(认 □ + - [ ])
    When Web engine 判定验收闸节点
    Then 应调用同一份 gate_check
      And 判定结果应与 CLI 一致

  Scenario: 模型配置(models.yaml)两端共享
    Given workflow/models.yaml 配置了若干模型
    When Web 请求 /api/models
    Then 应返回与 CLI 相同的模型列表
      And 改 models.yaml 后两端都能热刷

  Scenario: 节点产出路径两端一致
    Given 同一个 task_dir
    When CLI 和 Web 各自跑 brainstorm 节点
    Then 两端产物应落在同一路径(design/intent.md 等)
      And 不因入口不同而路径分叉
