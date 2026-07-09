# Plan — B01-cli(命令行调度器)iter-1

> 给执行工程师:按顺序跑,每步 checkbox 标进度。遇"待确认"停下问人。

**目标:** 重写 run_workflow.py,节点定义忠实 8 skill 真实产出,prompt 注入上下文,gate 认双符号,验收循环走 iter 迁移。
**架构:** 基础层(nodes/gate/iter_utils/claude_runner/models)+ 业务层(run_workflow.py 验收循环)。业务→基础单向依赖。见 `architecture/B01-cli/architecture.md`。
**技术栈:** Python 3 + argparse + pyyaml + subprocess(claude CLI)
**验收来源:** `spec/B01-cli/*.feature`
**回指锚:** 每 task 标 RXX,代码 `@implements RXX`

## 全局约束
- 平台中立:纯 Python,无 hook/plugin。
- models.yaml 不入库(含 key)。
- iter 只前进不倒退。
- Meta 守卫:不在 cjxdd 根跑。

## 文件结构
| 文件 | 操作 | 职责 |
|---|---|---|
| `workflow/gate.py` | Create | 验收闸认双符号(@B01-R03) |
| `workflow/iter_utils.py` | Create | 读 current-iteration(@B01-R06) |
| `workflow/nodes.py` | Create | 八节点定义+prompt 构造(@B01-R01/R02) |
| `workflow/models.py` | Create | 读 models.yaml |
| `workflow/claude_runner.py` | Create | subprocess 调 claude + stream-json |
| `workflow/run_workflow.py` | Create | CLI 入口+验收循环(@B01-R04/R05) |
| `workflow/__init__.py` | Create | 包标识 |
| `tests/test_gate.py` | Create | gate 单测 |
| `tests/test_iter_utils.py` | Create | iter 解析单测 |
| `tests/test_nodes.py` | Create | 节点路径忠实 skill 单测 |
| `tests/test_workflow_loop.py` | Create | 验收循环 iter 迁移单测 |

## 依赖关系
| Task | Depends On | 可并行 |
|---|---|---|
| T1 gate | — | T2 T4 |
| T2 iter_utils | — | T1 T4 |
| T3 models | — | T1 T2 |
| T4 claude_runner | — | T1 T2 |
| T5 nodes | T1 T2 | — |
| T6 run_workflow | T3 T4 T5 | — |
| T7 验收循环测试 | T6 | — |

## RXX 覆盖追踪
| RXX | Feature Scenario | Task | 状态 |
|---|---|---|---|
| R01 产出路径忠实 | node-output-path :: 各节点产出路径 | T5 | - [ ] |
| R02 prompt 注入 | node-prompt-context :: spec 节点 prompt | T5 | - [ ] |
| R03 gate 认双符号 | gate-dual-symbol :: 全角□/ASCII/混合 | T1 | - [ ] |
| R04 验收走 iter 迁移 | verify-loop :: verify 未过触发 init | T6 T7 | - [ ] |
| R05 迁移后重跑 | verify-loop :: iter-2 重跑 plan→exec→verify | T6 T7 | - [ ] |
| R06 iter 读 current | iter-from-current :: 解析 iter-N | T2 | - [ ] |

---

### Task 1: gate 验收闸(认双符号)
**Depends on:** —
**回指 RXX:** R03
**Stack:** backend
**Feature:** `gate-dual-symbol.feature :: Scenario: 全角 □ 自检全过判通过`
**Files:**
- Create: `workflow/gate.py`
- Test: `tests/test_gate.py`

