"""xdd workflow 网页版 —— 给 workflow/run_workflow.py 一个可视化编排前端。

定位:外部编排层的可视化 driver(非 agents/skills,不触发 Meta 守卫)。
- server.py   FastAPI + SSE,实时跑+实时看
- engine.py   图执行引擎(拓扑前进 + 回退边循环)
- graph_io.py graph.json 读写 + 默认图
- gate.py     放宽版 test_gateway(同时认 - [ ] 和 □)
"""

__all__ = ["server", "engine", "graph_io", "gate"]
