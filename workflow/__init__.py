"""xdd workflow —— 外部编排层(CLI + Web 两种入口,同一个项目)。

- run_workflow.py  CLI 调度器(八节点 + 验收循环走 iter 迁移)
- web/             可视化编排前端(FastAPI + SSE + Drawflow)

共享基础层:gate / iter_utils / nodes / models / claude_runner。
依赖:claude CLI + models.yaml(不入库)。不属于平台中立的 skill/agent 层。
"""
