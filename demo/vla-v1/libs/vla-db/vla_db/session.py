"""SQLAlchemy 2.0 session 工厂 + RLS session var 注入.

每个请求进来时:
  1. 从 contextvar 拿 current_user_id / current_project_id
  2. 开 session
  3. 在 PG 连接上 SET LOCAL app.current_project_id = '<uuid>'
  4. 业务 query
  5. close (SET LOCAL 自动 rollback)
"""
from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from vla_common.config import get_settings
from vla_common.middleware import current_project_id, current_user_id, is_admin


def init_db() -> None:
    """Scaffold 阶段: 用 ORM metadata.create_all 建表.

    Phase 5 后切到 Alembic (迁移文件已在 apps/*/migrations/versions/).
    """
    from vla_db.base import Base

    # sim-svc 的 models 也需要 import 才会注册到 Base.metadata
    try:
        from vla.sim.models import Project, SimJob  # noqa: F401
    except ImportError:
        pass  # 不是 sim-svc 进程 (例如脚本调用)

    engine = get_engine()
    Base.metadata.create_all(engine)


def get_engine() -> Engine:
    """按 settings 拼 URL, 返回 engine.

    dev / scaffold 阶段允许 SQLite (无 Docker), 跑通后再切 PG.
    """
    settings = get_settings()
    url = settings.database_url_resolved

    if url.startswith("sqlite"):
        # SQLite 用于本地 smoke (无 Docker), 走内存 + 单连接
        return create_engine(
            url,
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
            future=True,
        )

    return create_engine(
        url,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
        pool_recycle=3600,
        future=True,
    )


def get_session_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), autoflush=False, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    """FastAPI 依赖: 每个请求一个 session."""
    factory = get_session_factory()
    session = factory()
    try:
        _set_rls_on_session(session)
        yield session
    finally:
        session.close()


def set_rls_session_vars(session: Session) -> None:
    """对外公开: 显式设 PG session var (for alembic / scripts)."""
    _set_rls_on_session(session)


def _set_rls_on_session(session: Session) -> None:
    """从 contextvar 拿值, 注入到当前 session 的 PG 连接."""
    project_id = current_project_id.get()
    user_id = current_user_id.get()
    admin = is_admin.get()

    bind = session.get_bind()
    # SQLite 跳过 (没有 RLS 概念)
    if bind.dialect.name == "sqlite":
        return

    # 获取底层 connection, SET LOCAL (transaction-scoped)
    conn = session.connection()
    if project_id:
        conn.exec_driver_sql(f"SET LOCAL app.current_project_id = '{project_id}'")
    if user_id:
        conn.exec_driver_sql(f"SET LOCAL app.current_user_id = '{user_id}'")
    if admin:
        conn.exec_driver_sql("SET LOCAL app.is_admin = 'true'")


# 调试用
__all__ = ["get_engine", "get_session", "get_session_factory", "set_rls_session_vars", "Any"]
