"""图执行引擎:把"节点 + 边"跑成执行流,产出事件队列供 SSE 推。

执行语义:
- next 边:拓扑序前进。节点的所有 next 上游都 done 才跑它。
- loop 边(回退):节点 done 后检查;condition 满足(gate_fail=该节点 gate 没过)
  则把目标及沿 next 边的下游重置 pending 重跑(循环)。
- 防死循环:总步数上限 200。

复用 B01 gate(gate_check)+ claude_runner(run_agent_stream)。
@implements B02-R03 图执行引擎
@implements B02-R05 复用 B01 gate
"""
from __future__ import annotations

import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Iterator

from ..claude_runner import run_agent_stream
from ..gate import gate_check  # @implements B02-R05
from ..nodes import node_prompt

MAX_STEPS = 200  # 防回退边死循环 @covers B02-R03 resilience F04


class RunHandle:
    """一次执行的句柄。后台线程跑,主线程通过 SSE 读 events。"""

    def __init__(self, run_id: str, graph: dict, task_dir: str, force: bool):
        self.run_id = run_id
        self.graph = graph
        self.task_dir = task_dir
        self.force = force
        self.events: list[dict] = []     # 事件历史(单调追加,SSE 补播用)
        self.stop_event = threading.Event()
        self.thread: threading.Thread | None = None
        self.finished = False
        self.error: str | None = None

    def emit(self, event: dict) -> None:
        event.setdefault("ts", datetime.now().isoformat(timespec="seconds"))
        self.events.append(event)

    def stop(self) -> None:
        self.stop_event.set()

    def is_alive(self) -> bool:
        return self.thread is not None and self.thread.is_alive()


_RUNS: dict[str, RunHandle] = {}


def get_run(run_id: str) -> RunHandle | None:
    return _RUNS.get(run_id)


# 节点执行函数(可注入测试)。默认实现调 claude + gate。
def _execute_node_default(node: dict, graph: dict, task_dir: Path,
                          handle: RunHandle) -> Iterator[dict]:
    """跑单个节点:prompt → claude 流式 → gate 判定。产出事件。"""
    node_id = node["id"]
    yield {"type": "node_start", "node": node_id}

    output_doc = Path(node["output_doc"])
    if not output_doc.is_absolute():
        output_doc = task_dir / output_doc
    output_doc.parent.mkdir(parents=True, exist_ok=True)

    # 用 node_prompt 构造(B01-R02),但 Web 节点是 graph 自定义的,封装成 node_prompt 期望的结构
    prompt_node = {"name": node["name"], "skill": node["skill"], "output_doc": str(output_doc)}
    prd = task_dir / "prd.md"
    iter_n = 1  # Web 端简化:不直接管 iter,用 current-iteration 时由 claude 自己读
    prompt = node_prompt(prompt_node, task_dir, iter_n=iter_n, bizline=node.get("bizline", "B01"),
                         extra=node.get("extra", ""))

    success = True
    for ev in run_agent_stream(node["name"], prompt, task_dir,
                               model=node.get("model", ""), stop_check=handle.stop_event.is_set):
        if ev["type"] == "log":
            yield {"type": "node_log", "node": node_id, "text": ev["text"]}
        elif ev["type"] == "timeout":
            success = False
            yield {"type": "node_log", "node": node_id, "text": f"[error] 超时({ev['timeout']}s)"}
        elif ev["type"] == "stopped":
            yield {"type": "node_done", "node": node_id, "success": False, "passed": False,
                   "gate": node.get("gate", False), "stopped": True}
            return
        elif ev["type"] == "success":
            success = ev.get("success", True)

    if handle.stop_event.is_set():
        yield {"type": "node_done", "node": node_id, "success": False, "passed": False,
               "gate": node.get("gate", False), "stopped": True}
        return

    # gate 判定
    is_gate = node.get("gate", False)
    passed = True
    gate_stats = None
    if is_gate:
        passed, gate_stats = gate_check(output_doc)
        yield {"type": "node_log", "node": node_id,
               "text": f"[gate] {'PASS' if passed else 'FAIL'} {gate_stats}"}

    yield {"type": "node_done", "node": node_id, "success": success,
           "passed": passed, "gate": is_gate, "gate_stats": gate_stats}


def _build_next_deps(graph: dict) -> dict[str, list[str]]:
    """每个节点的 next 上游列表。"""
    deps: dict[str, list[str]] = {n["id"]: [] for n in graph["nodes"]}
    for e in graph["edges"]:
        if e.get("type") == "next":
            deps.setdefault(e["to"], []).append(e["from"])
    return deps


def _loop_edges(graph: dict) -> dict[str, list[dict]]:
    loops: dict[str, list[dict]] = {n["id"]: [] for n in graph["nodes"]}
    for e in graph["edges"]:
        if e.get("type") == "loop":
            loops.setdefault(e["from"], []).append(e)
    return loops


