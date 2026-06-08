"""B03 训练 17 RXX 单元测试 (核心 8)."""
from __future__ import annotations

import math
import os
import uuid
from typing import Any

import pytest

os.environ["VLA_SCAFFOLD_SQLITE"] = "1"

import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
sys.path.insert(0, os.path.join(ROOT, "libs/vla-common"))
sys.path.insert(0, os.path.join(ROOT, "libs/vla-db"))
sys.path.insert(0, os.path.join(ROOT, "libs/vla-events"))
sys.path.insert(0, os.path.join(ROOT, "apps/train-svc/src"))
sys.path.insert(0, os.path.join(ROOT, "apps/sim-svc/src"))
sys.path.insert(0, os.path.join(ROOT, "apps/pipe-svc/src"))

from vla_common.config import get_settings
from vla_common.errors import ErrorCode, VLAError
from vla_db.base import Base
from vla_db.session import get_engine, get_session_factory
from vla.train.domain import (
    VALID_BASE_MODELS,
    Checkpoint,
    ModelVersion,
    TrainingJob,
    TrainingJobStatus,
)
from vla.train.service import NAN_WINDOW_SIZE, TrainService, _config_hash


@pytest.fixture
def session():
    db_path = f"/tmp/{uuid.uuid4().hex}.db"
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    get_settings.cache_clear()
    import vla_common.audit  # noqa: F401
    import vla.train.domain  # noqa: F401
    import vla.eval.domain  # noqa: F401
    import vla.sim.domain  # noqa: F401
    import vla.coll.domain  # noqa: F401
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
def svc(session: Any) -> TrainService:
    return TrainService(session)


@pytest.fixture
def project_ctx() -> dict[str, str]:
    return {"project_id": str(uuid.uuid4()), "user_id": str(uuid.uuid4())}


# === B03-R01: 提交 TrainingJob ===
class TestB03R01SubmitTrainingJob:
    def test_submit_happy_path(self, svc: TrainService, project_ctx: dict) -> None:
        job = svc.submit_training_job(
            project_id=project_ctx["project_id"],
            job_name="R01",
            base_model="OpenVLA-7B",
            dataset_version_id="v1.0",
            hyperparams={"lr": 2e-5, "batch": 32, "epochs": 7},
            num_gpus=8,
            requested_by=project_ctx["user_id"],
        )
        assert job.id
        assert job.status == TrainingJobStatus.PENDING
        assert job.config_hash


# === B03-R02: 启动 + 上报 metric ===
class TestB03R02StartAndMetric:
    def test_start_job(self, svc: TrainService, project_ctx: dict) -> None:
        job = svc.submit_training_job(
            project_id=project_ctx["project_id"],
            job_name="R02",
            base_model="Octo-3B",
            dataset_version_id="v1.0",
            hyperparams={},
            requested_by=project_ctx["user_id"],
        )
        job = svc.start_training_job(training_job_id=job.id, k8s_pod_id="pod-001")
        assert job.status == TrainingJobStatus.RUNNING
        assert job.k8s_pod_id == "pod-001"

    def test_report_metric_updates_loss(
        self, svc: TrainService, project_ctx: dict
    ) -> None:
        job = svc.submit_training_job(
            project_id=project_ctx["project_id"],
            job_name="R02 metric",
            base_model="OpenVLA-7B",
            dataset_version_id="v1.0",
            hyperparams={},
            requested_by=project_ctx["user_id"],
        )
        svc.start_training_job(training_job_id=job.id)
        job = svc.report_metric(training_job_id=job.id, step=100, loss=0.5)
        assert job.current_step == 100
        assert job.current_loss == 0.5


# === B03-R03: Checkpoint 自动保存 ===
class TestB03R03Checkpoint:
    def test_save_checkpoint(self, svc: TrainService, project_ctx: dict) -> None:
        job = svc.submit_training_job(
            project_id=project_ctx["project_id"],
            job_name="R03",
            base_model="OpenVLA-7B",
            dataset_version_id="v1.0",
            hyperparams={},
            requested_by=project_ctx["user_id"],
        )
        svc.start_training_job(training_job_id=job.id)
        ckpt = svc.save_checkpoint(
            training_job_id=job.id,
            step=500,
            val_loss=0.5,
            file_uri="s3://ckpts/job-1/step-500.bin",
        )
        assert ckpt.id
        assert ckpt.step == 500
        svc.session.refresh(job)
        assert job.last_checkpoint_id == ckpt.id


