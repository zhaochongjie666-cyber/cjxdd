"""B01 Sim 域 — 3 聚合根扩展: SceneAsset / SimJob / SimWorker + SimEpisode.

per .xdd/arch/aggregate-landscape.md §3 B01 SimCtx.

状态机 (per .xdd/add/architecture-decision.md §6.1):
  SimJob:    created -> pending -> running -> (paused -> running) -> success | failed | cancelled
  SceneAsset: uploading -> validating -> ready | failed
  SimWorker: idle -> busy -> (drained -> idle) | offline

物理参数域随机化 (B01-R02): physics_config 域可指定 randomization_applied.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from vla_db.base import Base


class SimJobStatus:
    CREATED = "created"  # scaffold 兼容
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    PAUSED = "paused"
    SUCCESS = "success"
    COMPLETED = "completed"  # scaffold 兼容
    FAILED = "failed"
    CANCELLED = "cancelled"

    TERMINAL = frozenset({SUCCESS, COMPLETED, FAILED, CANCELLED})


# === 物理参数 schema (B01-R02/R06) ===
# 摩擦 ∈ [0, 2], 重力 ∈ [0, 30] m/s², 质量 ∈ [0.01, 1000] kg
PHYSICS_PARAM_BOUNDS = {
    "friction": (0.0, 2.0),
    "gravity": (0.0, 30.0),
    "mass_kg": (0.01, 1000.0),
}


def validate_physics_config(physics_config: dict[str, Any] | None) -> list[str]:
    """校验物理参数, 返回错误列表 (B01-R06).

    物理参数域允许 3 个键: friction / gravity / mass_kg.
    """
    errors: list[str] = []
    if physics_config is None:
        return errors
    for key, (lo, hi) in PHYSICS_PARAM_BOUNDS.items():
        if key in physics_config:
            val = physics_config[key]
            if not isinstance(val, (int, float)):
                errors.append(f"{key} 必须是数字, 当前 {type(val).__name__}")
                continue
            if val < lo or val > hi:
                errors.append(f"{key} 越界 [{lo}, {hi}], 当前 {val}")
    return errors


# === SceneAsset ===
class SceneAsset(Base):
    """B01 聚合根 2 — 3D 场景资产 (USD / MJCF / glTF).

    B01-R03: 上传 → 校验 → ready. size_bytes, format, file_uri 必含.
    """

    __tablename__ = "scene_assets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    format: Mapped[str] = mapped_column(String(32), nullable=False)  # usd / mjcf / obj / gltf
    file_uri: Mapped[str] = mapped_column(String(1024), nullable=False)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    physics_config: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    metadata_: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="uploading")
    uploaded_by: Mapped[str] = mapped_column(String(36), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    validated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    copyright_owner: Mapped[str | None] = mapped_column(String(255), nullable=True)  # B01-R12


# === Project (多租户根实体) ===
class Project(Base):
    """多租户根实体 — scaffold 简化为 SQLite/PG 通用."""

    __tablename__ = "projects"
    __table_args__ = {"extend_existing": True}

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


# === SimJob (扩展) ===
class SimJob(Base):
    """B01 聚合根 1 — 仿真任务 (扩展 SimJob 域)."""

    __tablename__ = "sim_jobs"
    __table_args__ = {"extend_existing": True}

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    task_name: Mapped[str] = mapped_column(String(255), nullable=False)
    scene_asset_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    scene_template_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    task_spec: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    physics_config: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    randomization_applied: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    engine: Mapped[str] = mapped_column(String(32), nullable=False)
    num_episodes: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    successful_episodes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_episodes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=SimJobStatus.PENDING)
    attempt_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    cost_estimate_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    cost_actual_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    scene_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)  # B01-R13 幂等
    copyright_owner: Mapped[str | None] = mapped_column(String(255), nullable=True)  # B01-R12
    requested_by: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


# === SimEpisode ===
class SimEpisode(Base):
    """B01 实体 — 1 次仿真跑出来的 episode 记录.

    per .xdd/arch/aggregate-landscape.md §3, SimEpisode 是 SimJob 下的 entity.
    B01-R05/R09: 1 个 SimJob → N 个 SimEpisode. 失败 episode 不入数据湖.
    """

    __tablename__ = "sim_episodes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    sim_job_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    episode_index: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="generated")
    # 实际物理参数 (B01-R02 随机化)
    actual_physics: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    # 产物 URI (MinIO 路径)
    video_uri: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    observation_uri: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    action_uri: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    duration_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


# === SimWorker ===
class SimWorker(Base):
    """B01 聚合根 3 — 仿真 worker (Isaac Sim / MuJoCo / Genesis).

    B01-R11: 单 worker 仿真并发上限 100.
    """

    __tablename__ = "sim_workers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    engine: Mapped[str] = mapped_column(String(32), nullable=False)
    worker_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="idle")
    current_sim_job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    active_episodes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_concurrent_episodes: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    last_heartbeat: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


# === SceneTemplate (B01-R07 校验) ===
VALID_SCENE_TEMPLATES = frozenset(
    {
        "kitchen_table",
        "factory_floor",
        "office_desk",
        "lab_bench",
        "warehouse",
        "living_room",
        "outdoor_garden",
        "hospital_room",
        "classroom",
        "kitchen_island",
    }
)
