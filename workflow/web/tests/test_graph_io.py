"""graph_io 单测。@covers B02-R01/R02/R06"""
from workflow.web.graph_io import default_graph, validate_graph, load_graph, save_graph


def test_default_8_nodes():
    g = default_graph("/tmp/x")
    assert len(g["nodes"]) == 8
    names = [n["name"] for n in g["nodes"]]
    assert names == ["brainstorm", "spec", "architecture", "wire", "resilience",
                     "plan", "execute", "verify"]


def test_default_node_seven_fields():
    """每节点 7 字段。@covers R01"""
    g = default_graph("/tmp/x")
    for n in g["nodes"]:
        assert all(k in n for k in ("id", "name", "skill", "output_doc", "model", "extra", "gate"))


def test_default_verify_is_gate():
    g = default_graph("/tmp/x")
    verify = next(n for n in g["nodes"] if n["name"] == "verify")
    assert verify["gate"] is True


def test_default_has_loop_edge():
    """默认图含 verify→execute 回退边。@covers R06"""
    g = default_graph("/tmp/x")
    loops = [e for e in g["edges"] if e["type"] == "loop"]
    assert len(loops) == 1
    assert loops[0]["condition"] == "gate_fail"
    by_name = {n["id"]: n["name"] for n in g["nodes"]}
    assert by_name[loops[0]["from"]] == "verify"
    assert by_name[loops[0]["to"]] == "execute"


def test_next_cycle_rejected():
    """next 边成环拒绝。@covers R02"""
    g = {"nodes": [
        {"id": "a", "name": "x", "skill": "s", "output_doc": "o", "model": "Y", "extra": "", "gate": False},
        {"id": "b", "name": "y", "skill": "s", "output_doc": "o", "model": "Y", "extra": "", "gate": False}],
        "edges": [{"from": "a", "to": "b", "type": "next"}, {"from": "b", "to": "a", "type": "next"}]}
    errs = validate_graph(g)
    assert any("环" in e for e in errs)


def test_loop_cycle_allowed():
    """loop 边成环允许(那是循环的本意)。@covers R02"""
    g = {"nodes": [
        {"id": "a", "name": "x", "skill": "s", "output_doc": "o", "model": "Y", "extra": "", "gate": False},
        {"id": "b", "name": "y", "skill": "s", "output_doc": "o", "model": "Y", "extra": "", "gate": False}],
        "edges": [{"from": "a", "to": "b", "type": "next"}, {"from": "b", "to": "a", "type": "loop", "condition": "gate_fail"}]}
    assert validate_graph(g) == []


def test_dup_id_rejected():
    g = {"nodes": [
        {"id": "a", "name": "x", "skill": "s", "output_doc": "o", "model": "Y", "extra": "", "gate": False},
        {"id": "a", "name": "y", "skill": "s", "output_doc": "o", "model": "Y", "extra": "", "gate": False}],
        "edges": []}
    assert any("重复" in e for e in validate_graph(g))


def test_missing_skill_rejected():
    g = {"nodes": [{"id": "a", "name": "x", "skill": "", "output_doc": "o", "model": "Y", "extra": "", "gate": False}], "edges": []}
    assert any("skill" in e for e in validate_graph(g))


def test_load_missing_falls_back_default(tmp_path):
    """graph.json 不存在回退默认图。@covers R06"""
    g = load_graph(tmp_path)
    assert len(g["nodes"]) == 8


def test_load_corrupt_falls_back_default(tmp_path):
    """graph.json 损坏回退默认图。@covers R06 容错"""
    xdd = tmp_path / ".xdd"; xdd.mkdir()
    (xdd / "graph.json").write_text("{broken", encoding="utf-8")
    g = load_graph(tmp_path)
    assert len(g["nodes"]) == 8  # 回退默认


def test_save_load_roundtrip(tmp_path):
    g = default_graph(tmp_path)
    save_graph(tmp_path, g)
    loaded = load_graph(tmp_path)
    assert len(loaded["nodes"]) == 8