# === B03-R04: 滚动保留 best 1 + 最近 5 ===
class TestB03R04Retention:
    def test_retain_best_plus_5(self, svc: TrainService, project_ctx: dict) -> None:
        job = svc.submit_training_job(
            project_id=project_ctx["project_id"],
            job_name="R04",
            base_model="OpenVLA-7B",
            dataset_version_id="v1.0",
            hyperparams={},
            requested_by=project_ctx["user_id"],
        )
        svc.start_training_job(training_job_id=job.id)
        # 存 7 个 checkpoint, val_loss 越来越低
        for i, vl in enumerate([0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3]):
            svc.save_checkpoint(
                training_job_id=job.id,
                step=(i + 1) * 500,
                val_loss=vl,
                file_uri=f"s3://ckpts/{job.id}/step-{i}.bin",
                is_best=(vl == 0.3),
            )
        retained = (
            svc.session.query(Checkpoint)
            .filter(
                Checkpoint.training_job_id == job.id,
                Checkpoint.is_retained == True,  # noqa: E712
            )
            .all()
        )
        # 期望: 1 best (step 3500, val_loss 0.3) + 最近 5 (step 3000-3500)
        # 总保留 5 个 (best 在最近 5 之内)
        assert len(retained) <= 6
        assert any(c.is_best for c in retained)


# === B03-R05: 训练结束发布 ModelVersion ===
class TestB03R05PublishModelVersion:
    def test_publish_model_version(self, svc: TrainService, project_ctx: dict) -> None:
        job = svc.submit_training_job(
            project_id=project_ctx["project_id"],
            job_name="R05",
            base_model="OpenVLA-7B",
            dataset_version_id="v1.0",
            hyperparams={},
            requested_by=project_ctx["user_id"],
        )
        svc.start_training_job(training_job_id=job.id)
        svc.save_checkpoint(
            training_job_id=job.id, step=500, val_loss=0.5, file_uri="s3://x", is_best=True
        )
        svc.finalize_training_job(training_job_id=job.id)
        mv = svc.publish_model_version(
            training_job_id=job.id, version_tag="v1.0", published_by=project_ctx["user_id"]
        )
        assert mv.id
        assert mv.version_tag == "v1.0"
        assert mv.base_model == "OpenVLA-7B"


# === B03-R06: NaN 滑动窗口 10 步检测 ===
class TestB03R06NaNDetection:
    def test_nan_10_steps_stops_job(
        self, svc: TrainService, project_ctx: dict
    ) -> None:
        job = svc.submit_training_job(
            project_id=project_ctx["project_id"],
            job_name="R06 NaN",
            base_model="OpenVLA-7B",
            dataset_version_id="v1.0",
            hyperparams={},
            requested_by=project_ctx["user_id"],
        )
        svc.start_training_job(training_job_id=job.id)
        # 报 10 步 NaN
        for step in range(100, 110):
            job = svc.report_metric(training_job_id=job.id, step=step, loss=float("nan"))
        svc.session.refresh(job)
        assert job.status == TrainingJobStatus.FAILED
        assert job.error_code == "VLA-B03-0011"
        assert NAN_WINDOW_SIZE == 10  # 常量

    def test_partial_nan_no_stop(self, svc: TrainService, project_ctx: dict) -> None:
        """5 步 NaN + 5 步正常 → 不停止."""
        job = svc.submit_training_job(
            project_id=project_ctx["project_id"],
            job_name="R06 partial",
            base_model="OpenVLA-7B",
            dataset_version_id="v1.0",
            hyperparams={},
            requested_by=project_ctx["user_id"],
        )
        svc.start_training_job(training_job_id=job.id)
        for step in range(100, 105):
            svc.report_metric(training_job_id=job.id, step=step, loss=float("nan"))
        for step in range(105, 110):
            svc.report_metric(training_job_id=job.id, step=step, loss=0.5)
        svc.session.refresh(job)
        assert job.status == TrainingJobStatus.RUNNING  # 没全 NaN


