#!/usr/bin/env python3
"""
Plan Engine - Task Plan Orchestration Engine
使用 JSON 存储 DAG，驱动任务计划执行
"""

import json
import os
import re
import sys
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Any, Literal
from dataclasses import dataclass, asdict
from enum import Enum
import argparse


class TaskStatus(str, Enum):
    PENDING = "pending"
    ACTIVE = "active"
    VERIFYING = "verifying"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


STATUS_ICONS = {
    TaskStatus.PENDING: "⭕",
    TaskStatus.ACTIVE: "🔵",
    TaskStatus.VERIFYING: "🔍",
    TaskStatus.COMPLETED: "✅",
    TaskStatus.FAILED: "❌",
    TaskStatus.SKIPPED: "⏭️",
}


@dataclass
class SubTask:
    subtask_id: str
    label: str
    status: str = "pending"
    description: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'SubTask':
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class Question:
    question_id: str
    content: str
    priority: str = "P1"
    status: str = "open"
    solution: Optional[str] = None
    created_at: Optional[int] = None
    resolved_at: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Question':
        data = dict(data)
        data.setdefault("created_at", None)
        data.setdefault("resolved_at", None)
        known = {f.name for f in cls.__dataclass_fields__.values()}
        return cls(**{k: v for k, v in data.items() if k in known})


@dataclass
class Task:
    id: str
    label: str
    status: str = "pending"
    description: Optional[str] = None
    output: Optional[str] = None
    checkpoint: str = ""
    retry_count: int = 0
    max_retries: int = 3
    failure_note: Optional[str] = None
    completed_at: Optional[int] = None
    parent_id: Optional[str] = None
    parallel: bool = False
    skill_name: Optional[str] = None
    subtasks: Optional[List[SubTask]] = None
    questions: Optional[List[Question]] = None

    def __post_init__(self):
        if self.subtasks is None:
            self.subtasks = []
        if self.questions is None:
            self.questions = []

    def has_blocking_question(self) -> bool:
        return any(q.status == "open" and q.priority in ("P0", "P1") for q in (self.questions or []))

    def raise_question(self, content: str, priority: str = "P1") -> Question:
        q = Question(
            question_id=f"q-{len(self.questions or []) + 1}",
            content=content,
            priority=priority,
            status="open",
            created_at=int(datetime.now().timestamp() * 1000),
        )
        if self.questions is None:
            self.questions = []
        self.questions.append(q)
        return q

    def resolve_question(self, question_id: str, solution: str) -> Optional[Question]:
        for q in (self.questions or []):
            if q.question_id == question_id:
                q.status = "resolved"
                q.solution = solution
                q.resolved_at = int(datetime.now().timestamp() * 1000)
                return q
        return None

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["task_id"] = d.pop("id")
        if not self.checkpoint:
            d.pop("checkpoint", None)
        if not self.skill_name:
            d.pop("skill_name", None)
        if not self.subtasks:
            d.pop("subtasks", None)
        if not self.questions:
            d.pop("questions", None)
        return d

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Task':
        data = dict(data)
        if "task_id" in data:
            data["id"] = data.pop("task_id")
        if "artifact" in data:
            data["output"] = data.pop("artifact")
        data.setdefault("status", "pending")
        data.setdefault("retry_count", 0)
        data.setdefault("max_retries", 3)
        data.setdefault("parallel", False)
        data.setdefault("checkpoint", "")
        data.setdefault("skill_name", None)
        data.setdefault("subtasks", [])
        data.setdefault("questions", [])
        if data["subtasks"]:
            data["subtasks"] = [SubTask.from_dict(s) for s in data["subtasks"]]
        if data["questions"]:
            data["questions"] = [Question.from_dict(q) for q in data["questions"]]
        known = {f.name for f in cls.__dataclass_fields__.values()}
        data = {k: v for k, v in data.items() if k in known}
        return cls(**data)


@dataclass
class Dependency:
    from_task: str
    to_task: str
    label: Optional[str] = None
    is_fallback: bool = False
    condition: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "from": self.from_task,
            "to": self.to_task,
            "label": self.label,
            "is_fallback": self.is_fallback,
            "condition": self.condition,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Dependency':
        return cls(
            from_task=data["from"],
            to_task=data["to"],
            label=data.get("label"),
            is_fallback=data.get("is_fallback", False),
            condition=data.get("condition"),
        )


@dataclass
class HistoryEntry:
    timestamp: int
    from_task_id: Optional[str]
    to_task_id: str
    action: str
    note: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'HistoryEntry':
        data = dict(data)
        if "from_node_id" in data:
            data["from_task_id"] = data.pop("from_node_id")
        if "to_node_id" in data:
            data["to_task_id"] = data.pop("to_node_id")
        known = {f.name for f in cls.__dataclass_fields__.values()}
        data = {k: v for k, v in data.items() if k in known}
        return cls(**data)


