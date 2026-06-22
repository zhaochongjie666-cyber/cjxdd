# xdd workflow 网页版

> 给 `workflow/run_workflow.py`(命令行 8 节点调度器)一个**可视化编排前端**:
> 在拖拽画布上**增删/配置节点**、**拉回退边定义任意循环**,点"开始"在网页上**实时跑+实时看**每个节点的通过/进行中/失败状态和流式日志。

这是 `workflow/`(外部编排层)的 web driver,不是 `agents/`/`skills/`(平台中立层),不触发 Meta 守卫。

---

## 和命令行的关系

| | `workflow/run_workflow.py` | `workflow/web/`(本目录) |
|---|---|---|
| 节点 | 硬编码 8 个 | 画布上任意增删/配置 |
| 循环 | 固定 verify→plan/execute | 任意节点拉任意回退边 |
| 运行 | 命令行一次性 | 网页上点开始,SSE 实时回显 |
| 复用 | — | import 复用 run_workflow 的核心函数 |

两者是**同一个项目**(详见上一级 [`workflow/README.md`](../README.md))。`web/` 不改
`run_workflow.py`,只 import 它的 `parser_msg` / `test_gateway`(经 `gate.py` 放宽)/
`load_model_envs` / `node_prompt` / `build_nodes`。

---

## 快速开始

### 1. 配模型(复用 workflow 的)

```bash
cp workflow/models.yaml.template workflow/models.yaml
vim workflow/models.yaml   # 填 ANTHROPIC_API_KEY 等
```

`web/` 用同一份 `workflow/models.yaml`,改完 key 在网页上点 `重新加载` 或调 `POST /api/models/reload` 热刷。

### 2. 装依赖

```bash
pip install -r workflow/requirements.txt   # fastapi + uvicorn + pyyaml
```

### 3. 起 server

```bash
python -m workflow.web.server            # → http://localhost:8000
python -m workflow.web.server --port 9000        # 换端口
python -m workflow.web.server --reload           # 开发热重载
```

### 4. 浏览器操作

1. 顶部填**任务目录**(须含 `prd.md`,例如 `demo/my-project`)。
2. 点 **📂 加载图** —— 加载该目录已保存的 `graph.json`;没有则加载默认 8 节点图。
3. 在画布上编辑:
   - **拖拽添加**:从左侧面板拖 `xdd 标准节点` / `自定义节点` / `验收闸节点` 到画布。
   - **连线**:拖节点右侧输出圆点到另一节点左侧输入圆点 = `next` 边(拓扑前进)。
   - **回退边(循环)**:**按住 Shift** 再拖 = `loop` 边(虚线红),带 `gate_fail` 条件。
   - **编辑**:双击节点弹配置框(改 skill/模型/产出路径/extra/gate)。
   - **删除**:右键节点 → 确认。
4. 点 **💾 保存** 落盘到 `<task_dir>/.xdd/graph.json`。
5. 点 **▶ 开始** —— 实时跑:节点徽章依次变 ⏳→✅/❌,底部日志流式滚动,回退边触发时目标节点重跑。
6. (可选)勾 **⟳ force** = 忽略已有产出全重跑。

---

## 编排图格式(graph.json)

```jsonc
{
  "task_dir": "/abs/demo/my-project",
  "nodes": [
    {
      "id": "n0_brainstorm",
      "name": "brainstorm",
      "skill": "use skill: xdd-brainstorm",
      "output_doc": ".xdd/design/design.md",
      "model": "YACC",
      "extra": "",
      "gate": false
    }
  ],
  "edges": [
    { "from": "n0_brainstorm", "to": "n1_spec", "type": "next" },
    { "from": "n7_verify", "to": "n6_execute", "type": "loop", "condition": "gate_fail" }
  ]
}
```

- **节点 7 字段**:完全自定义 `skill` / `output_doc`(相对 task_dir) / `model` / `extra`(追加 prompt 片段) / `gate`(是否当验收闸)。
- **边两类**:`next`(实线,拓扑序前进,一个节点的 next 上游都 done 才跑它) / `loop`(虚线,回退;`condition=gate_fail` = 源节点 gate 没过则触发,把目标及其下游重置 pending 重跑)。

---

## 执行语义(图引擎)

1. **拓扑前进**:反复找"状态 pending 且所有 next 上游都 done"的节点跑。
2. **验收闸**:节点 `gate=true` 时,跑完用 `gate_check(output_doc)` 判通过(统计自检清单,同时认 `- [ ]` 和 `□`)。
3. **回退边**:节点 done 后检查从它出发的 loop 边;`gate_fail` 条件满足则重置目标节点及沿 next 边的下游,回到目标重跑 —— 实现任意循环。
4. **force**:产出已存在的节点直接跳过(判 gate);勾 force 则全重跑。
5. **停止**:点 ⏹ → kill 当前 claude subprocess + 结束引擎。
6. **防死循环**:总步数上限 200,超过即停并报"疑似回退边死循环"。

---

## 验收闸说明(契约放宽)

`run_workflow.test_gateway` 只认 ASCII `- [ ]`/`- [x]`,但 xdd skill 模板的自检段用全角 `□`(U+25A1)。`web/gate.py` 的 `gate_check` **同时认两种**:
- 未完成:行首 `- [ ]` 或 `□`
- 已完成:行首 `- [x]` 或 `☑`/`✔`/`✓`
- 通过:未完成数=0 且已完成数>0。

---

## API 一览

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/` | 画布页 |
| GET | `/api/models` | 可用模型列表 |
| POST | `/api/models/reload` | 热刷 models.yaml |
| GET | `/api/graph?task_dir=` | 读编排图(无则默认图) |
| POST | `/api/graph` | 保存编排图(带校验) |
| POST | `/api/graph/validate` | 校验编排图 |
| POST | `/api/run` | 启动执行,返回 run_id |
| GET | `/api/run/{run_id}/stream` | SSE 实时事件流 |
| POST | `/api/run/{run_id}/stop` | 停止执行 |
| GET | `/api/runs` | 所有 run 状态 |

SSE 事件类型:`node_start` / `node_log` / `node_done` / `node_reset` / `loop_trigger` / `workflow_done`。

---

## 文件

```
workflow/web/
├── server.py            FastAPI + SSE
├── engine.py            图执行引擎(拓扑前进 + 回退边循环)
├── graph_io.py          graph.json 读写 + 默认图
├── gate.py              放宽版 test_gateway(认 □ 和 - [ ])
├── README.md            本文件
└── static/
    ├── index.html       画布页
    ├── app.js           Drawflow 交互 + SSE 消费
    ├── style.css        样式
    └── vendor/          drawflow.min.{css,js}
```

依赖文件 `workflow/requirements.txt` 在上一级(CLI + Web 共享)。

---

## 注意

- 依赖 `claude` CLI 在 PATH 里 + `workflow/models.yaml` 配好 key(同命令行版)。
- `--permission-mode bypassPermissions`:自动跑不等人确认,确保在可信环境。
- 单机本地工具,无用户认证/多租户。
- 产物落在 `<task_dir>/.xdd/`(同 xdd 三层模型)+ `<task_dir>/log/`(调度日志)。