def _downstream_via_next(graph: dict, start: str) -> set[str]:
    """从 start 沿 next 边可达的下游(回退时一起重置 pending)。"""
    adj: dict[str, list[str]] = {n["id"]: [] for n in graph["nodes"]}
    for e in graph["edges"]:
        if e.get("type") == "next":
            adj.setdefault(e["from"], []).append(e["to"])
    seen: set[str] = set()
    stack = list(adj.get(start, []))
    while stack:
        cur = stack.pop()
        if cur in seen:
            continue
        seen.add(cur)
        stack.extend(adj.get(cur, []))
    return seen


def run_graph(graph: dict, task_dir, force: bool, handle: RunHandle,
              execute_node_fn: Callable = _execute_node_default) -> None:
    """主执行循环(后台线程跑)。事件全部 emit 到 handle。

    @implements B02-R03 拓扑前进 + 回退边循环
    """
    task_dir = Path(task_dir)
    nodes_by_id = {n["id"]: n for n in graph["nodes"]}
    deps = _build_next_deps(graph)
    loops = _loop_edges(graph)
    status: dict[str, str] = {nid: "pending" for nid in nodes_by_id}  # pending/done
    passed_map: dict[str, bool] = {}

    def already_has_output(node: dict) -> bool:
        od = Path(node["output_doc"])
        if not od.is_absolute():
            od = task_dir / od
        return od.exists()

    steps = 0
    while steps < MAX_STEPS:
        if handle.stop_event.is_set():
            handle.emit({"type": "workflow_done", "stopped": True})
            handle.finished = True
            return

        # 找 runnable:pending 且 next 上游全 done
        runnable = None
        for nid, st in status.items():
            if st != "pending":
                continue
            if all(status.get(u) == "done" for u in deps.get(nid, [])):
                runnable = nid
                break

        if runnable is None:
            if all(s == "done" for s in status.values()):
                handle.emit({"type": "workflow_done", "stopped": False})
            else:
                blocked = [nid for nid, st in status.items() if st == "pending"]
                handle.emit({"type": "workflow_done", "stopped": False,
                             "blocked": blocked, "reason": "上游节点失败,下游受阻"})
            handle.finished = True
            return

        node = nodes_by_id[runnable]
        steps += 1

        # force=False 且产物已存在 → 跳过(仍判 gate)
        if not force and already_has_output(node):
            od = Path(node["output_doc"])
            if not od.is_absolute():
                od = task_dir / od
            if node.get("gate", False):
                p, stats = gate_check(od)
                passed_map[runnable] = p
                handle.emit({"type": "node_done", "node": runnable, "success": True,
                             "passed": p, "gate": True, "gate_stats": stats, "skipped": True})
            else:
                passed_map[runnable] = True
                handle.emit({"type": "node_done", "node": runnable, "success": True,
                             "passed": True, "gate": False, "skipped": True})
        else:
            for ev in execute_node_fn(node, graph, task_dir, handle):
                handle.emit(ev)
            if handle.stop_event.is_set():
                handle.emit({"type": "workflow_done", "stopped": True})
                handle.finished = True
                return
            # 从最后的 node_done 取 passed
            passed = True
            for ev in reversed(handle.events):
                if ev.get("type") == "node_done" and ev.get("node") == runnable:
                    passed = ev.get("passed", True)
                    break
            passed_map[runnable] = passed

        status[runnable] = "done"

        # 检查回退边
        for le in loops.get(runnable, []):
            cond = le.get("condition", "gate_fail")
            target = le["to"]
            fire = (cond == "gate_fail" and not passed_map.get(runnable, True)) or cond == "always"
            if fire:
                handle.emit({"type": "loop_trigger", "from": runnable, "to": target, "condition": cond})
                reset = {target} | _downstream_via_next(graph, target)
                for rid in reset:
                    if rid in status:
                        status[rid] = "pending"
                        passed_map.pop(rid, None)
                        handle.emit({"type": "node_reset", "node": rid})
                break

    handle.emit({"type": "workflow_done", "stopped": False,
                 "reason": f"达到最大步数 {MAX_STEPS},疑似回退边死循环"})
    handle.finished = True


def start_run(graph: dict, task_dir, force: bool = False,
              execute_node_fn: Callable = _execute_node_default) -> RunHandle:
    """启动一次执行。返回 RunHandle。"""
    run_id = uuid.uuid4().hex[:12]
    handle = RunHandle(run_id, graph, str(task_dir), force)

    def _worker():
        try:
            run_graph(graph, task_dir, force, handle, execute_node_fn)
        except Exception as e:
            handle.error = str(e)
            handle.emit({"type": "workflow_done", "stopped": False, "error": str(e)})
            handle.finished = True

    handle.thread = threading.Thread(target=_worker, daemon=True, name=f"run-{run_id}")
    _RUNS[run_id] = handle
    handle.thread.start()
    return handle
