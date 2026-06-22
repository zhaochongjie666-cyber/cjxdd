# xdd workflow —— 外部编排层(CLI + Web 一个项目)

> 用 Python 调度 claude CLI 自动跑完 xdd 全链:
> `brainstorm → spec → architecture → wire → resilience → plan → execute → verify`。
>
> **两种入口,同一个项目**:
> - **CLI**:`run_workflow.py`,八节点顺序执行 + 验收循环,无人值守/CI/批量跑
> - **Web**:`web/`,拖拽画布可视化编排(增删节点、拉任意回退边做循环、实时跑实时看)
>
> 两者共享 `run_workflow.py` 的核心函数(parser_msg / test_gateway / load_model_envs /
> node_prompt / build_nodes),Web 是 CLI 的可视化 driver。

这是**外部编排层**(给人/CI 直接跑),和 `agents/` 下的 walker/orchestrator(给 AI agent 自走)是两套范式。依赖 claude CLI + models.yaml,**不属于平台中立的 skill/agent 层**。

## 为什么有这两个入口

| | CLI `run_workflow.py` | Web `web/` |
|---|---|---|
| 节点 | 硬编码 8 个 | 画布上任意增删/配置 |
| 循环 | 固定 verify→plan/execute | 任意节点拉任意回退边 |
| 运行 | 命令行一次性 | 网页上点开始,SSE 实时回显 |
| 适合 | 无人值守/CI/批量 | 交互式编排、调试、观察 |

---

## 快速开始

### 1. 配模型(两入口共享)

```bash
cp workflow/models.yaml.template workflow/models.yaml
vim workflow/models.yaml   # 填 ANTHROPIC_API_KEY 等(models.yaml 不入库)
```

### 2. 装依赖

```bash
pip install -r workflow/requirements.txt   # fastapi + uvicorn + pyyaml
```

### 3. 准备项目目录(须含 prd.md)

```bash
mkdir -p demo/my-project && echo "# 我的需求" > demo/my-project/prd.md
```

### 4. 二选一启动

**CLI**(无人值守):

```bash
python workflow/run_workflow.py -t demo/my-project -m YACC
python workflow/run_workflow.py -t demo/my-project -m YACC -f   # 强制重跑
```

**Web**(可视化编排):

```bash
python -m workflow.web.server            # → http://localhost:8000
python -m workflow.web.server --port 9000
```

浏览器里填任务目录 → 加载图 → 拖拽编辑/连线 → 保存 → 开始。

---

## Web 用法

1. 顶部填**任务目录**(须含 `prd.md`)。
2. **📂 加载图** —— 加载该目录的 `graph.json`;没有则加载默认 8 节点图。
3. 画布编辑:
   - **拖拽添加**:从左侧面板拖 `xdd 标准节点` / `自定义节点` / `验收闸节点`。
   - **连线(next)**:拖节点输出圆点到另一节点输入圆点。
   - **回退边(loop,做循环)**:**按住 Shift** 再拖 = 虚线红回退边,带 `gate_fail` 条件。
   - **编辑**:双击节点改 skill/模型/产出路径/extra/gate。
   - **删除**:右键节点。
4. **💾 保存** 落盘到 `<task_dir>/.xdd/graph.json`。
5. **▶ 开始** —— 节点徽章 ⏳→✅/❌,底部日志流式滚动,回退触发时目标节点重跑。
6. (可选)**⟳ force** = 忽略已有产出全重跑。

详见 [`web/README.md`](./web/README.md)。

---

## 流程与验收闸

**CLI 第一阶段**(顺序执行八节点):每节点 `use skill: <xdd-skill>`,产出文档含 `- [ ]` 自检清单。

**CLI 第二阶段**(验收循环):verify 节点报告当总闸——统计 `- [ ]` 数量,全 `- [x]` 才过;未过则回 plan→execute→verify 重做(`loop_main_N/`),直到通过。

**Web 版**把这套泛化成图:任意节点配任意回退边。验收闸用 `web/gate.py` 的 `gate_check`,**同时认 `- [ ]` 和全角 `□`**(skill 模板自检段用 `□`,放宽版补了这个契约裂缝)。

---

## 文件

```
workflow/
├── run_workflow.py          CLI 调度器(八节点 + 验收循环)
├── models.yaml.template     模型 env 配置模板(复制为 models.yaml 填 key)
├── SYSTEM.md                追加给每个 agent 的 system prompt
├── requirements.txt         fastapi / uvicorn / pyyaml(CLI+Web 共享)
├── __init__.py
└── web/                     可视化编排前端(详见 web/README.md)
    ├── server.py            FastAPI + SSE
    ├── engine.py            图执行引擎(拓扑前进 + 回退边循环)
    ├── graph_io.py          graph.json 读写 + 默认图
    ├── gate.py              放宽版 test_gateway(认 □ 和 - [ ])
    └── static/              Drawflow 画布页 + SSE 消费
```

## 注意

- 依赖 `claude` CLI 在 PATH 里 + `models.yaml` 配好对应模型的 env。
- `--permission-mode bypassPermissions`:自动跑不等人确认,确保在可信环境。
- 产物落在 `<task_dir>/.xdd/`(同 xdd 三层模型)+ `<task_dir>/log/`(调度日志)。
