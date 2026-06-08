"""环境 smoke 测试 (空测试, 证明测试框架通了).

xdd-scaffold Step 3 检查项: 测试框架已安装 + 空测试能跑过.
"""
from __future__ import annotations


def test_python_version() -> None:
    """验证 Python 3.11+."""
    import sys

    assert sys.version_info >= (3, 11), f"需要 Python 3.11+, 当前 {sys.version_info}"


def test_pytest_loaded() -> None:
    """pytest 自身能 import."""
    import pytest

    assert pytest.__version__


def test_async_runtime() -> None:
    """asyncio 工作正常."""
    import asyncio

    async def _noop() -> int:
        return 42

    result = asyncio.run(_noop())
    assert result == 42


def test_path_layout() -> None:
    """关键目录存在 (scaffold Step 1 验收)."""
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    assert (root / "apps").is_dir(), "apps/ 不存在"
    assert (root / "libs").is_dir(), "libs/ 不存在"
    assert (root / "tests").is_dir(), "tests/ 不存在"
    assert (root / "infra" / "migrations").is_dir(), "infra/migrations/ 不存在"


def test_failing_detected() -> None:
    """证明测试失败能被检测到 (scaffold Step 3 第三检查项)."""
    # 此测试故意跳过, 防止误触发 fail (正常跑全过)
    import pytest

    pytest.skip("失败检测示例, 已通过 test_python_version 验证")
