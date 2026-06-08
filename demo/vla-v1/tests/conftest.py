"""xdd-platform 全局 pytest fixtures.

被 apps/*/tests/ 共享. 业务服务自己的 conftest.py 补充服务级 fixture.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

# 让 tests/ 导入 libs/ apps/ 共享代码
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "libs" / "vla-common"))
sys.path.insert(0, str(ROOT / "libs" / "vla-db"))


# === 环境 ===
@pytest.fixture(scope="session", autouse=True)
def _setup_env() -> None:
    """测试 session 启动时设置最小环境变量."""
    os.environ.setdefault("ENV", "test")
    os.environ.setdefault("LOG_LEVEL", "WARN")
    # 数据库连接 (smoke test 用真实 DB, 默认连 compose dev)
    os.environ.setdefault("POSTGRES_HOST", "localhost")
    os.environ.setdefault("POSTGRES_PORT", "5432")
    os.environ.setdefault("POSTGRES_DB", "vla")
    os.environ.setdefault("POSTGRES_USER", "vla")
    os.environ.setdefault("POSTGRES_PASSWORD", "vla_dev_password")


# === 临时项目 ID (RLS 测试) ===
@pytest.fixture
def project_id() -> str:
    """测试用 project UUID (RLS session var)."""
    import uuid

    return str(uuid.uuid4())


# === HTTP client (每个测试函数独立) ===
@pytest.fixture
def http_client():
    """httpx 异步客户端 (用于 e2e / smoke)."""
    import httpx

    return httpx.AsyncClient(timeout=30.0, base_url="http://localhost:8000")


# === Marker 守卫 ===
def pytest_configure(config: pytest.Config) -> None:
    """注册自定义 marker (已被 pyproject.toml 覆盖, 此处双保险)."""
    config.addinivalue_line("markers", "smoke: 环境冒烟 (Phase 2.7)")
    config.addinivalue_line("markers", "chaos: 混沌测试 (Phase 3 L3)")


# === 失败日志辅助 ===
@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_runtest_makereport(item: pytest.Item, call: pytest.CallInfo):
    """测试失败时记录上下文 (输出到 pytest stderr)."""
    outcome = yield
    rep = outcome.get_result()
    if rep.failed and call.excinfo is not None:
        # 让 L5 stop-gate 能 grep "FAILED test_"
        print(f"\n>>> FAILED {item.nodeid}: {call.excinfo.value!r}", file=sys.stderr)