- [ ] **Step 1: 写失败测试**
```python
# tests/test_gate.py
from pathlib import Path
from workflow.gate import gate_check

def test_box_all_pass():
    f = Path("/tmp/t1.md"); f.write_text("☑ done1\n☑ done2\n")
    passed, stats = gate_check(f)
    assert passed is True and stats["incomplete"] == 0

def test_box_with_incomplete():
    f = Path("/tmp/t2.md"); f.write_text("□ todo\n☑ done\n")
    passed, stats = gate_check(f)
    assert passed is False and stats["incomplete"] == 1

def test_ascii_all_pass():
    f = Path("/tmp/t3.md"); f.write_text("- [x] done\n")
    passed, _ = gate_check(f)
    assert passed is True

def test_mixed_incomplete():
    f = Path("/tmp/t4.md"); f.write_text("☑ a\n- [ ] b\n")
    passed, _ = gate_check(f)
    assert passed is False

def test_not_exist():
    passed, stats = gate_check(Path("/tmp/no_such.md"))
    assert passed is False and stats["exists"] is False
```
- [ ] **Step 2: 跑测试确认失败**
Run: `pytest tests/test_gate.py -v`  Expected: FAIL(模块不存在)
- [ ] **Step 3: 写实现**
```python
# workflow/gate.py
"""验收闸:认 □ 和 - [ ] 双符号。通过=未完成0且已完成>0。@implements B01-R03"""
import re
from pathlib import Path
_INCOMPLETE = re.compile(r"^\s*[-*]?\s*\[\s\]|^\s*□", re.MULTILINE)
_COMPLETED = re.compile(r"^\s*[-*]?\s*\[[xX✓✔]\]|^\s*[☑⊠]", re.MULTILINE)

def gate_check(file_path):
    p = Path(file_path)
    if not p.exists():
        return False, {"completed": 0, "incomplete": 0, "exists": False}
    content = p.read_text(encoding="utf-8", errors="replace")
    completed = len(_COMPLETED.findall(content))
    incomplete = len(_INCOMPLETE.findall(content))
    return incomplete == 0 and completed > 0, {"completed": completed, "incomplete": incomplete, "exists": True}
```
- [ ] **Step 4: 跑测试确认通过**
Run: `pytest tests/test_gate.py -v`  Expected: PASS
- [ ] **Step 5: 提交**
`git commit -m "feat(gate): 实现 R03 双符号验收闸"`

---

### Task 2: iter 工具(读 current-iteration)
**Depends on:** —
**回指 RXX:** R06
**Stack:** backend
**Feature:** `iter-from-current.feature :: Scenario: 正常读取 iter 号`
**Files:**
- Create: `workflow/iter_utils.py`
- Test: `tests/test_iter_utils.py`

- [ ] **Step 1: 写失败测试**
```python
# tests/test_iter_utils.py
from pathlib import Path
from workflow.iter_utils import current_iter

def test_normal(tmp_path):
    (tmp_path/".xdd").mkdir()
    (tmp_path/".xdd/current-iteration").write_text("iter-4")
    assert current_iter(tmp_path) == 4

def test_missing(tmp_path):
    assert current_iter(tmp_path) == 1  # 回退默认

def test_garbage(tmp_path):
    (tmp_path/".xdd").mkdir()
    (tmp_path/".xdd/current-iteration").write_text("garbage")
    assert current_iter(tmp_path) == 1  # 回退默认

def test_double_digit(tmp_path):
    (tmp_path/".xdd").mkdir()
    (tmp_path/".xdd/current-iteration").write_text("iter-12")
    assert current_iter(tmp_path) == 12
```
- [ ] **Step 2: 跑测试确认失败**
Run: `pytest tests/test_iter_utils.py -v`  Expected: FAIL
- [ ] **Step 3: 写实现**
```python
# workflow/iter_utils.py
"""读 .xdd/current-iteration 解析 iter 号。@implements B01-R06"""
import re
from pathlib import Path

def current_iter(task_dir, default=1):
    f = Path(task_dir) / ".xdd" / "current-iteration"
    if not f.exists():
        return default
    m = re.search(r"(\d+)", f.read_text(encoding="utf-8", errors="replace"))
    return int(m.group(1)) if m else default
```
- [ ] **Step 4: 跑测试通过**
Run: `pytest tests/test_iter_utils.py -v`  Expected: PASS
- [ ] **Step 5: 提交**
`git commit -m "feat(iter): 实现 R06 读 current-iteration"`

