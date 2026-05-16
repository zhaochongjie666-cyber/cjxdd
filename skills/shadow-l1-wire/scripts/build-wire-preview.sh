#!/usr/bin/env bash
set -euo pipefail

# build-wire-preview.sh — 从 wire/*.vue 生成静态可预览的 wire.html
# 用法: bash skills/shadow-l1-wire/scripts/build-wire-preview.sh <slug>

SLUG="${1:-}"
[ -z "$SLUG" ] && { echo "用法: $0 <slug>"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SHADOW_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
SHADOW_DIR="$PROJECT_DIR/.shadow"
L1_DIR="$SHADOW_DIR/L1-business/$SLUG"
WIRE_DIR="$L1_DIR/wire"
OUTPUT_FILE="$L1_DIR/wire.html"
SELECTION_FILE="$WIRE_DIR/template-selection.yaml"

[ -d "$WIRE_DIR" ] || { echo "wire 目录不存在: $WIRE_DIR" >&2; exit 1; }

python3 - <<'PY' "$WIRE_DIR" "$OUTPUT_FILE" "$SLUG" "$SELECTION_FILE"
import html
import json
import re
import sys
from pathlib import Path

wire_dir = Path(sys.argv[1])
output_file = Path(sys.argv[2])
slug = sys.argv[3]
selection_file = Path(sys.argv[4])

vue_files = sorted(wire_dir.rglob("*.vue"))
if not vue_files:
    raise SystemExit(f"wire 目录下未找到 Vue 文件: {wire_dir}")

def extract_block(text: str, tag: str):
    match = re.search(rf"<{tag}\b[^>]*>(.*?)</{tag}>", text, re.S)
    return match.group(1).strip() if match else ""

def extract_script(text: str) -> str:
    match = re.search(r"<script\b[^>]*>(.*?)</script>", text, re.S)
    return match.group(1).strip() if match else ""

sections = []
styles = []

def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", value)).strip()

def extract_between(template: str, tag: str):
    pattern = re.compile(rf"<{tag}\b([^>]*)>(.*?)</{tag}>", re.S | re.I)
    return pattern.findall(template)

def extract_self_closing(template: str, tag: str):
    pattern = re.compile(rf"<{tag}\b([^>]*)/>", re.S | re.I)
    return pattern.findall(template)

def parse_attrs(attr_text: str):
    attrs = {}
    for key, value in re.findall(r'([:@\w-]+)\s*=\s*"([^"]*)"', attr_text):
        attrs[key] = value
    return attrs

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
    if not path.exists():
        return None
    content = path.read_text(encoding="utf-8")
    try:
        import yaml  # type: ignore
        data = yaml.safe_load(content)
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return parse_simple_yaml(content)

def ensure_list(value):
    return value if isinstance(value, list) else []

def ensure_dict(value):
    return value if isinstance(value, dict) else {}

def normalize_selection(data):
    if not isinstance(data, dict):
        return None
    template_bundle = ensure_dict(data.get("template_bundle"))
    context_pack = ensure_dict(data.get("context_pack"))
    excluded = ensure_dict(data.get("excluded"))
    rationale = ensure_dict(data.get("selection_rationale"))
    trace = ensure_dict(data.get("trace"))
    return {
        "page_name": str(data.get("page_name", "") or ""),
        "page_goal": str(data.get("page_goal", "") or ""),
        "task": str(data.get("task", "") or ""),
        "domain": str(data.get("domain", "") or ""),
        "template_bundle": {
            "layout": ensure_list(template_bundle.get("layout")),
            "collection": ensure_list(template_bundle.get("collection")),
            "overlay": ensure_list(template_bundle.get("overlay")),
            "detail": ensure_list(template_bundle.get("detail")),
            "state": ensure_list(template_bundle.get("state")),
        },
        "context_pack": {
            "views": ensure_list(context_pack.get("views")),
            "components": ensure_list(context_pack.get("components")),
            "references": ensure_list(context_pack.get("references")),
        },
        "excluded": {
            "templates": ensure_list(excluded.get("templates")),
            "reasons": ensure_list(excluded.get("reasons")),
        },
        "selection_rationale": {
            "primary_view_reason": str(rationale.get("primary_view_reason", "") or ""),
            "overlay_reason": str(rationale.get("overlay_reason", "") or ""),
            "state_reason": str(rationale.get("state_reason", "") or ""),
        },
        "review_focus": ensure_list(data.get("review_focus")),
        "trace": {
            "source_input": str(trace.get("source_input", "") or ""),
            "selector_rule": str(trace.get("selector_rule", "") or ""),
            "generated_from": str(trace.get("generated_from", "") or ""),
        },
    }

def split_top_level_objects(source: str):
    items = []
    depth = 0
    start = None
    for idx, ch in enumerate(source):
        if ch == "{":
            if depth == 0:
                start = idx
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start is not None:
                items.append(source[start:idx + 1])
                start = None
    return items

def parse_js_object(obj_text: str):
    result = {}
    body = obj_text.strip()[1:-1]
    for key in ["prop", "label", "type", "placeholder", "title", "path", "icon", "status", "name"]:
        match = re.search(rf"{key}\s*:\s*'([^']*)'|{key}\s*:\s*\"([^\"]*)\"", body)
        if match:
            result[key] = match.group(1) or match.group(2) or ""
    options_match = re.search(r"options\s*:\s*\[([^\]]*)\]", body, re.S)
    if options_match:
        result["options"] = re.findall(r"'([^']*)'|\"([^\"]*)\"", options_match.group(1))
        result["options"] = [a or b for a, b in result["options"]]
    return result

def extract_const_array(script: str, name: str):
    match = re.search(rf"const\s+{re.escape(name)}\s*=\s*\[(.*?)\]\s*(?:\n|;)", script, re.S)
    if not match:
        return []
    body = match.group(1)
    return [parse_js_object(chunk) for chunk in split_top_level_objects(body)]

def infer_trigger(action_label: str, overlay_title: str, overlay_kind: str):
    normalized_action = action_label.lower()
    normalized_overlay = overlay_title.lower()
    if not action_label:
        return ""
    keywords = [
        ("新增", ["新增", "创建", "新建"]),
        ("编辑", ["编辑", "修改", "设置"]),
        ("查看", ["查看", "详情"]),
        ("删除", ["删除", "移除"]),
    ]
    for canonical, group in keywords:
        if any(token in action_label for token in group):
            if any(token in overlay_title for token in group):
                return action_label
    if overlay_kind == "Drawer" and any(token in normalized_action for token in ["edit", "drawer", "配置"]):
        return action_label
    if overlay_kind == "Dialog" and any(token in normalized_action for token in ["submit", "confirm", "open", "create"]):
        return action_label
    if normalized_action[:2] and normalized_action[:2] in normalized_overlay:
        return action_label
    return ""

def extract_facts(template: str, script: str):
    layout = []
    for tag, label in [
        ("WireSidebar", "侧边导航"),
        ("WireHeader", "顶部栏"),
        ("WireMain", "主内容区"),
        ("WireFilter", "筛选区"),
        ("WireTable", "表格区"),
        ("WireForm", "表单区"),
        ("WirePagination", "分页区"),
        ("WireTabs", "标签页"),
    ]:
        if re.search(rf"<{tag}\b", template):
            layout.append(label)

    actions = []
    for attr_text, inner in extract_between(template, "WireButton"):
        attrs = parse_attrs(attr_text)
        label = clean_text(inner) or attrs.get("title") or "未命名按钮"
        actions.append(
            {
                "label": label,
                "node": attrs.get("data-node", ""),
                "type": attrs.get("type", "default"),
            }
        )

    filter_defs = []
    filter_field_refs = []
    filter_meta = {"primary_goal": "", "search_hint": ""}
    filter_attrs_list = [attr_text for attr_text, _inner in extract_between(template, "WireFilter")]
    filter_attrs_list.extend(extract_self_closing(template, "WireFilter"))
    for attr_text in filter_attrs_list:
        attrs = parse_attrs(attr_text)
        ref_name = attrs.get(":fields") or attrs.get("fields") or ""
        if ref_name:
            filter_field_refs.append(ref_name)
            filter_defs.extend(extract_const_array(script, ref_name))
        filter_meta = {
            "primary_goal": attrs.get("primary-goal", "") or attrs.get("primaryGoal", "") or filter_meta["primary_goal"],
            "search_hint": attrs.get("search-hint", "") or attrs.get("searchHint", "") or filter_meta["search_hint"],
        }

    table_defs = []
    table_data_sample = []
    table_meta = {"empty_text": "", "bulk_hint": "", "default_sort": ""}
    table_attrs_list = [attr_text for attr_text, _inner in extract_between(template, "WireTable")]
    table_attrs_list.extend(extract_self_closing(template, "WireTable"))
    for attr_text in table_attrs_list:
        attrs = parse_attrs(attr_text)
        ref_name = attrs.get(":columns") or attrs.get("columns") or ""
        data_name = attrs.get(":data") or attrs.get("data") or ""
        if ref_name:
            table_defs.extend(extract_const_array(script, ref_name))
        if data_name:
            table_data_sample.extend(extract_const_array(script, data_name))
        table_meta = {
            "empty_text": attrs.get("empty-text", "") or attrs.get("emptyText", "") or table_meta["empty_text"],
            "bulk_hint": attrs.get("bulk-hint", "") or attrs.get("bulkHint", "") or table_meta["bulk_hint"],
            "default_sort": attrs.get("default-sort", "") or attrs.get("defaultSort", "") or table_meta["default_sort"],
        }

    states = []
    for attr_text, inner in extract_between(template, "WireBadge"):
        attrs = parse_attrs(attr_text)
        label = clean_text(inner) or "状态"
        states.append(
            {
                "label": label,
                "type": attrs.get("type", "info"),
            }
        )

    overlays = []
    for tag, default_surface in [("WireDialog", "centered-dialog"), ("WireDrawer", "right-drawer")]:
        for attr_text, inner in extract_between(template, tag):
            attrs = parse_attrs(attr_text)
            overlays.append(
                {
                    "kind": tag.replace("Wire", ""),
                    "title": attrs.get("title", "") or clean_text(inner)[:24] or "未命名浮层",
                    "surface": attrs.get("placement", default_surface),
                    "node": attrs.get("data-node", ""),
                    "trigger": attrs.get("trigger", "") or attrs.get("data-trigger", ""),
                    "close": attrs.get("close", "") or attrs.get("data-close", ""),
                    "after_close": attrs.get("afterClose", "") or attrs.get("after-close", "") or attrs.get("data-after-close", ""),
                }
            )
        for attr_text in extract_self_closing(template, tag):
            attrs = parse_attrs(attr_text)
            overlays.append(
                {
                    "kind": tag.replace("Wire", ""),
                    "title": attrs.get("title", "") or "未命名浮层",
                    "surface": attrs.get("placement", default_surface),
                    "node": attrs.get("data-node", ""),
                    "trigger": attrs.get("trigger", "") or attrs.get("data-trigger", ""),
                    "close": attrs.get("close", "") or attrs.get("data-close", ""),
                    "after_close": attrs.get("afterClose", "") or attrs.get("after-close", "") or attrs.get("data-after-close", ""),
                }
            )

    nodes = sorted(set(re.findall(r'data-node="(B\d{2}-N\d{2}(?:\.[A-Z]?\d{2}){0,2})"', template)))

    for overlay in overlays:
        if not overlay["trigger"]:
            for action in actions:
                guessed = infer_trigger(action["label"], overlay["title"], overlay["kind"])
                if guessed:
                    overlay["trigger"] = guessed
                    break
        if not overlay["close"]:
            overlay["close"] = "右上角关闭 / 遮罩关闭"
        if not overlay["after_close"]:
            overlay["after_close"] = "回到底层页面，保留上下文"

    return {
        "layout": layout,
        "actions": actions,
        "states": states,
        "overlays": overlays,
        "nodes": nodes,
        "filters": filter_defs,
        "filter_meta": filter_meta,
        "tables": table_defs,
        "table_data": table_data_sample[:3],
        "table_meta": table_meta,
    }

for vue_file in vue_files:
    content = vue_file.read_text(encoding="utf-8")
    template = extract_block(content, "template")
    script = extract_script(content)
    style_blocks = re.findall(r"<style\b[^>]*>(.*?)</style>", content, re.S)
    if style_blocks:
        styles.extend(block.strip() for block in style_blocks if block.strip())
    title = vue_file.stem
    h1 = re.search(r'title="([^"]+)"', template)
    if h1:
        title = h1.group(1)
    facts = extract_facts(template, script)
    sections.append(
        {
            "id": vue_file.stem,
            "title": title,
            "relpath": vue_file.relative_to(wire_dir).as_posix(),
            "template": template,
            "facts": facts,
        }
    )

selection = normalize_selection(load_yaml_like(selection_file))

def render_inline_chips(values, empty_label):
    if not values:
        return f'<span class="preview-inline-chip">{html.escape(empty_label)}</span>'
    return "".join(f'<span class="preview-inline-chip">{html.escape(str(value))}</span>' for value in values)

def render_review_items(items, empty_label):
    if not items:
        return f'<li class="preview-review-item">{html.escape(empty_label)}</li>'
    return "".join(items)

def render_selection_cards(selection_data):
    if not selection_data:
        return """
          <div class="preview-review-card">
            <h3>模板选择</h3>
            <div class="preview-review-item">未发现 <code>template-selection.yaml</code>，当前预览只能审页面本体，无法同步审查模板选择依据。</div>
          </div>
        """
    template_groups = []
    for label, key in [
        ("布局", "layout"),
        ("集合", "collection"),
        ("浮层", "overlay"),
        ("详情", "detail"),
        ("状态", "state"),
    ]:
        template_groups.append(
            f'<li class="preview-review-item"><strong>{label}</strong>{render_inline_chips(selection_data["template_bundle"][key], "未选择模板")}</li>'
        )
    context_views = render_inline_chips(selection_data["context_pack"]["views"], "无视图模板")
    context_components = render_inline_chips(selection_data["context_pack"]["components"], "无组件模板")
    context_refs = render_inline_chips(selection_data["context_pack"]["references"], "无参考文档")
    excluded_items = []
    for index, template_name in enumerate(selection_data["excluded"]["templates"]):
        reason = selection_data["excluded"]["reasons"][index] if index < len(selection_data["excluded"]["reasons"]) else "未写排除理由"
        excluded_items.append(
            f'<li class="preview-review-item"><strong>{html.escape(str(template_name))}</strong>{html.escape(str(reason))}</li>'
        )
    rationale_items = []
    for label, key in [("主视图", "primary_view_reason"), ("浮层", "overlay_reason"), ("状态", "state_reason")]:
        value = selection_data["selection_rationale"][key]
        if value:
            rationale_items.append(f'<li class="preview-review-item"><strong>{label}</strong>{html.escape(value)}</li>')
    trace_bits = [selection_data["task"]]
    if selection_data["domain"]:
        trace_bits.append(selection_data["domain"])
    if selection_data["trace"]["generated_from"]:
        trace_bits.append(selection_data["trace"]["generated_from"])
    trace_line = " / ".join(bit for bit in trace_bits if bit)
    return f"""
          <div class="preview-review-card">
            <h3>模板选择</h3>
            <ul class="preview-review-list">
              <li class="preview-review-item"><strong>{html.escape(selection_data["page_name"] or "未命名页面")}</strong>{html.escape(selection_data["page_goal"] or "未填写页面目标")}<br />{html.escape(trace_line or "未填写任务/领域/来源")}</li>
              {''.join(template_groups)}
            </ul>
          </div>
          <div class="preview-review-card">
            <h3>最小上下文</h3>
            <ul class="preview-review-list">
              <li class="preview-review-item"><strong>Views</strong>{context_views}</li>
              <li class="preview-review-item"><strong>Components</strong>{context_components}</li>
              <li class="preview-review-item"><strong>References</strong>{context_refs}</li>
            </ul>
          </div>
          <div class="preview-review-card">
            <h3>选择理由</h3>
            <ul class="preview-review-list">
              {render_review_items(rationale_items, "未填写 selection_rationale")}
            </ul>
          </div>
          <div class="preview-review-card">
            <h3>明确排除</h3>
            <ul class="preview-review-list">
              {render_review_items(excluded_items, "未声明 excluded 模板")}
            </ul>
          </div>
          <div class="preview-review-card">
            <h3>模板审查重点</h3>
            <ul class="preview-review-checklist">
              {''.join(f'<li>{html.escape(str(item))}</li>' for item in selection_data["review_focus"]) or '<li>未填写 review_focus</li>'}
            </ul>
          </div>
    """

base_style = """
* { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  margin: 0;
  color: #0f172a;
  background:
    radial-gradient(circle at top left, rgba(14, 165, 233, 0.18), transparent 22%),
    radial-gradient(circle at bottom right, rgba(59, 130, 246, 0.12), transparent 24%),
    linear-gradient(180deg, #f8fbff 0%, #eef4fb 100%);
}
.preview-shell { display: grid; grid-template-columns: 280px 1fr; min-height: 100vh; }
.preview-nav {
  padding: 24px;
  background: linear-gradient(180deg, #0f172a 0%, #172554 100%);
  color: #fff;
  position: sticky;
  top: 0;
  align-self: start;
  min-height: 100vh;
  box-sizing: border-box;
  border-right: 1px solid rgba(255,255,255,0.08);
}
.preview-nav h1 { margin: 0 0 8px; font-size: 21px; }
.preview-nav p { margin: 0 0 16px; color: #cbd5e1; font-size: 13px; line-height: 1.6; }
.preview-nav ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
.preview-nav a {
  color: #fff;
  text-decoration: none;
  display: block;
  padding: 11px 13px;
  border-radius: 12px;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.06);
}
.preview-nav-legend { margin-top: 20px; display: grid; gap: 8px; }
.preview-nav-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 12px;
  color: #dbeafe;
  background: rgba(59, 130, 246, 0.16);
  width: fit-content;
}
.preview-main { padding: 28px; display: grid; gap: 28px; }
.preview-page {
  background: rgba(255,255,255,0.72);
  backdrop-filter: blur(14px);
  border: 1px solid rgba(148, 163, 184, 0.25);
  border-radius: 22px;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.08);
  overflow: hidden;
}
.preview-page-header {
  padding: 18px 24px;
  border-bottom: 1px solid #dbe4ee;
  background: linear-gradient(180deg, rgba(248,250,252,0.92), rgba(241,245,249,0.88));
}
.preview-page-header h2 { margin: 0 0 6px; font-size: 18px; }
.preview-page-header code { color: #64748b; font-size: 12px; }
.preview-page-grid {
  padding: 24px;
  display: grid;
  grid-template-columns: minmax(840px, 1fr) 320px;
  gap: 24px;
  align-items: start;
}
.preview-window {
  background: linear-gradient(180deg, #dfe8f3 0%, #f8fbff 100%);
  border-radius: 20px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  padding: 16px;
}
.preview-browser {
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 24px 54px rgba(15, 23, 42, 0.16);
  background: #dbe4ee;
}
.preview-browser-bar {
  height: 48px;
  background: linear-gradient(180deg, #e2e8f0 0%, #cbd5e1 100%);
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 12px;
}
.preview-browser-dots { display: flex; gap: 6px; }
.preview-browser-dots span {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #94a3b8;
}
.preview-browser-dots span:nth-child(1) { background: #f87171; }
.preview-browser-dots span:nth-child(2) { background: #fbbf24; }
.preview-browser-dots span:nth-child(3) { background: #34d399; }
.preview-browser-address {
  flex: 1;
  border-radius: 999px;
  background: rgba(255,255,255,0.85);
  height: 30px;
  display: flex;
  align-items: center;
  padding: 0 14px;
  font-size: 12px;
  color: #64748b;
}
.preview-browser-stage {
  background:
    linear-gradient(180deg, rgba(15,23,42,0.05), rgba(15,23,42,0)),
    #cfd8e3;
  padding: 18px;
  overflow: auto;
}
.preview-browser-viewport {
  width: 1440px;
  min-height: 900px;
  background: #f8fafc;
  border-radius: 14px;
  overflow: hidden;
  position: relative;
}
.preview-wire-root {
  min-height: 900px;
  position: relative;
}
.preview-page-body * { box-sizing: border-box; }
.preview-page-body template { display: none !important; }
.preview-page-body wirecontainer,
.preview-page-body wiresidebar,
.preview-page-body wireheader,
.preview-page-body wiremain,
.preview-page-body wirecard,
.preview-page-body wiretable,
.preview-page-body wireform,
.preview-page-body wirefilter,
.preview-page-body wirepagination,
.preview-page-body wiredesclist,
.preview-page-body wirebutton,
.preview-page-body wirebadge,
.preview-page-body wireinput,
.preview-page-body wireselect,
.preview-page-body wiretabs,
.preview-page-body wiredialog,
.preview-page-body wiredrawer {
  display: block;
}
.preview-page-body wirecontainer {
  display: flex;
  min-height: 900px;
  background: #f8fafc;
}
.preview-page-body wiresidebar {
  width: 236px;
  flex-shrink: 0;
  background: linear-gradient(180deg, #243b53 0%, #1f2937 100%);
  color: #fff;
  padding: 72px 16px 16px;
  position: relative;
}
.preview-page-body .preview-wire-sidebar-title {
  position: absolute;
  top: 18px;
  left: 16px;
  right: 16px;
  padding: 12px 14px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 700;
  background: rgba(255,255,255,0.08);
}
.preview-page-body .preview-wire-sidebar-meta {
  margin-top: 10px;
  color: #cbd5e1;
  font-size: 12px;
}
.preview-page-body .content-wrapper {
  flex: 1;
  min-width: 0;
}
.preview-page-body wireheader {
  min-height: 64px;
  background: rgba(255,255,255,0.92);
  border-bottom: 1px solid #dbe4ee;
  padding: 16px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.preview-page-body .preview-wire-header-title {
  font-size: 20px;
  font-weight: 700;
  color: #111827;
}
.preview-page-body .preview-wire-header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.preview-page-body wiremain {
  min-height: 836px;
  background: linear-gradient(180deg, #eef4fb 0%, #f8fbff 100%);
  padding: 20px;
}
.preview-page-body .preview-wire-breadcrumbs {
  margin-bottom: 14px;
  color: #64748b;
  font-size: 12px;
  display: inline-flex;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 999px;
  background: rgba(255,255,255,0.7);
  border: 1px solid #dbe4ee;
}
.preview-page-body wirecard {
  display: block;
  margin-bottom: 16px;
  background: rgba(255,255,255,0.95);
  border: 1px solid #dbe4ee;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.04);
}
.preview-page-body .preview-wire-card-title {
  margin-bottom: 14px;
  font-size: 15px;
  font-weight: 700;
  color: #1e293b;
}
.preview-page-body wirefilter,
.preview-page-body wiretable,
.preview-page-body wireform,
.preview-page-body wirepagination,
.preview-page-body wiretabs,
.preview-page-body wiredesclist {
  display: block;
  margin-bottom: 16px;
  background: rgba(255,255,255,0.95);
  border: 1px dashed #93c5fd;
  border-radius: 16px;
  padding: 16px 18px;
  position: relative;
}
.preview-page-body .preview-wire-block-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  border-radius: 999px;
  padding: 5px 10px;
  font-size: 11px;
  font-weight: 700;
  color: #0f172a;
  background: #dbeafe;
}
.preview-page-body .preview-wire-block-meta {
  color: #64748b;
  font-size: 12px;
  line-height: 1.6;
}
.preview-page-body .preview-wire-filter-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.preview-page-body .preview-wire-filter-item {
  border: 1px solid #dbe4ee;
  border-radius: 12px;
  background: #fff;
  padding: 10px 12px;
}
.preview-page-body .preview-wire-filter-name {
  font-size: 11px;
  color: #64748b;
  margin-bottom: 6px;
}
.preview-page-body .preview-wire-filter-input {
  min-height: 36px;
  border-radius: 10px;
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  padding: 8px 10px;
  font-size: 12px;
  color: #334155;
}
.preview-page-body .preview-wire-filter-options {
  margin-top: 6px;
  font-size: 11px;
  color: #94a3b8;
}
.preview-page-body .preview-wire-filter-meta {
  margin-top: 12px;
  display: grid;
  gap: 8px;
}
.preview-page-body .preview-wire-filter-hint {
  padding: 8px 10px;
  border-radius: 10px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 12px;
  line-height: 1.5;
}
.preview-page-body .preview-wire-table-shell {
  border: 1px solid #dbe4ee;
  border-radius: 14px;
  overflow: hidden;
  background: #fff;
}
.preview-page-body .preview-wire-table-head,
.preview-page-body .preview-wire-table-row {
  display: grid;
  grid-template-columns: repeat(var(--col-count, 4), minmax(0, 1fr));
}
.preview-page-body .preview-wire-table-head {
  background: #eff6ff;
  color: #1e3a8a;
  font-size: 12px;
  font-weight: 700;
}
.preview-page-body .preview-wire-table-row {
  border-top: 1px solid #e2e8f0;
  font-size: 12px;
  color: #334155;
}
.preview-page-body .preview-wire-table-head span,
.preview-page-body .preview-wire-table-row span {
  padding: 10px 12px;
  min-width: 0;
}
.preview-page-body .preview-wire-table-row span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.preview-page-body .preview-wire-table-note {
  margin-top: 10px;
  font-size: 11px;
  color: #64748b;
}
.preview-page-body .preview-wire-table-meta {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.preview-page-body .preview-wire-table-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 11px;
  font-weight: 700;
}
.preview-page-body wirebutton {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 8px 14px;
  margin-right: 10px;
  margin-bottom: 10px;
  border-radius: 10px;
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #0f172a;
  font-size: 13px;
  font-weight: 600;
  position: relative;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06);
}
.preview-page-body wirebutton[data-preview-type="primary"] { background: #2563eb; color: #fff; border-color: #2563eb; }
.preview-page-body wirebutton[data-preview-type="danger"] { background: #ef4444; color: #fff; border-color: #ef4444; }
.preview-page-body wirebutton[data-preview-type="success"] { background: #16a34a; color: #fff; border-color: #16a34a; }
.preview-page-body wirebutton[data-preview-type="warning"] { background: #f59e0b; color: #fff; border-color: #f59e0b; }
.preview-page-body wirebutton[data-preview-text="true"] {
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  color: #2563eb;
  padding: 4px 8px;
}
.preview-page-body wirebadge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 4px 10px;
  margin-right: 8px;
  margin-bottom: 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}
.preview-page-body wirebadge[data-preview-type="success"] { background: #dcfce7; color: #166534; }
.preview-page-body wirebadge[data-preview-type="warning"] { background: #fef3c7; color: #92400e; }
.preview-page-body wirebadge[data-preview-type="danger"] { background: #fee2e2; color: #991b1b; }
.preview-page-body wirebadge[data-preview-type="info"] { background: #dbeafe; color: #1d4ed8; }
.preview-page-body .preview-node-badge {
  display: inline-flex;
  margin-left: 6px;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(15,23,42,0.14);
  color: inherit;
  font-size: 10px;
  font-weight: 700;
}
.preview-page-body wiredialog,
.preview-page-body wiredrawer {
  position: absolute;
  inset: 0;
  z-index: 30;
  pointer-events: none;
}
.preview-page-body .preview-overlay-mask {
  position: absolute;
  inset: 0;
  background: rgba(15, 23, 42, 0.34);
}
.preview-page-body .preview-overlay-panel {
  position: absolute;
  background: #fff;
  border: 1px solid #cbd5e1;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.22);
  border-radius: 18px;
  overflow: hidden;
}
.preview-page-body wiredialog .preview-overlay-panel {
  width: min(640px, calc(100% - 80px));
  top: 70px;
  left: 50%;
  transform: translateX(-50%);
}
.preview-page-body wiredrawer[data-preview-placement="right"] .preview-overlay-panel,
.preview-page-body wiredrawer:not([data-preview-placement]) .preview-overlay-panel {
  top: 0;
  right: 0;
  width: min(460px, 100%);
  height: 100%;
  border-radius: 18px 0 0 18px;
}
.preview-page-body wiredrawer[data-preview-placement="left"] .preview-overlay-panel {
  top: 0;
  left: 0;
  width: min(460px, 100%);
  height: 100%;
  border-radius: 0 18px 18px 0;
}
.preview-page-body wiredrawer[data-preview-placement="top"] .preview-overlay-panel {
  top: 0;
  left: 0;
  right: 0;
  height: 280px;
  border-radius: 0 0 18px 18px;
}
.preview-page-body wiredrawer[data-preview-placement="bottom"] .preview-overlay-panel {
  left: 0;
  right: 0;
  bottom: 0;
  height: 280px;
  border-radius: 18px 18px 0 0;
}
.preview-page-body .preview-overlay-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 18px;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
}
.preview-page-body .preview-overlay-title {
  font-size: 15px;
  font-weight: 700;
}
.preview-page-body .preview-overlay-surface {
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
}
.preview-page-body .preview-overlay-body {
  padding: 18px;
  font-size: 13px;
  color: #475569;
  line-height: 1.6;
}
.preview-review {
  display: grid;
  gap: 16px;
}
.preview-review-card {
  background: rgba(255,255,255,0.92);
  border: 1px solid #dbe4ee;
  border-radius: 16px;
  padding: 16px;
}
.preview-review-card h3 {
  margin: 0 0 12px;
  font-size: 14px;
  color: #0f172a;
}
.preview-review-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.preview-review-item {
  border-radius: 12px;
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  font-size: 12px;
  line-height: 1.55;
  color: #334155;
}
.preview-review-item strong {
  color: #0f172a;
  display: block;
  margin-bottom: 4px;
}
.preview-review-checklist {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.preview-review-checklist li {
  border-radius: 12px;
  padding: 10px 12px;
  background: #fff7ed;
  border: 1px solid #fed7aa;
  font-size: 12px;
  line-height: 1.55;
  color: #9a3412;
}
.preview-review-checklist strong {
  color: #7c2d12;
}
.preview-inline-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.preview-inline-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 11px;
  font-weight: 700;
}
.preview-note {
  margin-top: 16px;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(250, 204, 21, 0.12);
  color: #fef3c7;
  border: 1px solid rgba(250, 204, 21, 0.18);
  font-size: 13px;
  line-height: 1.6;
}
@media (max-width: 1440px) {
  .preview-page-grid { grid-template-columns: 1fr; }
}
"""

nav_items = "\n".join(
    f'<li><a href="#{html.escape(item["id"])}">{html.escape(item["title"])}</a></li>'
    for item in sections
)

selection_status = (
    "已联动 template-selection.yaml，侧栏同步展示模板组合、最小上下文、排除项与审查重点。"
    if selection
    else "未发现 template-selection.yaml，当前只能审查页面结构、状态和浮层落位。"
)

pages = "\n".join(
    f"""
    <section class="preview-page" id="{html.escape(item["id"])}">
      <div class="preview-page-header">
        <h2>{html.escape(item["title"])}</h2>
        <code>{html.escape(item["relpath"])}</code>
      </div>
      <div class="preview-page-grid">
        <div class="preview-window">
          <div class="preview-browser">
            <div class="preview-browser-bar">
              <div class="preview-browser-dots"><span></span><span></span><span></span></div>
              <div class="preview-browser-address">/{html.escape(slug)}/{html.escape(item["id"])}</div>
            </div>
            <div class="preview-browser-stage">
              <div class="preview-browser-viewport">
                <div class="preview-page-body preview-wire-root" data-page-id="{html.escape(item["id"])}">
                  {item["template"]}
                </div>
              </div>
            </div>
          </div>
        </div>
        <aside class="preview-review" data-facts='{html.escape(json.dumps(item["facts"], ensure_ascii=False))}'>
          {render_selection_cards(selection)}
          <div class="preview-review-card">
            <h3>布局骨架</h3>
            <div class="preview-inline-chips">
              {"".join(f'<span class="preview-inline-chip">{html.escape(label)}</span>' for label in item["facts"]["layout"]) or '<span class="preview-inline-chip">未识别布局组件</span>'}
            </div>
          </div>
          <div class="preview-review-card">
            <h3>关键操作</h3>
            <ul class="preview-review-list">
              {"".join(f'<li class="preview-review-item"><strong>{html.escape(action["label"])}</strong>节点: {html.escape(action["node"] or "未标注")}<br />类型: {html.escape(action["type"])}</li>' for action in item["facts"]["actions"]) or '<li class="preview-review-item">未识别按钮操作</li>'}
            </ul>
          </div>
          <div class="preview-review-card">
            <h3>状态与反馈</h3>
            <ul class="preview-review-list">
              {"".join(f'<li class="preview-review-item"><strong>{html.escape(state["label"])}</strong>样式: {html.escape(state["type"])}</li>' for state in item["facts"]["states"]) or '<li class="preview-review-item">未识别状态标签</li>'}
            </ul>
          </div>
          <div class="preview-review-card">
            <h3>浮层与方位</h3>
            <ul class="preview-review-list">
              {"".join(f'<li class="preview-review-item"><strong>{html.escape(overlay["kind"])} · {html.escape(overlay["title"])}</strong>方位: {html.escape(overlay["surface"])}<br />节点: {html.escape(overlay["node"] or "未标注")}</li>' for overlay in item["facts"]["overlays"]) or '<li class="preview-review-item">当前页面未声明 Dialog / Drawer</li>'}
            </ul>
          </div>
          <div class="preview-review-card">
            <h3>节点清单</h3>
            <div class="preview-inline-chips">
              {"".join(f'<span class="preview-inline-chip">{html.escape(node)}</span>' for node in item["facts"]["nodes"]) or '<span class="preview-inline-chip">无 data-node</span>'}
            </div>
          </div>
          <div class="preview-review-card">
            <h3>审查问题清单</h3>
            <ul class="preview-review-checklist">
              <li><strong>入口与主任务：</strong>进入页面后，用户要先完成什么？筛选区是否说明“为什么筛”。</li>
              <li><strong>列表初始状态：</strong>默认排序、空态文案、批量动作是否明确，能否判断第一页默认长什么样。</li>
              <li><strong>浮层关系：</strong>弹窗/抽屉从哪里打开、怎么关闭、关闭后回到哪里，是否保留筛选/分页上下文。</li>
              <li><strong>失败与反馈：</strong>加载中、错误、待处理、权限拒绝有没有至少一种可见反馈。</li>
              <li><strong>节点落位：</strong>关键 data-node 是否都挂在用户可见动作或反馈上，而不是只停留在结构层。</li>
            </ul>
          </div>
        </aside>
      </div>
    </section>
    """
    for item in sections
)

hydration_script = """
function textOf(node) {
  return (node.textContent || '').replace(/\\s+/g, ' ').trim();
}

function ensureNodeBadge(node) {
  const value = node.getAttribute('data-node');
  if (!value || node.querySelector(':scope > .preview-node-badge')) return;
  const badge = document.createElement('span');
  badge.className = 'preview-node-badge';
  badge.textContent = value;
  node.appendChild(badge);
}

function bindButtons(root) {
  root.querySelectorAll('wirebutton').forEach((node) => {
    node.dataset.previewType = node.getAttribute('type') || 'default';
    node.dataset.previewText = node.hasAttribute('text') ? 'true' : 'false';
    ensureNodeBadge(node);
  });
}

function bindBadges(root) {
  root.querySelectorAll('wirebadge').forEach((node) => {
    node.dataset.previewType = node.getAttribute('type') || 'info';
  });
}

function bindSidebar(root) {
  root.querySelectorAll('wiresidebar').forEach((node) => {
    if (!node.querySelector(':scope > .preview-wire-sidebar-title')) {
      const title = document.createElement('div');
      title.className = 'preview-wire-sidebar-title';
      title.textContent = node.getAttribute('title') || '侧边导航';
      node.prepend(title);
    }
    if (!node.querySelector(':scope > .preview-wire-sidebar-meta')) {
      const meta = document.createElement('div');
      meta.className = 'preview-wire-sidebar-meta';
      meta.textContent = node.getAttribute('active-path') || node.getAttribute(':menu-items') || 'menu-items';
      node.appendChild(meta);
    }
  });
}

function bindHeader(root) {
  root.querySelectorAll('wireheader').forEach((node) => {
    if (!node.querySelector(':scope > .preview-wire-header-title')) {
      const title = document.createElement('div');
      title.className = 'preview-wire-header-title';
      title.textContent = node.getAttribute('title') || '页面标题';
      node.prepend(title);
    }
    let actions = node.querySelector(':scope > .preview-wire-header-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'preview-wire-header-actions';
      Array.from(node.childNodes).forEach((child) => {
        if (child.nodeType === Node.ELEMENT_NODE && child.classList && child.classList.contains('preview-wire-header-title')) return;
        if (child.nodeType === Node.TEXT_NODE && !child.textContent.trim()) return;
        actions.appendChild(child);
      });
      node.appendChild(actions);
    }
  });
}

function bindMain(root) {
  root.querySelectorAll('wiremain').forEach((node) => {
    if ((node.hasAttribute(':breadcrumbs') || node.hasAttribute('breadcrumbs')) && !node.querySelector(':scope > .preview-wire-breadcrumbs')) {
      const breadcrumbs = document.createElement('div');
      breadcrumbs.className = 'preview-wire-breadcrumbs';
      breadcrumbs.textContent = 'Breadcrumbs · ' + (node.getAttribute(':breadcrumbs') || node.getAttribute('breadcrumbs'));
      node.prepend(breadcrumbs);
    }
  });
}

function bindCards(root) {
  root.querySelectorAll('wirecard').forEach((node) => {
    const title = node.getAttribute('title');
    if (title && !node.querySelector(':scope > .preview-wire-card-title')) {
      const heading = document.createElement('div');
      heading.className = 'preview-wire-card-title';
      heading.textContent = title;
      node.prepend(heading);
    }
  });
}

function ensureBlockPlaceholder(node, label, meta) {
  if (!node.querySelector(':scope > .preview-wire-block-label')) {
    const heading = document.createElement('div');
    heading.className = 'preview-wire-block-label';
    heading.textContent = label;
    node.prepend(heading);
  }
  if (!node.querySelector(':scope > .preview-wire-block-meta')) {
    const body = document.createElement('div');
    body.className = 'preview-wire-block-meta';
    body.textContent = meta;
    node.appendChild(body);
  }
}

function renderFilter(node, facts) {
  if (node.querySelector(':scope > .preview-wire-filter-grid')) return;
  const defs = facts.filters || [];
  ensureBlockPlaceholder(node, 'Filter', '静态预览直接展开筛选字段，帮助审查筛选区布局、字段顺序和查询动作。');
  if (!defs.length) return;
  const grid = document.createElement('div');
  grid.className = 'preview-wire-filter-grid';
  defs.forEach((field) => {
    const item = document.createElement('div');
    item.className = 'preview-wire-filter-item';
    const name = document.createElement('div');
    name.className = 'preview-wire-filter-name';
    name.textContent = field.label || field.prop || '未命名字段';
    const input = document.createElement('div');
    input.className = 'preview-wire-filter-input';
    input.textContent = field.placeholder || (field.type === 'select' ? '请选择' : '请输入');
    item.appendChild(name);
    item.appendChild(input);
    if (field.options && field.options.length) {
      const options = document.createElement('div');
      options.className = 'preview-wire-filter-options';
      options.textContent = '选项: ' + field.options.slice(0, 4).join(' / ');
      item.appendChild(options);
    }
    grid.appendChild(item);
  });
  node.appendChild(grid);
  const meta = facts.filter_meta || {};
  if (meta.primary_goal || meta.search_hint) {
    const wrap = document.createElement('div');
    wrap.className = 'preview-wire-filter-meta';
    if (meta.primary_goal) {
      const hint = document.createElement('div');
      hint.className = 'preview-wire-filter-hint';
      hint.textContent = '主任务: ' + meta.primary_goal;
      wrap.appendChild(hint);
    }
    if (meta.search_hint) {
      const hint = document.createElement('div');
      hint.className = 'preview-wire-filter-hint';
      hint.textContent = '筛选提示: ' + meta.search_hint;
      wrap.appendChild(hint);
    }
    node.appendChild(wrap);
  }
}

function renderTable(node, facts) {
  if (node.querySelector(':scope > .preview-wire-table-shell')) return;
  const cols = facts.tables || [];
  ensureBlockPlaceholder(node, 'Table', '静态预览直接展开列头和前 3 行样例，帮助审查表格密度、操作列和状态分布。');
  if (!cols.length) return;
  const shell = document.createElement('div');
  shell.className = 'preview-wire-table-shell';
  shell.style.setProperty('--col-count', String(Math.max(cols.length, 1)));

  const head = document.createElement('div');
  head.className = 'preview-wire-table-head';
  cols.forEach((col) => {
    const span = document.createElement('span');
    span.textContent = col.label || col.prop || '列';
    head.appendChild(span);
  });
  shell.appendChild(head);

  const rows = (facts.table_data || []).length ? facts.table_data : [{}, {}, {}];
  rows.forEach((row, idx) => {
    const line = document.createElement('div');
    line.className = 'preview-wire-table-row';
    cols.forEach((col) => {
      const span = document.createElement('span');
      const value = row && row[col.prop];
      span.textContent = value || (idx === 0 ? '示例数据' : idx === 1 ? '状态/时间/人名' : '...' );
      line.appendChild(span);
    });
    shell.appendChild(line);
  });
  node.appendChild(shell);

  const note = document.createElement('div');
  note.className = 'preview-wire-table-note';
  note.textContent = '列数: ' + cols.length + ' · 建议审查是否缺少状态列、操作列、空态和批量操作入口。';
  node.appendChild(note);
  const meta = facts.table_meta || {};
  if (meta.empty_text || meta.bulk_hint || meta.default_sort) {
    const wrap = document.createElement('div');
    wrap.className = 'preview-wire-table-meta';
    if (meta.default_sort) {
      const chip = document.createElement('div');
      chip.className = 'preview-wire-table-chip';
      chip.textContent = '默认排序: ' + meta.default_sort;
      wrap.appendChild(chip);
    }
    if (meta.empty_text) {
      const chip = document.createElement('div');
      chip.className = 'preview-wire-table-chip';
      chip.textContent = '空态: ' + meta.empty_text;
      wrap.appendChild(chip);
    }
    if (meta.bulk_hint) {
      const chip = document.createElement('div');
      chip.className = 'preview-wire-table-chip';
      chip.textContent = '批量动作: ' + meta.bulk_hint;
      wrap.appendChild(chip);
    }
    node.appendChild(wrap);
  }
}

function bindBlocks(root) {
  const facts = JSON.parse(root.closest('.preview-page-grid').querySelector('.preview-review').dataset.facts || '{}');
  root.querySelectorAll('wirefilter').forEach((node) => {
    renderFilter(node, facts);
  });
  root.querySelectorAll('wiretable').forEach((node) => {
    renderTable(node, facts);
  });
  root.querySelectorAll('wirepagination').forEach((node) => {
    ensureBlockPlaceholder(node, 'Pagination', '分页承接列表翻页语义；静态预览中显示为占位块。');
  });
  root.querySelectorAll('wireform').forEach((node) => {
    ensureBlockPlaceholder(node, 'Form', '表单字段由 slot/子组件承接；静态预览重点审查字段分组、提交区和错误反馈。');
  });
  root.querySelectorAll('wiretabs').forEach((node) => {
    ensureBlockPlaceholder(node, 'Tabs', '标签页切换语义在运行时生效；静态预览中保留为结构占位。');
  });
  root.querySelectorAll('wiredesclist').forEach((node) => {
    ensureBlockPlaceholder(node, 'DescList', '描述列表承接详情型内容；静态预览中显示为说明块。');
  });
}

function bindOverlay(root) {
  const facts = JSON.parse(root.closest('.preview-page-grid').querySelector('.preview-review').dataset.facts || '{}');
  const overlays = facts.overlays || [];
  root.querySelectorAll('wiredialog, wiredrawer').forEach((node) => {
    if (node.querySelector(':scope > .preview-overlay-mask')) return;
    const kind = node.tagName.toLowerCase() === 'wiredialog' ? 'Dialog' : 'Drawer';
    const placement = node.getAttribute('placement') || (kind === 'Drawer' ? 'right' : 'center');
    const current = overlays.find((item) =>
      (item.node && item.node === node.getAttribute('data-node')) ||
      ((item.title || '') === (node.getAttribute('title') || ''))
    ) || {};
    if (kind === 'Drawer') node.dataset.previewPlacement = placement;

    const mask = document.createElement('div');
    mask.className = 'preview-overlay-mask';
    const panel = document.createElement('div');
    panel.className = 'preview-overlay-panel';
    const header = document.createElement('div');
    header.className = 'preview-overlay-header';
    const title = document.createElement('div');
    title.className = 'preview-overlay-title';
    title.textContent = node.getAttribute('title') || kind;
    const surface = document.createElement('div');
    surface.className = 'preview-overlay-surface';
    surface.textContent = kind === 'Dialog' ? 'centered-dialog' : placement + '-drawer';
    header.appendChild(title);
    header.appendChild(surface);
    const body = document.createElement('div');
    body.className = 'preview-overlay-body';
    body.innerHTML = [
      '<div><strong>触发源:</strong> ' + (current.trigger || '未声明，请补充 data-trigger 或在命名中体现') + '</div>',
      '<div><strong>关闭方式:</strong> ' + (current.close || '右上角关闭 / 遮罩关闭') + '</div>',
      '<div><strong>关闭后:</strong> ' + (current.after_close || '回到底层页面并保留上下文') + '</div>',
      '<div><strong>说明:</strong> ' + (textOf(node) || '静态预览显示浮层位置、层级和节点落位；具体开关逻辑由运行时代码承接。') + '</div>'
    ].join('');
    panel.appendChild(header);
    panel.appendChild(body);
    node.innerHTML = '';
    node.appendChild(mask);
    node.appendChild(panel);
    ensureNodeBadge(title.parentElement);
  });
}

document.querySelectorAll('.preview-wire-root').forEach((root) => {
  bindButtons(root);
  bindBadges(root);
  bindSidebar(root);
  bindHeader(root);
  bindMain(root);
  bindCards(root);
  bindBlocks(root);
  bindOverlay(root);
});
"""

output = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{html.escape(slug)} wire preview</title>
  <style>
  {base_style}
  {' '.join(styles)}
  </style>
</head>
<body>
  <div class="preview-shell">
    <aside class="preview-nav">
      <h1>{html.escape(slug)} Wire Preview</h1>
      <p>由 wire/*.vue 自动生成的静态预览页，用于直接在浏览器中审查页面骨架、浮层方位、状态反馈和 data-node 落位。</p>
      <ul>{nav_items}</ul>
      <div class="preview-nav-legend">
        <span class="preview-nav-chip">Browser Frame 审查真实窗口感</span>
        <span class="preview-nav-chip">Review Panel 审查动作/状态/浮层</span>
        <span class="preview-nav-chip">data-node 审查节点落位</span>
      </div>
      <div class="preview-note">{html.escape(selection_status)}</div>
      <div class="preview-note">这是静态预览，不执行真实 Vue 逻辑。它的职责不是模拟业务运行，而是把布局、浮层、状态和节点位置变成可审查的窗口稿。</div>
    </aside>
    <main class="preview-main">
      {pages}
    </main>
  </div>
  <script>
  {hydration_script}
  </script>
</body>
</html>
"""

output_file.write_text(output, encoding="utf-8")
print(output_file)
PY
