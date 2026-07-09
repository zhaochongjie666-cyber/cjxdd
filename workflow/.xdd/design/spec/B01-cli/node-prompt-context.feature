@B01 @R02 @covers-G2 @covers-G5
Feature: 节点 prompt 注入完整上下文
  作为被调用的 claude,
  我要在 prompt 里拿到 skill 入口、上游指针、业务线、iter、自检要求,
  以便正确执行对应 xdd skill。

  Scenario: spec 节点 prompt 含上游指针和业务线
    Given workflow 即将执行 spec 节点,当前业务线为 B01-cli,iter 为 2
    When 构造该节点的 prompt
    Then prompt 应包含 "use skill: xdd-spec"
      And prompt 应指明上游 design/design.md 的路径
      And prompt 应包含业务线 slug B01-cli
      And prompt 应包含 iter 号 2
      And prompt 应要求产出末尾含自检清单(□ 或 - [ ])

  Scenario: execute 节点 prompt 含 plan 上游
    Given workflow 即将执行 execute 节点
    When 构造该节点的 prompt
    Then prompt 应指明上游 plan 路径 runs/iter-N/plan/{bxx-slug}/plan.md
      And prompt 应要求代码标注 @implements RXX

  Scenario: iter 号来自 current-iteration 而非硬编码
    Given .xdd/current-iteration 内容为 "iter-3"
    When 构造任意节点的 prompt
    Then prompt 中的 iter 号应为 3
      But 不应是硬编码的 1

  Scenario: 缺 current-iteration 时回退默认 iter 1 并警告
    Given .xdd/current-iteration 文件不存在
    When 构造节点 prompt
    Then iter 号应回退为 1
      And 应输出警告:未找到 current-iteration,用默认 iter 1