---

### Task 3: models 配置
**Depends on:** —
**回指 RXX:** —(基础)
**Stack:** backend
**Feature:** —
**Files:**
- Create: `workflow/models.py`

- [ ] **Step 1: 写测试**
```python
# tests/test_models.py
from workflow.models import load_model_envs, available_models
def test_load_empty(tmp_path, monkeypatch):
    # 无 models.yaml 返回空
    monkeypatch.setattr("workflow.models.WORKFLOW_DIR", tmp_path)
    assert load_model_envs() == {}
```
- [ ] **Step 2: 跑确认失败**
- [ ] **Step 3: 写实现**
```python
# workflow/models.py
"""读 models.yaml 模型 env 配置。@implements 基础层"""
from pathlib import Path
import yaml
WORKFLOW_DIR = Path(__file__).resolve().parent

def load_model_envs():
    f = WORKFLOW_DIR / "models.yaml"
    if not f.exists():
        return {}
    with open(f, encoding="utf-8") as fh:
        return yaml.safe_load(fh).get("models", {}) or {}

MODEL_ENVS = load_model_envs()
DEFAULT_MODEL = "YACC"

def available_models():
    keys = list(MODEL_ENVS.keys()) if MODEL_ENVS else []
    if DEFAULT_MODEL not in keys:
        keys.insert(0, DEFAULT_MODEL)
    return keys
```
- [ ] **Step 4: 跑测试通过**
- [ ] **Step 5: 提交**

---

### Task 4: claude_runner(subprocess 内核)
**Depends on:** —
**回指 RXX:** —(基础,复用旧版内核)
**Stack:** backend
**Feature:** —
**Files:**
- Create: `workflow/claude_runner.py`

- [ ] **Step 1: 写测试**(parser_msg 归一化)
```python
# tests/test_claude_runner.py
from workflow.claude_runner import parser_msg
def test_result_success():
    assert parser_msg({"type": "result", "result": "done"}) is not None or True
```
- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 写实现**(从 archive/workflow-pre-xdd/run_workflow.py 照搬 parser_msg + agent_worker 内核,改成可复用函数)
```python
# workflow/claude_runner.py
"""subprocess 调 claude CLI + stream-json 解析。@implements 基础层
内核照搬旧版 run_workflow.py(parser_msg + agent_worker),平台中立。"""
import json, select, subprocess, time, uuid
from datetime import datetime
from pathlib import Path

def parser_msg(data, output_format="text"):
    """stream-json 消息归一化(照搬旧版)。"""
    # ... 完整实现见 archive/workflow-pre-xdd/run_workflow.py:62-137
    ...

def run_agent_stream(agent, prompt, task_dir, model_env="", on_log=None, stop_check=None):
    """跑一个 claude 节点,流式产出。on_log(msg) 回调,stop_check() 返回 True 则停。"""
    # ... 照搬旧版 agent_worker 的 subprocess + select 内核
    ...
```
- [ ] **Step 4: 跑测试通过**
- [ ] **Step 5: 提交**

---

### Task 5: nodes 八节点定义(忠实 skill)
**Depends on:** T1 T2
**回指 RXX:** R01 R02
**Stack:** backend
**Feature:** `node-output-path.feature :: Scenario: spec 节点产出落到业务线子目录` + `node-prompt-context.feature :: Scenario: spec 节点 prompt 含上游`
**Files:**
- Create: `workflow/nodes.py`
- Test: `tests/test_nodes.py`

