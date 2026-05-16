#!/usr/bin/env python3
"""
Plan Creator - 计划生成工具
从自然语言描述生成可执行的任务计划
"""

import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple
from dataclasses import dataclass
import argparse


@dataclass
class TaskStep:
    """任务步骤"""
    task_id: str
    label: str
    description: str = ""
    output: str = ""
    checkpoint: str = ""  # 质量检查点
    max_retries: int = 3


def generate_task_id(label: str) -> str:
    """从标签生成任务 ID"""
    ascii_label = unicodedata.normalize("NFKD", label).encode("ascii", "ignore").decode("ascii")
    id_str = re.sub(r'[^a-zA-Z0-9\s_-]', '', ascii_label)
    id_str = re.sub(r'\s+', '-', id_str.strip()).strip("-_").lower()
    return id_str[:20] or "task"


def extract_tasks_from_description(description: str) -> List[TaskStep]:
    """从描述中提取任务"""
    steps = []
    
    # 首先尝试按数字序号分割（支持中英文序号）
    # 模式：1. xxx 或 1、xxx 或 第1步 xxx 或 步骤1 xxx
    # 匹配：数字[.、:空格]内容，直到下一个数字或结束
    numbered_pattern = r'(?:^|[\s\：\:])?(?:第?\s*步骤?\s*)?(\d+)[\.\、\.\:\s]+([^\d\n]+?)(?=(?:[\s\：\:](?:第?\s*步骤?\s*)?\d+[\.\、\.\:\s]+)|(?:\s*$))'
    matches = re.findall(numbered_pattern, description, re.MULTILINE)
    
    if matches:
        for num, label in matches:
            label = label.strip()
            if label:
                step_id = generate_task_id(label)
                steps.append(TaskStep(
                    task_id=f"step{num}-{step_id}",
                    label=label[:50],
                    description=label
                ))
        return steps
    
    # 如果没有数字序号，尝试按行分割
    step_keywords = [
        r'[-•]\s*(.+)',  # - xxx 或 • xxx
        r'([\u4e00-\u9fa5]{2,}?)[:\s]+(.+)',  # 中文关键词: xxx
    ]
    
    lines = description.split('\n')
    step_num = 0
    
    for line in lines:
        line = line.strip()
        if not line or len(line) < 3:
            continue
        
        matched = False
        
        # 尝试匹配模式
        for pattern in step_keywords:
            match = re.match(pattern, line)
            if match:
                if len(match.groups()) == 2:
                    label = f"{match.group(1).strip()}: {match.group(2).strip()}"
                else:
                    label = match.group(1).strip()
                
                step_num += 1
                step_id = generate_task_id(label)
                steps.append(TaskStep(
                    task_id=f"step{step_num}-{step_id}",
                    label=label[:50],
                    description=line
                ))
                matched = True
                break
        
        if not matched:
            # 如果没有匹配到，整行作为一个步骤
            step_num += 1
            step_id = generate_task_id(line)
            steps.append(TaskStep(
                task_id=f"step{step_num}-{step_id}",
                label=line[:50],
                description=line
            ))
    
    return steps


def generate_plan_visualization(steps: List[TaskStep], title: str = "") -> str:
    """生成 Mermaid 流程图"""
    lines = ["flowchart TD"]
    
    if title:
        lines.append(f"    %% {title}")
    
    # 添加节点
    for i, step in enumerate(steps):
        # 转义特殊字符
        label = step.label.replace('"', '\\"')
        lines.append(f'    {step.task_id}["{label}"]')
    
    lines.append("")
    
    for i in range(len(steps) - 1):
        lines.append(f"    {steps[i].task_id} --> {steps[i+1].task_id}")
    
    return "\n".join(lines)


