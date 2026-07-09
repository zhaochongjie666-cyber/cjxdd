# Plan — B02-web(可视化编排前端)iter-1

> T 编号在本文件内独立(T1~T7)。复用 B01 的基础层(nodes/gate/runner)。

**目标:** 重写 web/(server+engine+前端),画布编辑节点/边,SSE 实时回显,图执行引擎支持任意回退边。
**架构:** 浏览器(Drawflow)→ FastAPI server → engine(图执行)→ 复用基础层调 claude。见 `architecture/B02-web/architecture.md`。
**技术栈:** FastAPI + uvicorn + Drawflow(纯静态)
**验收来源:** `spec/B02-web/*.feature`
**回指锚:** 每 task 标 RXX,代码 `@implements RXX`

## 全局约束
- 前端零构建:纯静态 + vendor,无 npm。
- import 复用 B01 基础层(nodes/gate/claude_runner)。
- graph.json 落 `<task_dir>/.xdd/graph.json`。

## 文件结构
| 文件 | 操作 | 职责 |
|---|---|---|
| `workflow/web/__init__.py` | Create | 包标识 |
| `workflow/web/graph_io.py` | Create | graph.json 读写+默认图(@B02-R01/R06) |
| `workflow/web/engine.py` | Create | 图执行引擎(@B02-R03) |
| `workflow/web/server.py` | Create | FastAPI+SSE(@B02-R04) |
| `workflow/web/static/index.html` | Create | 画布页(依 wire/canvas) |
| `workflow/web/static/app.js` | Create | Drawflow+SSE 消费 |
| `workflow/web/static/style.css` | Create | 样式(依 wire tokens) |
| `workflow/web/static/vendor/drawflow.*` | Copy | Drawflow 库 |
| `workflow/web/tests/test_graph_io.py` | Create | 图模型单测 |
| `workflow/web/tests/test_engine.py` | Create | 图引擎单测 |
| `workflow/web/tests/test_server.py` | Create | API+SSE 单测 |

## 依赖关系
| Task | Depends On | 可并行 |
|---|---|---|
| T1 graph_io | B01-T5(nodes) | — |
| T2 engine | T1 | — |
| T3 server | T2 | — |
| T4 static 前端 | T3 | — |
| T5 集成测试 | T3 T4 | — |

## RXX 覆盖追踪
| RXX | Feature | Task | 状态 |
|---|---|---|---|
| R01 图模型 | graph-model | T1 | - [ ] |
| R02 边类型 | edge-types | T1 | - [ ] |
| R03 图引擎 | graph-engine | T2 | - [ ] |
| R04 SSE | sse-stream | T3 | - [ ] |
| R05 复用 B01 | reuse-b01 | T2 | - [ ] |
| R06 默认图 | default-graph | T1 | - [ ] |

---

### Task 1: graph_io(图模型 + 默认图)
**Depends on:** B01-T5
**回指 RXX:** R01 R02 R06
**Stack:** backend
**Feature:** `graph-model.feature :: 加载默认图得到八节点` + `edge-types.feature :: next 边成环拒绝` + `default-graph.feature :: graph.json 损坏回退`
**Files:**
- Create: `workflow/web/graph_io.py`
- Test: `workflow/web/tests/test_graph_io.py`

