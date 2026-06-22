"""workflow graph 的读写 + 默认图。

一份"编排" = 节点列表 + 边列表,落盘到 <task_dir>/.xdd/graph.json(与 xdd
三层模型同居,工作记录性质)。

默认图从 workflow.run_workflow.build_nodes() 派生:8 个 xdd 标准节点 +
现有"verify 没过 → 回 plan/execute 重做"的回退边,保证开箱即用。
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..run_workflow import (  # noqa: E402
    DEFAULT_MODEL,
    build_nodes,
)


# 默认图用的"基准 task_dir"——只是为了让 build_nodes 给出相对产出路径。
# 真正落盘时产出路径是相对 task_dir 的,前端/引擎会按需拼接。
_DUMMY_TASK_DIR = "__TASK_DIR__"


def _default_nodes() -> list[dict[str, Any]]:
    """从 build_nodes() 派生默认节点列表。

    build_nodes 返回 [(agent, doc, skill_cmd, node_model), ...],doc 是绝对路径
    (含 task_dir)。我们转成相对 task_dir 的字符串,存 output_doc。
    """
    raw = build_nodes(Path(_DUMMY_TASK_DIR))
    nodes = []
    for i, (agent, doc, skill_cmd, node_model) in enumerate(raw):
        doc_str = str(doc)
        # 剥掉 dummy 前缀,留相对路径
        rel = doc_str.split(_DUMMY_TASK_DIR + "/", 1)[-1] if _DUMMY_TASK_DIR in doc_str else doc_str
        nodes.append({
            "id": f"n{i}_{agent}",
            "name": agent,
            "skill": skill_cmd,
            "output_doc": rel,
            "model": node_model or DEFAULT_MODEL,
            "extra": "",
            "gate": agent == "verify",  # 只有 verify 默认当验收闸
        })
    return nodes


def _default_edges(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """默认边:顺序 next 链 + verify→plan/execute 的回退 loop 边。

    顺序链:brainstorm→spec→architecture→wire→resilience→plan→execute→verify
    回退边:verify 没过 → 回 execute(plan 也行,这里仿原 workflow 走 plan)。
    """
    edges = []
    for i in range(len(nodes) - 1):
        edges.append({"from": nodes[i]["id"], "to": nodes[i + 1]["id"], "type": "next"})

    # 找 verify 和 plan 的 id 做回退边
    by_name = {n["name"]: n["id"] for n in nodes}
    verify_id = by_name.get("verify")
    plan_id = by_name.get("plan")
    execute_id = by_name.get("execute")
    # 仿原 workflow 第二阶段:verify 没过 → 回 execute 重做(经 plan)
    if verify_id and execute_id:
        edges.append({
            "from": verify_id,
            "to": execute_id,
            "type": "loop",
            "condition": "gate_fail",
        })
    _ = plan_id  # 保留引用,未来可加 verify→plan 回退边
    return edges


def default_graph(task_dir: str | Path) -> dict[str, Any]:
    """生成默认编排图。"""
    return {
        "task_dir": str(Path(task_dir).resolve()),
        "nodes": _default_nodes(),
        "edges": _default_edges(nodes := _default_nodes()),
    }


def graph_path(task_dir: str | Path) -> Path:
    """graph.json 的落盘位置:<task_dir>/.xdd/graph.json"""
    return Path(task_dir) / ".xdd" / "graph.json"


def load_graph(task_dir: str | Path) -> dict[str, Any]:
    """读 graph.json;不存在则返回默认图(不落盘)。"""
    p = graph_path(task_dir)
    if p.exists():
        data = json.loads(p.read_text(encoding="utf-8"))
        # 兜底:旧文件可能缺字段
        data.setdefault("task_dir", str(Path(task_dir).resolve()))
        data.setdefault("nodes", [])
        data.setdefault("edges", [])
        return data
    g = default_graph(task_dir)
    g["task_dir"] = str(Path(task_dir).resolve())
    return g


def save_graph(task_dir: str | Path, graph: dict[str, Any]) -> Path:
    """保存编排图到 graph.json。返回落盘路径。"""
    p = graph_path(task_dir)
    p.parent.mkdir(parents=True, exist_ok=True)
    graph = dict(graph)
    graph["task_dir"] = str(Path(task_dir).resolve())
    p.write_text(json.dumps(graph, ensure_ascii=False, indent=2), encoding="utf-8")
    return p


def validate_graph(graph: dict[str, Any]) -> list[str]:
    """轻量校验:返回错误信息列表(空 = 合法)。"""
    errs = []
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])
    ids = {n.get("id") for n in nodes}

    seen_ids = set()
    for n in nodes:
        nid = n.get("id")
        if not nid:
            errs.append("存在无 id 的节点")
            continue
        if nid in seen_ids:
            errs.append(f"节点 id 重复: {nid}")
        seen_ids.add(nid)
        for f in ("name", "skill"):
            if not n.get(f):
                errs.append(f"节点 {nid} 缺字段 {f}")

    for e in edges:
        if e.get("from") not in ids:
            errs.append(f"边的 from 指向不存在的节点: {e.get('from')}")
        if e.get("to") not in ids:
            errs.append(f"边的 to 指向不存在的节点: {e.get('to')}")
        if e.get("type") not in ("next", "loop"):
            errs.append(f"边类型非法(应为 next/loop): {e.get('type')}")

    # 检测 next 边成环(回退边允许成环,那是循环的本意)
    next_adj = {nid: [] for nid in ids}
    for e in edges:
        if e.get("type") == "next":
            next_adj.setdefault(e["from"], []).append(e["to"])

    visited: set[str] = set()
    stack: set[str] = set()

    def dfs(node):
        if node in stack:
            return True
        if node in visited:
            return False
        visited.add(node)
        stack.add(node)
        for nxt in next_adj.get(node, []):
            if dfs(nxt):
                return True
        stack.discard(node)
        return False

    for nid in ids:
        if dfs(nid):
            errs.append(f"next 边存在环(回退请用 loop 类型): 涉及 {nid}")
            break

    return errs