def generate_detailed_plan(steps: List[TaskStep], title: str = "") -> str:
    """生成带详细信息的 Mermaid 流程图（Plan Engine 兼容格式）"""
    lines = ["flowchart TD"]
    
    if title:
        lines.append(f"    %% {title}")
    
    icons = ["🔍", "📐", "⚡", "🧪", "🚀", "✅", "📝", "🎯", "🔧", "📊"]
    
    # 添加节点
    for i, step in enumerate(steps):
        icon = icons[i % len(icons)]
        label = step.label.replace('"', '\\"')
        desc = step.description[:50].replace('"', '\\"') if step.description else ""
        
        if desc:
            node_label = f"{icon} {label}<br/>{desc}"
        else:
            node_label = f"{icon} {label}"
        
        lines.append(f'    {step.task_id}["{node_label}"]')
    
    lines.append("")
    
    for i in range(len(steps) - 1):
        lines.append(f"    {steps[i].task_id} --> {steps[i+1].task_id}")
    
    lines.append("")
    lines.append("    %% @plan-engine")
    for i, step in enumerate(steps):
        if step.output:
            lines.append(f"    %% @output {step.task_id}: {step.output}")
    
    return "\n".join(lines)


def parse_plan_to_tasks(mermaid_content: str) -> Tuple[List[Dict], List[Dict]]:
    """解析 Mermaid 为 Plan Engine 格式"""
    nodes = []
    edges = []
    node_ids = set()
    node_id_pattern = r'([^\s\[\]\{\}\(\)\|">]+)'
    
    for line in mermaid_content.split('\n'):
        line = line.strip()
        if not line or line.startswith('%%') or line.startswith('flowchart'):
            continue
        
        # 解析节点: A[标签] 或 A["标签"]
        node_patterns = [
            rf'{node_id_pattern}\["([^"]+)"\]',
            rf'{node_id_pattern}\[([^\]]+)\]',
        ]
        
        for pattern in node_patterns:
            matches = re.findall(pattern, line)
            for match in matches:
                node_id, label = match
                if node_id not in node_ids:
                    # 清理标签中的 HTML
                    clean_label = re.sub(r'<[^>]+>', '', label)
                    nodes.append({
                        "task_id": node_id,
                        "label": clean_label.strip(),
                        "description": "",
                        "max_retries": 3
                    })
                    node_ids.add(node_id)
        
        # 解析边
        edge_patterns = [
            (rf'{node_id_pattern}\s*-\.-*>\s*\|([^|]*)\|\s*{node_id_pattern}', True),
            (rf'{node_id_pattern}\s*-\.-*>\s*{node_id_pattern}', True),
            (rf'{node_id_pattern}\s*-->\s*\|([^|]*)\|\s*{node_id_pattern}', False),
            (rf'{node_id_pattern}\s*-->\s*{node_id_pattern}', False),
        ]
        
        for pattern, is_fallback in edge_patterns:
            match = re.search(pattern, line)
            if match:
                groups = match.groups()
                if len(groups) == 3:
                    from_node, label, to_node = groups
                else:
                    from_node, to_node = groups
                    label = ""
                
                edges.append({
                    "from": from_node,
                    "to": to_node,
                    "label": label.strip() if label else None,
                    "is_fallback": is_fallback
                })
                break
    
    return nodes, edges


def enhance_task_description(description: str) -> str:
    """增强描述，添加更多细节"""
    enhancements = {
        "需求分析": "阅读PRD文档，理解功能需求，记录疑问点",
        "架构设计": "设计数据库表结构，API接口规范，系统架构",
        "代码实现": "编写代码实现功能，遵循编码规范",
        "测试验证": "编写单元测试和集成测试，确保代码质量",
        "部署上线": "部署到测试环境和生产环境",
        "需求": "分析和确认需求细节",
        "设计": "设计技术方案",
        "实现": "编写代码",
        "测试": "验证功能正确性",
        "部署": "发布到生产环境",
    }
    
    for key, value in enhancements.items():
        if key in description:
            return f"{description}：{value}"
    
    return description


