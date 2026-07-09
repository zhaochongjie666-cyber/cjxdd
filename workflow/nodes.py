"""八节点定义,产出路径忠实 8 个 skill 的真实产出。

旧版 build_nodes 把产出路径硬编码错了 7/8(如 spec 写成 design/spec/rules.md,
实际 skill 产 design/spec/{bxx}/rules.md + *.feature)。本模块对照 spec/B01-cli/
rules.md 的「八节点产出路径对照」表,数据驱动声明真实路径。

@implements B01-R01 八节点产出路径忠实 skill
@implements B01-R02 节点 prompt 注入完整上下文
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from .models import DEFAULT_MODEL

# 八节点定义:(name, skill_cmd, [产出路径模板], gate)
# 路径模板占位:{bxx}=业务线 slug,{N}=iter 号,{page}=页面名。
# 对照 spec/B01-cli/rules.md 路径表 + 各 skill SKILL.md 真实产出。
NODE_DEFS: list[tuple[str, str, list[str], bool]] = [
    ("brainstorm", "use skill: xdd-brainstorm",
     ["design/intent.md", "design/design.md"], False),
    ("spec", "use skill: xdd-spec",
     ["design/spec/_landscape.md", "design/spec/{bxx}/business.md",
      "design/spec/{bxx}/rules.md"], False),
    ("architecture", "use skill: xdd-architecture",
     ["design/architecture/aggregate-landscape.md",
      "design/architecture/event-contract.md",
      "design/architecture/{bxx}/architecture.md",
      "design/architecture/{bxx}/flow.mermaid"], False),
    ("wire", "use skill: xdd-wire",
     ["design/wire/{page}/index.html"], False),
    ("resilience", "use skill: xdd-resilience",
     ["design/architecture/{bxx}/resilience/failure-modes.md",
      "design/architecture/{bxx}/resilience/failsafe-design.md"], False),
    ("plan", "use skill: xdd-plan",
     ["runs/iter-{N}/plan/{bxx}/plan.md"], False),
    ("execute", "use skill: xdd-execute",
     ["runs/iter-{N}/audits/build.md"], False),
    ("verify", "use skill: xdd-verify",
     ["runs/iter-{N}/verify-report.md"], True),
]

# 各节点的上游指针提示(注入 prompt)。对照各 skill SKILL.md 的「上游消费者」。
_UPSTREAM_HINT: dict[str, str] = {
    "spec": "上游:读 design/design.md + design/intent.md(意图→规则)",
    "architecture": "上游:读 spec 规则(spec/{bxx}/rules.md)+ design.md(规则→结构)",
    "wire": "上游:读 spec/*.feature(页面名/交互)+ design.md(出页面清单)",
    "resilience": "上游:读 architecture/{bxx}/architecture.md §ODD 失败模型 + spec *.feature(找反面)",
    "plan": "上游:读全部设计锚(spec/architecture/wire/resilience)拆 task",
    "execute": "上游:读 runs/iter-{N}/plan/{bxx}/plan.md 按 task 写代码",
    "verify": "对照 spec RXX + architecture 端点双契约验代码,4 维一致性审计",
}


def build_nodes(task_dir, bizline: str = "B01", iter_n: int = 1) -> list[dict[str, Any]]:
    """构建八节点列表。每节点含 name/skill/output_doc(业务线主产物)/gate/model。

    Args:
        task_dir: 任务目录(用于拼绝对产出路径)。
        bizline: 业务线 slug(如 B01-cli,完整保留作路径里的 {bxx})。
        iter_n: iter 号(注入 plan/execute/verify 路径)。

    Note:
        output_doc 取该节点**含 {bxx} 的业务线主产物**(代表产出),若该节点无业务线
        子目录产出(如 brainstorm 产项目层 intent.md),则取首个。
    """
    nodes: list[dict[str, Any]] = []
    for name, skill, outputs, gate in NODE_DEFS:
        formatted = [o.format(bxx=bizline, N=iter_n, page="index") for o in outputs]
        # 代表产出:优先含 {bxx} 的(业务线主产物),否则取首个
        bxx_outputs = [o for o in formatted if bizline in o]
        od = bxx_outputs[0] if bxx_outputs else formatted[0]
        nodes.append({
            "name": name,
            "skill": skill,
            "output_doc": od,
            "gate": gate,
            "model": DEFAULT_MODEL,
            "all_outputs": formatted,
        })
    return nodes


def node_prompt(node: dict[str, Any], task_dir, iter_n: int,
                bizline: str = "B01", extra: str = "") -> str:
    """构造含完整上下文的节点 prompt。

    注入:skill 入口、任务目录、业务线、iter 号、上游指针、产出文档、自检要求。

    @implements B01-R02
    """
    name = node["name"]
    output_doc = Path(node["output_doc"])
    if not output_doc.is_absolute():
        output_doc = Path(task_dir) / output_doc
    upstream = _UPSTREAM_HINT.get(name, "")
    return f"""{node['skill']}，不要问问题，自主选择最优方案。
任务目录: {task_dir}
业务线: {bizline}  iter: {iter_n}
需求文档: {Path(task_dir) / 'prd.md'}
{upstream}
{extra}
产出文档: {output_doc}（文档末尾必须含本节点自检清单，用 □ 或 - [ ] 标记各项，完成的改 ☑ 或 - [x]）"""
