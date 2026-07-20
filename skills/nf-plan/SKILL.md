---
name: nf-plan
description: |
  Normal Flow 第 3 阶段（plan）-- 把 RXX + .feature 翻译成零上下文工程师可直接执行的 TDD 任务计划。
  plan.md 格式：每个 Task 必须有 Feature/Implementation/Acceptance Test 三件套（给 verify 的 FEATURE_SCENARIO_GAP gate 解析）；
  可选 Wandering Scenarios 块（声明哪些 Scenario 会被 verify 真实走一遍，给 WANDERING_NOT_WALKED gate 解析）。
  触发：normal-flow plan、nf plan、计划、任务拆解、实施计划、TDD 计划。
---

# nf-plan -- 桥接锚

**我做什么**：把设计翻译成可执行计划。每个 task 显式回指 RXX，给 execute 零上下文执行，给 verify 追溯锚。

**上游**：`nf-brainstorm` 的 design.md + `nf-spec` 的 RXX + .feature
**我产出**：`.xdd/runs/normal_run/plan.md`
**下游**：`nf-execute` 按 task 逐步 TDD；`nf-verify` 检查 FEATURE_SCENARIO_GAP / SCENARIO_NOT_IMPLEMENTED / SCENARIO_UNVERIFIED / WANDERING_NOT_WALKED

> **无损切换原则**：plan.md 写到 `.xdd/runs/normal_run/plan.md`（NF 专属 run 目录），不写 xdd_run。如果 cwd 上已有 `runs/xdd_run/plan.md`（xdd 产的），不要读它--两个 run 的计划是独立的。但 `.xdd/design/` 下的 RXX / .feature 是共享的，必须 READ 并对齐。

## 怎么做

写 `.xdd/runs/normal_run/plan.md`：

```markdown
# Plan

### Task login-success
**RXX:** R01
**Feature:** auth.feature :: Scenario: 用户登录成功
**Implementation:** src/auth.ts
**Acceptance Test:** curl -X POST http://localhost:8000/api/login -d '{"user":"alice","pwd":"ok"}' -> 200 + token
**Files:** src/auth.ts, src/routes/login.ts
**Expected:** HTTP 200, 响应体含 token 字段, DB sessions 表有 1 行
**Attack:** 错误密码 -> 401; 空密码 -> 400
**Gate:** requireTestsPass + @implements R01 标注

### Task login-deny
**RXX:** R02
**Feature:** auth.feature :: Scenario: 错误密码被拒
**Implementation:** src/auth.ts
**Acceptance Test:** curl -X POST /api/login -d '{"user":"alice","pwd":"wrong"}' -> 401
**Files:** src/auth.ts
**Expected:** HTTP 401, 响应体含 error 字段
**Attack:** 重复错误 10 次 -> 不锁定
**Gate:** requireTestsPass + @implements R02 标注

## Wandering Scenarios

> 这些 Scenario 会被 verify 阶段用 nf_wander 真实走一遍。声明了就必须真走，否则 verify gate 拒绝。

- Feature: .xdd/design/spec/b01/auth.feature
  Scenario: 用户登录成功
- Feature: .xdd/design/spec/b01/auth.feature
  Scenario: 错误密码被拒
```

## 格式约定（Gate 强制）

- `### Task <name>` -- 每个 task 一个块，name 唯一
- `**Feature:** <feature 文件名> :: Scenario: <Scenario 名>` -- **必须**。Scenario 名必须与 .feature 完全一致
- `**Implementation:** <源码路径>` -- **必须**。必须是磁盘上真实存在的源文件路径（verify gate 的 SCENARIO_NOT_IMPLEMENTED 会检查文件存在）
- `**Acceptance Test:** <可运行命令>` -- **必须**
- `**RXX:** R01` -- **必须**，回指 spec 规则
- `## Wandering Scenarios` -- **可选**。写了就必须在 verify 阶段被走到
  - 每条形如 `- Feature: <path>` + 缩进的 `Scenario: <name>`

## 纪律

- 每个 task 先写测试再写实现（execute 阶段强制 TDD）
- `**Expected:**` 必须有具体值（HTTP code / 响应字段 / DB 行），不能是「成功」
- `**Attack:**` 必须有 ≥1 个失败/边界/异常用例
- plan.md 写在 `.xdd/runs/normal_run/plan.md`，不是 xdd_run

## 自检

- [ ] 每个 `### Task` 有 Feature/Implementation/Acceptance Test 三件套
- [ ] Feature 字段的 Scenario 名与 .feature 完全一致
- [ ] Implementation 路径指向真实源文件（execute 阶段会写出来）
- [ ] 每个 task 关联 ≥1 RXX
- [ ] Expected 有具体值；Attack 有 ≥1 失败用例
- [ ] Wandering Scenarios 块（如果写）的 Scenario 在 .feature 中真实存在

## 工具

```
nf_observe / nf_desired_state / nf_difference
read .xdd/design/** + 仓库 README/package.json
write/edit .xdd/runs/normal_run/plan.md
nf_submit_artifact -> nf_advance
```
