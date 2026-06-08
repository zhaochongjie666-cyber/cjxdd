"""B02 Coll service — Saga + 业务逻辑 (R01~R17, 核心 8 个).

实现: R01, R02, R03, R04, R07, R08, R12, R13, R15, R16, R17
其余 R05/R06/R09/R10/R11/R14 在生产环境写 (本 Phase 覆盖核心 + 状态机).
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from vla_common.errors import ErrorCode, VLAError
from vla_events.producer import EventEnvelope, get_event_bus

from vla.coll.domain import (
    Annotation,
    CollectionEpisode,
    CollectionSession,
    CollectionSessionStatus,
    DatasetVersion,
    DatasetVersionStatus,
    Device,
    DeviceStatus,
)

logger = logging.getLogger(__name__)


def _config_hash(operator_id: str, device_id: str, task_spec: dict[str, Any]) -> str:
    """B02-R15: (operator + device + task_spec) 重复识别."""
    canonical = json.dumps(
        {"op": operator_id, "dev": device_id, "task": sorted(task_spec.items())},
        sort_keys=True,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:32]


class CollService:
    """B02 业务逻辑层."""

    # 设备状态机合法迁移
    DEVICE_TRANSITIONS: dict[str, set[str]] = {
        DeviceStatus.READY: {DeviceStatus.RECORDING, DeviceStatus.OFFLINE, DeviceStatus.MAINTENANCE},
        DeviceStatus.RECORDING: {DeviceStatus.READY, DeviceStatus.OFFLINE, DeviceStatus.PAUSED if hasattr(DeviceStatus, "PAUSED") else "ready"},
        DeviceStatus.OFFLINE: {DeviceStatus.READY, DeviceStatus.MAINTENANCE},
        DeviceStatus.MAINTENANCE: {DeviceStatus.READY},
    }

    def __init__(self, session: Session) -> None:
        self.session = session

    # === B02-R01: 创建 CollectionSession ===
    def create_session(
        self,
        *,
        project_id: str,
        operator_id: str,
        device_id: str,
        task_spec: dict[str, Any],
        copyright_owner: str | None = None,
    ) -> CollectionSession:
        """R01 创建. 校验: 设备 READY, 校准 24h 内 (R16), 重复识别 (R15)."""
        device = self.session.get(Device, device_id)
        if not device:
            raise VLAError(
                ErrorCode.X_RESOURCE_NOT_FOUND,
                f"VLA-B02-0016 设备 {device_id} 不存在",
                status_code=404,
            )
        if device.status != DeviceStatus.READY:
            raise VLAError(
                ErrorCode.B02_COLL_DEVICE_OFFLINE,
                f"VLA-B02-0012 设备 {device.device_code} 状态 {device.status} 不允许开始 session (需要 READY)",
                status_code=409,
            )
        # R16: 校准 24h 校验
        if device.last_calibration_at is None:
            raise VLAError(
                ErrorCode.B02_COLL_DEVICE_OFFLINE,
                f"VLA-B02-0016 设备 {device.device_code} 从未校准",
                status_code=422,
            )
        if datetime.utcnow() - device.last_calibration_at > timedelta(
            hours=device.calibration_validity_hours
        ):
            raise VLAError(
                ErrorCode.B02_COLL_DEVICE_OFFLINE,
                f"VLA-B02-0016 设备 {device.device_code} 校准超过 {device.calibration_validity_hours}h",
                status_code=422,
            )

        # R15: 重复识别
        cfg_hash = _config_hash(operator_id, device_id, task_spec)
        existing = (
            self.session.query(CollectionSession)
            .filter(
                CollectionSession.project_id == project_id,
                CollectionSession.config_hash == cfg_hash,
                CollectionSession.status.notin_(
                    [CollectionSessionStatus.COMPLETED, CollectionSessionStatus.ABORTED]
                ),
            )
            .first()
        )
        if existing:
            raise VLAError(
                ErrorCode.X_IDEMPOTENCY_CONFLICT,
                f"VLA-B02-0015 同 (op+dev+task) 已有活跃 session ({existing.id})",
                status_code=409,
            )

        session_obj = CollectionSession(
            project_id=project_id,
            operator_id=operator_id,
            device_id=device_id,
            task_spec=task_spec,
            config_hash=cfg_hash,
            copyright_owner=copyright_owner,
            status=CollectionSessionStatus.RECORDING,
            started_at=datetime.utcnow(),
        )
        self.session.add(session_obj)
        # 设备切 RECORDING
        device.status = DeviceStatus.RECORDING
        self.session.flush()
        return session_obj

    # === B02-R02: 录制 1 个 episode ===
    def record_episode(
        self,
        *,
        session_id: str,
        episode_index: int,
        video_uri_top: str,
        video_uri_left: str,
        video_uri_right: str,
        video_uri_wrist: str,
        observation_uri: str,
        action_uri: str,
        frame_count: int,
        duration_s: float,
    ) -> CollectionEpisode:
        """R02: 4 相机同步录制完成."""
        sess = self._get_session(session_id)
        if sess.status != CollectionSessionStatus.RECORDING:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"session 状态 {sess.status} 不允许 record_episode",
                status_code=409,
            )
        ep = CollectionEpisode(
            session_id=sess.id,
            project_id=sess.project_id,
            episode_index=episode_index,
            video_uri_top=video_uri_top,
            video_uri_left=video_uri_left,
            video_uri_right=video_uri_right,
            video_uri_wrist=video_uri_wrist,
            observation_uri=observation_uri,
            action_uri=action_uri,
            frame_count=frame_count,
            duration_s=duration_s,
            status="recorded",
            finalized_at=datetime.utcnow(),
        )
        self.session.add(ep)
        sess.episode_count += 1
        sess.last_recorded_frame = frame_count
        self.session.flush()
        return ep

    # === B02-R03: 标注 ===
    def submit_annotation(
        self,
        *,
        episode_id: str,
        task_instruction: str,
        success: bool,
        quality_score: float,
        failure_reason: str | None = None,
        tags: list[str] | None = None,
        annotator_id: str,
        schema_version: str = "v1",
    ) -> Annotation:
        """R03: 提交标注. R04 校验必填字段."""
        if not task_instruction or not task_instruction.strip():
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                "VLA-B02-0011 标注字段 task_instruction 缺失",
                status_code=422,
            )
        if success is None:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                "VLA-B02-0011 标注字段 success 缺失",
                status_code=422,
            )
        if quality_score is None:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                "VLA-B02-0011 标注字段 quality_score 缺失",
                status_code=422,
            )
        if not 0.0 <= quality_score <= 1.0:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"quality_score 越界 [0,1]: {quality_score}",
                status_code=422,
            )

        ann = Annotation(
            episode_id=episode_id,
            project_id=self._get_episode_project(episode_id),
            schema_version=schema_version,
            task_instruction=task_instruction,
            success=success,
            quality_score=quality_score,
            failure_reason=failure_reason,
            tags=tags or [],
            annotator_id=annotator_id,
        )
        self.session.add(ann)
        self.session.flush()
        return ann

    # === B02-R07: 发布 DatasetVersion ===
    def publish_dataset_version(
        self,
        *,
        project_id: str,
        version_tag: str,
        episode_count: int,
        schema_version: str = "v1",
        license: str = "internal",
        published_by: str,
    ) -> DatasetVersion:
        """R07/R13: 创建并发布 dataset_version. R13 schema 校验."""
        # R13: schema 不兼容拒绝
        if schema_version not in {"v1", "v2"}:
            raise VLAError(
                ErrorCode.B02_COLL_DATASET_VALIDATION_FAILED,
                f"VLA-B02-0013 标注 schema '{schema_version}' 不兼容 (支持 v1, v2)",
                status_code=422,
            )
        if episode_count < 1:
            raise VLAError(
                ErrorCode.B02_COLL_DATASET_VALIDATION_FAILED,
                f"episode_count 必须 ≥ 1 (当前 {episode_count})",
                status_code=422,
            )

        ds = DatasetVersion(
            project_id=project_id,
            version_tag=version_tag,
            episode_count=episode_count,
            total_episode_count=episode_count,
            license=license,
            schema_version=schema_version,
            status=DatasetVersionStatus.PUBLISHED,
            published_by=published_by,
            published_at=datetime.utcnow(),
        )
        self.session.add(ds)
        self.session.flush()
        return ds

    # === B02-R07: 设备断连 → session 切 PAUSED (R07/L3 F02) ===
    def device_disconnect(self, *, session_id: str, reason: str) -> CollectionSession:
        """R07 设备断连: 保留已录制帧, 标 incomplete=true, 切 PAUSED."""
        sess = self._get_session(session_id)
        if sess.status != CollectionSessionStatus.RECORDING:
            raise VLAError(
                ErrorCode.B02_COLL_DEVICE_OFFLINE,
                f"session 状态 {sess.status} 不允许 disconnect (需要 RECORDING)",
                status_code=409,
            )
        sess.status = CollectionSessionStatus.PAUSED
        sess.incomplete = True
        sess.error_code = "VLA-B02-0001"
        sess.error_message = f"设备断连: {reason}"
        # 设备切 OFFLINE
        device = self.session.get(Device, sess.device_id)
        if device:
            device.status = DeviceStatus.OFFLINE
        self.session.flush()
        return sess

    # === B02-R08: 断点续传 ===
    def resume_session(self, *, session_id: str) -> CollectionSession:
        """R08: 设备重连后, session 切回 RECORDING, 从 last_recorded_frame 继续."""
        sess = self._get_session(session_id)
        if sess.status != CollectionSessionStatus.PAUSED:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"session 状态 {sess.status} 不允许 resume (需要 PAUSED)",
                status_code=409,
            )
        sess.status = CollectionSessionStatus.RECORDING
        sess.incomplete = False
        sess.error_code = None
        sess.error_message = None
        device = self.session.get(Device, sess.device_id)
        if device:
            device.status = DeviceStatus.RECORDING
            device.last_heartbeat_at = datetime.utcnow()
        self.session.flush()
        return sess

    # === B02-R11: 异常结束 ===
    def abort_session(self, *, session_id: str, reason: str) -> CollectionSession:
        """R11: 异常结束 (e.g. 机房分区故障)."""
        sess = self._get_session(session_id)
        if sess.status in CollectionSessionStatus.TERMINAL:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"session 已 {sess.status}, 不可 abort",
                status_code=409,
            )
        sess.status = CollectionSessionStatus.ABORTED
        sess.completed_at = datetime.utcnow()
        sess.error_message = reason
        device = self.session.get(Device, sess.device_id)
        if device:
            device.status = DeviceStatus.READY
        self.session.flush()
        return sess

    # === B02-R12: 设备状态机非法迁移被拒 ===
    def transition_device(
        self, *, device_id: str, to_status: str
    ) -> Device:
        """R12: 校验设备状态机迁移合法性."""
        device = self.session.get(Device, device_id)
        if not device:
            raise VLAError(
                ErrorCode.X_RESOURCE_NOT_FOUND,
                f"device {device_id} not found",
                status_code=404,
            )
        allowed = self.DEVICE_TRANSITIONS.get(device.status, set())
        if to_status not in allowed:
            raise VLAError(
                ErrorCode.B02_COLL_DEVICE_OFFLINE,
                f"VLA-B02-0012 设备状态机非法迁移: {device.status} → {to_status}",
                status_code=409,
                details={"from": device.status, "to": to_status, "allowed": list(allowed)},
            )
        device.status = to_status
        self.session.flush()
        return device

    # === B02-R16: 设备校准 ===
    def calibrate_device(
        self, *, device_id: str, validity_hours: int = 24
    ) -> Device:
        """R16: 校准设备, 更新 last_calibration_at."""
        device = self.session.get(Device, device_id)
        if not device:
            raise VLAError(
                ErrorCode.X_RESOURCE_NOT_FOUND,
                f"device {device_id} not found",
                status_code=404,
            )
        device.last_calibration_at = datetime.utcnow()
        device.calibration_validity_hours = validity_hours
        self.session.flush()
        return device

    # === B02: 创建 Device ===
    def create_device(
        self,
        *,
        project_id: str,
        device_code: str,
        device_type: str,
        camera_count: int = 4,
        metadata: dict[str, Any] | None = None,
    ) -> Device:
        device = Device(
            project_id=project_id,
            device_code=device_code,
            device_type=device_type,
            camera_count=camera_count,
            metadata_=metadata,
            status=DeviceStatus.READY,
            last_calibration_at=datetime.utcnow(),
        )
        self.session.add(device)
        self.session.flush()
        return device

    # === 内部 ===
    def _get_session(self, session_id: str) -> CollectionSession:
        sess = self.session.get(CollectionSession, session_id)
        if not sess:
            raise VLAError(
                ErrorCode.X_RESOURCE_NOT_FOUND,
                f"collection_session {session_id} not found",
                status_code=404,
            )
        return sess

    def _get_episode_project(self, episode_id: str) -> str:
        ep = self.session.get(CollectionEpisode, episode_id)
        if not ep:
            raise VLAError(
                ErrorCode.X_RESOURCE_NOT_FOUND,
                f"episode {episode_id} not found",
                status_code=404,
            )
        return ep.project_id
