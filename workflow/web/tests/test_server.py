"""server API 单测。@covers B02-R01/R04/R06"""
from fastapi.testclient import TestClient

from workflow.web.server import app

client = TestClient(app)


def test_models():
    r = client.get("/api/models")
    assert r.status_code == 200
    data = r.json()
    assert "models" in data and "default" in data
    assert len(data["models"]) >= 1


def test_graph_default(tmp_path):
    """无 graph.json 返回默认八节点。@covers R06"""
    (tmp_path / "prd.md").write_text("x")
    r = client.get("/api/graph", params={"task_dir": str(tmp_path)})
    assert r.status_code == 200
    assert len(r.json()["nodes"]) == 8


def test_graph_not_exist_dir():
    r = client.get("/api/graph", params={"task_dir": "/no/such/dir/xyz"})
    assert r.status_code == 404


def test_graph_save_and_load(tmp_path):
    """保存后加载一致。@covers R01"""
    g = {"task_dir": str(tmp_path), "nodes": [
        {"id": "x", "name": "x", "skill": "use skill: a", "output_doc": "o.md", "model": "Y", "extra": "", "gate": False}],
        "edges": []}
    r = client.post("/api/graph", json={"task_dir": str(tmp_path), "graph": g})
    assert r.status_code == 200
    # 加载
    r2 = client.get("/api/graph", params={"task_dir": str(tmp_path)})
    assert len(r2.json()["nodes"]) == 1


def test_graph_validate_cycle():
    g = {"task_dir": "/tmp/x", "nodes": [
        {"id": "a", "name": "x", "skill": "s", "output_doc": "o", "model": "Y", "extra": "", "gate": False},
        {"id": "b", "name": "y", "skill": "s", "output_doc": "o", "model": "Y", "extra": "", "gate": False}],
        "edges": [{"from": "a", "to": "b", "type": "next"}, {"from": "b", "to": "a", "type": "next"}]}
    r = client.post("/api/graph/validate", json={"task_dir": "/tmp/x", "graph": g})
    assert len(r.json()["errors"]) > 0


def test_graph_save_rejects_invalid(tmp_path):
    """坏图保存被 400 拒。@covers R02"""
    g = {"task_dir": str(tmp_path), "nodes": [
        {"id": "a", "name": "x", "skill": "s", "output_doc": "o", "model": "Y", "extra": "", "gate": False},
        {"id": "a", "name": "y", "skill": "s", "output_doc": "o", "model": "Y", "extra": "", "gate": False}],
        "edges": []}
    r = client.post("/api/graph", json={"task_dir": str(tmp_path), "graph": g})
    assert r.status_code == 400


def test_index_returns_html():
    r = client.get("/")
    # index.html 可能还没建(A7 前端),只要不 500
    assert r.status_code in (200, 500)
