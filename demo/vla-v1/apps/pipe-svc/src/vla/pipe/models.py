"""Pipe 域 ORM (X 跨业务线: PipelineRun / PipelineStage / StageStatus).

3 聚合根: PipelineRun / PipelineStage / StageEvent.
状态机 (per .xdd/add/architecture-decision.md §6.5):
  PipelineRun: created -> running -> (paused -> running) -> completed | failed | cancelled
  PipelineStage: pending -> running -> completed | failed | skipped
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from vla_db.base import Base


# === 状态机常量 ===
class PipelineRunStatus:
    CREATED = "created"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

    TERMINAL = frozenset({COMPLETED, FAILED, CANCELLED})


class StageStatus:
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"

    TERMINAL = frozenset({COMPLETED, FAILED, SKIPPED})


# === 4 Stage 类型 (VLA pipeline 固定) ===
VALID_STAGES = ("B01_sim", "B02_coll", "B03_train", "B04_eval")


class PipelineRun(Base):
    """X-R01 / X-R11: 端到端 pipeline 编排聚合根.

    4 阶段固定 (B01 sim → B02 coll (real data) → B03 train → B04 eval).
    PM 1 键启动 → 创建 PipelineRun + 4 PipelineStage records.
    """

    __tablename__ = "pipeline_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    task_description: Mapped[str] = mapped_column(String(1024), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=PipelineRunStatus.CREATED)
    current_stage_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_retry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # stage_id 引用 (B01 sim_job_id / B02 collection_session_id / B03 training_job_id / B04 eval_job_id)
    stage_resource_ids: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_by: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class PipelineStage(Base):
    """PipelineRun 下的 4 阶段 (B01/B02/B03/B04)."""

    __tablename__ = "pipeline_stages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    pipeline_run_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    stage: Mapped[str] = mapped_column(String(16), nullable=False)  # B01_sim / B02_coll / ...
    stage_index: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=StageStatus.PENDING)
    resource_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # B01 sim_job_id
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
