"""VLA sim-svc — SQLAlchemy ORM models (scaffold 阶段).

Phase 5 后切到 Alembic 管理, 但 scaffold 阶段用 ORM auto-create_table
+ 已写好的迁移 SQL, 二者保持一致 (UUID v4 / created_at / updated_at / project_id RLS).
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from vla_db.base import Base


class Project(Base):
    """多租户根实体 — scaffold 简化为 SQLite/PG 通用."""

    __tablename__ = "projects"

    # PG 用 UUID + server_default, SQLite 用 String(36) + Python uuid
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class SimJob(Base):
    """B01 仿真任务聚合根 — scaffold 阶段: 核心字段 + JSONB 任务规格."""

    __tablename__ = "sim_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    task_name: Mapped[str] = mapped_column(String(255), nullable=False)
    engine: Mapped[str] = mapped_column(String(32), nullable=False)
    num_episodes: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="created")
    task_spec: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    physics_config: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    requested_by: Mapped[str] = mapped_column(String(36), nullable=False)
    cost_estimate_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
