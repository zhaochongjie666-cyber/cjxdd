# B02-web(可视化编排前端)— 规则

> 一条业务规则 = 一个 RXX = 一个 Feature 文件。RXX 是 plan→code→verify 的追溯 ID。
> 术语全部来自 `design/notes/glossary.md`,无新造词。

| RXX | 规则一句话 | 覆盖 Feature | 关联 G |
|-----|-----------|-------------|--------|
| R01 | 编排图(graph.json)用节点+边建模,节点 7 字段可完全自定义 | graph-model.feature | G6 G7 |
| R02 | 边分两类:next(拓扑前进)和 loop(回退,带 condition);loop 边可从任意节点拉到上游任意节点 | edge-types.feature | G6 |
| R03 | 图执行引擎:next 上游全 done 才跑目标;loop 条件满足则重置目标及下游重跑(循环);防死循环上限 | graph-engine.feature | G6 |
| R04 | 执行进度经 SSE 实时推给浏览器:node_start/node_log/node_done/loop_trigger/workflow_done | sse-stream.feature | G6 |
| R05 | Web engine import 复用 B01 的节点定义(nodes)和 gate(gate_check),不平行实现 | reuse-b01.feature | G1 G3 G7 |
| R06 | 默认图从 B01 的八节点定义派生,保证开箱即用;wire 节点在纯后端项目跳过 | default-graph.feature | G1 G5 |

## 约束

- 每条 RXX 至少 1 个 `*.feature` 覆盖。
- RXX 编号业务线内裸 `R01~R06`;跨业务线引用带前缀(`B02-R01`)。
- graph.json 落盘到 `<task_dir>/.xdd/graph.json`。
- 前端零构建:纯静态(HTML/JS/CSS)+ Drawflow vendor,不引 React/npm。

## 节点字段(graph.json 节点结构,支撑 R01)

```jsonc
{
  "id": "n0_brainstorm",      // 唯一 id
  "name": "brainstorm",       // 显示名
  "skill": "use skill: xdd-brainstorm",  // 调什么(完全自定义)
  "output_doc": ".xdd/design/design.md", // 产出路径(相对 task_dir)
  "model": "YACC",            // 用哪个模型
  "extra": "",                // 追加 prompt 片段
  "gate": false               // 是否当验收闸
}
```
