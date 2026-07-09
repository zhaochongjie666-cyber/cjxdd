"""gate 验收闸单测。@covers B01-R03"""
from pathlib import Path

from workflow.gate import gate_check


def test_box_all_pass(tmp_path):
    f = tmp_path / "r.md"
    f.write_text("☑ done1\n☑ done2\n", encoding="utf-8")
    passed, stats = gate_check(f)
    assert passed is True
    assert stats["incomplete"] == 0
    assert stats["completed"] == 2


def test_box_with_incomplete(tmp_path):
    f = tmp_path / "r.md"
    f.write_text("□ todo\n☑ done\n", encoding="utf-8")
    passed, stats = gate_check(f)
    assert passed is False
    assert stats["incomplete"] == 1


def test_ascii_all_pass(tmp_path):
    f = tmp_path / "r.md"
    f.write_text("- [x] done\n", encoding="utf-8")
    passed, _ = gate_check(f)
    assert passed is True


def test_ascii_with_incomplete(tmp_path):
    f = tmp_path / "r.md"
    f.write_text("- [ ] todo\n- [x] done\n", encoding="utf-8")
    passed, _ = gate_check(f)
    assert passed is False


def test_mixed_incomplete(tmp_path):
    f = tmp_path / "r.md"
    f.write_text("☑ a\n- [ ] b\n", encoding="utf-8")
    passed, _ = gate_check(f)
    assert passed is False


def test_not_exist(tmp_path):
    passed, stats = gate_check(tmp_path / "no_such.md")
    assert passed is False
    assert stats["exists"] is False


def test_empty_no_checklist(tmp_path):
    """全空文档(无任何自检项)判未过(completed 必须 >0)。"""
    f = tmp_path / "r.md"
    f.write_text("# 只有个标题\n\n正文\n", encoding="utf-8")
    passed, stats = gate_check(f)
    assert passed is False
    assert stats["completed"] == 0