- [ ] **Step 1: 写失败测试**
```python
# tests/test_graph_io.py
from workflow.web.graph_io import default_graph, validate_graph, load_graph
def test_default_8_nodes():
    g = default_graph("/tmp/x")
    assert len(g["nodes"]) == 8
    assert any(n["name"]=="verify" and n["gate"] for n in g["nodes"])
def test_default_has_loop_edge():
    g = default_graph("/tmp/x")
    loops = [e for e in g["edges"] if e["type"]=="loop"]
    assert len(loops) == 1 and loops[0]["condition"]=="gate_fail"
def test_next_cycle_rejected():
    g = {"nodes":[{"id":"a","name":"x","skill":"s","output_doc":"o","model":"Y","extra":"","gate":False},
                  {"id":"b","name":"y","skill":"s","output_doc":"o","model":"Y","extra":"","gate":False}],
         "edges":[{"from":"a","to":"b","type":"next"},{"from":"b","to":"a","type":"next"}]}
    assert len(validate_graph(g)) > 0  # 报环
def test_dup_id_rejected():
    g = {"nodes":[{"id":"a","name":"x","skill":"s","output_doc":"o","model":"Y","extra":"","gate":False}]*2, "edges":[]}
    assert len(validate_graph(g)) > 0
```
- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 写实现**(default_graph 从 B01 nodes.build_nodes 派生)
```python
# workflow/web/graph_io.py
"""graph.json 读写+默认图+校验。@implements B02-R01/R02/R06"""
import json
from pathlib import Path
from workflow.nodes import build_nodes  # @B02-R05 复用 B01

def default_graph(task_dir):
    """从 B01 build_nodes 派生默认八节点图。@implements B02-R06"""
    raw = build_nodes(Path(task_dir), bizline="B01", iter_n=1)
    nodes = [{"id":f"n{i}_{n['name']}","name":n["name"],"skill":n["skill"],
              "output_doc":n["output_doc"],"model":n["model"],"extra":"","gate":n["gate"]}
             for i,n in enumerate(raw)]
    edges = [{"from":nodes[i]["id"],"to":nodes[i+1]["id"],"type":"next"} for i in range(len(nodes)-1)]
    vid = [n["id"] for n in nodes if n["name"]=="verify"][0]
    eid = [n["id"] for n in nodes if n["name"]=="execute"][0]
    edges.append({"from":vid,"to":eid,"type":"loop","condition":"gate_fail"})
    return {"task_dir":str(Path(task_dir).resolve()),"nodes":nodes,"edges":edges}

def validate_graph(g):
    """校验:id 唯一/边指向存在/next 无环。@implements B02-R02"""
    errs = []; ids = {n["id"] for n in g.get("nodes",[])}
    seen = set()
    for n in g["nodes"]:
        if n["id"] in seen: errs.append(f"id 重复 {n['id']}")
        seen.add(n["id"])
        if not n.get("skill"): errs.append(f"{n['id']} 缺 skill")
    for e in g.get("edges",[]):
        if e.get("from") not in ids or e.get("to") not in ids: errs.append("边指向不存在")
        if e.get("type") not in ("next","loop"): errs.append("边类型非法")
    # next 环检测(DFS)
    adj = {n["id"]:[] for n in g["nodes"]}
    for e in g["edges"]:
        if e.get("type")=="next": adj[e["from"]].append(e["to"])
    # ... DFS 找环
    return errs

def load_graph(task_dir):
    p = Path(task_dir)/".xdd"/"graph.json"
    if p.exists():
        try: return json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError: pass  # @B02-R06 容错
    return default_graph(task_dir)

def save_graph(task_dir, g):
    p = Path(task_dir)/".xdd"/"graph.json"; p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(g,ensure_ascii=False,indent=2),encoding="utf-8")
    return p
```
- [ ] **Step 4: 跑测试通过**
- [ ] **Step 5: 提交**
`git commit -m "feat(graph_io): 实现 R01/R02/R06 图模型"`

---

### Task 2: engine(图执行引擎)
**Depends on:** T1
**回指 RXX:** R03 R05
**Stack:** backend
**Feature:** `graph-engine.feature :: gate 未过触发回退边重跑` + `reuse-b01.feature :: 引擎复用 gate_check`
**Files:**
- Create: `workflow/web/engine.py`
- Test: `workflow/web/tests/test_engine.py`

- [ ] **Step 1: 写失败测试**(mock 验证拓扑+回退语义)
```python
# tests/test_engine.py
from workflow.web import engine
def test_loop_triggers_reset(monkeypatch):
    # 图 a→b→c(gate),c gate 未过→回退 a
    graph = {"nodes":[{"id":"a","name":"a","skill":"s","output_doc":"o","model":"Y","extra":"","gate":False},
                      {"id":"b","name":"b","skill":"s","output_doc":"o","model":"Y","extra":"","gate":False},
                      {"id":"c","name":"c","skill":"s","output_doc":"o","model":"Y","extra":"","gate":True}],
             "edges":[{"from":"a","to":"b","type":"next"},{"from":"b","to":"c","type":"next"},
                      {"from":"c","to":"a","type":"loop","condition":"gate_fail"}]}
    calls = {}
    def fake_exec(node, graph, td, h):
        nid = node["id"]; calls[nid] = calls.get(nid,0)+1
        yield {"type":"node_start","node":nid}
        passed = calls[nid]>=2  # 第二次才过
        yield {"type":"node_done","node":nid,"passed":passed,"gate":node["gate"]}
    monkeypatch.setattr(engine, "_execute_node", fake_exec)
    h = engine.RunHandle("t", graph, "/tmp/x", True)
    engine.run_graph(graph, "/tmp/x", True, h)
    assert calls["a"]==2 and calls["b"]==2 and calls["c"]==2  # 回退后全重跑
    loops = [e for e in h.events if e["type"]=="loop_trigger"]
    assert len(loops)==1
```
- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 写实现**(照搬旧版 engine.py 内核,import 基础层)
```python
# workflow/web/engine.py
"""图执行引擎:拓扑前进+回退边循环。@implements B02-R03
复用 B01 gate(gate_check)。@implements B02-R05"""
import threading
from workflow.gate import gate_check  # @B02-R05
from workflow.claude_runner import run_agent_stream

class RunHandle: ...  # 事件队列+stop_event+finished

def run_graph(graph, task_dir, force, handle):
    """主循环:找 runnable( next 上游全 done)→ 跑 → 检查 loop 边 → 重置。@B02-R03"""
    # ... 拓扑前进 + loop 条件满足重置目标及 next 下游 + 步数上限 200
    ...

def start_run(graph, task_dir, force):
    """起后台线程跑 run_graph。"""
    ...
```
- [ ] **Step 4: 跑测试通过**
- [ ] **Step 5: 提交**
`git commit -m "feat(engine): 实现 R03/R05 图执行引擎"`