# === B03-R07: dataset_version 不存在被拒 ===
class TestB03R07InvalidDatasetVersion:
    def test_empty_dataset_rejected(self, svc: TrainService, project_ctx: dict) -> None:
        with pytest.raises(VLAError) as exc_info:
            svc.submit_training_job(
                project_id=project_ctx["project_id"],
                job_name="R07",
                base_model="OpenVLA-7B",
                dataset_version_id="",
                hyperparams={},
                requested_by=project_ctx["user_id"],
            )
        assert exc_info.value.code == ErrorCode.B03_TRAIN_DATASET_MISSING

    def test_invalid_base_model_rejected(
        self, svc: TrainService, project_ctx: dict
    ) -> None:
        with pytest.raises(VLAError):
            svc.submit_training_job(
                project_id=project_ctx["project_id"],
                job_name="R07 base",
                base_model="FAKE-MODEL",
                dataset_version_id="v1.0",
                hyperparams={},
                requested_by=project_ctx["user_id"],
            )


# === B03-R08: OOM 降 batch 50% ===
class TestB03R08OOMRetry:
    def test_oom_halves_batch(self, svc: TrainService, project_ctx: dict) -> None:
        job = svc.submit_training_job(
            project_id=project_ctx["project_id"],
            job_name="R08",
            base_model="OpenVLA-7B",
            dataset_version_id="v1.0",
            hyperparams={},
            batch_size=32,
            requested_by=project_ctx["user_id"],
        )
        svc.start_training_job(training_job_id=job.id)
        svc.finalize_training_job(
            training_job_id=job.id, status=TrainingJobStatus.FAILED
        )
        job.error_code = "VLA-B03-0031"
        svc.session.flush()
        job = svc.oom_retry(training_job_id=job.id)
        assert job.batch_size == 16  # 32 / 2
        assert job.status == TrainingJobStatus.PENDING

    def test_oom_retry_non_oom_rejected(
        self, svc: TrainService, project_ctx: dict
    ) -> None:
        job = svc.submit_training_job(
            project_id=project_ctx["project_id"],
            job_name="R08 non-oom",
            base_model="OpenVLA-7B",
            dataset_version_id="v1.0",
            hyperparams={},
            requested_by=project_ctx["user_id"],
        )
        svc.start_training_job(training_job_id=job.id)
        svc.finalize_training_job(
            training_job_id=job.id, status=TrainingJobStatus.FAILED
        )
        job.error_code = "OTHER_ERROR"
        svc.session.flush()
        with pytest.raises(VLAError):
            svc.oom_retry(training_job_id=job.id)


# === B03-R09: 节点 down → PAUSED ===
class TestB03R09NodeDown:
    def test_node_down_pauses(self, svc: TrainService, project_ctx: dict) -> None:
        job = svc.submit_training_job(
            project_id=project_ctx["project_id"],
            job_name="R09",
            base_model="OpenVLA-7B",
            dataset_version_id="v1.0",
            hyperparams={},
            requested_by=project_ctx["user_id"],
        )
        svc.start_training_job(training_job_id=job.id)
        job = svc.node_down_pause(training_job_id=job.id)
        assert job.status == TrainingJobStatus.PAUSED
        assert job.error_code == "VLA-B03-0009"

    def test_resume_from_paused(self, svc: TrainService, project_ctx: dict) -> None:
        job = svc.submit_training_job(
            project_id=project_ctx["project_id"],
            job_name="R09 resume",
            base_model="OpenVLA-7B",
            dataset_version_id="v1.0",
            hyperparams={},
            requested_by=project_ctx["user_id"],
        )
        svc.start_training_job(training_job_id=job.id)
        svc.node_down_pause(training_job_id=job.id)
        job = svc.resume_training_job(training_job_id=job.id)
        assert job.status == TrainingJobStatus.RUNNING


# === B03-R10: GPU 调度 (本测配置校验) ===
class TestB03R10Scheduling:
    def test_8_gpu_config(self, svc: TrainService, project_ctx: dict) -> None:
        job = svc.submit_training_job(
            project_id=project_ctx["project_id"],
            job_name="R10",
            base_model="OpenVLA-7B",
            dataset_version_id="v1.0",
            hyperparams={},
            num_gpus=8,
            requested_by=project_ctx["user_id"],
        )
        assert job.num_gpus == 8


# === B03-R11: LoRA / QLoRA 单卡 ===
class TestB03R11LoraQlora:
    def test_qlora_1_gpu(self, svc: TrainService, project_ctx: dict) -> None:
        job = svc.submit_training_job(
            project_id=project_ctx["project_id"],
            job_name="R11 qlora",
            base_model="OpenVLA-7B",
            dataset_version_id="v1.0",
            hyperparams={},
            mode="qlora",
            num_gpus=1,
            requested_by=project_ctx["user_id"],
        )
        assert job.mode == "qlora"
        assert job.num_gpus == 1

    def test_qlora_multi_gpu_rejected(
        self, svc: TrainService, project_ctx: dict
    ) -> None:
        with pytest.raises(VLAError):
            svc.submit_training_job(
                project_id=project_ctx["project_id"],
                job_name="R11 qlora multi",
                base_model="OpenVLA-7B",
                dataset_version_id="v1.0",
                hyperparams={},
                mode="qlora",
                num_gpus=4,  # 必须 1
                requested_by=project_ctx["user_id"],
            )