@dataclass
class Plan:
    id: str
    name: str
    description: Optional[str] = None
    created_at: int = 0
    updated_at: int = 0
    tasks: List[Task] = None
    dependencies: List[Dependency] = None
    current_task_id: Optional[str] = None
    history: List[HistoryEntry] = None

    def __post_init__(self):
        if self.tasks is None:
            self.tasks = []
        if self.dependencies is None:
            self.dependencies = []
        if self.history is None:
            self.history = []
        if self.created_at == 0:
            self.created_at = int(datetime.now().timestamp() * 1000)
        if self.updated_at == 0:
            self.updated_at = self.created_at

    def to_dict(self) -> Dict[str, Any]:
        return {
            "plan_id": self.id,
            "name": self.name,
            "description": self.description,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "tasks": [t.to_dict() for t in self.tasks],
            "dependencies": [d.to_dict() for d in self.dependencies],
            "current_task_id": self.current_task_id,
            "history": [h.to_dict() for h in self.history],
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Plan':
        plan_id = data.get("plan_id", data.get("id"))
        plan = cls(
            id=plan_id,
            name=data["name"],
            description=data.get("description"),
            created_at=data.get("created_at", 0),
            updated_at=data.get("updated_at", 0),
            current_task_id=data.get("current_task_id", data.get("current_node_id")),
        )
        plan.tasks = [Task.from_dict(t) for t in data.get("tasks", data.get("nodes", []))]
        plan.dependencies = [Dependency.from_dict(d) for d in data.get("dependencies", data.get("edges", []))]
        plan.history = [HistoryEntry.from_dict(h) for h in data.get("history", [])]
        return plan


    def get_task_by_id(self, task_id: str) -> Optional[Task]:
        return next((t for t in self.tasks if t.id == task_id), None)


setattr(Plan, "get_task_by_id", Plan.get_task_by_id)


class PlanEngine:
    """Plan Engine - 计划执行引擎"""

    def __init__(self, state_dir: str = ".opencode/plan"):
        self.state_dir = Path(state_dir)
        self._ensure_dir()

    def _ensure_dir(self) -> None:
        """确保状态目录存在"""
        self.state_dir.mkdir(parents=True, exist_ok=True)

    def _get_plan_path(self, plan_id: str) -> Path:
        """获取流程文件路径"""
        return self.state_dir / f"{plan_id}.json"

    def _get_plans_dir(self) -> Path:
        """获取计划目录"""
        plans_dir = self.state_dir / "plans"
        plans_dir.mkdir(parents=True, exist_ok=True)
        return plans_dir

    def read_plan(self, plan_id: str) -> Optional[Plan]:
        """读取流程"""
        path = self._get_plan_path(plan_id)
        if not path.exists():
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return Plan.from_dict(data)
        except Exception as e:
            print(f"Error reading plan: {e}", file=sys.stderr)
            return None

    def write_plan(self, plan: Plan) -> None:
        """写入流程"""
        plan.updated_at = int(datetime.now().timestamp() * 1000)
        path = self._get_plan_path(plan.id)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(plan.to_dict(), f, indent=2, ensure_ascii=False)

    def list_plans(self) -> List[str]:
        """列出所有流程"""
        if not self.state_dir.exists():
            return []
        return [f.stem for f in self.state_dir.glob("*.json")]

    def delete_plan(self, plan_id: str) -> bool:
        """删除流程"""
        path = self._get_plan_path(plan_id)
        if path.exists():
            path.unlink()
            return True
        return False

    # ========== Graph Operations ==========

    def get_task(self, plan: Plan, task_id: str) -> Optional[Task]:
        """获取任务"""
        return next((n for n in plan.tasks if n.id == task_id), None)

    def get_outgoing_deps(self, plan: Plan, task_id: str) -> List[Dependency]:
        """获取出依赖"""
        return [d for d in plan.dependencies if d.from_task == task_id]

    def get_incoming_deps(self, plan: Plan, task_id: str) -> List[Dependency]:
        """获取入依赖"""
        return [d for d in plan.dependencies if d.to_task == task_id]

    def get_start_task(self, plan: Plan) -> Optional[Task]:
        """获取起始任务"""
        tasks_with_incoming = {d.to_task for d in plan.dependencies}
        return next((t for t in plan.tasks if t.id not in tasks_with_incoming), None)

    def get_next_tasks(self, plan: Plan, task_id: str) -> List[Task]:
        """获取下一个任务"""
        out_edges = self.get_outgoing_deps(plan, task_id)
        next_nodes = []
        for e in out_edges:
            task = self.get_task(plan, e.to_task)
            if task and task.status not in ["completed", "skipped"]:
                next_nodes.append(task)
        return next_nodes

    def get_fallback_target(self, plan: Plan, task_id: str) -> Optional[Task]:
        """获取回退目标"""
        fallback_edge = next(
            (e for e in plan.dependencies if e.from_task == task_id and e.is_fallback), None
        )
        if fallback_edge:
            return self.get_task(plan, fallback_edge.to_task)
        return None

    def get_subtasks(self, plan: Plan, task_id: str) -> List[Task]:
        """获取子任务"""
        return [n for n in plan.tasks if n.parent_id == task_id]

    def is_group_task(self, plan: Plan, task_id: str) -> bool:
        """判断是否为组任务"""
        return len(self.get_subtasks(plan, task_id)) > 0

    def all_subtasks_completed(self, plan: Plan, task_id: str) -> bool:
        """判断所有子任务是否完成"""
        subtasks = self.get_subtasks(plan, task_id)
        if not subtasks:
            return False
        return all(c.status in ["completed", "skipped"] for c in subtasks)

    def compute_progress(self, plan: Plan) -> Dict[str, int]:
        """计算进度"""
        return {
            "total": len(plan.tasks),
            "completed": len([t for t in plan.tasks if t.status == "completed"]),
            "failed": len([t for t in plan.tasks if t.status == "failed"]),
            "verifying": len([t for t in plan.tasks if t.status == "verifying"]),
            "active": len([t for t in plan.tasks if t.status == "active"]),
            "pending": len([t for t in plan.tasks if t.status == "pending"]),
        }

    def get_ready_tasks(self, plan: Plan) -> List[Task]:
        """获取所有可立即执行的任务（依赖都已完成的 pending 任务）"""
        ready = []
        for task in plan.tasks:
            if task.status != "pending":
                continue
            deps = self.get_incoming_deps(plan, task.id)
            dep_ids = {d.from_task for d in deps}
            if all(
                self.get_task(plan, did).status in ("completed", "skipped")
                for did in dep_ids
                if self.get_task(plan, did)
            ):
                ready.append(task)
        return ready

    def replan(self, plan: Plan, reason: str, new_tasks: List[Dict[str, Any]], new_deps: List[Dict[str, Any]]) -> Plan:
        """重新规划：保留已完成任务，替换未完成任务"""
        completed_ids = {t.id for t in plan.tasks if t.status in ("completed", "skipped")}
        plan.tasks = [t for t in plan.tasks if t.id in completed_ids]
        plan.dependencies = [
            d for d in plan.dependencies
            if d.from_task in completed_ids and d.to_task in completed_ids
        ]
        for task_data in new_tasks:
            tid = task_data.get("id", task_data.get("task_id"))
            if tid not in completed_ids:
                task = Task(
                    id=tid,
                    label=task_data["label"],
                    description=task_data.get("description"),
                    output=task_data.get("output", task_data.get("artifact")),
                    checkpoint=task_data.get("checkpoint", ""),
                    max_retries=task_data.get("max_retries", 3),
                    parallel=task_data.get("parallel", False),
                    skill_name=task_data.get("skill_name"),
                )
                plan.tasks.append(task)
        for dep_data in new_deps:
            plan.dependencies.append(Dependency(
                from_task=dep_data["from"],
                to_task=dep_data["to"],
                label=dep_data.get("label"),
                is_fallback=dep_data.get("is_fallback", False),
                condition=dep_data.get("condition"),
            ))
        self._auto_chain_tasks(plan, new_tasks)
        # Replan keeps completed tasks, so the original graph start may already be completed.
        # Activate the first ready pending task instead of leaving current_task_id stale.
        plan.current_task_id = None
        ready_tasks = self.get_ready_tasks(plan)
        if ready_tasks:
            ready_tasks[0].status = "active"
            plan.current_task_id = ready_tasks[0].id
        plan.history.append(HistoryEntry(
            timestamp=int(datetime.now().timestamp() * 1000),
            from_task_id=None,
            to_task_id="all",
            action="replan",
            note=reason,
        ))
        self.write_plan(plan)
        return plan

    # ========== Plan Operations ==========

    def create_plan(
        self,
        plan_id: str,
        name: str,
        tasks: List[Dict[str, Any]],
        dependencies: List[Dict[str, Any]],
        description: Optional[str] = None,
    ) -> Plan:
        """创建流程"""
        plan = Plan(
            id=plan_id,
            name=name,
            description=description,
        )

        # 创建节点
        for task_data in tasks:
            task = Task(
                id=task_data.get("id", task_data.get("task_id")),
                label=task_data["label"],
                description=task_data.get("description"),
                output=task_data.get("output", task_data.get("artifact")),
                checkpoint=task_data.get("checkpoint", ""),
                max_retries=task_data.get("max_retries", 3),
                parent_id=task_data.get("parent_id"),
                parallel=task_data.get("parallel", False),
                skill_name=task_data.get("skill_name"),
            )
            plan.tasks.append(task)

        # 创建边
        for edge_data in dependencies:
            dep = Dependency(
                from_task=edge_data["from"],
                to_task=edge_data["to"],
                label=edge_data.get("label"),
                is_fallback=edge_data.get("is_fallback", False),
                condition=edge_data.get("condition"),
            )
            plan.dependencies.append(dep)

        # 自动连接线性流程
        self._auto_chain_tasks(plan, tasks)

        # 设置起始节点
        start_task = self.get_start_task(plan)
        if start_task:
            start_task.status = "active"
            plan.current_task_id = start_task.id
            plan.history.append(
                HistoryEntry(
                    timestamp=int(datetime.now().timestamp() * 1000),
                    from_task_id=None,
                    to_task_id=start_task.id,
                    action="start",
                )
            )

            # 处理组节点
            if self.is_group_task(plan, start_task.id):
                subtasks = self.get_subtasks(plan, start_task.id)
                for subtask in subtasks:
                    if subtask.status == "pending":
                        subtask.status = "active"
                if subtasks:
                    plan.current_task_id = subtasks[0].id
                    plan.history.append(
                        HistoryEntry(
                            timestamp=int(datetime.now().timestamp() * 1000),
                            from_task_id=start_task.id,
                            to_task_id=subtasks[0].id,
                            action="start",
                            note=f"{len(subtasks)} subtasks activated",
                        )
                    )

        self.write_plan(plan)
        return plan

    def _auto_chain_tasks(self, plan: Plan, node_defs: List[Dict[str, Any]]) -> None:
        """自动连接线性节点"""
        for i in range(len(node_defs) - 1):
            cur = node_defs[i]
            next_task = node_defs[i + 1]

            # 检查是否已有出边
            has_out_edge = any(
                e.from_task == cur["id"] and not any(
                    c["id"] == e.to_task for c in cur.get("subtasks", [])
                )
                for e in plan.dependencies
            )

            if not has_out_edge and not cur.get("subtasks"):
                # 添加线性连接
                plan.dependencies.append(
                    Dependency(from_task=cur["id"], to_task=next_task["id"])
                )
            elif not has_out_edge and cur.get("subtasks"):
                # 连接子节点的最后一个到下一个
                end_subtasks = [
                    c for c in cur["subtasks"]
                    if not any(e.from_task == c["id"] for e in plan.dependencies)
                ]
                for ec in end_subtasks:
                    plan.dependencies.append(
                        Dependency(from_task=ec["id"], to_task=next_task["id"])
                    )

    def complete_task(
        self, plan: Plan, note: Optional[str] = None, branch: Optional[str] = None
    ) -> Dict[str, Any]:
        """推进节点"""
        if not plan.current_task_id:
            return {"success": False, "error": "No current task"}

        current_node = self.get_task(plan, plan.current_task_id)
        if not current_node:
            return {"success": False, "error": "Current task not found"}

        if current_node.status == "verifying":
            return {
                "success": False,
                "error": f'Task "{current_node.label}" is already VERIFYING. Call verify-task instead.',
            }

        if current_node.status == "failed":
            current_node.retry_count += 1
            current_node.failure_note = None

        current_node.status = "verifying"
        plan.history.append(
            HistoryEntry(
                timestamp=int(datetime.now().timestamp() * 1000),
                from_task_id=plan.current_task_id,
                to_task_id=plan.current_task_id,
                action="advance",
                note=note,
            )
        )
        self.write_plan(plan)

        return {
            "success": True,
            "task": current_node.to_dict(),
            "message": f'Node "{current_node.label}" entered VERIFYING phase',
        }

    def verify_task(
        self,
        plan: Plan,
        result: Literal["passed", "rejected"],
        note: str,
        branch: Optional[str] = None,
    ) -> Dict[str, Any]:
        """验证节点"""
        if not plan.current_task_id:
            return {"success": False, "error": "No current task"}

        current_node = self.get_task(plan, plan.current_task_id)
        if not current_node:
            return {"success": False, "error": "Current task not found"}

        if current_node.status != "verifying":
            return {
                "success": False,
                "error": f'Current task "{current_node.label}" is not verifying (current: {current_node.status}). Call complete-task first.',
            }

        if result == "rejected":
            current_node.status = "active"
            plan.history.append(
                HistoryEntry(
                    timestamp=int(datetime.now().timestamp() * 1000),
                    from_task_id=plan.current_task_id,
                    to_task_id=plan.current_task_id,
                    action="seal-reject",
                    note=note,
                )
            )
            self.write_plan(plan)
            return {
                "success": True,
                "rejected": True,
                "message": f'VERIFICATION REJECTED: "{current_node.label}"',
                "reason": note,
            }

        # Passed
        current_node.status = "completed"
        current_node.completed_at = int(datetime.now().timestamp() * 1000)

        # Advance to next
        result_data = self._advance_from_completed(plan, current_node.id, branch)
        next_task_id = result_data["next_task_id"]
        history_note = result_data["history_note"]

        plan.history.append(
            HistoryEntry(
                timestamp=int(datetime.now().timestamp() * 1000),
                from_task_id=current_node.id,
                to_task_id=next_task_id or current_node.id,
                action="seal-pass",
                note=f"{note} | {history_note}",
            )
        )
        self.write_plan(plan)

        next_task = self.get_task(plan, next_task_id) if next_task_id else None

        return {
            "success": True,
            "completed": True,
            "message": f'VERIFIED: "{current_node.label}" passed!',
            "seal_note": note,
            "history_note": history_note,
            "next_task": next_task.to_dict() if next_task else None,
            "plan_complete": next_task_id is None,
        }

    def _advance_from_completed(
        self, plan: Plan, completed_task_id: str, branch: Optional[str] = None
    ) -> Dict[str, Any]:
        """从节点推进"""
        completed_task = self.get_task(plan, completed_task_id)
        if not completed_task:
            return {"next_task_id": None, "history_note": "Task not found"}

        # Handle parent task
        if completed_task.parent_id:
            parent = self.get_task(plan, completed_task.parent_id)
            if parent and self.all_subtasks_completed(plan, parent.id):
                parent.status = "completed"
                parent.completed_at = int(datetime.now().timestamp() * 1000)
                result = self._activate_next_task(plan, parent.id, branch)
                return {
                    "next_task_id": result["next_task_id"],
                    "history_note": f"subtask {completed_task_id} completed → group {parent.id} completed {result['history_note']}",
                }

            # More subtasks pending
            pending_subtasks = [
                c for c in self.get_subtasks(plan, completed_task.parent_id)
                if c.status == "pending"
            ]
            if pending_subtasks:
                pending_subtasks[0].status = "active"
                plan.current_task_id = pending_subtasks[0].id
                return {
                    "next_task_id": pending_subtasks[0].id,
                    "history_note": f"subtask {completed_task_id} completed → next subtask {pending_subtasks[0].id}",
                }

            plan.current_task_id = completed_task.parent_id
            return {
                "next_task_id": completed_task.parent_id,
                "history_note": f"subtask {completed_task_id} completed → back to parent {completed_task.parent_id}",
            }

        # Root task
        result = self._activate_next_task(plan, completed_task_id, branch)
        prefix = (
            f"group {completed_task_id} completed"
            if self.is_group_task(plan, completed_task_id)
            else f"{completed_task_id} completed"
        )
        return {
            "next_task_id": result["next_task_id"],
            "history_note": f"{prefix} {result['history_note']}",
        }

    def _activate_next_task(
        self, plan: Plan, from_task_id: str, branch: Optional[str] = None
    ) -> Dict[str, Any]:
        """激活下一个节点"""
        out_edges = self.get_outgoing_deps(plan, from_task_id)
        non_fallback_edges = [e for e in out_edges if not e.is_fallback]

        candidates = []
        for e in non_fallback_edges:
            task = self.get_task(plan, e.to_task)
            if task and task.status not in ["completed", "skipped"]:
                candidates.append((e, task))

        if not candidates:
            plan.current_task_id = None
            return {"next_task_id": None, "history_note": "plan complete"}

        # Select by branch or first
        selected = None
        if branch:
            selected = next(
                (c for c in candidates if c[0].label == branch or c[0].condition == branch), None
            )
        if not selected:
            selected = candidates[0]

        dep, next_task = selected
        next_task.status = "active"

        # Handle group
        if self.is_group_task(plan, next_task.id):
            subtasks = self.get_subtasks(plan, next_task.id)
            for subtask in subtasks:
                if subtask.status == "pending":
                    subtask.status = "active"
            if subtasks:
                plan.current_task_id = subtasks[0].id
                return {
                    "next_task_id": subtasks[0].id,
                    "history_note": f"group {next_task.id} started ({len(subtasks)} subtasks)",
                }

        plan.current_task_id = next_task.id
        return {"next_task_id": next_task.id, "history_note": f"→ {next_task.id}"}

    def reject_task(self, plan: Plan, note: str) -> Dict[str, Any]:
        """标记节点失败"""
        if not plan.current_task_id:
            return {"success": False, "error": "No current task"}

        current_node = self.get_task(plan, plan.current_task_id)
        if not current_node:
            return {"success": False, "error": "Current task not found"}

        current_node.retry_count += 1
        current_node.status = "failed"
        current_node.failure_note = note

        fallback = self.get_fallback_target(plan, plan.current_task_id)
        plan.history.append(
            HistoryEntry(
                timestamp=int(datetime.now().timestamp() * 1000),
                from_task_id=plan.current_task_id,
                to_task_id=fallback.id if fallback else plan.current_task_id,
                action="fail",
                note=note,
            )
        )
        self.write_plan(plan)

        result = {
            "success": True,
            "failed": True,
            "task": current_node.to_dict(),
            "message": f'Node "{current_node.label}" FAILED',
            "reason": note,
            "retry_count": current_node.retry_count,
            "max_retries": current_node.max_retries,
        }

        if current_node.retry_count >= current_node.max_retries and fallback:
            result["should_rollback"] = True
            result["fallback_target"] = fallback.to_dict()
        elif current_node.retry_count >= current_node.max_retries:
            result["should_reset"] = True

        return result

    def fallback_task(
        self, plan: Plan, target_node_id: Optional[str] = None, note: Optional[str] = None
    ) -> Dict[str, Any]:
        """回退节点"""
        if not plan.current_task_id:
            return {"success": False, "error": "No current task"}

        target_id = target_node_id
        if not target_id:
            fallback = self.get_fallback_target(plan, plan.current_task_id)
            if fallback:
                target_id = fallback.id

        if not target_id:
            return {"success": False, "error": "No rollback target found"}

        target_node = self.get_task(plan, target_id)
        if not target_node:
            return {"success": False, "error": f"Target task '{target_id}' not found"}

        prev_id = plan.current_task_id
        target_node.status = "active"
        target_node.retry_count = 0
        target_node.failure_note = None
        plan.current_task_id = target_id

        plan.history.append(
            HistoryEntry(
                timestamp=int(datetime.now().timestamp() * 1000),
                from_task_id=prev_id,
                to_task_id=target_id,
                action="rollback",
                note=note,
            )
        )
        self.write_plan(plan)

        return {
            "success": True,
            "message": f"Rolled back to: {target_node.label}",
            "from": prev_id,
            "to": target_id,
            "task": target_node.to_dict(),
        }

    def reset_plan(self, plan: Plan, task_id: Optional[str] = None, note: Optional[str] = None) -> Dict[str, Any]:
        """重置流程"""
        if task_id:
            task = self.get_task(plan, task_id)
            if not task:
                return {"success": False, "error": f"Task '{task_id}' not found"}
            self._reset_task(plan, task)
            for subtask in self.get_subtasks(plan, task.id):
                self._reset_task(plan, subtask)
            if self.is_group_task(plan, task.id):
                subtasks = self.get_subtasks(plan, task.id)
                if subtasks:
                    subtasks[0].status = "active"
                    plan.current_task_id = subtasks[0].id
                else:
                    task.status = "active"
                    plan.current_task_id = task.id
            else:
                task.status = "active"
                plan.current_task_id = task.id
        else:
            for task in plan.tasks:
                self._reset_task(plan, task)
            plan.current_task_id = None
            start = self.get_start_task(plan)
            if start:
                start.status = "active"
                plan.current_task_id = start.id
                if self.is_group_task(plan, start.id):
                    subtasks = self.get_subtasks(plan, start.id)
                    for subtask in subtasks:
                        subtask.status = "active"
                    if subtasks:
                        plan.current_task_id = subtasks[0].id

        plan.history.append(
            HistoryEntry(
                timestamp=int(datetime.now().timestamp() * 1000),
                from_task_id=None,
                to_task_id=task_id or "all",
                action="reset",
                note=note,
            )
        )
        self.write_plan(plan)

        return {
            "success": True,
            "message": f"Reset {task_id or 'all tasks'}",
            "plan": plan.to_dict(),
        }

    def _reset_task(self, plan: Plan, task: Task) -> None:
        """重置节点"""
        task.status = "pending"
        task.retry_count = 0
        task.failure_note = None
        task.completed_at = None

    # ========== Rendering ==========

    def render_ascii(self, plan: Plan, compact: bool = False) -> str:
        """渲染 ASCII 视图
        
        Args:
            plan: 流程对象
            compact: 如果为 True，返回适合 TUI 显示的紧凑格式
        """
        progress = self.compute_progress(plan)
        pct = round((progress["completed"] / max(progress["total"], 1)) * 100)
        
        if compact:
            # TUI 紧凑格式 - 单行进度条
            bar_len = 10
            filled = round((progress["completed"] / max(progress["total"], 1)) * bar_len)
            bar = "█" * filled + "░" * (bar_len - filled)
            
            # 当前节点信息
            current_str = ""
            if plan.current_task_id:
                current = self.get_task(plan, plan.current_task_id)
                if current:
                    icon = STATUS_ICONS.get(TaskStatus(current.status), "⭕")
                    current_str = f" | {icon} {current.label}"
            
            return f"{bar} {pct}% ({progress['completed']}/{progress['total']}){current_str}"
        
        # 完整格式
        bar_len = 20
        filled = round((progress["completed"] / max(progress["total"], 1)) * bar_len)
        bar = "█" * filled + "░" * (bar_len - filled)

        lines = [
            f"📋 Plan: {plan.name} [{bar}] {pct}% ({progress['completed']}/{progress['total']})",
            "",
        ]

        root_tasks = [n for n in plan.tasks if not n.parent_id]

        for task in root_tasks:
            lines.append(self._render_ascii_node(task, task.id == plan.current_task_id, 0))
            if self.is_group_task(plan, task.id):
                for subtask in self.get_subtasks(plan, task.id):
                    lines.append(
                        self._render_ascii_node(subtask, subtask.id == plan.current_task_id, 1)
                    )

        if plan.current_task_id:
            current = self.get_task(plan, plan.current_task_id)
            if current:
                next_nodes = self.get_next_tasks(plan, plan.current_task_id)
                fallback = self.get_fallback_target(plan, plan.current_task_id)
                lines.append("")
                lines.append(f"👉 Current task: {current.label} ({current.id})")
                if next_nodes:
                    lines.append(
                        f"⭐ Next task: {', '.join(f'{n.label} ({n.id})' for n in next_nodes)}"
                    )
                if fallback:
                    lines.append(f"↩️ Fallback: {fallback.label} ({fallback.id})")

        lines.append("")
        lines.append(self._render_changelog(plan))
        return "\n".join(lines)
    
    def get_tui_status(self, plan: Plan) -> Dict[str, str]:
        """获取 TUI 状态信息
        
        返回适合 TUI status bar 显示的简洁信息
        """
        progress = self.compute_progress(plan)
        pct = round((progress["completed"] / max(progress["total"], 1)) * 100)
        
        # 紧凑进度条
        bar_len = 8
        filled = round((progress["completed"] / max(progress["total"], 1)) * bar_len)
        bar = "█" * filled + "░" * (bar_len - filled)
        
        # 当前节点
        current_info = "None"
        if plan.current_task_id:
            current = self.get_task(plan, plan.current_task_id)
            if current:
                icon = STATUS_ICONS.get(TaskStatus(current.status), "⭕")
                current_info = f"{icon} {current.label}"
        
        return {
            "progress_bar": f"{bar} {pct}%",
            "progress_text": f"{progress['completed']}/{progress['total']}",
            "current": current_info,
            "status_summary": f"✅{progress['completed']} 🔵{progress['active']} 🔍{progress['verifying']} ❌{progress['failed']}",
            "full": f"{bar} {pct}% | {current_info}",
        }

    def _render_ascii_node(self, task: Task, is_current: bool, indent: int) -> str:
        """渲染 ASCII 节点"""
        icon = STATUS_ICONS.get(TaskStatus(task.status), "⭕")
        marker = " ◀── HERE" if is_current else ""
        desc = f" — {task.description}" if task.description else ""
        fail_note = f" ⚠️ {task.failure_note}" if task.status == "failed" and task.failure_note else ""
        artifact = f" [📄 {task.output}]" if task.output else ""
        prefix = "  " * indent
        return f"{prefix}{icon} {task.id}: {task.label}{desc}{artifact}{fail_note}{marker}"

    def _render_changelog(self, plan: Plan) -> str:
        """渲染历史记录"""
        if not plan.history:
            return ""

        lines = ["\n━━━ Execution History ━━━", ""]
        entries = plan.history[-20:]
        idx = max(len(plan.history) - len(entries), 1)

        action_labels = {
            "start": "🚀 Started",
            "advance": "🔍 To verify",
            "fail": "❌ Rejected",
            "retry": "🔄 Retried",
            "rollback": "↩️ Fallback",
            "reset": "🔄 Reset",
            "seal-pass": "✅ Verified",
            "seal-reject": "❌ Verify rejected",
            "replan": "🧭 Replanned",
        }

        for h in entries:
            idx += 1
            time_str = datetime.fromtimestamp(h.timestamp / 1000).strftime("%H:%M:%S")
            action = action_labels.get(h.action, h.action.upper())
            from_label = h.from_task_id or "▶"
            lines.append(
                f"  {str(idx).rjust(3)} │ {time_str} │ {action.ljust(12)} │ {from_label} → {h.to_task_id}"
            )
            if h.note:
                lines.append(f"      │              │ Note: {h.note}")

        if len(plan.history) > 20:
            lines.append(f"  ... ({len(plan.history) - 20} earlier entries omitted)")

        return "\n".join(lines)

    def render_mermaid(self, plan: Plan) -> str:
        """渲染 Mermaid 图表"""
        lines = ["flowchart TD"]
        root_tasks = [n for n in plan.tasks if not n.parent_id]

        for task in root_tasks:
            if self.is_group_task(plan, task.id):
                icon = STATUS_ICONS.get(TaskStatus(task.status), "⭕")
                lines.append(f'  subgraph {task.id} ["{icon} {task.label}"]')
                for subtask in self.get_subtasks(plan, task.id):
                    child_icon = STATUS_ICONS.get(TaskStatus(subtask.status), "⭕")
                    is_current = subtask.id == plan.current_task_id
                    prefix = ">>" if is_current else ""
                    suffix = "<<" if is_current else ""
                    lines.append(f'    {subtask.id}{prefix}[{child_icon} {subtask.label}]{suffix}')
                lines.append("  end")
            else:
                icon = STATUS_ICONS.get(TaskStatus(task.status), "⭕")
                is_current = task.id == plan.current_task_id
                prefix = ">>" if is_current else ""
                suffix = "<<" if is_current else ""
                lines.append(f'  {task.id}{prefix}[{icon} {task.label}]{suffix}')

        lines.append("")
        for dep in plan.dependencies:
            label = f"|{dep.label}|" if dep.label else ""
            arrow = "-.->" if dep.is_fallback else "-->"
            lines.append(f"  {dep.from_task} {arrow} {label} {dep.to_task}")

        return "\n".join(lines)

    def parse_plan(self, mermaid_content: str) -> tuple:
        """解析 Mermaid 流程图，返回节点和边
        
        支持格式:
        flowchart TD
            A[节点A] --> B[节点B]
            B -.->|回退| A
        """
        tasks = []
        dependencies = []
        node_ids = set()
        id_pattern = r'[^\s\[\]\{\}\(\)\|">]+'
        
        for line in mermaid_content.split('\n'):
            line = line.strip()
            if not line or line.startswith('%') or line.startswith('flowchart'):
                continue
            
            # 解析节点定义: A[标签] 或 A["标签"]
            # 支持: A[节点A], A["节点A"], A((节点A)), A{节点A}
            # 查找节点定义
            node_patterns = [
                rf'({id_pattern})\["([^"]+)"\]',   # A["标签"]
                rf'({id_pattern})\[([^\]]+)\]',    # A[标签]
                rf'({id_pattern})\(([^)]+)\)',     # A(标签)
                rf'({id_pattern})\{{([^}}]+)\}}',  # A{标签}
            ]
            
            for pattern in node_patterns:
                matches = re.findall(pattern, line)
                for match in matches:
                    task_id, label = match
                    if task_id not in node_ids:
                        tasks.append({
                            "id": task_id,
                            "label": label.strip(),
                            "description": "",
                            "max_retries": 3
                        })
                        node_ids.add(task_id)
            
            # 解析边: A --> B, A -.-> B, A -->|标签| B
            edge_patterns = [
                # 虚线回退边: A -.-> B 或 A -.->|标签| B
                rf'({id_pattern})\s*-\.-*>\s*\|([^|]*)\|\s*({id_pattern})',
                rf'({id_pattern})\s*-\.-*>\s*({id_pattern})',
                # 实线边: A --> B 或 A -->|标签| B
                rf'({id_pattern})\s*-->\s*\|([^|]*)\|\s*({id_pattern})',
                rf'({id_pattern})\s*-->\s*({id_pattern})',
            ]
            
            for i, pattern in enumerate(edge_patterns):
                match = re.search(pattern, line)
                if match:
                    groups = match.groups()
                    if len(groups) == 3:
                        from_task, label, to_task = groups
                        is_fallback = i < 2  # 前两个模式是虚线
                    else:
                        from_task, to_task = groups
                        label = ""
                        is_fallback = i < 2
                    
                    dependencies.append({
                        "from": from_task,
                        "to": to_task,
                        "label": label.strip() if label else None,
                        "is_fallback": is_fallback
                    })
                    break
        
        return tasks, dependencies


# ========== CLI ==========

def main():
    parser = argparse.ArgumentParser(description="Plan Engine - Task Plan Orchestration")
    parser.add_argument("--state-dir", default=".opencode/plan", help="State directory")
    parser.add_argument("--json", action="store_true", help="Output JSON format")

    subparsers = parser.add_subparsers(dest="command", help="Commands")

    # create
    create_parser = subparsers.add_parser("create", help="Create a plan")
    create_parser.add_argument("--id", required=True, help="Plan ID")
    create_parser.add_argument("--name", required=True, help="Plan name")
    create_parser.add_argument("--description", help="Plan description")
    create_parser.add_argument("--tasks", required=True, help="Tasks JSON array")
    create_parser.add_argument("--dependencies", default="[]", help="Dependencies JSON array")

    # advance
    complete_task_parser = subparsers.add_parser("complete-task", help="Complete task (enter verification)")
    complete_task_parser.add_argument("--plan-id", required=True)
    complete_task_parser.add_argument("--note")
    complete_task_parser.add_argument("--branch")

    verify_task_parser = subparsers.add_parser("verify-task", help="Verify task")
    verify_task_parser.add_argument("--plan-id", required=True)
    verify_task_parser.add_argument("--result", required=True, choices=["passed", "rejected"])
    verify_task_parser.add_argument("--note", required=True)
    verify_task_parser.add_argument("--branch")

    reject_task_parser = subparsers.add_parser("reject-task", help="Mark task as failed")
    reject_task_parser.add_argument("--plan-id", required=True)
    reject_task_parser.add_argument("--note", required=True)

    fallback_task_parser = subparsers.add_parser("fallback-task", help="Fallback to previous task")
    fallback_task_parser.add_argument("--plan-id", required=True)
    fallback_task_parser.add_argument("--target")
    fallback_task_parser.add_argument("--note")

    # status
    status_parser = subparsers.add_parser("status", help="Show plan status")
    status_parser.add_argument("--plan-id")
    status_parser.add_argument("--compact", action="store_true", help="Show compact status for TUI")

    # render
    render_parser = subparsers.add_parser("render", help="Render plan")
    render_parser.add_argument("--plan-id")
    render_parser.add_argument("--format", choices=["mermaid", "ascii", "both"], default="both")

    # list
    subparsers.add_parser("list", help="List all plans")

    # reset
    reset_parser = subparsers.add_parser("reset", help="Reset plan")
    reset_parser.add_argument("--plan-id", required=True)
    reset_parser.add_argument("--task-id")
    reset_parser.add_argument("--note")

    # add-task
    add_task_parser = subparsers.add_parser("add-task", help="Add task to plan")
    add_task_parser.add_argument("--plan-id", required=True)
    add_task_parser.add_argument("--task-id", required=True)
    add_task_parser.add_argument("--label", required=True)
    add_task_parser.add_argument("--description")
    add_task_parser.add_argument("--output")
    add_task_parser.add_argument("--after")
    add_task_parser.add_argument("--before")
    add_task_parser.add_argument("--max-retries", type=int, default=3)
    add_task_parser.add_argument("--parent-id")

    # add-dep
    add_dep_parser = subparsers.add_parser("add-dep", help="Add dep to plan")
    add_dep_parser.add_argument("--plan-id", required=True)
    add_dep_parser.add_argument("--from", required=True, dest="from_task")
    add_dep_parser.add_argument("--to", required=True, dest="to_task")
    add_dep_parser.add_argument("--label")
    add_dep_parser.add_argument("--condition")
    add_dep_parser.add_argument("--is-fallback", action="store_true")

    # import - 从 Mermaid 导入
    import_parser = subparsers.add_parser("import", help="Import plan from Mermaid")
    import_parser.add_argument("--from-mermaid", help="Path to Mermaid file")
    import_parser.add_argument("--mermaid-string", help="Mermaid string directly")
    import_parser.add_argument("--id", required=True, help="Plan ID")
    import_parser.add_argument("--name", required=True, help="Plan name")
    import_parser.add_argument("--description", help="Plan description")

    args = parser.parse_args()

    engine = PlanEngine(args.state_dir)

    if args.command == "create":
        tasks = json.loads(args.tasks)
        dependencies = json.loads(args.dependencies)
        plan = engine.create_plan(
            args.id, args.name, tasks, dependencies, args.description
        )
        result = {
            "success": True,
            "message": f"Created plan: {plan.name}",
            "plan": plan.to_dict(),
            "ascii": engine.render_ascii(plan),
            "mermaid": engine.render_mermaid(plan),
        }

    elif args.command == "complete-task":
        plan = engine.read_plan(args.plan_id)
        if not plan:
            result = {"success": False, "error": f"Plan '{args.plan_id}' not found"}
        else:
            result = engine.complete_task(plan, args.note, args.branch)
            if result["success"]:
                result["ascii"] = engine.render_ascii(plan)

    elif args.command == "verify-task":
        plan = engine.read_plan(args.plan_id)
        if not plan:
            result = {"success": False, "error": f"Plan '{args.plan_id}' not found"}
        else:
            result = engine.verify_task(plan, args.result, args.note, args.branch)
            if result["success"]:
                result["ascii"] = engine.render_ascii(plan)
                if result.get("plan_complete"):
                    result["message"] = f'🎉 Plan "{plan.name}" complete!'

    elif args.command == "reject-task":
        plan = engine.read_plan(args.plan_id)
        if not plan:
            result = {"success": False, "error": f"Plan '{args.plan_id}' not found"}
        else:
            result = engine.reject_task(plan, args.note)
            if result["success"]:
                result["ascii"] = engine.render_ascii(plan)

    elif args.command == "fallback-task":
        plan = engine.read_plan(args.plan_id)
        if not plan:
            result = {"success": False, "error": f"Plan '{args.plan_id}' not found"}
        else:
            result = engine.fallback_task(plan, args.target, args.note)
            if result["success"]:
                result["ascii"] = engine.render_ascii(plan)

    elif args.command == "status":
        if args.plan_id:
            plan = engine.read_plan(args.plan_id)
            if not plan:
                result = {"success": False, "error": f"Plan '{args.plan_id}' not found"}
            else:
                progress = engine.compute_progress(plan)
                if args.compact:
                    # TUI compact mode
                    tui_status = engine.get_tui_status(plan)
                    result = {
                        "success": True,
                        "compact": tui_status["full"],
                        "progress": tui_status["progress_bar"],
                        "current": tui_status["current"],
                        "summary": tui_status["status_summary"],
                    }
                else:
                    result = {
                        "success": True,
                        "plan": plan.to_dict(),
                        "progress": progress,
                        "ascii": engine.render_ascii(plan),
                    }
        else:
            plans = engine.list_plans()
            result = {"success": True, "plans": plans}

    elif args.command == "render":
        if args.plan_id:
            plan = engine.read_plan(args.plan_id)
            if not plan:
                result = {"success": False, "error": f"Plan '{args.plan_id}' not found"}
            else:
                result = {"success": True}
                if args.format in ["mermaid", "both"]:
                    result["mermaid"] = engine.render_mermaid(plan)
                if args.format in ["ascii", "both"]:
                    result["ascii"] = engine.render_ascii(plan)
        else:
            result = {"success": False, "error": "Plan ID required"}

    elif args.command == "list":
        plans = engine.list_plans()
        result = {"success": True, "plans": plans}

    elif args.command == "reset":
        plan = engine.read_plan(args.plan_id)
        if not plan:
            result = {"success": False, "error": f"Plan '{args.plan_id}' not found"}
        else:
            result = engine.reset_plan(plan, args.task_id, args.note)
            if result["success"]:
                result["ascii"] = engine.render_ascii(engine.read_plan(args.plan_id))

    elif args.command == "add-task":
        plan = engine.read_plan(args.plan_id)
        if not plan:
            result = {"success": False, "error": f"Plan '{args.plan_id}' not found"}
        elif engine.get_task(plan, args.task_id):
            result = {"success": False, "error": f"Task '{args.task_id}' already exists"}
        else:
            task = Task(
                id=args.task_id,
                label=args.label,
                description=args.description,
                output=args.output,
                max_retries=args.max_retries,
                parent_id=args.parent_id,
            )
            plan.tasks.append(task)

            if args.after:
                existing = [e for e in plan.dependencies if e.from_task == args.after]
                for e in existing:
                    e.from_task = args.task_id
                plan.dependencies.append(Dependency(from_task=args.after, to_task=args.task_id))
            elif args.before:
                existing = [e for e in plan.dependencies if e.to_task == args.before]
                for e in existing:
                    e.to_task = args.task_id
                plan.dependencies.append(Dependency(from_task=args.task_id, to_task=args.before))

            engine.write_plan(plan)
            result = {
                "success": True,
                "message": f"Added task: {args.label}",
                "ascii": engine.render_ascii(plan),
            }

    elif args.command == "add-dep":
        plan = engine.read_plan(args.plan_id)
        if not plan:
            result = {"success": False, "error": f"Plan '{args.plan_id}' not found"}
        elif not engine.get_task(plan, args.from_task):
            result = {"success": False, "error": f"Source task '{args.from_task}' not found"}
        elif not engine.get_task(plan, args.to_task):
            result = {"success": False, "error": f"Target task '{args.to_task}' not found"}
        elif any(e for e in plan.dependencies if e.from_task == args.from_task and e.to_task == args.to_task):
            result = {"success": False, "error": f"Edge {args.from_task} → {args.to_task} already exists"}
        else:
            plan.dependencies.append(
                Dependency(
                    from_task=args.from_task,
                    to_task=args.to_task,
                    label=args.label,
                    condition=args.condition,
                    is_fallback=args.is_fallback,
                )
            )
            engine.write_plan(plan)
            result = {
                "success": True,
                "message": f"Added dep: {args.from_task} → {args.to_task}",
                "ascii": engine.render_ascii(plan),
            }

    elif args.command == "import":
        # 从 Mermaid 导入
        mermaid_content = None
        if args.from_mermaid:
            try:
                with open(args.from_mermaid, "r", encoding="utf-8") as f:
                    mermaid_content = f.read()
            except Exception as e:
                result = {"success": False, "error": f"Failed to read Mermaid file: {e}"}
        elif args.mermaid_string:
            mermaid_content = args.mermaid_string
        
        if mermaid_content:
            tasks, dependencies = engine.parse_plan(mermaid_content)
            if tasks:
                plan = engine.create_plan(
                    args.id, args.name,
                    tasks, dependencies,
                    args.description
                )
                result = {
                    "success": True,
                    "message": f"Imported plan: {args.name} ({len(tasks)} tasks, {len(dependencies)} dependencies)",
                    "plan": plan.to_dict(),
                    "ascii": engine.render_ascii(plan),
                    "mermaid": engine.render_mermaid(plan),
                }
            else:
                result = {"success": False, "error": "No tasks found in Mermaid content"}
        else:
            result = {"success": False, "error": "No Mermaid content provided"}

    else:
        result = {"success": False, "error": "No command specified"}

    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        if "compact" in result:
            print(result["compact"])
        elif "message" in result:
            print(result["message"])
        if "mermaid" in result:
            print("\n```mermaid")
            print(result["mermaid"])
            print("```")
        if "ascii" in result:
            print(result["ascii"])
        if "error" in result and not result.get("success"):
            print(f"Error: {result['error']}", file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()
