"""B02 采集 17 RXX 单元测试 (核心 8 + 重复识别 + 校准 + 状态机)."""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta
from typing import Any

import pytest

os.environ["VLA_SCAFFOLD_SQLITE"] = "1"

import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
sys.path.insert(0, os.path.join(ROOT, "libs/vla-common"))
sys.path.insert(0, os.path.join(ROOT, "libs/vla-db"))
sys.path.insert(0, os.path.join(ROOT, "libs/vla-events"))
sys.path.insert(0, os.path.join(ROOT, "apps/coll-svc/src"))
sys.path.insert(0, os.path.join(ROOT, "apps/sim-svc/src"))
sys.path.insert(0, os.path.join(ROOT, "apps/pipe-svc/src"))

from vla_common.config import get_settings
from vla_common.errors import ErrorCode, VLAError
from vla_db.base import Base
from vla_db.session import get_engine, get_session_factory
from vla.coll.domain import (
    CollectionEpisode,
    CollectionSession,
    CollectionSessionStatus,
    DatasetVersion,
    Device,
    DeviceStatus,
)
from vla.coll.service import CollService, _config_hash


@pytest.fixture
def session():
    db_path = f"/tmp/{uuid.uuid4().hex}.db"
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    get_settings.cache_clear()
    import vla_common.audit  # noqa: F401
    import vla.coll.domain  # noqa: F401
    import vla.eval.domain  # noqa: F401
    import vla.sim.domain  # noqa: F401
    import vla.pipe.models  # noqa: F401
    engine = get_engine()
    Base.metadata.create_all(engine)
    factory = get_session_factory()
    s = factory()
    yield s
    s.close()
    try:
        os.unlink(db_path)
    except OSError:
        pass


@pytest.fixture
def svc(session: Any) -> CollService:
    return CollService(session)


@pytest.fixture
def project_ctx() -> dict[str, str]:
    return {"project_id": str(uuid.uuid4()), "user_id": str(uuid.uuid4())}


@pytest.fixture
def device(svc: CollService, project_ctx: dict) -> Device:
    return svc.create_device(
        project_id=project_ctx["project_id"],
        device_code="aloha_01",
        device_type="aloha",
        camera_count=4,
    )


# === B02-R01: 创建 CollectionSession ===
class TestB02R01CreateSession:
    def test_create_session_happy_path(
        self, svc: CollService, project_ctx: dict, device: Device
    ) -> None:
        sess = svc.create_session(
            project_id=project_ctx["project_id"],
            operator_id=project_ctx["user_id"],
            device_id=device.id,
            task_spec={"task": "把方块放进盒子"},
            copyright_owner="VLA Lab",
        )
        assert sess.id
        assert sess.status == CollectionSessionStatus.RECORDING
        # 设备应切 RECORDING
        svc.session.refresh(device)
        assert device.status == DeviceStatus.RECORDING

    def test_device_not_ready_rejected(
        self, svc: CollService, project_ctx: dict, device: Device
    ) -> None:
        device.status = DeviceStatus.OFFLINE
        svc.session.flush()
        with pytest.raises(VLAError):
            svc.create_session(
                project_id=project_ctx["project_id"],
                operator_id=project_ctx["user_id"],
                device_id=device.id,
                task_spec={"task": "t"},
            )


# === B02-R02: 录制 episode ===
class TestB02R02RecordEpisode:
    def test_record_episode_increments_count(
        self, svc: CollService, project_ctx: dict, device: Device
    ) -> None:
        sess = svc.create_session(
            project_id=project_ctx["project_id"],
            operator_id=project_ctx["user_id"],
            device_id=device.id,
            task_spec={"task": "t"},
        )
        ep = svc.record_episode(
            session_id=sess.id,
            episode_index=0,
            video_uri_top="s3://x/top.mp4",
            video_uri_left="s3://x/left.mp4",
            video_uri_right="s3://x/right.mp4",
            video_uri_wrist="s3://x/wrist.mp4",
            observation_uri="s3://x/obs.pkl",
            action_uri="s3://x/action.pkl",
            frame_count=360,
            duration_s=60.0,
        )
        assert ep.id
        svc.session.refresh(sess)
        assert sess.episode_count == 1
        assert sess.last_recorded_frame == 360


# === B02-R03: 提交标注 ===
class TestB02R03Annotation:
    def test_submit_annotation_happy(
        self, svc: CollService, project_ctx: dict, device: Device
    ) -> None:
        sess = svc.create_session(
            project_id=project_ctx["project_id"],
            operator_id=project_ctx["user_id"],
            device_id=device.id,
            task_spec={"task": "t"},
        )
        ep = svc.record_episode(
            session_id=sess.id,
            episode_index=0,
            video_uri_top="s3://x/top.mp4",
            video_uri_left="s3://x/left.mp4",
            video_uri_right="s3://x/right.mp4",
            video_uri_wrist="s3://x/wrist.mp4",
            observation_uri="s3://x/obs.pkl",
            action_uri="s3://x/action.pkl",
            frame_count=360,
            duration_s=60.0,
        )
        ann = svc.submit_annotation(
            episode_id=ep.id,
            task_instruction="把方块放进盒子",
            success=True,
            quality_score=0.9,
            annotator_id=project_ctx["user_id"],
        )
        assert ann.id
        assert ann.quality_score == 0.9


