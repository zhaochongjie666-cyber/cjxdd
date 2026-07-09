"""nodes 八节点定义单测。@covers B01-R01(路径忠实)/ B01-R02(prompt 注入)"""
from pathlib import Path

from workflow.nodes import build_nodes, node_prompt, NODE_DEFS


def test_eight_nodes():
    nodes = build_nodes("/tmp/x", bizline="B01-cli", iter_n=1)
    assert len(nodes) == 8
    names = [n["name"] for n in nodes]
    assert names == ["brainstorm", "spec", "architecture", "wire", "resilience",
                     "plan", "execute", "verify"]


def test_spec_output_uses_bizline_subdir(tmp_path):
    """spec 产出必须落到业务线子目录,不是扁平 rules.md。@covers R01"""
    nodes = build_nodes(tmp_path, bizline="B01-cli", iter_n=1)
    spec = next(n for n in nodes if n["name"] == "spec")
    # output_doc 是业务线主产物(含 B01-cli 子目录)
    assert "B01-cli" in spec["output_doc"]
    # all_outputs 应同时含全局 _landscape.md 和业务线子目录 rules.md
    assert any("design/spec/_landscape.md" == o for o in spec["all_outputs"])
    assert any("B01-cli" in o and o.endswith("rules.md") for o in spec["all_outputs"])
    assert "design/spec/rules.md" not in spec["all_outputs"]  # 不是扁平旧路径


def test_resilience_colocation(tmp_path):
    """resilience 产出 colocation 到 architecture/{bxx}/resilience/。@covers R01"""
    nodes = build_nodes(tmp_path, bizline="B01-cli", iter_n=1)
    res = next(n for n in nodes if n["name"] == "resilience")
    assert "architecture/B01-cli/resilience/" in res["output_doc"]


def test_iter_injected_in_paths(tmp_path):
    """plan/execute/verify 路径含 iter 号。@covers R01/R06"""
    nodes = build_nodes(tmp_path, bizline="B01-cli", iter_n=3)
    plan = next(n for n in nodes if n["name"] == "plan")
    execute = next(n for n in nodes if n["name"] == "execute")
    verify = next(n for n in nodes if n["name"] == "verify")
    assert "iter-3" in plan["output_doc"]
    assert "iter-3" in execute["output_doc"]
    assert "runs/iter-3/verify-report.md" in verify["output_doc"]


def test_verify_is_gate(tmp_path):
    nodes = build_nodes(tmp_path, bizline="B01", iter_n=1)
    verify = next(n for n in nodes if n["name"] == "verify")
    assert verify["gate"] is True
    # 其余节点不是 gate
    assert all(n["gate"] is False for n in nodes if n["name"] != "verify")


def test_bizline_slug_extraction(tmp_path):
    """B01-cli → 路径用 cli 作 slug。"""
    nodes = build_nodes(tmp_path, bizline="B02-web", iter_n=1)
    arch = next(n for n in nodes if n["name"] == "architecture")
    assert "architecture/B02-web/" in arch["output_doc"] or "architecture/web/" in arch["output_doc"]


def test_prompt_has_context(tmp_path):
    """prompt 含 skill/业务线/iter/上游/自检要求。@covers R02"""
    (tmp_path / "prd.md").write_text("需求", encoding="utf-8")
    nodes = build_nodes(tmp_path, bizline="B01-cli", iter_n=2)
    spec = next(n for n in nodes if n["name"] == "spec")
    p = node_prompt(spec, tmp_path, iter_n=2, bizline="B01-cli")
    assert "use skill: xdd-spec" in p
    assert "B01-cli" in p          # 业务线
    assert "iter: 2" in p          # iter
    assert "design.md" in p        # 上游指针
    assert "□" in p or "- [ ]" in p  # 自检要求


def test_prompt_execute_has_plan_upstream(tmp_path):
    (tmp_path / "prd.md").write_text("x", encoding="utf-8")
    nodes = build_nodes(tmp_path, bizline="B01-cli", iter_n=1)
    execute = next(n for n in nodes if n["name"] == "execute")
    p = node_prompt(execute, tmp_path, iter_n=1, bizline="B01-cli")
    assert "plan" in p.lower()  # 含 plan 上游提示
