#!/usr/bin/env python3
"""
Initialize an orchestrated task plan from a natural language task.
"""

import argparse
import json
import re
from copy import deepcopy
from pathlib import Path
from typing import Any
import subprocess


ROOT = Path(__file__).resolve().parents[3]
TEMPLATE_DIR = ROOT / "plans" / "templates"
INSTANCE_DIR = ROOT / "plans" / "instances"
PLAN_WORKFLOW = ROOT / "skills" / "plan-workflow" / "scripts" / "plan_workflow.py"


TYPE_CHOICES = ("feature", "bugfix", "small-task", "research")


def slugify(value: str) -> str:
    normalized = value.strip().lower()
    normalized = normalized.replace("_", "-")
    normalized = re.sub(r"[^a-z0-9\u4e00-\u9fff-]+", "-", normalized)
    normalized = re.sub(r"-+", "-", normalized).strip("-")
    return normalized[:48] or "task"


def detect_type(task: str) -> str:
    text = task.lower()
    research_keywords = [
        "research", "investigate", "evaluate", "compare", "feasibility",
        "调研", "研究", "评估", "选型", "方案", "比较",
    ]
    bugfix_keywords = [
        "bug", "fix", "error", "issue", "regression", "broken",
        "修复", "报错", "问题", "异常", "回归", "故障",
    ]
    small_keywords = [
        "small", "minor", "tiny", "simple", "quick", "half-day",
        "小改", "微调", "简单", "小任务", "半天",
    ]

    if any(keyword in text for keyword in research_keywords):
        return "research"
    if any(keyword in text for keyword in bugfix_keywords):
        return "bugfix"
    if any(keyword in text for keyword in small_keywords):
        return "small-task"
    return "feature"


def load_template(plan_type: str) -> dict[str, Any]:
    path = TEMPLATE_DIR / f"{plan_type}.json"
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def build_output_path(plan_slug: str, task_id: str, output: str) -> str:
    if output == "code changes":
        return output
    if output in {"test results", "regression results", "verification result"}:
        return f"artifacts/{plan_slug}/{task_id}.md"
    if output.endswith(".md"):
        return output.replace("feature-name", plan_slug).replace("task-name", plan_slug)
    return f"docs/{plan_slug}/{task_id}.md"


def expand_task_fields(plan: dict[str, Any], raw_task: str, plan_slug: str, plan_type: str) -> dict[str, Any]:
    expanded = deepcopy(plan)
    expanded["title"] = plan_slug
    expanded["goal"] = raw_task.strip()
    expanded["source_task"] = raw_task.strip()
    expanded["orchestration"] = {
        "type": plan_type,
        "coordinator": "task-orchestrator",
        "planner": "task-orchestrator/planner",
        "executor_rule_prompt": "prompts/ai-execution-prompt.md",
    }

    for task in expanded.get("tasks", []):
        task_id = task["id"]
        task["output"] = build_output_path(plan_slug, task_id, task.get("output", ""))
        task["description"] = f"{task['description']} 本次任务上下文：{raw_task.strip()}"

    return expanded


def write_instance(plan_id: str, payload: dict[str, Any]) -> Path:
    INSTANCE_DIR.mkdir(parents=True, exist_ok=True)
    path = INSTANCE_DIR / f"{plan_id}.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")
    return path


def create_execution_state(plan_id: str, plan_name: str, plan_path: Path) -> subprocess.CompletedProcess[str]:
    cmd = [
        "python",
        str(PLAN_WORKFLOW),
        "create",
        "--plan-id",
        plan_id,
        "--name",
        plan_name,
        "--from-json",
        str(plan_path),
        "--json",
    ]
    return subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True, check=False)


def main() -> None:
    parser = argparse.ArgumentParser(description="Initialize an orchestrated plan from natural language")
    parser.add_argument("--task", required=True, help="Natural language task")
    parser.add_argument("--plan-id", help="Stable plan id / instance filename stem")
    parser.add_argument("--title", help="Override plan title")
    parser.add_argument(
        "--type",
        default="auto",
        choices=("auto", "feature", "bugfix", "small-task", "research"),
        help="Plan template type",
    )
    parser.add_argument("--execute", action="store_true", help="Create execution state after generating plan")
    args = parser.parse_args()

    plan_type = detect_type(args.task) if args.type == "auto" else args.type
    plan_id = args.plan_id or slugify(args.title or args.task)
    title = args.title or plan_id

    template = load_template(plan_type)
    payload = expand_task_fields(template, args.task, title, plan_type)
    payload["title"] = title

    path = write_instance(plan_id, payload)

    result: dict[str, Any] = {
        "success": True,
        "plan_type": plan_type,
        "plan_id": plan_id,
        "plan_path": str(path.relative_to(ROOT)),
        "title": title,
        "message": f"Generated orchestrated plan: {plan_id}",
    }

    if args.execute:
        completed = create_execution_state(plan_id, title, path)
        result["execute"] = {
            "returncode": completed.returncode,
            "stdout": completed.stdout.strip(),
            "stderr": completed.stderr.strip(),
            "success": completed.returncode == 0,
        }

    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
