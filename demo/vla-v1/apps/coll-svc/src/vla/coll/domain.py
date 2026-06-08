"""B02 Coll 域 — 3 聚合根: CollectionSession / Device / DatasetVersion.

per .xdd/arch/aggregate-landscape.md §4 B02 CollCtx.
状态机 (per .xdd/add/architecture-decision.md §6.2):
  CollectionSession: created -> recording -> (paused -> recording) -> completed | aborted
  Device:            ready -> (recording -> ready) | offline | maintenance
  DatasetVersion:    draft -> published | archived

R07: ALOHA 设备断连 (R1.1) → session.paused
R08: 断点续传
R12: 设备状态机非法迁移被拒
R13: Schema 不兼容被拒
R15: 重复 (operator + device + task_spec) 提交识别
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from vla_db.base import Base


class CollectionSessionStatus:
    CREATED = "created"
    RECORDING = "recording"
    PAUSED = "paused"
    COMPLETED = "completed"
    ABORTED = "aborted"

    TERMINAL = frozenset({COMPLETED, ABORTED})


class DeviceStatus:
    READY = "ready"
    RECORDING = "recording"
    OFFLINE = "offline"
    MAINTENANCE = "maintenance"


class DeviceType:
    ALOHA = "aloha"
    MOBILE = "mobile"
    GELLO = "gello"


class DatasetVersionStatus:
    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class Device(Base):
    """B02 聚合根 2 — 设备 (ALOHA / Mobile / GELLO).

    B02-R05/R12: 校准时间戳, 状态机.
    B02-R16: 校准状态校验.
    """

    __tablename__ = "devices"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    device_code: Mapped[str] = mapped_column(String(64), nullable=False)  # e.g. aloha_01
    device_type: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=DeviceStatus.READY)
    last_calibration_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_heartbeat_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # 校准有效期 (默认 24h)
    calibration_validity_hours: Mapped[int] = mapped_column(Integer, nullable=False, default=24)
    # 4 相机配置 (R05 帧同步)
    camera_count: Mapped[int] = mapped_column(Integer, nullable=False, default=4)
    # 设备元数据
    metadata_: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSON, nullable=True)


class CollectionSession(Base):
    """B02 聚合根 1 — 采集会话.

    B02-R01: 创建. R02: 录制 episode. R07: 设备断连切 paused. R08: 断点续传.
    """

    __tablename__ = "collection_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    operator_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    device_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    task_spec: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    # R15 重复识别 hash
    config_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default=CollectionSessionStatus.CREATED
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    episode_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # R08: 断点续传 — 已录制帧数
    last_recorded_frame: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    incomplete: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    copyright_owner: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class CollectionEpisode(Base):
    """B02 entity — 单个录制的 episode (含 4 相机视频)."""

    __tablename__ = "collection_episodes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    episode_index: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="recorded")
    # 4 相机 URI (顶/左/右/手腕)
    video_uri_top: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    video_uri_left: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    video_uri_right: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    video_uri_wrist: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    observation_uri: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    action_uri: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    frame_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    duration_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Annotation(Base):
    """B02 entity — 标注 (R03/R04). 5 字段, 前 3 必填."""

    __tablename__ = "annotations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    episode_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    schema_version: Mapped[str] = mapped_column(String(16), nullable=False, default="v1")
    # 5 字段
    task_instruction: Mapped[str | None] = mapped_column(Text, nullable=True)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    quality_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.7)
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    annotator_id: Mapped[str] = mapped_column(String(36), nullable=False)
    reviewed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    reviewer_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class DatasetVersion(Base):
    """B02 聚合根 3 — 数据集版本 (R07/R10/R13)."""

    __tablename__ = "dataset_versions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    version_tag: Mapped[str] = mapped_column(String(64), nullable=False)
    episode_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    license: Mapped[str] = mapped_column(String(64), nullable=False, default="internal")
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default=DatasetVersionStatus.DRAFT
    )
    schema_version: Mapped[str] = mapped_column(String(16), nullable=False, default="v1")
    published_by: Mapped[str] = mapped_column(String(36), nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 软删除 (R10: 7 天保留)
    soft_deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 损坏检测 (R09)
    damaged_episode_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_episode_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
