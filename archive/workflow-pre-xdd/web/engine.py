"""图执行引擎:把"节点 + 边"跑成执行流,产出 SSE 事件流。

复用 workflow.run_workflow 的:
- parser_msg(stream-json 归一化)
- test_gateway / gate.gate_check(验收判定)
- load_model_envs / MODEL_ENVS(模型 env)
- node_prompt(prompt 拼装)
- WORKFLOW_DIR(SYSTEM.md 路径)

不碰原文件。agent_worker 的 subprocess + stream-json 内核复制成本文件的
生成器版本:_run_agent_stream(),核心逻辑照搬,把 log() 换成 yield。

执行语义:
- next 边:拓扑序前进。一个节点的所有 next 上游都 done 才跑它。
- loop 边(回退):节点 done 后检查;若 condition 满足(gate_fail = 该节点
  gate 没过),把目标节点及其下游(next 边可达的)重置为 pending 重跑。
- force=True:忽略已有产出,全部重跑。
- 停止:stop_event 被 set → kill 当前 subprocess → 结束。
"""
from __future__ import annotations

import json
import select
import subprocess
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator

from ..run_workflow import (
    DEFAULT_MODEL,
    MODEL_ENVS,
    WORKFLOW_DIR,
    load_model_envs,
    node_prompt,
    parser_msg,
)

from .gate import gate_check


# ==================== 模型 env(支持热刷) ====================
_models_lock = threading.Lock()
# MODEL_ENVS 在 import 时缓存;这里维护一份可热刷的副本


def available_models() -> list[str]:
    """当前可用模型名(models.yaml 的 keys + DEFAULT)。"""
    with _models_lock:
        keys = list(MODEL_ENVS.keys()) if MODEL_ENVS else []
    if DEFAULT_MODEL not in keys:
        keys.insert(0, DEFAULT_MODEL)
    return keys


def reload_models() -> list[str]:
    """重新读 models.yaml(改了 key 后调)。"""
    global MODEL_ENVS
    with _models_lock:
        MODEL_ENVS.clear()
        MODEL_ENVS.update(load_model_envs())
    return available_models()


# ==================== 运行管理 ====================
class RunHandle:
    """一次执行的句柄。后台线程跑,主线程通过 SSE 读事件队列。"""

    def __init__(self, run_id: str, graph: dict, task_dir: str, force: bool):
        self.run_id = run_id
        self.graph = graph
        self.task_dir = task_dir
        self.force = force
        self.events: list[dict] = []          # 事件历史(SSE 断线重连/晚到的客户端补播)
        self.queue: list[dict] = []           # 待消费事件(SSE 实时拉)
        self.cond = threading.Condition()
        self.thread: threading.Thread | None = None
        self.stop_event = threading.Event()
        self.finished = False
        self.error: str | None = None

    def emit(self, event: dict) -> None:
        event.setdefault("ts", datetime.now().isoformat(timespec="seconds"))
        with self.cond:
            self.events.append(event)
            self.queue.append(event)
            self.cond.notify_all()

    def stop(self) -> None:
        self.stop_event.set()

    def is_alive(self) -> bool:
        return self.thread is not None and self.thread.is_alive()


_RUNS: dict[str, RunHandle] = {}
_RUNS_LOCK = threading.Lock()


def get_run(run_id: str) -> RunHandle | None:
    return _RUNS.get(run_id)


