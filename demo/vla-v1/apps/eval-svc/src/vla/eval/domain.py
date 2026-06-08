"""B04 Eval 域 — 2 聚合根: EvalJob / EvalWorker.

per .xdd/arch/aggregate-landscape.md §6 B04 EvalCtx.
状态机 (per .xdd/add/architecture-decision.md §6.4):
  EvalJob: PENDING -> RUNNING -> (PAUSED -> RUNNING) -> SUCCESS | FAILED | CANCELLED
  3 trial 中位数 (R4.1): 每个 benchmark 跑 num_trials 次, 取 success_rate 中位数, std < 5%
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from vla_db.base import Base


class EvalJobStatus:
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    PAUSED = "paused"
    SUCCESS = "success"
    COMPLETED = "completed"  # scaffold 兼容
    FAILED = "failed"
    CANCELLED = "cancelled"

    TERMINAL = frozenset({SUCCESS, COMPLETED, FAILED, CANCELLED})


# === 4 套 LIBERO 套件 + SimplerEnv ===
VALID_BENCHMARKS = frozenset(
    {
        "libero_spatial",
        "libero_object",
        "libero_goal",
        "libero_10",
        "libero_90",
        "simpler_env",
    }
)


class EvalJob(Base):
    """B04 聚合根 1 — 评测任务.

    B04-R05: 3 trial 中位数 (R4.1 复现性)
    B04-R06: 多 benchmark (LIBERO 4 套件)
    B04-R15: 重复 (model + benchmark + trial_count) 提交识别
    """

    __tablename__ = "eval_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    job_name: Mapped[str] = mapped_column(String(255), nullable=False)
    model_version_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    benchmarks: Mapped[list[str]] = mapped_column(JSON, nullable=False)  # 多 benchmark
    num_trials: Mapped[int] = mapped_column(Integer, nullable=False, default=3)  # R05 默认 3 trial
    total_tasks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    successful_trials: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_trials: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=EvalJobStatus.PENDING)
    # R05: 3 trial 中位数 + std
    median_success_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    std_dev: Mapped[float | None] = mapped_column(Float, nullable=True)
    reproducibility_passed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # R04: 发布报告
    report_published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    report_uri: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    # 业务对账 hash (per B04-R15 重复识别)
    config_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    requested_by: Mapped[str] = mapped_column(String(36), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class EvalTask(Base):
    """B04 entity — 单个 eval task (1 个 benchmark 内 1 task 的多次 trial)."""

    __tablename__ = "eval_tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    eval_job_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    benchmark: Mapped[str] = mapped_column(String(64), nullable=False)
    task_name: Mapped[str] = mapped_column(String(255), nullable=False)
    trial_index: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    success: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    duration_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    video_uri: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class EvalReport(Base):
    """B04 entity — 评测报告 (R03/R04/R09/R10).

    R09: HTML/PDF/JSON 3 格式
    R10: 归档 S3
    """

    __tablename__ = "eval_reports"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    eval_job_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    model_version_id: Mapped[str] = mapped_column(String(36), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    overall_success_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    per_task_metrics: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    # 3 格式 URI
    html_uri: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    pdf_uri: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    json_uri: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    # S3 归档 (R10)
    archived_s3_uri: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class EvalWorker(Base):
    """B04 聚合根 2 — eval worker (vLLM 推理)."""

    __tablename__ = "eval_workers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    worker_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    engine: Mapped[str] = mapped_column(String(32), nullable=False, default="vllm")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="idle")
    current_eval_job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    last_heartbeat: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