def build_plan_payload(
    steps: List[TaskStep],
    title: str = "",
    dependencies: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """构造标准 JSON plan 载荷。"""
    tasks = [
        {
            "id": s.task_id,
            "label": s.label,
            "description": s.description,
            "output": s.output or None,
            "checkpoint": s.checkpoint or None,
            "max_retries": s.max_retries,
        }
        for s in steps
    ]

    if dependencies is None:
        dependencies = []
        for i in range(len(steps) - 1):
            dependencies.append({"from": steps[i].task_id, "to": steps[i + 1].task_id})

    return {
        "title": title or "Flow",
        "steps": len(steps),
        "tasks": tasks,
        "dependencies": dependencies,
    }


def load_steps_from_json_payload(payload: Dict[str, Any]) -> Tuple[List[TaskStep], List[Dict[str, Any]], str]:
    """从 JSON 载荷加载步骤。支持 tasks/steps/description 三种入口。"""
    title = payload.get("title") or payload.get("name") or ""
    dependencies = payload.get("dependencies") or payload.get("edges")

    if payload.get("tasks"):
        steps = []
        for idx, task in enumerate(payload["tasks"], start=1):
            label = task.get("label") or task.get("name") or f"Step {idx}"
            task_id = task.get("id") or task.get("task_id") or f"step{idx}-{generate_task_id(label)}"
            steps.append(TaskStep(
                task_id=task_id,
                label=label[:50],
                description=task.get("description") or label,
                output=task.get("output") or task.get("artifact") or "",
                checkpoint=task.get("checkpoint") or "",
                max_retries=int(task.get("max_retries", 3)),
            ))
        return steps, dependencies or [], title

    if payload.get("steps"):
        steps = []
        for idx, step in enumerate(payload["steps"], start=1):
            if isinstance(step, str):
                label = step.strip()
                step_data = {}
            else:
                step_data = step
                label = step.get("label") or step.get("name") or step.get("description") or f"Step {idx}"

            task_id = step_data.get("id") or step_data.get("task_id") or f"step{idx}-{generate_task_id(label)}"
            steps.append(TaskStep(
                task_id=task_id,
                label=label[:50],
                description=step_data.get("description") or label,
                output=step_data.get("output") or "",
                checkpoint=step_data.get("checkpoint") or "",
                max_retries=int(step_data.get("max_retries", 3)),
            ))
        return steps, dependencies or [], title

    if payload.get("description"):
        steps = extract_tasks_from_description(payload["description"])
        return steps, dependencies or [], title

    raise ValueError("JSON payload must contain one of: tasks, steps, or description")


class PlanCreator:
    """计划生成器"""
    
    def __init__(self, output_dir: str = "."):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
    
    def generate_from_description(
        self,
        description: str,
        title: str = "",
        detailed: bool = True
    ) -> Dict[str, Any]:
        """从描述生成流程图"""
        steps = extract_tasks_from_description(description)
        
        if not steps:
            return {"success": False, "error": "No steps found in description"}
        
        for step in steps:
            step.description = enhance_task_description(step.label)
        
        if detailed:
            mermaid = generate_detailed_plan(steps, title)
        else:
            mermaid = generate_plan_visualization(steps, title)

        payload = build_plan_payload(steps, title)
        return {"success": True, "mermaid": mermaid, **payload}

    def generate_from_json_data(
        self,
        payload: Dict[str, Any],
        detailed: bool = True,
    ) -> Dict[str, Any]:
        """从 JSON 计划载荷生成 Mermaid 和标准任务结构。"""
        steps, dependencies, title = load_steps_from_json_payload(payload)

        if not steps:
            return {"success": False, "error": "No steps found in JSON payload"}

        for step in steps:
            if not step.description:
                step.description = enhance_task_description(step.label)

        if detailed:
            mermaid = generate_detailed_plan(steps, title)
        else:
            mermaid = generate_plan_visualization(steps, title)

        plan_payload = build_plan_payload(steps, title, dependencies or None)
        return {"success": True, "mermaid": mermaid, **plan_payload}

    def save_mermaid(self, content: str, filename: str) -> Path:
        """保存 Mermaid 文件"""
        filepath = self.output_dir / filename
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        return filepath

    def save_json(self, payload: Dict[str, Any], filename: str) -> Path:
        """保存 JSON 计划文件。"""
        filepath = self.output_dir / filename
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
            f.write("\n")
        return filepath


def main():
    parser = argparse.ArgumentParser(description="Plan Creator - Generate task plans from descriptions")
    parser.add_argument("--output-dir", default=".", help="Output directory")
    
    subparsers = parser.add_subparsers(dest="command", help="Commands")
    
    # generate
    generate_parser = subparsers.add_parser("generate", help="Generate Mermaid from description")
    generate_parser.add_argument("--description", help="Flow description")
    generate_parser.add_argument("--from-file", help="Read description from file")
    generate_parser.add_argument("--from-json", help="Read JSON plan payload from file")
    generate_parser.add_argument("--title", default="", help="Flow title")
    generate_parser.add_argument("--output", "-o", help="Output file")
    generate_parser.add_argument("--json-output", help="Write JSON plan payload to file")
    generate_parser.add_argument("--format", choices=["mermaid", "json", "both"], default="mermaid", help="Output format")
    generate_parser.add_argument("--detailed", action="store_true", help="Generate detailed format")
    generate_parser.add_argument("--to-plan-engine", action="store_true", help="Output plan-engine format")
    generate_parser.add_argument("--plan-id", help="Plan ID (enables auto-import into plan-engine)")
    
    # parse
    parse_parser = subparsers.add_parser("parse", help="Parse existing Mermaid")
    parse_parser.add_argument("--file", required=True, help="Mermaid file to parse")
    parse_parser.add_argument("--json", action="store_true", help="Print parsed result as JSON")
    
    args = parser.parse_args()
    
    creator = PlanCreator(args.output_dir)
    
    if args.command == "generate":
        result = None

        if args.from_json:
            try:
                with open(args.from_json, "r", encoding="utf-8") as f:
                    payload = json.load(f)
                result = creator.generate_from_json_data(payload, args.detailed)
            except Exception as e:
                print(f"Error reading JSON file: {e}", file=sys.stderr)
                sys.exit(1)

        else:
            description = args.description
            if args.from_file:
                try:
                    with open(args.from_file, "r", encoding="utf-8") as f:
                        description = f.read()
                except Exception as e:
                    print(f"Error reading file: {e}", file=sys.stderr)
                    sys.exit(1)

            if not description:
                print("Error: No description provided", file=sys.stderr)
                sys.exit(1)

            result = creator.generate_from_description(
                description, args.title, args.detailed
            )

        if result["success"]:
            plan_payload = {
                "title": result["title"],
                "tasks": result["tasks"],
                "dependencies": result["dependencies"],
            }

            if args.output and args.format in ("mermaid", "both"):
                filepath = creator.save_mermaid(result["mermaid"], args.output)
                print(f"✅ Mermaid saved to: {filepath}")
            elif args.format in ("mermaid", "both"):
                print(result["mermaid"])

            if args.json_output:
                json_filepath = creator.save_json(plan_payload, args.json_output)
                print(f"✅ JSON plan saved to: {json_filepath}")
            elif args.format in ("json", "both") or args.to_plan_engine:
                print("\n📊 JSON plan:")
                print(json.dumps(plan_payload, indent=2, ensure_ascii=False))

            if args.plan_id:
                try:
                    plan_engine_dir = str(Path(__file__).resolve().parent.parent.parent / "plan-engine" / "scripts")
                    sys.path.insert(0, plan_engine_dir)
                    from plan_engine import PlanEngine
                    engine = PlanEngine(".opencode/plan")
                    plan = engine.create_plan(
                        args.plan_id,
                        args.title or args.plan_id,
                        result["tasks"],
                        result["dependencies"],
                    )
                    print(f"\n✅ Imported into plan-engine: {plan.id}")
                    print(f"📊 Tasks: {len(plan.tasks)}, Current: {plan.current_task_id}")
                except Exception as e:
                    print(f"\n⚠️ Failed to import into plan-engine: {e}", file=sys.stderr)
            
            print(f"\n📈 Generated {result['steps']} steps")
        else:
            print(f"Error: {result['error']}", file=sys.stderr)
            sys.exit(1)
    
    elif args.command == "parse":
        try:
            with open(args.file, "r", encoding="utf-8") as f:
                content = f.read()
            
            tasks, deps = parse_plan_to_tasks(content)

            if args.json:
                print(json.dumps({
                    "success": True,
                    "tasks": tasks,
                    "dependencies": deps,
                }, indent=2, ensure_ascii=False))
            else:
                print(f"📊 Parsed {len(tasks)} tasks, {len(deps)} dependencies")
                print("\nTasks:")
                for task in tasks:
                    tid = task.get('task_id', task.get('id', '?'))
                    print(f"  - {tid}: {task['label']}")
                print("\nDependencies:")
                for dep in deps:
                    label = f" [{dep['label']}]" if dep['label'] else ""
                    fallback = " (fallback)" if dep['is_fallback'] else ""
                    print(f"  - {dep['from']} --> {dep['to']}{label}{fallback}")
        
        except Exception as e:
            print(f"Error parsing file: {e}", file=sys.stderr)
            sys.exit(1)
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