# ==================== 单节点执行(生成器版 agent_worker) ====================
def _run_agent_stream(
    node: dict,
    prompt: str,
    task_dir: Path,
    handle: RunHandle,
) -> Iterator[dict]:
    """跑一个节点,产出事件流。

    核心 subprocess + stream-json 解析逻辑照搬 run_workflow.agent_worker,
    但:(1) 把 log() 换成 emit 事件;(2) 支持 stop_event 中断;(3) 返回 bool。
    """
    agent = node["name"]
    model = node.get("model") or DEFAULT_MODEL

    claude_env = MODEL_ENVS.get(model, {}).get("env", "")
    if not claude_env:
        yield {"type": "node_log", "node": node["id"], "text": f"[warn] 模型 '{model}' 无 env 配置,用默认"}

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    debug_dir = task_dir / "log" / "claude"
    debug_dir.mkdir(parents=True, exist_ok=True)
    debug_file = debug_dir / f"{timestamp}_{agent}_{uuid.uuid4().hex[:8]}.log"

    add_system_prompt_file = WORKFLOW_DIR / "SYSTEM.md"
    tmp_system_prompt_file = (
        task_dir / "log" / "prompt" / f"system_{timestamp}_{uuid.uuid4().hex[:8]}.md"
    )
    tmp_system_prompt_file.parent.mkdir(parents=True, exist_ok=True)
    with open(tmp_system_prompt_file, "w", encoding="utf-8") as f:
        if add_system_prompt_file.exists():
            f.write(add_system_prompt_file.read_text(encoding="utf-8"))

    tt = f"/tmp/prompt_{uuid.uuid4().hex[:8]}.md"
    with open(tt, "w", encoding="utf-8") as f:
        f.write(prompt)

    cmd = (
        f"{claude_env} && echo {tt} | claude "
        f"--append-system-prompt-file {tmp_system_prompt_file} "
        f"--permission-mode bypassPermissions --include-partial-messages "
        f"--debug-file {debug_file} --output-format stream-json --verbose -p"
    )

    yield {"type": "node_log", "node": node["id"], "text": f"$ {cmd[:120]}..."}

    try:
        process = subprocess.Popen(
            cmd, shell=True, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, text=True, bufsize=1,
        )
    except Exception as e:
        yield {"type": "node_log", "node": node["id"], "text": f"[error] 启动 claude 失败: {e}"}
        return

    start_time = time.time()
    timeout = 3000
    success = False

    while True:
        if handle.stop_event.is_set():
            process.kill()
            yield {"type": "node_log", "node": node["id"], "text": "[stopped] 用户中止"}
            return

        ready, _, _ = select.select([process.stdout], [], [], 2)
        if ready:
            line = process.stdout.readline()
            if not line:
                break
            if "/bin/sh: 1: Test: not found\n" == line:
                continue
            try:
                data = json.loads(line)
                msg = parser_msg(data)
                if msg:
                    if "'type': 'image'" in str(msg):
                        continue
                    yield {"type": "node_log", "node": node["id"], "text": str(msg)}
                if data.get("type") == "result" and data.get("subtype") == "success":
                    success = True
                    # 不立即 kill,让尾部日志读完
            except json.JSONDecodeError:
                pass
        else:
            if process.poll() is not None:
                break
            if time.time() - start_time > timeout:
                process.kill()
                yield {"type": "node_log", "node": node["id"], "text": f"[error] 超时({timeout}s)"}
                return

    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()

    if not success:
        yield {"type": "node_log", "node": node["id"], "text": f"[warn] claude 未返回 success(rc={process.returncode})"}
    return


def _execute_node(node: dict, graph: dict, task_dir: Path, handle: RunHandle) -> Iterator[dict]:
    """跑单个节点:拼 prompt → 流式执行 → gate 判定。"""
    node_id = node["id"]
    yield {"type": "node_start", "node": node_id}

    output_doc = Path(node["output_doc"])
    if not output_doc.is_absolute():
        output_doc = task_dir / output_doc
    output_doc.parent.mkdir(parents=True, exist_ok=True)

    prd_md = task_dir / "prd.md"
    skill_cmd = node["skill"]
    extra = node.get("extra", "")
    prompt = node_prompt(node["name"], skill_cmd, output_doc, task_dir, prd_md, extra)

    yield from _run_agent_stream(node, prompt, task_dir, handle)
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

    yield {"type": "node_done", "node": node_id, "success": True,
           "passed": passed, "gate": is_gate, "gate_stats": gate_stats}


# ==================== 图执行:拓扑前进 + 回退边 ====================
def _build_next_deps(graph: dict) -> dict[str, list[str]]:
    """每个节点的 next 上游(谁跑完我才能跑)。"""
    deps: dict[str, list[str]] = {n["id"]: [] for n in graph["nodes"]}
    for e in graph["edges"]:
        if e.get("type") == "next":
            deps.setdefault(e["to"], []).append(e["from"])
    return deps


def _loop_edges(graph: dict) -> dict[str, list[dict]]:
    """每个节点出发的 loop(回退)边。"""
    loops: dict[str, list[dict]] = {n["id"]: [] for n in graph["nodes"]}
    for e in graph["edges"]:
        if e.get("type") == "loop":
            loops.setdefault(e["from"], []).append(e)
    return loops


def _downstream_via_next(graph: dict, start: str) -> set[str]:
    """从 start 沿 next 边可达的所有下游(回退时要一起重置 pending)。"""
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


