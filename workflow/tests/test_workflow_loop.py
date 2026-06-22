"""workflow_loop 验收循环单测。@covers B01-R04(迁移)/ B01-R05(重跑)"""
from pathlib import Path

from workflow.run_workflow import workflow_loop, MAX_ITER


def _setup_task(tmp_path, iter_n=1):
    """建 task_dir + current-iteration。"""
    (tmp_path / "prd.md").write_text("x", encoding="utf-8")
    xdd = tmp_path / ".xdd"
    xdd.mkdir(exist_ok=True)
    (xdd / "current-iteration").write_text(f"iter-{iter_n}", encoding="utf-8")
    # 建各节点产出目录占位(让 output_doc 的父目录存在,build_nodes 不会报错)
    return tmp_path


def test_passes_first_try(tmp_path, monkeypatch):
    """verify 一次过,不迁移。"""
    _setup_task(tmp_path)
    ran = []
    def fake_run(node, td, it, bz, model):
        ran.append((node["name"], it)); return True
    assert workflow_loop(tmp_path, run_node_fn=fake_run,
                         gate_fn=lambda *a: True) is True
    # 八节点各跑一次,iter 都是 1
    assert len(ran) == 8
    assert all(it == 1 for _, it in ran)


def test_iter_migration_on_fail(tmp_path, monkeypatch):
    """verify 未过 → 迁移到 iter-2 重跑。@covers R04/R05"""
    _setup_task(tmp_path)
    calls = {"migrate": [], "run": []}
    pass_at = {"iter": 2}  # iter-2 才过

    def fake_run(node, td, it, bz, model):
        calls["run"].append((node["name"], it)); return True
    def fake_migrate(td, n):
        calls["migrate"].append(n)
        # 模拟 init 迁移:更新 current-iteration
        (td / ".xdd" / "current-iteration").write_text(f"iter-{n}")
        return True
    def fake_gate(td, doc):
        # 读 current-iteration 判定
        ci = (td / ".xdd" / "current-iteration").read_text()
        return ci == f"iter-{pass_at['iter']}"

    assert workflow_loop(tmp_path, run_node_fn=fake_run, migrate_fn=fake_migrate, gate_fn=fake_gate) is True
    assert calls["migrate"] == [2]              # 迁移到 iter-2
    # iter-1 跑了八节点,iter-2 重跑了(产物存在跳过逻辑:新 iter 目录空,plan/exec/verify 重跑)
    iter2_runs = [n for n, it in calls["run"] if it == 2]
    assert "verify" in iter2_runs


def test_max_iter_stops(tmp_path, monkeypatch):
    """verify 永不过 → 达 MAX_ITER 停。@covers R04 resilience F07"""
    _setup_task(tmp_path)
    monkeypatch.setattr("workflow.run_workflow.MAX_ITER", 3)
    migrates = []
    def fake_migrate(td, n):
        migrates.append(n)
        (td / ".xdd" / "current-iteration").write_text(f"iter-{n}")
        return True
    assert workflow_loop(tmp_path,
                         run_node_fn=lambda *a: True,
                         migrate_fn=fake_migrate,
                         gate_fn=lambda *a: False) is False  # 永不过
    assert migrates == [2, 3]  # 从 1 迁到 2、3,达 MAX_ITER=3 停


def test_node_failure_aborts(tmp_path, monkeypatch):
    """节点跑失败则中止。@covers R04(F05 阻塞)"""
    _setup_task(tmp_path)
    def fake_run(node, td, it, bz, model):
        return node["name"] != "spec"  # spec 失败
    monkeypatch.setattr("workflow.run_workflow.run_node", fake_run)
    assert workflow_loop(tmp_path, run_node_fn=fake_run) is False
