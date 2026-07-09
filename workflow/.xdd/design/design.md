# 收敛决策 — workflow(外部编排层)

> brainstorm 发散后的收敛。Selected 是定下来的方案,下游 spec 据此拆 RXX 规则。

## Selected(选定方案)

### S1. 双入口单项目:CLI + Web 共享节点定义
workflow 是一个 Python 包,两种入口:
- **CLI**(`run_workflow.py`):八节点顺序执行,verify 当验收闸,未过回 plan→execute→verify。
- **Web**(`web/`):节点/边是图,拖拽编排,SSE 实时回显。
共享核心:`nodes.py`(节点定义,忠实 skill 真实产出路径)+ `gate.py`(验收闸)。

### S2. 节点定义忠实 skill(修旧版核心 bug)
节点不再硬编码产出路径,而是**对照 8 个 skill 的真实 SKILL.md** 声明:
- brainstorm → `design/intent.md`+`design.md`+`notes/`+`runs/iter-N/goals.md`
- spec → `design/spec/_landscape.md`+`{bxx-slug}/{business,rules}.md`+`*.feature`
- architecture → `design/architecture/{aggregate-landscape,event-contract,module-landscape}.md`+`{bxx-slug}/{architecture.md,flow.mermaid}`
- wire → `design/wire/{page}/` 6 操作态(**纯后端跳过**)
- resilience → `design/architecture/{bxx-slug}/resilience/` 5 文档
- plan → `runs/iter-N/plan/{bxx-slug}/plan.md`
- execute → 代码 `@implements RXX` + `runs/iter-N/audits/build.md`
- verify → `runs/iter-N/verify-report.md`

### S3. prompt 注入完整上下文
每个节点的 prompt 不再是干巴巴"产出文档 X",而是注入:
- 该 skill 的真实入口流程提示(从 SKILL.md 提炼一句话)
- 上游指针(具体文件路径)
- 业务线 slug(BXX)
- iter 号(从 `.xdd/current-iteration` 读,不硬编码 1)
- 自检清单要求(`□` 或 `- [ ]`,完成的改 `- [x]`/`☑`)

### S4. 验收闸认双符号
`gate.py` 同时认 `- [ ]`/`- [x]`(ASCII)和 `□`/`☑`(全角),通过条件:未完成=0 且已完成>0。CLI 和 Web 共用。

### S5. 验收循环走 iter 迁移
verify 未过 → `init --iter N+1`(归档 iter-N,建 iter-N+1,design 不动)→ plan→execute→verify。不落 `loop_main_N/`(旧版的乱放)。

### S6. 多业务线
默认两条业务线(B01-cli, B02-web)。节点定义按业务线分组,跨业务线有一致性约束(术语、G 编号全局、节点 id 不冲突)。

## Alternatives(考虑过没选)

- **A1. 只做 CLI,砍 Web** —— 否决:用户明确要网页版(可拖拽节点做循环)。
- **A2. 只做 Web,砍 CLI** —— 否决:CI/无人值守场景需要命令行入口。
- **A3. 用 React/打包器做前端** —— 否决:违反仓库"零重型前端依赖"调性,用 Drawflow(vanilla,~46KB)。
- **A4. 给 workflow 加 docker-compose** —— 否决:它是 Python 编排器,不是服务,verify 适配而非强套。
- **A5. 验收循环原地重跑(同 iter)** —— 否决:不忠实 xdd 的 iter 迁移机制,选 S5 走 `init --iter N+1`。
- **A6. 修改 skills 源码让自检统一用 `- [ ]`** —— 否决:改 framework skill 是 Meta 任务,超出"用 xdd 做产品"边界;选 S4 在 workflow 侧放宽识别。

## Assumptions(假设)

- `claude` CLI 在 PATH 里,`--output-format stream-json` + `--append-system-prompt-file` 等参数可用。
- `workflow/models.yaml` 配好对应模型的 env(不入库)。
- 运行环境可信(`--permission-mode bypassPermissions` 自动跑不等人)。
- 用户在 workflow/ 子目录跑(避 cjxdd 根的 Meta 守卫)。
- 每个被调 skill 已 install 到 harness(软链或软链目录)。

## Out of Scope(不做)

- 用户认证 / 多租户 / 远程访问(单机本地工具)。
- 画布持久化版本管理(只存当前一份 graph.json)。
- workflow 自身的 docker 化 / 服务化。
- 修改 xdd skill 源码(只调,不改)。

## Open Questions(待答)

- Q1:execute 节点的执行报告路径 skill 未明确规定 → 选 `runs/iter-N/audits/build.md`(对齐 init 建的 audits/ 占位)。spec RXX 里会写死这条约定。
- Q2:Web 上"回退边"的 condition 目前只支持 `gate_fail`/`always`,要不要加自定义条件? → iter-1 只做这两种,留扩展点。
- Q3:多业务线时 CLI 怎么编排顺序? → 默认两业务线并行不了(subprocess 串行),按 B01→B02 顺序跑设计层,代码层按依赖合并。spec RXX 会定。