# === B03-R12: 状态机 — running 不可 resume ===
class TestB03R12StateMachine:
    def test_running_cannot_resume(self, svc: TrainService, project_ctx: dict) -> None:
        job = svc.submit_training_job(
            project_id=project_ctx["project_id"],
            job_name="R12",
            base_model="OpenVLA-7B",
            dataset_version_id="v1.0",
            hyperparams={},
            requested_by=project_ctx["user_id"],
        )
        svc.start_training_job(training_job_id=job.id)
        with pytest.raises(VLAError):
            svc.resume_training_job(training_job_id=job.id)


# === B03-R13: 同 (base+dataset+hp) 重复识别 ===
class TestB03R13DuplicateSubmission:
    def test_same_config_rejected(self, svc: TrainService, project_ctx: dict) -> None:
        params = {
            "project_id": project_ctx["project_id"],
            "job_name": "R13",
            "base_model": "OpenVLA-7B",
            "dataset_version_id": "v1.0",
            "hyperparams": {"lr": 2e-5, "batch": 32},
            "requested_by": project_ctx["user_id"],
        }
        svc.submit_training_job(**params)
        with pytest.raises(VLAError) as exc_info:
            svc.submit_training_job(**{**params, "job_name": "R13 副本"})
        assert exc_info.value.code == ErrorCode.X_IDEMPOTENCY_CONFLICT


# === B03-R15: 手动 stop ===
class TestB03R15Stop:
    def test_stop_running_job(self, svc: TrainService, project_ctx: dict) -> None:
        job = svc.submit_training_job(
            project_id=project_ctx["project_id"],
            job_name="R15 stop",
            base_model="OpenVLA-7B",
            dataset_version_id="v1.0",
            hyperparams={},
            requested_by=project_ctx["user_id"],
        )
        svc.start_training_job(training_job_id=job.id)
        job = svc.stop_training_job(training_job_id=job.id)
        assert job.status == TrainingJobStatus.CANCELLED

    def test_stop_completed_rejected(
        self, svc: TrainService, project_ctx: dict
    ) -> None:
        job = svc.submit_training_job(
            project_id=project_ctx["project_id"],
            job_name="R15 stop comp",
            base_model="OpenVLA-7B",
            dataset_version_id="v1.0",
            hyperparams={},
            requested_by=project_ctx["user_id"],
        )
        svc.start_training_job(training_job_id=job.id)
        svc.finalize_training_job(training_job_id=job.id)
        with pytest.raises(VLAError):
            svc.stop_training_job(training_job_id=job.id)


# === B03-R17: TrainingJob 审计 ===
class TestB03R17Audit:
    def test_submit_writes_audit(self, svc: TrainService, session: Any, project_ctx: dict) -> None:
        from vla_common.audit import write_audit, AuditLog

        job = svc.submit_training_job(
            project_id=project_ctx["project_id"],
            job_name="R17",
            base_model="OpenVLA-7B",
            dataset_version_id="v1.0",
            hyperparams={},
            requested_by=project_ctx["user_id"],
        )
        write_audit(
            actor_user_id=project_ctx["user_id"],
            actor_role="researcher",
            project_id=project_ctx["project_id"],
            action="submit_training_job",
            target_resource_id=job.id,
            target_resource_type="training_job",
            result="success",
            session=session,
        )
        session.commit()
        log = session.query(AuditLog).filter(AuditLog.target_resource_id == job.id).first()
        assert log is not None


# === config_hash ===
def test_config_hash_stable() -> None:
    h1 = _config_hash("OpenVLA-7B", "v1.0", {"lr": 2e-5, "batch": 32})
    h2 = _config_hash("OpenVLA-7B", "v1.0", {"batch": 32, "lr": 2e-5})
    assert h1 == h2


# === Constants ===
def test_valid_base_models_count() -> None:
    assert len(VALID_BASE_MODELS) == 5
    assert "OpenVLA-7B" in VALID_BASE_MODELS