def run_graph(graph: dict, task_dir: str | Path, force: bool, handle: RunHandle) -> None:
    """主执行循环(在后台线程跑)。事件全部 emit 到 handle。"""
    task_dir = Path(task_dir)
    nodes_by_id = {n["id"]: n for n in graph["nodes"]}
    deps = _build_next_deps(graph)
    loops = _loop_edges(graph)

    # 节点状态:pending / done(passed) / done(failed)
    status: dict[str, str] = {nid: "pending" for nid in nodes_by_id}
    passed_map: dict[str, bool] = {}

    # force:不管产出存不存在都跑;否则产出已存在的节点直接跳过
    def already_has_output(node: dict) -> bool:
        od = Path(node["output_doc"])
        if not od.is_absolute():
            od = task_dir / od
        return od.exists()

    max_total_steps = 200  # 防回退边失控死循环
    steps = 0

    while steps < max_total_steps:
        if handle.stop_event.is_set():
            handle.emit({"type": "workflow_done", "stopped": True})
            handle.finished = True
            return

        # 找一个可跑节点:状态 pending 且所有 next 上游都 done(passed)
        runnable = None
        for nid, st in status.items():
            if st != "pending":
                continue
            upstream = deps.get(nid, [])
            if all(status.get(u) == "done" for u in upstream):
                runnable = nid
                break

        if runnable is None:
            # 没有 runnable 了:要么全 done,要么有节点 failed 阻塞下游
            if all(s == "done" for s in status.values()):
                handle.emit({"type": "workflow_done", "stopped": False})
            else:
                # 有 pending 但上游有 failed —— 收集受阻的
                blocked = [nid for nid, st in status.items() if st == "pending"]
                handle.emit({
                    "type": "workflow_done", "stopped": False,
                    "blocked": blocked,
                    "reason": "上游节点失败,下游受阻",
                })
            handle.finished = True
            return

        node = nodes_by_id[runnable]
        steps += 1

        # force 控制:产出已存在则跳过(除非该节点是 gate 且上次没过 → 不跳)
        if not force and already_has_output(node) and status.get(runnable) == "pending":
            # 产物已存在视为已 done(但 gate 节点仍需判 gate)
            od = Path(node["output_doc"])
            if not od.is_absolute():
                od = task_dir / od
            if node.get("gate", False):
                p, stats = gate_check(od)
                passed_map[runnable] = p
                status[runnable] = "done"
                handle.emit({"type": "node_done", "node": runnable, "success": True,
                             "passed": p, "gate": True, "gate_stats": stats, "skipped": True})
            else:
                status[runnable] = "done"
                passed_map[runnable] = True
                handle.emit({"type": "node_done", "node": runnable, "success": True,
                             "passed": True, "gate": False, "skipped": True})
        else:
            # 真跑
            for ev in _execute_node(node, graph, task_dir, handle):
                handle.emit(ev)
            if handle.stop_event.is_set():
                handle.emit({"type": "workflow_done", "stopped": True})
                handle.finished = True
                return

            passed = passed_map.get(runnable, True)
            # _execute_node 没设 passed_map,从最后一个 node_done 事件取
            for ev in reversed(handle.events):
                if ev.get("type") == "node_done" and ev.get("node") == runnable:
                    passed = ev.get("passed", True)
                    break
            passed_map[runnable] = passed
            status[runnable] = "done"

        # 检查回退边:本节点 done 后,是否有 loop 边条件满足
        triggered_loop = False
        for le in loops.get(runnable, []):
            cond = le.get("condition", "gate_fail")
            target = le["to"]
            fire = False
            if cond == "gate_fail":
                fire = not passed_map.get(runnable, True)
            elif cond == "always":
                fire = True
            if fire:
                triggered_loop = True
                handle.emit({"type": "loop_trigger", "from": runnable, "to": target,
                             "condition": cond})
                # 重置 target + 其 next 下游为 pending(实现循环)
                reset = {target} | _downstream_via_next(graph, target)
                for rid in reset:
                    if rid in status:
                        status[rid] = "pending"
                        passed_map.pop(rid, None)
                        handle.emit({"type": "node_reset", "node": rid})
                break  # 一次只触发一条回退边

        _ = triggered_loop  # 触发后循环继续找 runnable

    handle.emit({"type": "workflow_done", "stopped": False,
                 "reason": f"达到最大步数 {max_total_steps},疑似回退边死循环"})
    handle.finished = True


def start_run(graph: dict, task_dir: str, force: bool = False) -> RunHandle:
    """启动一次执行。返回 RunHandle,SSE 端读 handle.events/queue。"""
    run_id = uuid.uuid4().hex[:12]
    handle = RunHandle(run_id, graph, task_dir, force)

    def _worker():
        try:
            run_graph(graph, task_dir, force, handle)
        except Exception as e:
            handle.error = str(e)
            handle.emit({"type": "workflow_done", "stopped": False, "error": str(e)})
            handle.finished = True

    handle.thread = threading.Thread(target=_worker, daemon=True, name=f"run-{run_id}")
    with _RUNS_LOCK:
        _RUNS[run_id] = handle
    handle.thread.start()
    return handle
