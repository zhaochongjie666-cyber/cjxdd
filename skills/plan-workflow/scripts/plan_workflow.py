#!/usr/bin/env python3
"""
Plan Workflow - Unified CLI for JSON plan design and execution.
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict


ROOT = Path(__file__).resolve().parents[3]
PLAN_CREATOR_DIR = ROOT / "skills" / "plan-creator" / "scripts"
PLAN_ENGINE_DIR = ROOT / "skills" / "plan-engine" / "scripts"

sys.path.insert(0, str(PLAN_CREATOR_DIR))
sys.path.insert(0, str(PLAN_ENGINE_DIR))

from plan_creator import PlanCreator, parse_plan_to_tasks  # type: ignore
from plan_engine import Dependency, PlanEngine, Task  # type: ignore


def load_json_file(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def build_plan_payload(result: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "title": result["title"],
        "tasks": result["tasks"],
        "dependencies": result["dependencies"],
    }


def format_plan_stats(tasks: list[Dict[str, Any]] | None, dependencies: list[Dict[str, Any]] | None) -> str | None:
    if tasks is None:
        return None
    return f"Tasks: {len(tasks)} | Dependencies: {len(dependencies or [])}"


def attach_summary(
    result: Dict[str, Any],
    action: str,
    *,
    plan_name: str | None = None,
    tasks: list[Dict[str, Any]] | None = None,
    dependencies: list[Dict[str, Any]] | None = None,
    saved: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    lines = [action if not plan_name else f"{action}: {plan_name}"]
    stats = format_plan_stats(tasks, dependencies)
    if stats:
        lines.append(stats)
    if saved:
        if saved.get("mermaid_file"):
            lines.append(f"Mermaid: {saved['mermaid_file']}")
        if saved.get("json_file"):
            lines.append(f"JSON plan: {saved['json_file']}")
    result["message"] = "\n".join(lines)
    return result


def attach_action_message(result: Dict[str, Any], action: str, lines: list[str]) -> Dict[str, Any]:
    result["message"] = "\n".join([action, *[line for line in lines if line]])
    return result


def print_result(result: Dict[str, Any], as_json: bool = False) -> None:
    if as_json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return

    if result.get("compact"):
        print(result["compact"])
        return

    if "message" in result:
        print(result["message"])

    if result.get("plan_payload"):
        print("\n📊 JSON plan:")
        print(json.dumps(result["plan_payload"], indent=2, ensure_ascii=False))

    if result.get("mermaid"):
        print("\n```mermaid")
        print(result["mermaid"])
        print("```")

    if result.get("ascii"):
        print(result["ascii"])

    if result.get("error") and not result.get("success"):
        print(f"Error: {result['error']}", file=sys.stderr)


def generate_plan(
    creator: PlanCreator,
    description: str | None,
    from_file: str | None,
    from_json: str | None,
    title: str,
    detailed: bool,
) -> Dict[str, Any]:
    if from_json:
        payload = load_json_file(from_json)
        return creator.generate_from_json_data(payload, detailed=detailed)

    if from_file:
        with open(from_file, "r", encoding="utf-8") as f:
            description = f.read()

    if not description:
        raise ValueError("No description provided")

    return creator.generate_from_description(description, title, detailed=detailed)


def save_outputs(
    creator: PlanCreator,
    result: Dict[str, Any],
    output: str | None,
    json_output: str | None,
    output_format: str,
) -> Dict[str, Any]:
    plan_payload = build_plan_payload(result)
    saved: Dict[str, Any] = {}

    if output and output_format in ("mermaid", "both"):
        saved["mermaid_file"] = str(creator.save_mermaid(result["mermaid"], output))

    if json_output:
        saved["json_file"] = str(creator.save_json(plan_payload, json_output))

    return saved


def create_plan_from_payload(
    engine: PlanEngine,
    plan_id: str,
    name: str,
    description: str | None,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    plan = engine.create_plan(
        plan_id,
        name,
        payload["tasks"],
        payload.get("dependencies", []),
        description,
    )
    return {
        "success": True,
        "plan": plan.to_dict(),
        "ascii": engine.render_ascii(plan),
        "mermaid": engine.render_mermaid(plan),
    }


def create_from_mermaid(engine: PlanEngine, mermaid_path: str, plan_id: str, name: str, description: str | None) -> Dict[str, Any]:
    with open(mermaid_path, "r", encoding="utf-8") as f:
        mermaid = f.read()
    tasks, dependencies = engine.parse_plan(mermaid)
    return create_plan_from_payload(
        engine,
        plan_id,
        name,
        description,
        {"tasks": tasks, "dependencies": dependencies},
    )


def parse_mermaid(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    tasks, dependencies = parse_plan_to_tasks(content)
    return {"success": True, "tasks": tasks, "dependencies": dependencies}


def read_plan_or_error(engine: PlanEngine, plan_id: str) -> tuple[Any, Dict[str, Any] | None]:
    plan = engine.read_plan(plan_id)
    if not plan:
        return None, {"success": False, "error": f"Plan '{plan_id}' not found"}
    return plan, None


def payload_from_sources(
    creator: PlanCreator,
    description: str | None = None,
    from_file: str | None = None,
    from_json: str | None = None,
    from_mermaid: str | None = None,
    title: str = "",
    detailed: bool = False,
) -> Dict[str, Any]:
    if from_json or from_file or description:
        result = generate_plan(creator, description, from_file, from_json, title, detailed)
        return build_plan_payload(result)

    if from_mermaid:
        parsed = parse_mermaid(from_mermaid)
        return {
            "title": title or Path(from_mermaid).stem,
            "tasks": parsed["tasks"],
            "dependencies": parsed["dependencies"],
        }

    raise ValueError("No plan source provided")


def main() -> None:
    parser = argparse.ArgumentParser(description="Plan Workflow - unified JSON plan CLI")
    parser.add_argument("--state-dir", default=".opencode/plan", help="Plan engine state directory")
    parser.add_argument("--output-dir", default=".", help="Output directory for generated files")

    subparsers = parser.add_subparsers(dest="command", help="Commands")

    generate_parser = subparsers.add_parser("generate", help="Generate JSON plan and/or Mermaid")
    generate_parser.add_argument("--description")
    generate_parser.add_argument("--from-file")
    generate_parser.add_argument("--from-json")
    generate_parser.add_argument("--title", default="")
    generate_parser.add_argument("--output")
    generate_parser.add_argument("--json-output")
    generate_parser.add_argument("--format", choices=["mermaid", "json", "both"], default="json")
    generate_parser.add_argument("--detailed", action="store_true")
    generate_parser.add_argument("--json", action="store_true", default=None, help="Output JSON")

    start_parser = subparsers.add_parser("start", help="Generate a plan and create executable state")
    start_parser.add_argument("--plan-id", required=True)
    start_parser.add_argument("--name")
    start_parser.add_argument("--description")
    start_parser.add_argument("--from-file")
    start_parser.add_argument("--from-json")
    start_parser.add_argument("--title", default="")
    start_parser.add_argument("--output")
    start_parser.add_argument("--json-output")
    start_parser.add_argument("--format", choices=["mermaid", "json", "both"], default="both")
    start_parser.add_argument("--detailed", action="store_true")
    start_parser.add_argument("--json", action="store_true", default=None, help="Output JSON")

    create_parser = subparsers.add_parser("create", help="Create executable plan state from JSON or Mermaid")
    create_parser.add_argument("--plan-id", required=True)
    create_parser.add_argument("--name", required=True)
    create_parser.add_argument("--description")
    create_parser.add_argument("--from-json")
    create_parser.add_argument("--from-mermaid")
    create_parser.add_argument("--tasks")
    create_parser.add_argument("--dependencies", default="[]")
    create_parser.add_argument("--json", action="store_true", default=None, help="Output JSON")

    import_parser = subparsers.add_parser("import", help="Import plan from Mermaid or JSON")
    import_parser.add_argument("--plan-id", required=True)
    import_parser.add_argument("--name", required=True)
    import_parser.add_argument("--description")
    import_parser.add_argument("--from-json")
    import_parser.add_argument("--from-mermaid")
    import_parser.add_argument("--json", action="store_true", default=None, help="Output JSON")

    parse_parser = subparsers.add_parser("parse", help="Parse Mermaid to JSON plan payload")
    parse_parser.add_argument("--file", required=True)
    parse_parser.add_argument("--json", action="store_true", default=None, help="Output JSON")

    status_parser = subparsers.add_parser("status", help="Show plan status")
    status_parser.add_argument("--plan-id")
    status_parser.add_argument("--compact", action="store_true")
    status_parser.add_argument("--json", action="store_true", default=None, help="Output JSON")

    complete_parser = subparsers.add_parser("complete-task", help="Complete current task")
    complete_parser.add_argument("--plan-id", required=True)
    complete_parser.add_argument("--note")
    complete_parser.add_argument("--branch")
    complete_parser.add_argument("--json", action="store_true", default=None, help="Output JSON")

    verify_parser = subparsers.add_parser("verify-task", help="Verify current task")
    verify_parser.add_argument("--plan-id", required=True)
    verify_parser.add_argument("--result", required=True, choices=["passed", "rejected"])
    verify_parser.add_argument("--note", required=True)
    verify_parser.add_argument("--branch")
    verify_parser.add_argument("--json", action="store_true", default=None, help="Output JSON")

    reject_parser = subparsers.add_parser("reject-task", help="Reject current task")
    reject_parser.add_argument("--plan-id", required=True)
    reject_parser.add_argument("--note", required=True)
    reject_parser.add_argument("--json", action="store_true", default=None, help="Output JSON")

    fallback_parser = subparsers.add_parser("fallback-task", help="Fallback to previous or target task")
    fallback_parser.add_argument("--plan-id", required=True)
    fallback_parser.add_argument("--target")
    fallback_parser.add_argument("--note")
    fallback_parser.add_argument("--json", action="store_true", default=None, help="Output JSON")

    reset_parser = subparsers.add_parser("reset", help="Reset whole plan or one task")
    reset_parser.add_argument("--plan-id", required=True)
    reset_parser.add_argument("--task-id")
    reset_parser.add_argument("--note")
    reset_parser.add_argument("--json", action="store_true", default=None, help="Output JSON")

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
    add_task_parser.add_argument("--json", action="store_true", default=None, help="Output JSON")

    add_dep_parser = subparsers.add_parser("add-dep", help="Add dependency to plan")
    add_dep_parser.add_argument("--plan-id", required=True)
    add_dep_parser.add_argument("--from", required=True, dest="from_task")
    add_dep_parser.add_argument("--to", required=True, dest="to_task")
    add_dep_parser.add_argument("--label")
    add_dep_parser.add_argument("--condition")
    add_dep_parser.add_argument("--is-fallback", action="store_true")
    add_dep_parser.add_argument("--json", action="store_true", default=None, help="Output JSON")

    replan_parser = subparsers.add_parser("replan", help="Replace unfinished tasks with a new plan")
    replan_parser.add_argument("--plan-id", required=True)
    replan_parser.add_argument("--reason", required=True)
    replan_parser.add_argument("--description")
    replan_parser.add_argument("--from-file")
    replan_parser.add_argument("--from-json")
    replan_parser.add_argument("--from-mermaid")
    replan_parser.add_argument("--title", default="")
    replan_parser.add_argument("--detailed", action="store_true")
    replan_parser.add_argument("--json", action="store_true", default=None, help="Output JSON")

    render_parser = subparsers.add_parser("render", help="Render plan")
    render_parser.add_argument("--plan-id", required=True)
    render_parser.add_argument("--format", choices=["mermaid", "ascii", "both"], default="both")
    render_parser.add_argument("--json", action="store_true", default=None, help="Output JSON")

    list_parser = subparsers.add_parser("list", help="List plans")
    list_parser.add_argument("--json", action="store_true", default=None, help="Output JSON")

    args = parser.parse_args()

    creator = PlanCreator(args.output_dir)
    engine = PlanEngine(args.state_dir)
    result: Dict[str, Any]

    if args.command == "generate":
        generated = generate_plan(creator, args.description, args.from_file, args.from_json, args.title, args.detailed)
        result = {"success": True, "plan_payload": build_plan_payload(generated)}
        if args.format in ("mermaid", "both") and generated.get("mermaid"):
            result["mermaid"] = generated["mermaid"]
        saved = save_outputs(creator, generated, args.output, args.json_output, args.format)
        attach_summary(
            result,
            "Generated plan",
            plan_name=generated["title"],
            tasks=generated["tasks"],
            dependencies=generated["dependencies"],
            saved=saved,
        )

    elif args.command == "start":
        generated = generate_plan(creator, args.description, args.from_file, args.from_json, args.title, args.detailed)
        payload = build_plan_payload(generated)
        plan_name = args.name or generated["title"] or args.plan_id
        created = create_plan_from_payload(engine, args.plan_id, plan_name, None, payload)
        result = {
            "success": True,
            "plan_payload": payload,
            "plan": created["plan"],
            "ascii": created["ascii"],
        }
        if args.format in ("mermaid", "both") and generated.get("mermaid"):
            result["mermaid"] = generated["mermaid"]
        saved = save_outputs(creator, generated, args.output, args.json_output, args.format)
        attach_summary(
            result,
            "Started plan",
            plan_name=plan_name,
            tasks=payload["tasks"],
            dependencies=payload["dependencies"],
            saved=saved,
        )

    elif args.command == "create":
        if args.from_json:
            payload = load_json_file(args.from_json)
            result = create_plan_from_payload(engine, args.plan_id, args.name, args.description, payload)
        elif args.from_mermaid:
            result = create_from_mermaid(engine, args.from_mermaid, args.plan_id, args.name, args.description)
        elif args.tasks:
            payload = {"tasks": json.loads(args.tasks), "dependencies": json.loads(args.dependencies)}
            result = create_plan_from_payload(engine, args.plan_id, args.name, args.description, payload)
        else:
            raise ValueError("create requires --from-json, --from-mermaid, or --tasks")
        if result.get("success"):
            attach_summary(
                result,
                "Created executable plan",
                plan_name=args.name,
                tasks=result["plan"]["tasks"],
                dependencies=result["plan"]["dependencies"],
            )

    elif args.command == "import":
        if args.from_json:
            payload = load_json_file(args.from_json)
            result = create_plan_from_payload(engine, args.plan_id, args.name, args.description, payload)
            if result.get("success"):
                attach_summary(
                    result,
                    "Imported plan",
                    plan_name=args.name,
                    tasks=payload["tasks"],
                    dependencies=payload.get("dependencies", []),
                )
        elif args.from_mermaid:
            with open(args.from_mermaid, "r", encoding="utf-8") as f:
                mermaid = f.read()
            tasks, dependencies = engine.parse_plan(mermaid)
            if tasks:
                result = create_plan_from_payload(
                    engine,
                    args.plan_id,
                    args.name,
                    args.description,
                    {"tasks": tasks, "dependencies": dependencies},
                )
                attach_summary(
                    result,
                    "Imported plan",
                    plan_name=args.name,
                    tasks=tasks,
                    dependencies=dependencies,
                )
            else:
                result = {"success": False, "error": "No tasks found in Mermaid content"}
        else:
            raise ValueError("import requires --from-json or --from-mermaid")

    elif args.command == "parse":
        result = parse_mermaid(args.file)
        attach_summary(
            result,
            "Parsed Mermaid",
            plan_name=Path(args.file).name,
            tasks=result["tasks"],
            dependencies=result["dependencies"],
        )

    elif args.command == "status":
        if args.plan_id:
            plan = engine.read_plan(args.plan_id)
            if not plan:
                result = {"success": False, "error": f"Plan '{args.plan_id}' not found"}
            elif args.compact:
                tui = engine.get_tui_status(plan)
                result = {
                    "success": True,
                    "compact": tui["full"],
                    "progress": tui["progress_bar"],
                    "current": tui["current"],
                    "summary": tui["status_summary"],
                }
            else:
                result = {
                    "success": True,
                    "plan": plan.to_dict(),
                    "progress": engine.compute_progress(plan),
                    "ascii": engine.render_ascii(plan),
                }
        else:
            result = {"success": True, "plans": engine.list_plans()}

    elif args.command == "complete-task":
        plan, error = read_plan_or_error(engine, args.plan_id)
        if error:
            result = error
        else:
            result = engine.complete_task(plan, args.note, args.branch)
            if result.get("success"):
                result["ascii"] = engine.render_ascii(plan)
                attach_action_message(
                    result,
                    "Updated task state",
                    [
                        f"Task: {result['task']['label']}",
                        "State: verifying",
                    ],
                )

    elif args.command == "verify-task":
        plan, error = read_plan_or_error(engine, args.plan_id)
        if error:
            result = error
        else:
            result = engine.verify_task(plan, args.result, args.note, args.branch)
            if result.get("success"):
                result["ascii"] = engine.render_ascii(plan)
                if result.get("rejected"):
                    attach_action_message(
                        result,
                        "Verification rejected",
                        [
                            f"Reason: {result.get('reason', args.note)}",
                        ],
                    )
                else:
                    next_task = result.get("next_task")
                    attach_action_message(
                        result,
                        "Verified task",
                        [
                            f"Result: passed",
                            f"Next: {next_task['label']} ({next_task['task_id']})" if next_task else "Plan complete",
                        ],
                    )

    elif args.command == "reject-task":
        plan, error = read_plan_or_error(engine, args.plan_id)
        if error:
            result = error
        else:
            result = engine.reject_task(plan, args.note)
            if result.get("success"):
                result["ascii"] = engine.render_ascii(plan)
                attach_action_message(
                    result,
                    "Rejected task",
                    [
                        f"Task: {result['task']['label']}",
                        f"Reason: {result['reason']}",
                        f"Retry: {result['retry_count']}/{result['max_retries']}",
                    ],
                )

    elif args.command == "fallback-task":
        plan, error = read_plan_or_error(engine, args.plan_id)
        if error:
            result = error
        else:
            result = engine.fallback_task(plan, args.target, args.note)
            if result.get("success"):
                result["ascii"] = engine.render_ascii(plan)
                attach_action_message(
                    result,
                    "Applied fallback",
                    [
                        f"From: {result['from']}",
                        f"To: {result['to']}",
                    ],
                )

    elif args.command == "reset":
        plan, error = read_plan_or_error(engine, args.plan_id)
        if error:
            result = error
        else:
            result = engine.reset_plan(plan, args.task_id, args.note)
            if result.get("success"):
                refreshed = engine.read_plan(args.plan_id)
                if refreshed:
                    result["ascii"] = engine.render_ascii(refreshed)
                attach_action_message(
                    result,
                    "Reset plan state",
                    [
                        f"Target: {args.task_id or 'all tasks'}",
                    ],
                )

    elif args.command == "add-task":
        plan, error = read_plan_or_error(engine, args.plan_id)
        if error:
            result = error
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
                for edge in existing:
                    edge.from_task = args.task_id
                plan.dependencies.append(Dependency(from_task=args.after, to_task=args.task_id))
            elif args.before:
                existing = [e for e in plan.dependencies if e.to_task == args.before]
                for edge in existing:
                    edge.to_task = args.task_id
                plan.dependencies.append(Dependency(from_task=args.task_id, to_task=args.before))

            engine.write_plan(plan)
            result = {
                "success": True,
                "ascii": engine.render_ascii(plan),
            }
            attach_summary(result, "Added task", plan_name=args.label)

    elif args.command == "add-dep":
        plan, error = read_plan_or_error(engine, args.plan_id)
        if error:
            result = error
        elif not engine.get_task(plan, args.from_task):
            result = {"success": False, "error": f"Source task '{args.from_task}' not found"}
        elif not engine.get_task(plan, args.to_task):
            result = {"success": False, "error": f"Target task '{args.to_task}' not found"}
        elif any(edge for edge in plan.dependencies if edge.from_task == args.from_task and edge.to_task == args.to_task):
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
                "ascii": engine.render_ascii(plan),
            }
            attach_summary(result, "Added dependency", plan_name=f"{args.from_task} → {args.to_task}")

    elif args.command == "replan":
        plan, error = read_plan_or_error(engine, args.plan_id)
        if error:
            result = error
        else:
            payload = payload_from_sources(
                creator,
                description=args.description,
                from_file=args.from_file,
                from_json=args.from_json,
                from_mermaid=args.from_mermaid,
                title=args.title,
                detailed=args.detailed,
            )
            replanned = engine.replan(plan, args.reason, payload["tasks"], payload.get("dependencies", []))
            result = {
                "success": True,
                "reason": args.reason,
                "plan": replanned.to_dict(),
                "plan_payload": payload,
                "ascii": engine.render_ascii(replanned),
                "mermaid": engine.render_mermaid(replanned),
            }
            attach_summary(
                result,
                "Replanned",
                plan_name=replanned.name,
                tasks=payload["tasks"],
                dependencies=payload.get("dependencies", []),
            )

    elif args.command == "render":
        plan, error = read_plan_or_error(engine, args.plan_id)
        if error:
            result = error
        else:
            result = {"success": True}
            if args.format in ("mermaid", "both"):
                result["mermaid"] = engine.render_mermaid(plan)
            if args.format in ("ascii", "both"):
                result["ascii"] = engine.render_ascii(plan)

    elif args.command == "list":
        result = {"success": True, "plans": engine.list_plans()}

    else:
        parser.print_help()
        return

    print_result(result, bool(getattr(args, "json", False)))
    if result.get("error") and not result.get("success"):
        sys.exit(1)


if __name__ == "__main__":
    main()
