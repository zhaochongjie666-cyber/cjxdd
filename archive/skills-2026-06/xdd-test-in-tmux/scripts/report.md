[xdd-dispatch-test] === 9 subagent dispatch 测试 ===
[xdd-dispatch-test] agents dir: /home/zhaocj/ws/cjxdd/agents
[xdd-dispatch-test] claude agents: /home/zhaocj/.claude/agents

=== L1 静态: 文件存在 + frontmatter ===
  ✓ xdd-orchestrator: L1 文件 + frontmatter OK
  ⚠ phase-researcher: 缺 Meta 守卫段 (改 cjxdd 时可能误触发)
  ✓ phase-researcher: L1 文件 + frontmatter OK
  ⚠ phase-designer: 缺 Meta 守卫段 (改 cjxdd 时可能误触发)
  ✓ phase-designer: L1 文件 + frontmatter OK
  ⚠ phase-architect: 缺 Meta 守卫段 (改 cjxdd 时可能误触发)
  ✓ phase-architect: L1 文件 + frontmatter OK
  ⚠ phase-scaffolder: 缺 Meta 守卫段 (改 cjxdd 时可能误触发)
  ✓ phase-scaffolder: L1 文件 + frontmatter OK
  ⚠ phase-resilience-designer: 缺 Meta 守卫段 (改 cjxdd 时可能误触发)
  ✓ phase-resilience-designer: L1 文件 + frontmatter OK
  ⚠ phase-planner: 缺 Meta 守卫段 (改 cjxdd 时可能误触发)
  ✓ phase-planner: L1 文件 + frontmatter OK
  ⚠ phase-executor: 缺 Meta 守卫段 (改 cjxdd 时可能误触发)
  ✓ phase-executor: L1 文件 + frontmatter OK
  ⚠ phase-verifier: 缺 Meta 守卫段 (改 cjxdd 时可能误触发)
  ✓ phase-verifier: L1 文件 + frontmatter OK

=== L1.5 软链: ~/.claude/agents/ ===
  ✓ xdd-orchestrator: 软链 OK
  ✓ phase-researcher: 软链 OK
  ✓ phase-designer: 软链 OK
  ✓ phase-architect: 软链 OK
  ✓ phase-scaffolder: 软链 OK
  ✓ phase-resilience-designer: 软链 OK
  ✓ phase-planner: 软链 OK
  ✓ phase-executor: 软链 OK
  ✓ phase-verifier: 软链 OK

=== L2 引用: subagent 提的 skill ===
  ✓ skill: xdd-l6 OK
  ✓ skill: xdd-l0 OK
  ✓ skill: xdd-l3 OK
  ✓ skill: xdd-init OK
  ✓ skill: xdd-bdd OK
  ✓ skill: xdd-arch OK
  ✓ skill: xdd-docker-helper OK
  ✓ skill: xdd-wire OK
  ✓ skill: xdd-scaffold OK
  ✓ skill: xdd-execute OK
  ✓ skill: xdd-mermaid-check OK
  ✓ skill: xdd-flow OK
  ✓ skill: xdd-plan OK
  ✓ skill: xdd-add OK

=== L3 orchestrator dispatch 表 ===
  ✓ orchestrator 引用 phase-researcher
  ✓ orchestrator 引用 phase-designer
  ✓ orchestrator 引用 phase-architect
  ✓ orchestrator 引用 phase-scaffolder
  ✓ orchestrator 引用 phase-resilience-designer
  ✓ orchestrator 引用 phase-planner
  ✓ orchestrator 引用 phase-executor
  ✓ orchestrator 引用 phase-verifier

=== L3.5 必填产物声明 ===
  ✓ phase-researcher: 声明必填产物
  ✓ phase-designer: 声明必填产物
  ✓ phase-architect: 声明必填产物
  ✓ phase-scaffolder: 声明必填产物
  ✓ phase-resilience-designer: 声明必填产物
  ✓ phase-planner: 声明必填产物
  ✓ phase-executor: 声明必填产物
  ✓ phase-verifier: 声明必填产物

=== 汇总 ===
PASS: 48
FAIL: 0

✅ 9 subagent dispatch 测试全过
