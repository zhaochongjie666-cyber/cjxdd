"""xdd workflow —— 外部编排层(CLI + Web 两种入口,同一个项目)。

- run_workflow.py  CLI 调度器,subprocess 调 claude CLI 跑 8 节点 + 验收循环
- web/             可视化编排前端(FastAPI + SSE + Drawflow 画布)

两者共享 run_workflow.py 的核心函数(parser_msg / test_gateway /
load_model_envs / node_prompt / build_nodes),web/ 是它的可视化 driver。

依赖:claude CLI + models.yaml(不入库,各自填 key)。不属于平台中立的
skill/agent 层。
"""
