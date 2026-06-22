"""xdd workflow 可视化编排前端(FastAPI + SSE + Drawflow)。

- server.py   FastAPI + SSE,实时跑+实时看
- engine.py   图执行引擎(拓扑前进 + 回退边循环)
- graph_io.py graph.json 读写 + 默认图 + 校验

复用 B01 基础层(nodes/gate/claude_runner)。@implements B02-R05
"""