# === B02-R04: 标注字段必填 ===
class TestB02R04AnnotationRequired:
    def test_empty_task_instruction_rejected(
        self, svc: CollService, project_ctx: dict, device: Device
    ) -> None:
        sess = svc.create_session(
            project_id=project_ctx["project_id"],
            operator_id=project_ctx["user_id"],
            device_id=device.id,
            task_spec={"task": "t"},
        )
        ep = svc.record_episode(
            session_id=sess.id,
            episode_index=0,
            video_uri_top="s3://x",
            video_uri_left="s3://x",
            video_uri_right="s3://x",
            video_uri_wrist="s3://x",
            observation_uri="s3://x",
            action_uri="s3://x",
            frame_count=10,
            duration_s=5.0,
        )
        with pytest.raises(VLAError) as exc_info:
            svc.submit_annotation(
                episode_id=ep.id,
                task_instruction="",
                success=True,
                quality_score=0.9,
                annotator_id=project_ctx["user_id"],
            )
        assert "task_instruction" in str(exc_info.value.message)

    def test_quality_out_of_range_rejected(
        self, svc: CollService, project_ctx: dict, device: Device
    ) -> None:
        sess = svc.create_session(
            project_id=project_ctx["project_id"],
            operator_id=project_ctx["user_id"],
            device_id=device.id,
            task_spec={"task": "t"},
        )
        ep = svc.record_episode(
            session_id=sess.id,
            episode_index=0,
            video_uri_top="s3://x",
            video_uri_left="s3://x",
            video_uri_right="s3://x",
            video_uri_wrist="s3://x",
            observation_uri="s3://x",
            action_uri="s3://x",
            frame_count=10,
            duration_s=5.0,
        )
        with pytest.raises(VLAError):
            svc.submit_annotation(
                episode_id=ep.id,
                task_instruction="t",
                success=True,
                quality_score=1.5,  # > 1.0
                annotator_id=project_ctx["user_id"],
            )


# === B02-R07: 设备断连 → paused ===
class TestB02R07DeviceDisconnect:
    def test_disconnect_marks_paused(
        self, svc: CollService, project_ctx: dict, device: Device
    ) -> None:
        sess = svc.create_session(
            project_id=project_ctx["project_id"],
            operator_id=project_ctx["user_id"],
            device_id=device.id,
            task_spec={"task": "t"},
        )
        # 录制部分
        svc.record_episode(
            session_id=sess.id,
            episode_index=0,
            video_uri_top="s3://x",
            video_uri_left="s3://x",
            video_uri_right="s3://x",
            video_uri_wrist="s3://x",
            observation_uri="s3://x",
            action_uri="s3://x",
            frame_count=300,
            duration_s=50.0,
        )
        sess = svc.device_disconnect(session_id=sess.id, reason="USB 断开")
        assert sess.status == CollectionSessionStatus.PAUSED
        assert sess.incomplete is True
        svc.session.refresh(device)
        assert device.status == DeviceStatus.OFFLINE


# === B02-R08: 断点续传 ===
class TestB02R08ResumeAfterReconnect:
    def test_resume_continues_from_last_frame(
        self, svc: CollService, project_ctx: dict, device: Device
    ) -> None:
        sess = svc.create_session(
            project_id=project_ctx["project_id"],
            operator_id=project_ctx["user_id"],
            device_id=device.id,
            task_spec={"task": "t"},
        )
        svc.record_episode(
            session_id=sess.id,
            episode_index=0,
            video_uri_top="s3://x",
            video_uri_left="s3://x",
            video_uri_right="s3://x",
            video_uri_wrist="s3://x",
            observation_uri="s3://x",
            action_uri="s3://x",
            frame_count=300,
            duration_s=50.0,
        )
        svc.device_disconnect(session_id=sess.id, reason="USB")
        sess = svc.resume_session(session_id=sess.id)
        assert sess.status == CollectionSessionStatus.RECORDING
        assert sess.incomplete is False
        assert sess.last_recorded_frame == 300  # 接续

    def test_resume_non_paused_rejected(
        self, svc: CollService, project_ctx: dict, device: Device
    ) -> None:
        sess = svc.create_session(
            project_id=project_ctx["project_id"],
            operator_id=project_ctx["user_id"],
            device_id=device.id,
            task_spec={"task": "t"},
        )
        with pytest.raises(VLAError):
            svc.resume_session(session_id=sess.id)


# === B02-R11: 异常结束 ===
class TestB02R11AbortSession:
    def test_abort_session(self, svc: CollService, project_ctx: dict, device: Device) -> None:
        sess = svc.create_session(
            project_id=project_ctx["project_id"],
            operator_id=project_ctx["user_id"],
            device_id=device.id,
            task_spec={"task": "t"},
        )
        sess = svc.abort_session(session_id=sess.id, reason="机房分区故障")
        assert sess.status == CollectionSessionStatus.ABORTED


