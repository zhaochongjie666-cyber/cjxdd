#!/usr/bin/env bash
set -euo pipefail

# check-triangle-links.sh — 三角链接校验
# 从 l1-conduction-map.md Section 1 提取
# 校验 flow→spec→wire 三角链接完整性
# 用法: bash skills/shadow-l1-flow/scripts/check-triangle-links.sh <slug>

SLUG="${1:-}"
[ -z "$SLUG" ] && { echo "用法: $0 <slug>"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SHADOW_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
SHADOW_DIR="$PROJECT_DIR/.shadow"
L1_DIR="$SHADOW_DIR/L1-business/$SLUG"
SPEC_FILE="$L1_DIR/spec.md"
WIRE_SVG="$SHADOW_DIR/L1-business/wire.svg"

FLOW_FILE=""
for f in "$SHADOW_DIR/L1-business/project.flow.mermaid" "$SHADOW_DIR/L1-business/flow.mermaid" "$L1_DIR/flow.mermaid" "$L1_DIR/${SLUG}.flow.mermaid"; do
  [ -f "$f" ] && FLOW_FILE="$f" && break
done

python3 - <<'PY' "$FLOW_FILE" "$SPEC_FILE" "$WIRE_SVG"
import re
import sys
from pathlib import Path

flow_file = Path(sys.argv[1]) if sys.argv[1] else None
spec_file = Path(sys.argv[2])
wire_svg = Path(sys.argv[3])

PASS = 0
FAIL = 0
WARN = 0

GREEN = "\033[0;32m"
RED = "\033[0;31m"
YELLOW = "\033[0;33m"
NC = "\033[0m"

def ok(message: str):
    global PASS
    PASS += 1
    print(f"{GREEN}PASS{NC} {message}")

def fail(message: str):
    global FAIL
    FAIL += 1
    print(f"{RED}FAIL{NC} {message}")

def warn(message: str):
    global WARN
    WARN += 1
    print(f"{YELLOW}WARN{NC} {message}")

def normalize_full_id(value: str) -> str:
    if re.fullmatch(r"B\d{2}-N\d{2}(?:-C\d{2})?(?:-D\d{2})?", value):
        return value.replace("-C", ".C").replace("-D", ".D")
    if re.fullmatch(r"N\d{2}(?:_\d{2})?", value):
        return value.replace("_", ".")
    return value

def suffix_key(value: str) -> str:
    value = value.strip()
    if value.startswith("B"):
        return re.sub(r"^B\d{2}-", "", value)
    return value

def extract_flow_payload(path: Path):
    text = path.read_text(encoding="utf-8")
    full_ids = {normalize_full_id(m.group(0)) for m in re.finditer(r"\bB\d{2}-N\d{2}(?:-C\d{2})?(?:-D\d{2})?\b", text)}
    legacy_ids = {normalize_full_id(m.group(0)) for m in re.finditer(r"\bN\d{2}(?:_\d{2})?\b", text)}
    node_ids = full_ids or legacy_ids

    unnumbered = []
    shape_pattern = re.compile(r"([A-Za-z0-9_-]+)\s*(?:\[\[|\[\(|\[\{|\[|\(\(|\(|\{\{|\{)")
    for lineno, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("%%"):
            continue
        if re.match(r"^(classDef|class|style|linkStyle|click|subgraph|end)\b", line):
            continue
        for match in shape_pattern.finditer(raw):
            node_id = match.group(1)
            if re.fullmatch(r"B\d{2}-N\d{2}(?:-C\d{2})?(?:-D\d{2})?", node_id):
                continue
            if re.fullmatch(r"N\d{2}(?:_\d{2})?", node_id):
                continue
            unnumbered.append((lineno, node_id, raw.strip()))

    return text, node_ids, unnumbered

def extract_business_rule_section(text: str) -> str:
    match = re.search(r"^##\s+业务规则\s*$([\s\S]*?)(?=^##\s+|\Z)", text, re.M)
    return match.group(1) if match else ""

def split_row(line: str):
    return [cell.strip() for cell in line.strip().strip("|").split("|")]

def extract_spec_nodes(path: Path):
    text = path.read_text(encoding="utf-8")
    all_nodes = set(re.findall(r"B\d{2}-N\d{2}(?:\.[A-Z]?\d{2}){0,2}", text))
    need_wire_nodes = set()
    section = extract_business_rule_section(text)
    header = None
    for raw in section.splitlines():
        if not raw.strip().startswith("|"):
            continue
        cells = split_row(raw)
        if not cells:
            continue
        if "规则 ID" in cells:
            header = cells
            continue
        if raw.strip().startswith("|---") or header is None:
            continue
        row = dict(zip(header, cells))
        decision = row.get("需 Wire 承接", "").strip().lower()
        if decision in {"是", "yes", "y", "required", "必须"}:
            coords = row.get("节点坐标", "")
            for node in re.findall(r"B\d{2}-N\d{2}(?:\.[A-Z]?\d{2}){0,2}", coords):
                need_wire_nodes.add(node)
    return all_nodes, need_wire_nodes

def extract_wire_nodes(wire_svg_path: Path):
    nodes = set()
    if wire_svg_path.is_file():
        text = wire_svg_path.read_text(encoding="utf-8")
        nodes.update(re.findall(r'data-node="(B\d{2}-N\d{2}(?:\.[A-Z]?\d{2}){0,2})"', text))
    return nodes

print("=== 三角链接校验: {} ===".format(spec_file.parent.name))

if not flow_file or not flow_file.is_file():
    fail("project.flow.mermaid 缺失，无法提取节点")
    print(f"\n=== 三角链接校验结果: PASS={PASS} WARN={WARN} FAIL={FAIL} ===")
    raise SystemExit(1)

if not spec_file.is_file():
    fail("spec.md 缺失，无法提取节点引用")
    print(f"\n=== 三角链接校验结果: PASS={PASS} WARN={WARN} FAIL={FAIL} ===")
    raise SystemExit(1)

flow_text, flow_nodes, unnumbered_nodes = extract_flow_payload(flow_file)
spec_nodes, spec_need_wire = extract_spec_nodes(spec_file)
wire_nodes = extract_wire_nodes(wire_svg)

ok(f"project.flow.mermaid 节点提取完成 ({len(flow_nodes)} 个)")
ok(f"spec.md 节点引用提取完成 ({len(spec_nodes)} 个)")
if spec_need_wire:
    ok(f"spec.md 提取需 Wire 承接节点 ({len(spec_need_wire)} 个)")
else:
    warn("spec.md 未提取到「需 Wire 承接=是」节点；将无法精确校验 UI 传导")

if wire_svg.is_file():
    ok(f"wire.svg data-node 提取完成 ({len(wire_nodes)} 个)")
else:
    warn("wire.svg 缺失（纯后端项目可跳过 wire 相关校验）")

print("\n--- Check 0: flow 未编号节点 ---")
if unnumbered_nodes:
    for lineno, node_id, line in unnumbered_nodes:
        fail(f"flow 第 {lineno} 行存在未编号节点 `{node_id}`: {line}")
else:
    ok("flow 中所有业务节点均使用编号 ID")

flow_suffixes = {suffix_key(node) for node in flow_nodes}
spec_suffixes = {suffix_key(node) for node in spec_nodes}
wire_suffixes = {suffix_key(node) for node in wire_nodes}
need_wire_suffixes = {suffix_key(node) for node in spec_need_wire}

print("\n--- Check 1: flow 节点 → spec 规则覆盖 ---")
missing_flow = sorted(node for node in flow_nodes if suffix_key(node) not in spec_suffixes)
if missing_flow:
    for node in missing_flow:
        fail(f"flow 节点 {node} 在 spec.md 中无规则引用")
else:
    ok("所有 flow 节点在 spec 中有规则引用")

print("\n--- Check 2: spec BXX-NYY → flow 节点 ---")
missing_spec = sorted(node for node in spec_nodes if suffix_key(node) not in flow_suffixes)
if missing_spec:
    for node in missing_spec:
        fail(f"spec 引用 {node} 在 flow 中无对应节点")
else:
    ok("所有 spec 引用在 flow 中有对应节点")

print("\n--- Check 3: spec 需 Wire 承接 → wire data-node ---")
if spec_need_wire:
    missing_need_wire = sorted(node for node in spec_need_wire if suffix_key(node) not in wire_suffixes)
    if missing_need_wire:
        for node in missing_need_wire:
            fail(f"spec 标记需 Wire 承接的节点 {node} 未在 wire 中落位")
    else:
        ok("所有需 Wire 承接节点在 wire 中有对应 data-node")

print("\n--- Check 4: wire data-node → flow 节点 ---")
missing_wire = sorted(node for node in wire_nodes if suffix_key(node) not in flow_suffixes)
if missing_wire:
    for node in missing_wire:
        fail(f"wire 引用 {node} 在 flow 中无对应节点")
else:
    ok("所有 wire data-node 在 flow 中有对应节点")

print(f"\n=== 三角链接校验结果: PASS={PASS} WARN={WARN} FAIL={FAIL} ===")
raise SystemExit(1 if FAIL else 0)
PY
