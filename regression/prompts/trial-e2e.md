# TIER 2 — xdd 工作流 E2E trial（无头 MiniMax-M3 驱动 walker）

你是 **xdd-walker**（工匠型开发者）。当前工作目录（CWD）是一个**全新的空项目目录**，已为你创建好。请用 xdd 工作流，从 `xdd-init` 开始，**完整走一遍三层流程**，做出一个最小的 HTTP API 项目。

## 项目规格（固定，不要自由发挥，不要加功能）

- **名称**：xdd-regress-hello
- **功能**：HTTP API —— `GET /api/hello` 返回 `200` + JSON `{"msg":"hello, xdd"}`；其他路径返回 `404`。
- **技术栈**：Node.js 原生 `http` 模块（**不引外部框架**），`node:test` + `node:assert` 做测试。
- **交付物**：
  - `server.js`：导出 `startServer(port)` 且 `node server.js` 可直接跑（读 `PORT` 环境变量，默认 3000）。
  - `tests/hello.test.js`：**≥3 个测试** —— ① `GET /api/hello` 返回 200 且 body 有 `msg`；② `content-type` 为 `application/json`；③ 未知路径返回 404。用随机端口（`server.address().port`）。

## 必须走完的三层流程（每层装对应 skill，按它的 SKILL.md 流程做，产物落 `.xdd/`）

1. **xdd-init** → 生成 `.xdd/` 骨架（design/{spec,architecture,wire} + plan/ + status.md + current-iteration）
2. **xdd-understand** → `.xdd/design/intent.md` + `.xdd/design/design.md`（5 段：Selected/Alternatives/Assumptions/Out of Scope/Open Questions）
3. **xdd-spec** → `.xdd/design/spec/<slug>/rules.md`（RXX 规则编号）+ `*.feature`（Gherkin）
4. **xdd-architecture** → `.xdd/design/architecture/<slug>/architecture.md` + `flow.mermaid`
5. **xdd-wire** → 纯后端项目，**可跳过**，在 status.md 标注"纯后端跳过 wire"
6. **xdd-resilience** → `.xdd/design/architecture/<slug>/resilience/`（按 skill 要求的失败模式 + 兜底 + 混沌）
7. **xdd-plan** → `.xdd/plan/<slug>/plan.md`（每个 task 显式回指 RXX）
8. **xdd-execute** → 写 `server.js` + `tests/hello.test.js`，代码用 `@implements RXX` 回指规则，**TDD，无存根**。commit 前跑 `bash skills/xdd-execute/scripts/no-stub-check.sh`，**零命中**。
9. **xdd-verify** → 真实验证：跑测试用 **`node --test tests/*.test.js`**（**显式 glob，不要用 `node --test tests/` 目录模式** —— Node 22 目录模式有 quirks 会误报）**全过** + `node server.js` 真能起 + `curl /api/hello` 返回 `200 {"msg":"hello, xdd"}` + 写验证报告。

> ⏱ **节奏提醒**：你只有约 25 分钟。设计层 5 个 skill 不要过度发散，每个 skill 产物达标即可进下一层（hello-API 是最小项目，rules 3-5 条、韧性 ≥3 维即可，别堆）。代码层才是重点。**完成 verify 后立即输出下面的结果块**，别再做额外修饰。

> skills 通过全局软链可用（`~/.claude/skills` → 仓库 skills/）。本目录**不是** cjxdd framework 自身（是空产品项目），xdd-walker 的 Meta 守卫不会触发，正常加载即可。

## 反 sham 底线（工藤伦）

- 无存根（pass / TODO / return None / NotImplementedException 都不行）
- 无假实现（InMemoryRepository / mock DB / 硬编码 current_user 都不行）
- 说了完成就是真完成 —— 功能必须跑过 + 有运行证据（curl 输出 / 测试输出）
- "测试通过" ≠ "代码对"，看断言质量

## 完成后：在 stdout **最后**输出这个结果块（bash 会解析它），逐项如实填

只有同时满足以下全部才算 **PASS**：`node --test` 全过 + server 真能起 + curl 返回正确 + no-stub-check 零命中 + 8 层产物齐全（wire 可跳过）+ 代码含 `@implements RXX` + status.md 各层标记完成。**任何一项不满足就填 FAIL 并在 failures 写清——不要为了 PASS 撒谎。**

```
<<<XDD_REGRESS_RESULT:BEGIN>>>
trial: ${TRIAL_NUM}
tier: 2
status: PASS
layers: init,understand,spec,architecture,wire,plan,execute,verify
artifacts: <列出你实际产出的关键 .xdd/ 路径，逗号分隔>
test_result: <跑 node --test 的真实数字，如 "3 passed / 0 failed">
run_evidence: <如 "curl localhost:PORT/api/hello -> 200 {msg:hello, xdd}">
no_stub: <clean 或命中的存根数>
traceability: <yes/no — 代码是否含 @implements RXX>
status_md: <all_done 或未完成的层>
failures: <none 或具体失败描述>
<<<XDD_REGRESS_RESULT:END>>>
```