---

### Task 3: server(FastAPI + SSE)
**Depends on:** T2
**回指 RXX:** R04
**Stack:** backend
**Feature:** `sse-stream.feature :: SSE 推送节点开始事件`
**Files:**
- Create: `workflow/web/server.py`
- Test: `workflow/web/tests/test_server.py`

- [ ] **Step 1: 写测试**(用 TestClient 验 API + SSE)
```python
# tests/test_server.py
from fastapi.testclient import TestClient
from workflow.web.server import app
def test_models():
    c = TestClient(app); r = c.get("/api/models")
    assert r.status_code==200 and "models" in r.json()
def test_graph_default(tmp_path):
    c = TestClient(app); r = c.get(f"/api/graph?task_dir={tmp_path}")
    assert len(r.json()["nodes"])==8
```
- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 写实现**
```python
# workflow/web/server.py
"""FastAPI + SSE。@implements B02-R04"""
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from . import engine
from .graph_io import load_graph, save_graph, validate_graph, default_graph

app = FastAPI()
app.mount("/static", StaticFiles(directory=str(Path(__file__).parent/"static")))

@app.get("/api/models")
def api_models():
    from workflow.models import available_models, DEFAULT_MODEL
    return {"models": available_models(), "default": DEFAULT_MODEL}

@app.get("/api/graph")
def api_graph(task_dir: str):
    return load_graph(task_dir)

@app.post("/api/run")
def api_run(task_dir: str, force: bool=False):
    graph = load_graph(task_dir)
    h = engine.start_run(graph, task_dir, force)
    return {"run_id": h.run_id}

@app.get("/api/run/{rid}/stream")
async def stream(rid: str):
    h = engine.get_run(rid)
    async def gen():
        idx=0
        while True:
            new = h.events[idx:]; idx=len(h.events)
            for ev in new:
                yield f"event: {ev['type']}\ndata: {__import__('json').dumps(ev,ensure_ascii=False)}\n\n"
            if h.finished and idx>=len(h.events): return
            await __import__('asyncio').sleep(0.15)
    return StreamingResponse(gen(), media_type="text/event-stream")
```
- [ ] **Step 4: 跑测试通过**
- [ ] **Step 5: 提交**
`git commit -m "feat(server): 实现 R04 FastAPI+SSE"`

---

### Task 4: 静态前端(Drawflow 画布)
**Depends on:** T3
**回指 RXX:** R01 R02 R04(前端消费)
**Stack:** frontend
**Feature:** 依 `wire/canvas/index.html`(6 态)
**Files:**
- Create: `workflow/web/static/index.html` `app.js` `style.css`
- Copy: `vendor/drawflow.min.{css,js}`

- [ ] **Step 1:** 按 `wire/canvas/` 设计稿实现 index.html(主页面)+ style.css(token)
- [ ] **Step 2:** app.js:Drawflow 初始化 + 拖拽添加 + 双击编辑 + Shift 拖=loop + SSE EventSource 消费更新徽章
- [ ] **Step 3:** 起 server 手工验证:加载默认图→拖拽→保存→开始看 SSE
- [ ] **Step 4:** 浏览器 console 无错;6 操作态对照 wire
- [ ] **Step 5: 提交**
`git commit -m "feat(frontend): 实现画布编排前端"`

---

### Task 5: 集成测试(端到端)
**Depends on:** T3 T4
**回指 RXX:** R03 R04
**Stack:** backend
**Files:**
- Test: `workflow/web/tests/test_server.py`(补 SSE 端到端)

- [ ] **Step 1:** 写测试:起 run → 订阅 SSE → 断言收到 node_start/node_log/node_done/workflow_done 事件序列
- [ ] **Step 2~5:** 跑 → 修 → 过 → 提交
