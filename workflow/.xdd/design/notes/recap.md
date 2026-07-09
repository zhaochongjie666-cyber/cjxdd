# Recap — workflow brainstorm(iter-1)

> brainstorm Step 1「吃透现状」的产出:机械遍历读的全部材料清单 + 关键事实。
> 下游 spec/architecture 据此建立前因后果,不重新发明。

## 已读文件清单(遍历 + 逐个读)

### 上游:xdd framework 本身(workflow 要调的 skill)
| 文件 | 读了什么 |
|---|---|
| `skills/xdd-brainstorm/SKILL.md` | 入口流程(Step1 机械遍历读)+ 真实产出(intent/design/notes/goals)+ 11 项 `□` 自检 |
| `skills/xdd-spec/SKILL.md` | 输入对齐(design→RXX)+ 产出 `_landscape.md`+`{bxx}/{business,rules}.md`+`*.feature` + 13 项自检 |
| `skills/xdd-architecture/SKILL.md` | 质量属性场景选模式 + 产出 aggregate/event/module-landscape + `{bxx}/{architecture.md,flow.mermaid}` + 19 项自检 |
| `skills/xdd-wire/SKILL.md` | 解析 spec Feature 出页面清单 + 产出 `{page}/` 9 文件(6 操作态)+ **纯后端跳过** + 11 项自检 |
| `skills/xdd-resilience/SKILL.md` | 读 ODD 失败模型 + colocation 到 `{bxx}/resilience/` 5 文档 + 9 项自检 |
| `skills/xdd-plan/SKILL.md` | 读全部设计锚 + 产出 `plan/{bxx}/plan.md`(多业务线一份)+ task 回指 RXX + 10 项自检 |
| `skills/xdd-execute/SKILL.md` | Step0 准备环境 + 代码 `@implements RXX` + 18 项自检 + no-stub-check |
| `skills/xdd-verify/SKILL.md` | health-check + 4 维一致性 + 产出 `runs/iter-N/verify-report.md` + 30 项自检 |
| `skills/xdd-init/scripts/init.sh` | 骨架生成逻辑 + iter 迁移(`--iter N+1`)+ current-iteration 指针 + 存量检测 |
| `skills/xdd-init/SKILL.md` | 三态分流(全新/iter 迁移/重复)+ 入口路由判定 |

### 历史:旧版 workflow(已归档,本次重写的参考)
| 文件 | 看到的 bug / 可复用 |
|---|---|
| `archive/workflow-pre-xdd/run_workflow.py` | build_nodes 8 路径 7 错;node_prompt 不传上下文;test_gateway 扫 `- [ ]`;验收循环落 `loop_main_N/`。**可复用**:parser_msg / agent_worker 的 subprocess+stream-json 内核 / single_claude |
| `archive/workflow-pre-xdd/web/server.py` | FastAPI 路由结构可复用 |
| `archive/workflow-pre-xdd/web/engine.py` | 图执行引擎(拓扑前进+回退边)可复用 |
| `archive/workflow-pre-xdd/web/gate.py` | 放宽版 gate_check 认 `□`,**直接复用** |
| `archive/workflow-pre-xdd/web/graph_io.py` | graph.json 读写可复用 |

### 现场骨架
| 文件 | 状态 |
|---|---|
| `.xdd/runs/iter-1/status.md` | 3 层骨架占位,产出路径用的是**正确**的 skill 真实路径(印证旧 build_nodes 错) |
| `.xdd/design/spec/_landscape.md` | 业务线全景占位(待 spec 填) |
| `.xdd/design/spec/B01-cli/` `B02-web/` | init 预建的业务线目录 |

## 关键事实(决策依据)

1. **8 个 skill 的真实产出路径** 全部摸清(见 design.md S2),旧 build_nodes 与之不符。
2. **自检符号**:8 个 skill 全用 `□`(在代码块里),旧 test_gateway 扫 `- [ ]` → 不匹配。
3. **iter 迁移**:`init --iter N+1` 归档旧 iter,design/ 不动,current-iteration 指针前进。
4. **多业务线**:BXX 是限界上下文,plan 每业务线一份,T 编号文件内独立;G 编号项目级。
5. **Meta 守卫**:`${PWD}/agents/xdd-walker.md` 判定,workflow/ 子目录跑不命中。
6. **可复用核心**:旧版的 parser_msg(stream-json 归一)、agent_worker(subprocess 内核)、gate.py(认 □)、图引擎、FastAPI 路由 —— 重写时复用,不重造。

## 复用 vs 重写边界

| 模块 | 复用 | 重写 |
|---|---|---|
| gate.py(认 □ + - [ ]) | ✅ 原样 | |
| parser_msg(stream-json) | ✅ 原样 | |
| agent_worker subprocess 内核 | ✅ 照搬 | |
| FastAPI 路由 + SSE | ✅ 结构 | 适配新节点定义 |
| 图引擎(拓扑+回退) | ✅ 照搬 | |
| build_nodes(节点定义) | | ❌ 全重写(忠实 skill) |
| node_prompt | | ❌ 全重写(注入上下文) |
| 验收循环 | | ❌ 改走 iter 迁移 |
