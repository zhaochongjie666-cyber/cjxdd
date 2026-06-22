"""iter_utils 单测。@covers B01-R06"""
from workflow.iter_utils import current_iter


def _write_ci(tmp_path, content):
    d = tmp_path / ".xdd"
    d.mkdir(exist_ok=True)
    (d / "current-iteration").write_text(content, encoding="utf-8")


def test_normal(tmp_path):
    _write_ci(tmp_path, "iter-4")
    assert current_iter(tmp_path) == 4


def test_double_digit(tmp_path):
    _write_ci(tmp_path, "iter-12")
    assert current_iter(tmp_path) == 12


def test_missing(tmp_path):
    """文件不存在回退默认。"""
    assert current_iter(tmp_path) == 1


def test_garbage(tmp_path):
    """内容无可解析数字回退默认。"""
    _write_ci(tmp_path, "garbage")
    assert current_iter(tmp_path) == 1


def test_empty(tmp_path):
    _write_ci(tmp_path, "")
    assert current_iter(tmp_path) == 1


def test_custom_default(tmp_path):
    assert current_iter(tmp_path, default=7) == 7