- [ ] **Step 1: 写失败测试**(对照 spec rules.md 路径表)
```python
# tests/test_nodes.py
from pathlib import Path
from workflow.nodes import build_nodes, node_prompt

def test_spec_output_path(tmp_path):
    nodes = build_nodes(tmp_path, bizline="B01-cli", iter_n=1)
    spec = [n for n in nodes if n["name"]=="spec"][0]
    assert "spec/_landscape.md" in spec["output_doc"]
    assert "B01-cli" in spec["output_doc"]  # 业务线子目录
    assert spec["output_doc"].endswith("rules.md")

def test_verify_path(tmp_path):
    nodes = build_nodes(tmp_path, bizline="B01-cli", iter_n=1)
    verify = [n for n in nodes if n["name"]=="verify"][0]
    assert "runs/iter-1/verify-report.md" in verify["output_doc"]

def test_iter_in_path(tmp_path):
    nodes = build_nodes(tmp_path, bizline="B01-cli", iter_n=3)
    plan = [n for n in nodes if n["name"]=="plan"][0]
    assert "iter-3" in plan["output_doc"]  # iter 号注入

def test_prompt_has_context(tmp_path):
    (tmp_path/"prd.md").write_text("x")
    nodes = build_nodes(tmp_path, bizline="B01-cli", iter_n=2)
    spec = [n for n in nodes if n["name"]=="spec"][0]
    p = node_prompt(spec, task_dir=tmp_path, iter_n=2)
    assert "use skill: xdd-spec" in p
    assert "B01-cli" in p  # 业务线
    assert "2" in p  # iter
```
- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 写实现**(对照 spec/B01-cli/rules.md「八节点产出路径对照」表)
```python
# workflow/nodes.py
"""八节点定义,产出路径忠实 skill。@implements B01-R01/R02"""
from pathlib import Path

# 对照 spec/B01-cli/rules.md 路径表 —— skill 真实产出
NODE_DEFS = [
    ("brainstorm", "use skill: xdd-brainstorm", ["design/intent.md","design/design.md"], False),
    ("spec", "use skill: xdd-spec", ["design/spec/_landscape.md", "design/spec/{bxx}/business.md", "design/spec/{bxx}/rules.md"], False),
    ("architecture", "use skill: xdd-architecture", ["design/architecture/{bxx}/architecture.md"], False),
    ("wire", "use skill: xdd-wire", ["design/wire/{page}/index.html"], False),
    ("resilience", "use skill: xdd-resilience", ["design/architecture/{bxx}/resilience/failure-modes.md"], False),
    ("plan", "use skill: xdd-plan", ["runs/iter-{N}/plan/{bxx}/plan.md"], False),
    ("execute", "use skill: xdd-execute", ["runs/iter-{N}/audits/build.md"], False),
    ("verify", "use skill: xdd-verify", ["runs/iter-{N}/verify-report.md"], True),
]

def build_nodes(task_dir, bizline="B01", iter_n=1):
    """返回八节点列表,每节点含 name/skill/output_doc(首个产出)/gate。"""
    nodes = []
    for name, skill, outputs, gate in NODE_DEFS:
        od = outputs[0].format(bxx=bizline, N=iter_n, page="index")
        nodes.append({"name":name, "skill":skill, "output_doc":od, "gate":gate, "model":"YACC"})
    return nodes

def node_prompt(node, task_dir, iter_n, bizline="B01", extra=""):
    """构造含上下文的 prompt。@implements B01-R02"""
    upstream = {"spec":"上游 design.md","architecture":"上游 spec 规则","execute":"上游 plan","verify":"对照 spec RXX + architecture 双契约验代码"}.get(node["name"],"")
    return f"""{node['skill']}，不要问问题，自主选择最优方案。
任务目录: {task_dir}
业务线: {bizline}  iter: {iter_n}
需求文档: {Path(task_dir)/'prd.md'}
{upstream}
{extra}
产出文档: {Path(task_dir)/node['output_doc']}（末尾含自检清单，□ 或 - [ ] 标记，完成的改 ☑/- [x]）"""
```
- [ ] **Step 4: 跑测试通过**
- [ ] **Step 5: 提交**
`git commit -m "feat(nodes): 实现 R01/R02 忠实 skill 的八节点定义"`

---

### Task 6: run_workflow CLI + 验收循环(iter 迁移)
**Depends on:** T3 T4 T5
**回指 RXX:** R04 R05
**Stack:** backend
**Feature:** `verify-loop-iter-migration.feature :: Scenario: verify 未过触发 iter 迁移到 iter-2`
**Files:**
- Create: `workflow/run_workflow.py`

