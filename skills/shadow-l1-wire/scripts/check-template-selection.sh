#!/usr/bin/env bash
set -euo pipefail

# check-template-selection.sh — 校验 wire/template-selection.yaml 结构是否完整
# 用法: bash skills/shadow-l1-wire/scripts/check-template-selection.sh <slug>

SLUG="${1:-}"
[ -z "$SLUG" ] && { echo "用法: $0 <slug>"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SHADOW_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
SELECTION_FILE="$PROJECT_DIR/.shadow/L1-business/BXX-$SLUG/wire/template-selection.yaml"

[ -f "$SELECTION_FILE" ] || { echo "FAIL 缺少 template-selection.yaml: $SELECTION_FILE"; exit 1; }

python3 - <<'PY' "$SELECTION_FILE"
import sys
from pathlib import Path

selection_file = Path(sys.argv[1])

def parse_scalar(value: str):
    value = value.strip()
    if value in ("[]", ""):
        return []
    if value == "{}":
        return {}
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        return value[1:-1]
    return value

def find_next_meaningful(lines, index, indent):
    for offset in range(index + 1, len(lines)):
        candidate = lines[offset]
        if not candidate.strip() or candidate.lstrip().startswith("#"):
            continue
        next_indent = len(candidate) - len(candidate.lstrip(" "))
        if next_indent <= indent:
            return None, None
        return candidate.strip(), next_indent
    return None, None

def parse_simple_yaml(text: str):
    lines = text.splitlines()
    root = {}
    stack = [(-1, root)]
    for idx, raw in enumerate(lines):
        line = raw.rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip(" "))
        stripped = line.strip()
        while len(stack) > 1 and indent <= stack[-1][0]:
            stack.pop()
        current = stack[-1][1]
        if stripped.startswith("- "):
            if not isinstance(current, list):
                continue
            item_text = stripped[2:].strip()
            if not item_text:
                next_text, _ = find_next_meaningful(lines, idx, indent)
                value = [] if next_text and next_text.startswith("- ") else {}
                current.append(value)
                stack.append((indent, value))
                continue
            if ":" in item_text:
                key, rest = item_text.split(":", 1)
                value = {key.strip(): parse_scalar(rest.strip())}
                current.append(value)
                stack.append((indent, value))
                continue
            current.append(parse_scalar(item_text))
            continue
        if ":" not in stripped or not isinstance(current, dict):
            continue
        key, rest = stripped.split(":", 1)
        key = key.strip()
        rest = rest.strip()
        if rest:
            current[key] = parse_scalar(rest)
            continue
        next_text, _ = find_next_meaningful(lines, idx, indent)
        if next_text is None:
            current[key] = ""
            continue
        container = [] if next_text.startswith("- ") else {}
        current[key] = container
        stack.append((indent, container))
    return root

def load_yaml_like(path: Path):
    content = path.read_text(encoding="utf-8")
    try:
        import yaml  # type: ignore
        data = yaml.safe_load(content)
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return parse_simple_yaml(content)

def as_dict(value):
    return value if isinstance(value, dict) else {}

def as_list(value):
    return value if isinstance(value, list) else []

data = load_yaml_like(selection_file)
errors = []
warnings = []

if not isinstance(data, dict):
    errors.append("YAML 根节点必须是对象")
    data = {}

for field in ["page_name", "page_goal", "task", "template_bundle", "context_pack", "excluded", "selection_rationale", "review_focus", "trace"]:
    if field not in data:
        errors.append(f"缺少顶层字段: {field}")

for field in ["page_name", "page_goal", "task"]:
    value = str(data.get(field, "") or "").strip()
    if not value:
        errors.append(f"{field} 不能为空")

template_bundle = as_dict(data.get("template_bundle"))
for key in ["layout", "collection", "overlay", "detail", "state"]:
    if key not in template_bundle:
        errors.append(f"template_bundle 缺少分组: {key}")
    elif not isinstance(template_bundle.get(key), list):
        errors.append(f"template_bundle.{key} 必须是数组")
    elif key == "layout" and not as_list(template_bundle.get(key)):
        warnings.append("template_bundle.layout 为空，通常表示主视图模板尚未明确")

context_pack = as_dict(data.get("context_pack"))
for key in ["views", "components", "references"]:
    if key not in context_pack:
        errors.append(f"context_pack 缺少分组: {key}")
    elif not isinstance(context_pack.get(key), list):
        errors.append(f"context_pack.{key} 必须是数组")

for key in ["views", "components", "references"]:
    for item in as_list(context_pack.get(key)):
        value = str(item).strip()
        if value.endswith("/"):
            errors.append(f"context_pack.{key} 不允许使用目录路径: {value}")

excluded = as_dict(data.get("excluded"))
excluded_templates = as_list(excluded.get("templates"))
excluded_reasons = as_list(excluded.get("reasons"))
if "templates" not in excluded or "reasons" not in excluded:
    errors.append("excluded 必须同时包含 templates 和 reasons")
elif len(excluded_templates) != len(excluded_reasons):
    errors.append("excluded.templates 与 excluded.reasons 数量必须一致")
elif not excluded_templates:
    warnings.append("excluded 为空，建议至少写出本次明确不采用的模板方向")

rationale = as_dict(data.get("selection_rationale"))
for key in ["primary_view_reason", "overlay_reason", "state_reason"]:
    value = str(rationale.get(key, "") or "").strip()
    if not value:
        warnings.append(f"selection_rationale.{key} 为空，建议补理由以便人审和 AI 复用")

review_focus = as_list(data.get("review_focus"))
if not review_focus:
    warnings.append("review_focus 为空，建议补 2~5 条审查重点")
elif len(review_focus) < 2 or len(review_focus) > 5:
    warnings.append("review_focus 建议保持 2~5 条")

trace = as_dict(data.get("trace"))
for key in ["source_input", "selector_rule", "generated_from"]:
    value = str(trace.get(key, "") or "").strip()
    if not value:
        warnings.append(f"trace.{key} 为空，追溯链会变弱")

input_snapshot = as_dict(data.get("input_snapshot"))
if input_snapshot:
    for key in ["interactions", "states", "primary_actions", "overlay_rules", "table_rules", "filter_rules"]:
        if key not in input_snapshot:
            warnings.append(f"input_snapshot 建议补齐字段: {key}")

for message in errors:
    print(f"FAIL {message}")
for message in warnings:
    print(f"WARN {message}")

if errors:
    raise SystemExit(1)

print(f"PASS template-selection.yaml 结构有效: {selection_file}")
PY
