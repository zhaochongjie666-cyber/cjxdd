"""graph.json 读写 + 默认图 + 校验。

编排图 = 节点列表 + 边列表。默认图从 B01 nodes.build_nodes 派生(满足复用 + 开箱即用)。

@implements B02-R01 编排图用节点+边建模(节点 7 字段)
@implements B02-R02 边分 next/loop 两类(next 无环检测)
@implements B02-R06 默认图从八节点定义派生
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from ..models import DEFAULT_MODEL
from ..nodes import build_nodes  # @implements B02-R05 复用 B01


def _default_nodes(task_dir) -> list[dict[str, Any]]:
    """从 B01 build_nodes 派生默认八节点(7 字段)。@implements B02-R06"""
    raw = build_nodes(task_dir, bizline="B01", iter_n=1)
    return [
        {
            "id": f"n{i}_{n['name']}",
            "name": n["name"],
            "skill": n["skill"],
            "output_doc": n["output_doc"],
            "model": n["model"] or DEFAULT_MODEL,
            "extra": "",
            "gate": n["gate"],
        }
        for i, n in enumerate(raw)
    ]


def _default_edges(nodes: list[dict]) -> list[dict]:
    """默认边:8 节点 next 链 + verify→execute loop 回退边。"""
    edges = [
        {"from": nodes[i]["id"], "to": nodes[i + 1]["id"], "type": "next"}
        for i in range(len(nodes) - 1)
    ]
    by_name = {n["name"]: n["id"] for n in nodes}
    vid, eid = by_name.get("verify"), by_name.get("execute")
    if vid and eid:
        edges.append({"from": vid, "to": eid, "type": "loop", "condition": "gate_fail"})
    return edges


def default_graph(task_dir) -> dict[str, Any]:
    """生成默认八节点编排图。@implements B02-R06"""
    nodes = _default_nodes(task_dir)
    return {
        "task_dir": str(Path(task_dir).resolve()),
        "nodes": nodes,
        "edges": _default_edges(nodes),
    }


def graph_path(task_dir) -> Path:
    return Path(task_dir) / ".xdd" / "graph.json"


def load_graph(task_dir) -> dict[str, Any]:
    """读 graph.json;不存在/损坏回退默认图。@implements B02-R06 容错"""
    p = graph_path(task_dir)
    if p.exists():
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            data.setdefault("task_dir", str(Path(task_dir).resolve()))
            data.setdefault("nodes", [])
            data.setdefault("edges", [])
            return data
        except json.JSONDecodeError:
            logging.warning("graph.json 解析失败,用默认图")
    g = default_graph(task_dir)
    return g


def save_graph(task_dir, graph: dict) -> Path:
    p = graph_path(task_dir)
    p.parent.mkdir(parents=True, exist_ok=True)
    graph = dict(graph)
    graph["task_dir"] = str(Path(task_dir).resolve())
    p.write_text(json.dumps(graph, ensure_ascii=False, indent=2), encoding="utf-8")
    return p


def validate_graph(graph: dict) -> list[str]:
    """校验编排图。返回错误列表(空=合法)。

    @implements B02-R02(id 唯一/边指向存在/类型合法/next 无环)
    """
    errs: list[str] = []
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])
    ids = {n.get("id") for n in nodes}

    seen: set = set()
    for n in nodes:
        nid = n.get("id")
        if not nid:
            errs.append("存在无 id 的节点")
            continue
        if nid in seen:
            errs.append(f"节点 id 重复: {nid}")
        seen.add(nid)
        if not n.get("skill"):
            errs.append(f"节点 {nid} 缺 skill 字段")

    for e in edges:
        if e.get("from") not in ids:
            errs.append(f"边的 from 指向不存在: {e.get('from')}")
        if e.get("to") not in ids:
            errs.append(f"边的 to 指向不存在: {e.get('to')}")
        if e.get("type") not in ("next", "loop"):
            errs.append(f"边类型非法(应为 next/loop): {e.get('type')}")

    # next 边环检测(回退请用 loop)@B02-R02
    adj: dict[str, list[str]] = {nid: [] for nid in ids}
    for e in edges:
        if e.get("type") == "next":
            adj.setdefault(e["from"], []).append(e["to"])

    visited: set[str] = set()
    stack: set[str] = set()

    def has_cycle(node: str) -> bool:
        if node in stack:
            return True
        if node in visited:
            return False
        visited.add(node)
        stack.add(node)
        for nxt in adj.get(node, []):
            if has_cycle(nxt):
                return True
        stack.discard(node)
        return False

    for nid in ids:
        if has_cycle(nid):
            errs.append(f"next 边存在环(回退请用 loop 类型): 涉及 {nid}")
            break

    return errs