# === B02-R12: 设备状态机非法迁移 ===
class TestB02R12DeviceStateMachine:
    def test_valid_transition(self, svc: CollService, device: Device) -> None:
        d = svc.transition_device(device_id=device.id, to_status=DeviceStatus.MAINTENANCE)
        assert d.status == DeviceStatus.MAINTENANCE

    def test_invalid_transition_rejected(
        self, svc: CollService, device: Device
    ) -> None:
        """MAINTENANCE → RECORDING 非法 (MAINTENANCE 只能到 READY)."""
        device.status = DeviceStatus.MAINTENANCE
        svc.session.flush()
        with pytest.raises(VLAError) as exc_info:
            svc.transition_device(device_id=device.id, to_status=DeviceStatus.RECORDING)
        assert exc_info.value.status_code == 409


# === B02-R13: 标注 schema 不兼容 ===
class TestB02R13SchemaIncompatible:
    def test_invalid_schema_rejected(
        self, svc: CollService, project_ctx: dict
    ) -> None:
        with pytest.raises(VLAError) as exc_info:
            svc.publish_dataset_version(
                project_id=project_ctx["project_id"],
                version_tag="v1.0",
                episode_count=50,
                schema_version="v99",  # 不支持
                published_by=project_ctx["user_id"],
            )
        assert exc_info.value.code == ErrorCode.B02_COLL_DATASET_VALIDATION_FAILED


# === B02-R15: 重复 (op+dev+task) 提交 ===
class TestB02R15DuplicateSession:
    def test_same_op_dev_task_rejected(
        self, svc: CollService, project_ctx: dict, device: Device
    ) -> None:
        """两次相同 (op+dev+task) → 第二次幂等冲突.

        模拟: 第 1 次创建后, 让 device 回到 READY (用于业务演示), 第二次同 config 应被冲突识别.
        """
        params = {
            "project_id": project_ctx["project_id"],
            "operator_id": project_ctx["user_id"],
            "device_id": device.id,
            "task_spec": {"task": "把方块放进盒子", "seed": 42},
        }
        svc.create_session(**params)
        # 把设备重新置 READY (模拟 1 次 abort 之后回到可用)
        device.status = DeviceStatus.READY
        svc.session.flush()
        with pytest.raises(VLAError) as exc_info:
            svc.create_session(**params)
        assert exc_info.value.code == ErrorCode.X_IDEMPOTENCY_CONFLICT


# === B02-R16: 设备校准校验 ===
class TestB02R16Calibration:
    def test_uncalibrated_device_rejected(
        self, svc: CollService, project_ctx: dict, device: Device
    ) -> None:
        device.last_calibration_at = None
        svc.session.flush()
        with pytest.raises(VLAError):
            svc.create_session(
                project_id=project_ctx["project_id"],
                operator_id=project_ctx["user_id"],
                device_id=device.id,
                task_spec={"task": "t"},
            )

    def test_calibration_expired_rejected(
        self, svc: CollService, project_ctx: dict, device: Device
    ) -> None:
        device.last_calibration_at = datetime.utcnow() - timedelta(hours=25)
        svc.session.flush()
        with pytest.raises(VLAError):
            svc.create_session(
                project_id=project_ctx["project_id"],
                operator_id=project_ctx["user_id"],
                device_id=device.id,
                task_spec={"task": "t"},
            )

    def test_recalibrate_resets_timer(
        self, svc: CollService, device: Device
    ) -> None:
        device.last_calibration_at = datetime.utcnow() - timedelta(hours=25)
        svc.session.flush()
        d = svc.calibrate_device(device_id=device.id, validity_hours=24)
        assert d.last_calibration_at
        assert (datetime.utcnow() - d.last_calibration_at).total_seconds() < 5


# === B02-R07: 发布 DatasetVersion ===
class TestB02R07PublishDatasetVersion:
    def test_publish_v1(self, svc: CollService, project_ctx: dict) -> None:
        ds = svc.publish_dataset_version(
            project_id=project_ctx["project_id"],
            version_tag="v1.0",
            episode_count=50,
            schema_version="v1",
            published_by=project_ctx["user_id"],
        )
        assert ds.id
        assert ds.status == "published"
        assert ds.episode_count == 50


# === config_hash helper ===
def test_config_hash_stable() -> None:
    h1 = _config_hash("op1", "dev1", {"task": "t", "seed": 42})
    h2 = _config_hash("op1", "dev1", {"seed": 42, "task": "t"})  # 顺序无关
    assert h1 == h2


# === State machine constants ===
def test_device_state_machine_ready_to_offline_allowed() -> None:
    assert DeviceStatus.OFFLINE in CollService.DEVICE_TRANSITIONS[DeviceStatus.READY]


def test_device_state_machine_maintenance_to_recording_blocked() -> None:
    assert DeviceStatus.RECORDING not in CollService.DEVICE_TRANSITIONS[DeviceStatus.MAINTENANCE]