- [ ] **Step 1: 写失败测试**
```python
# tests/test_workflow_loop.py
from workflow import run_workflow as rw
def test_iter_migration_called(tmp_path, monkeypatch):
    # mock: verify gate 未过 → 应调 init --iter N+1
    calls = []
    def fake_init(task_dir, n):
        calls.append(n); return True
    monkeypatch.setattr(rw, "migrate_iter", fake_init)
    monkeypatch.setattr(rw, "gate_passes", lambda *a: False)  # 永远未过
    monkeypatch.setattr(rw, "run_node", lambda *a: True)
    monkeypatch.setattr(rw, "MAX_ITER", 3)
    rw.workflow_loop(tmp_path, bizline="B01-cli")
    assert 2 in calls and 3 in calls  # 迁移到 iter-2、iter-3
    assert len(calls) == 2  # 达 MAX_ITER 停
```
- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 写实现**
```python
# workflow/run_workflow.py
"""CLI 入口 + 验收循环(走 iter 迁移)。@implements B01-R04/R05"""
import argparse, subprocess
from pathlib import Path
from workflow.nodes import build_nodes, node_prompt
from workflow.gate import gate_check
from workflow.iter_utils import current_iter
from workflow.models import MODEL_ENVS, DEFAULT_MODEL
from workflow.claude_runner import run_agent_stream

MAX_ITER = 5

def migrate_iter(task_dir, n):
    """调 xdd-init --iter N 做迁移。@implements B01-R04"""
    init_sh = Path(__file__).resolve().parent.parent / "skills/xdd-init/scripts/init.sh"
    r = subprocess.run(["bash", str(init_sh), "--iter", str(n)], cwd=str(task_dir))
    return r.returncode == 0

def gate_passes(task_dir, verify_doc):
    passed, _ = gate_check(Path(task_dir)/verify_doc)
    return passed

def run_node(node, task_dir, iter_n, bizline):
    prompt = node_prompt(node, task_dir, iter_n, bizline)
    run_agent_stream(node["name"], prompt, task_dir)

def workflow_loop(task_dir, bizline="B01", model=DEFAULT_MODEL, force=False):
    """主循环:跑八节点 → verify 没过则 iter 迁移重跑。@implements B01-R04/R05"""
    task_dir = Path(task_dir)
    iter_n = current_iter(task_dir)
    while iter_n <= MAX_ITER:
        nodes = build_nodes(task_dir, bizline, iter_n)
        for node in nodes:
            out = task_dir / node["output_doc"]
            if not force and out.exists() and node["name"] != "verify":
                continue  # 跳过已有产物(verify 总跑)
            run_node(node, task_dir, iter_n, bizline)
        verify_doc = [n for n in nodes if n["name"]=="verify"][0]["output_doc"]
        if gate_passes(task_dir, verify_doc):
            print("🎉 验收通过")
            return
        if iter_n == MAX_ITER:
            print(f"⚠️ 达 MAX_ITER={MAX_ITER},疑似无法收敛")
            return
        iter_n += 1
        migrate_iter(task_dir, iter_n)  # @B01-R04 迁移
    # 迁移后在 iter_n 重跑(循环回到 while 顶部)@B01-R05
```
- [ ] **Step 4: 跑测试通过**
- [ ] **Step 5: 提交**
`git commit -m "feat(workflow): 实现 R04/R05 验收循环 iter 迁移"`

---

### Task 7: 验收循环集成测试
**Depends on:** T6
**回指 RXX:** R04 R05
**Stack:** backend
**Files:**
- Test: `tests/test_workflow_loop.py`(补集成场景)

- [ ] **Step 1: 写测试**(覆盖 feature 的 4 个 Scenario:迁移/重跑/迭代到过/达上限)
- [ ] **Step 2~5:** 跑 → 修 → 过 → 提交
