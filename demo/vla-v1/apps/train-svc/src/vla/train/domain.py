"""B03 Train 域 — 3 聚合根: TrainingJob / ModelVersion / TrainWorker.

per .xdd/arch/aggregate-landscape.md §5 B03 TrainCtx.
状态机 (per .xdd/add/architecture-decision.md §6.3):
  TrainingJob: PENDING -> QUEUED -> RUNNING -> (PAUSED -> RUNNING) -> SUCCESS | FAILED | CANCELLED
  Checkpoint:  active -> (best | rolled | deleted)
  NaN/OOM 触发 graceful retry (R2.1)
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from vla_db.base import Base


class TrainingJobStatus:
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    PAUSED = "paused"
    SUCCESS = "success"
    COMPLETED = "completed"  # scaffold 兼容
    FAILED = "failed"
    CANCELLED = "cancelled"

    TERMINAL = frozenset({SUCCESS, COMPLETED, FAILED, CANCELLED})


# === 基线模型 (B03-R01) ===
VALID_BASE_MODELS = frozenset(
    {"OpenVLA-7B", "Octo-3B", "pi0-3B", "RT-2", "GR00T"}
)


class TrainingJob(Base):
    """B03 聚合根 1 — 训练任务.

    R02: 上报 metric. R06: NaN 检测. R08: OOM 降 batch. R10: GPU 调度.
    R11: LoRA/QLoRA. R12: 状态机. R13: dataset_version 不存在.
    """

    __tablename__ = "training_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    job_name: Mapped[str] = mapped_column(String(255), nullable=False)
    base_model: Mapped[str] = mapped_column(String(64), nullable=False)
    dataset_version_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    hyperparams: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    # R02: GPU 资源
    num_gpus: Mapped[int] = mapped_column(Integer, nullable=False, default=8)
    batch_size: Mapped[int] = mapped_column(Integer, nullable=False, default=32)
    learning_rate: Mapped[float] = mapped_column(Float, nullable=False, default=2e-5)
    num_epochs: Mapped[int] = mapped_column(Integer, nullable=False, default=7)
    # R11: LoRA / QLoRA
    mode: Mapped[str] = mapped_column(String(16), nullable=False, default="full")  # full / lora / qlora
    # R03: Checkpoint 频率
    checkpoint_freq: Mapped[int] = mapped_column(Integer, nullable=False, default=500)
    # R15: 重复 (base + dataset + hp) 识别
    config_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    # 状态
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=TrainingJobStatus.PENDING)
    attempt_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    # R02: 最新 metric
    current_step: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    current_loss: Mapped[float | None] = mapped_column(Float, nullable=True)
    # R06: NaN 滑动窗口
    nan_window: Mapped[list[bool]] = mapped_column(JSON, nullable=False, default=list)
    # R04: best + 滚动 5
    best_checkpoint_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    last_checkpoint_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # R05: 发布 ModelVersion
    published_model_version_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # K8s pod
    k8s_pod_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    k8s_node_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # 错误
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    cost_estimate_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    requested_by: Mapped[str] = mapped_column(String(36), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class Checkpoint(Base):
    """B03 entity — checkpoint 记录. R03 自动保存, R04 滚动保留."""

    __tablename__ = "checkpoints"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    training_job_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    step: Mapped[int] = mapped_column(Integer, nullable=False)
    metric_val_loss: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_best: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_retained: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    file_uri: Mapped[str] = mapped_column(String(1024), nullable=False)
    file_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    saved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class ModelVersion(Base):
    """B03 聚合根 2 — 模型版本. R05 发布."""

    __tablename__ = "model_versions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    training_job_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    version_tag: Mapped[str] = mapped_column(String(64), nullable=False)
    base_model: Mapped[str] = mapped_column(String(64), nullable=False)
    dataset_version_id: Mapped[str] = mapped_column(String(64), nullable=False)
    checkpoint_id: Mapped[str] = mapped_column(String(36), nullable=False)
    final_metric: Mapped[float | None] = mapped_column(Float, nullable=True)
    mlflow_run_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    published_by: Mapped[str] = mapped_column(String(36), nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class TrainWorker(Base):
    """B03 聚合根 3 — GPU worker (K8s pod). R09 节点掉电 → paused."""

    __tablename__ = "train_workers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    k8s_pod_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    k8s_node_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    gpu_count: Mapped[int] = mapped_column(Integer, nullable=False, default=8)
    gpu_type: Mapped[str] = mapped_column(String(32), nullable=False, default="A100")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="idle")
    current_training_job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    last_heartbeat: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
