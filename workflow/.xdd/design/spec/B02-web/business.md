# B02-web — 可视化编排前端

## 业务目标

让用户在**交互式**场景下,在网页画布上拖拽编排 xdd 节点、拉回退边定义任意循环,点"开始"后实时看每个节点的状态和流式日志。

## 关键问题(本业务线要解的)

1. **节点/边是图模型** —— 用户要能增删节点、连线、拉任意回退边,不是固定链。→ R01 R02
2. **图执行引擎** —— 拓扑序前进(next 边依赖)+ 回退边触发循环(loop 边条件满足重跑)。→ R03
3. **SSE 实时回显** —— 节点跑的时候,浏览器要实时看到 claude 的流式输出和节点状态变化。→ R04
4. **复用 B01 的节点定义/gate** —— 不平行实现,import B01 的 `nodes.py`/`gate.py`。→ R05
5. **节点可完全自定义** —— 任意 skill/产出路径/模型/prompt 片段,不限于 xdd 标准 8 节点。→ R06

## 范围

| In(做) | Out(不做) |
|---|---|
| FastAPI server + SSE 推流 | 不做 CLI(那是 B01) |
| Drawflow 画布(拖拽/连线/编辑) | 不做用户认证/多租户 |
| 图执行引擎(拓扑前进 + 回退边) | 不引入 React/npm 构建 |
| graph.json 编排图持久化 | 不做画布版本管理 |
| 节点状态机(idle/running/passed/failed) | 不做远程/多机 |
| 复用 B01 节点定义 + gate | 不实现 skill 内容 |

## 通用语言(引用)

本上下文的词全部来自 `design/notes/glossary.md`,核心:节点 / next 边 / loop 边 / gate / run_id / SSE / 状态(idle/running/passed/failed)/ pending/done / graph.json / Drawflow / 验收闸。

## 关联

| 产物 | 路径 |
|---|---|
| 本业务线规则 | `spec/B02-web/rules.md`(R01~R06) |
| Feature | `spec/B02-web/*.feature` |
| 架构 | `architecture/B02-web/architecture.md` + `flow.mermaid` |
| 韧性 | `architecture/B02-web/resilience/` |
| 计划 | `runs/iter-1/plan/B02-web/plan.md` |
| 代码 | `workflow/web/server.py` + `engine.py` + `graph_io.py` + `static/`(@implements RXX) |

## 跨业务线关系

- **复用 B01**:本业务线的 engine import B01 的节点定义(`nodes.py`)和 gate(`gate.py`)。B01 改 R01/R03 会传导到本业务线。
- **共享 G 编号**:本业务线 RXX 支撑 G1/G3/G6/G7。
