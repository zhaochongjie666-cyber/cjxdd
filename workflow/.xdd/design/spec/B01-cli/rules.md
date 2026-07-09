# B01-cli(命令行调度器)— 规则

> 一条业务规则 = 一个 RXX = 一个 Feature 文件。RXX 是 plan→code→verify 的追溯 ID。
> 术语全部来自 `design/notes/glossary.md`,无新造词。

| RXX | 规则一句话 | 覆盖 Feature | 关联 G |
|-----|-----------|-------------|--------|
| R01 | 八节点产出路径必须忠实各 skill 的真实产出,不得硬编码错路径 | node-output-path.feature | G1 G5 |
| R02 | 每节点 prompt 必须注入:skill 入口提示 + 上游指针 + 业务线 slug + iter 号 + 自检符号要求 | node-prompt-context.feature | G2 G5 |
| R03 | 验收闸(gate)同时认 `- [ ]`/`- [x]` 和 `□`/`☑`,通过=未完成0且已完成>0 | gate-dual-symbol.feature | G3 |
| R04 | 验收未过时走 `init --iter N+1` 迁移,不得在当前 iter 乱落 `loop_main_N/` | verify-loop-iter-migration.feature | G4 |
| R05 | 迁移后在 iter-(N+1) 重跑 plan→execute→verify 修复未过项,design/ 不动 | verify-loop-iter-migration.feature | G4 G5 |
| R06 | iter 号从 `.xdd/current-iteration` 读取,不得硬编码为 1 | iter-from-current.feature | G8 |

## 约束

- 每条 RXX 至少 1 个 `*.feature` 覆盖(见下方)。
- RXX 编号业务线内裸 `R01~R06`;跨业务线引用带前缀(`B01-R01`)。
- 改一条 RXX → 通知 plan + code(改下游追溯链)。

## 八节点产出路径对照(支撑 R01)

| 节点 | 忠实产出(skill 真实) |
|---|---|
| brainstorm | `design/intent.md` + `design/design.md` + `design/notes/` + `runs/iter-{N}/goals.md` |
| spec | `design/spec/_landscape.md` + `design/spec/{bxx}/{business,rules}.md` + `*.feature` |
| architecture | `design/architecture/{aggregate-landscape,event-contract,module-landscape}.md` + `design/architecture/{bxx}/{architecture.md,flow.mermaid}` |
| wire | `design/wire/{page}/`(6 操作态;**纯后端项目跳过**) |
| resilience | `design/architecture/{bxx}/resilience/`(5 文档) |
| plan | `runs/iter-{N}/plan/{bxx}/plan.md` |
| execute | 代码 `@implements RXX` + `runs/iter-{N}/audits/build.md` |
| verify | `runs/iter-{N}/verify-report.md` |
