"""B01 仿真 17 RXX 单元测试 (R01 ~ R17)."""
from __future__ import annotations

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
sys.path.insert(0, os.path.join(ROOT, "apps/sim-svc/src"))
sys.path.insert(0, os.path.join(ROOT, "apps/pipe-svc/src"))

from vla_common.config import get_settings
from vla_common.errors import ErrorCode, VLAError
from vla_db.base import Base
from vla_db.session import get_engine, get_session_factory
from vla.sim.domain import (
    PHYSICS_PARAM_BOUNDS,
    SimEpisode,
    SimJob,
    SimJobStatus,
    SimWorker,
    SceneAsset,
    VALID_SCENE_TEMPLATES,
    validate_physics_config,
)
from vla.sim.service import SimService, _scene_hash


@pytest.fixture
def session():
    db_path = f"/tmp/{uuid.uuid4().hex}.db"
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    get_settings.cache_clear()
    import vla_common.audit  # noqa: F401
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
def svc(session: Any) -> SimService:
    return SimService(session)


@pytest.fixture
def project_ctx() -> dict[str, str]:
    return {
        "project_id": str(uuid.uuid4()),
        "user_id": str(uuid.uuid4()),
    }


# === B01-R01: 创建 SimJob (Happy Path) ===
class TestB01R01CreateSimJob:
    def test_create_sim_job_happy_path(self, svc: SimService, project_ctx: dict) -> None:
        job = svc.create_sim_job(
            project_id=project_ctx["project_id"],
            task_name="抓取杯子",
            engine="isaac_sim",
            num_episodes=1000,
            task_spec={"task": "grasp_cup", "object": "cup"},
            physics_config={"friction": 0.5, "gravity": 9.8, "mass_kg": 0.3},
            scene_template_id="kitchen_table",
            randomization_applied=False,
            copyright_owner="VLA Lab",
            requested_by=project_ctx["user_id"],
        )
        assert job.id
        assert job.status == SimJobStatus.PENDING
        assert job.scene_hash  # B01-R13 自动生成
        assert job.scene_template_id == "kitchen_table"


# === B01-R02: 物理参数域随机化 ===
class TestB01R02Randomization:
    def test_randomization_applied_flag_persisted(
        self, svc: SimService, project_ctx: dict
    ) -> None:
        job = svc.create_sim_job(
            project_id=project_ctx["project_id"],
            task_name="R02",
            engine="mujoco",
            num_episodes=10,
            task_spec={"task": "grasp_cup"},
            physics_config={"friction": 0.5},
            randomization_applied=True,
            copyright_owner="VLA Lab",
            requested_by=project_ctx["user_id"],
        )
        assert job.randomization_applied is True

    def test_actual_physics_recorded_per_episode(
        self, svc: SimService, project_ctx: dict
    ) -> None:
        """R02 实际物理参数记录在 SimEpisode.actual_physics."""
        job = svc.create_sim_job(
            project_id=project_ctx["project_id"],
            task_name="R02 ep",
            engine="isaac_sim",
            num_episodes=10,
            task_spec={"task": "grasp_cup"},
            physics_config={"friction": 0.5},
            randomization_applied=True,
            copyright_owner="VLA Lab",
            requested_by=project_ctx["user_id"],
        )
        svc.start_sim_job(sim_job_id=job.id)
        ep = svc.record_episode(
            sim_job_id=job.id,
            episode_index=0,
            success=True,
            actual_physics={"friction": 0.42, "gravity": 9.7},
        )
        assert ep.actual_physics["friction"] == 0.42


# === B01-R03: SceneAsset 上传 ===
class TestB01R03SceneAsset:
    def test_upload_usd_asset(self, svc: SimService, project_ctx: dict) -> None:
        asset = svc.upload_scene_asset(
            project_id=project_ctx["project_id"],
            name="asset_v1.usd",
            format="usd",
            file_uri="s3://assets/usd/asset_v1.usd",
            size_bytes=50 * 1024 * 1024,  # 50MB
            copyright_owner="VLA Lab",
            uploaded_by=project_ctx["user_id"],
        )
        assert asset.id
        assert asset.format == "usd"
        assert asset.size_bytes == 50 * 1024 * 1024
        assert asset.status == "ready"

    def test_invalid_format_rejected(self, svc: SimService, project_ctx: dict) -> None:
        with pytest.raises(VLAError) as exc_info:
            svc.upload_scene_asset(
                project_id=project_ctx["project_id"],
                name="bad.exe",
                format="exe",
                file_uri="s3://x.exe",
                size_bytes=1024,
                uploaded_by=project_ctx["user_id"],
            )
        assert exc_info.value.code == ErrorCode.B01_SIM_INVALID_SCENE


# === B01-R04: 启动 + episode 生成 ===
class TestB01R04StartAndEpisodes:
    def test_start_pending_job(self, svc: SimService, project_ctx: dict) -> None:
        job = svc.create_sim_job(
            project_id=project_ctx["project_id"],
            task_name="R04",
            engine="isaac_sim",
            num_episodes=10,
            task_spec={"task": "grasp_cup"},
            physics_config={"friction": 0.5},
            copyright_owner="VLA Lab",
            requested_by=project_ctx["user_id"],
        )
        job = svc.start_sim_job(sim_job_id=job.id, worker_id="worker-001")
        assert job.status == SimJobStatus.RUNNING
        assert job.started_at

    def test_record_episode_increments_counter(
        self, svc: SimService, project_ctx: dict
    ) -> None:
        job = svc.create_sim_job(
            project_id=project_ctx["project_id"],
            task_name="R04 ep count",
            engine="mujoco",
            num_episodes=3,
            task_spec={"task": "grasp_cup"},
            physics_config={"friction": 0.5},
            copyright_owner="VLA Lab",
            requested_by=project_ctx["user_id"],
        )
        svc.start_sim_job(sim_job_id=job.id)
        for i in range(3):
            svc.record_episode(
                sim_job_id=job.id,
                episode_index=i,
                success=True,
                video_uri=f"s3://datalake/sim/{job.id}/ep{i}.mp4",
            )
        session = svc.session
        session.refresh(job)
        assert job.successful_episodes == 3


# === B01-R05: 100% 完成 ===
class TestB01R05Completion:
    def test_finalize_success(self, svc: SimService, project_ctx: dict) -> None:
        job = svc.create_sim_job(
            project_id=project_ctx["project_id"],
            task_name="R05",
            engine="isaac_sim",
            num_episodes=10,
            task_spec={"task": "grasp_cup"},
            physics_config={"friction": 0.5},
            copyright_owner="VLA Lab",
            requested_by=project_ctx["user_id"],
        )
        svc.start_sim_job(sim_job_id=job.id)
        for i in range(10):
            svc.record_episode(sim_job_id=job.id, episode_index=i, success=True)
        job = svc.finalize_sim_job(sim_job_id=job.id, status=SimJobStatus.SUCCESS)
        assert job.status == SimJobStatus.SUCCESS
        assert job.completed_at
        assert job.successful_episodes == 10


# === B01-R06: 物理参数非法被拒 ===
class TestB01R06InvalidPhysics:
    def test_negative_friction_rejected(self, svc: SimService, project_ctx: dict) -> None:
        with pytest.raises(VLAError) as exc_info:
            svc.create_sim_job(
                project_id=project_ctx["project_id"],
                task_name="R06",
                engine="isaac_sim",
                num_episodes=1,
                task_spec={"task": "grasp_cup"},
                physics_config={"friction": -0.5},  # 非法
                copyright_owner="VLA Lab",
                requested_by=project_ctx["user_id"],
            )
        assert exc_info.value.code == ErrorCode.B01_SIM_INVALID_TASK_SPEC
        assert "friction" in str(exc_info.value.message)

    def test_gravity_out_of_range_rejected(
        self, svc: SimService, project_ctx: dict
    ) -> None:
        with pytest.raises(VLAError):
            svc.create_sim_job(
                project_id=project_ctx["project_id"],
                task_name="R06 gravity",
                engine="mujoco",
                num_episodes=1,
                task_spec={"task": "grasp_cup"},
                physics_config={"gravity": 100.0},  # > 30 越界
                copyright_owner="VLA Lab",
                requested_by=project_ctx["user_id"],
            )

    def test_validate_physics_helper(self) -> None:
        errors = validate_physics_config({"friction": -0.5, "gravity": 9.8})
        assert any("friction" in e for e in errors)

        errors = validate_physics_config(None)
        assert errors == []


# === B01-R07: scene_template 不存在 ===
class TestB01R07InvalidSceneTemplate:
    def test_unknown_template_rejected(
        self, svc: SimService, project_ctx: dict
    ) -> None:
        with pytest.raises(VLAError) as exc_info:
            svc.create_sim_job(
                project_id=project_ctx["project_id"],
                task_name="R07",
                engine="isaac_sim",
                num_episodes=1,
                task_spec={"task": "grasp_cup"},
                physics_config={"friction": 0.5},
                scene_template_id="unknown_scene_999",
                copyright_owner="VLA Lab",
                requested_by=project_ctx["user_id"],
            )
        assert exc_info.value.code == ErrorCode.B01_SIM_INVALID_SCENE
        assert exc_info.value.status_code == 422


# === B01-R08: Isaac 崩溃 SimJob 失败 ===
class TestB01R08SimCrash:
    def test_finalize_failed_preserves_completed_episodes(
        self, svc: SimService, project_ctx: dict
    ) -> None:
        """R08: 50/1000 已完成, Isaac 崩溃 → 失败状态 + 50 episode 保留."""
        job = svc.create_sim_job(
            project_id=project_ctx["project_id"],
            task_name="R08",
            engine="isaac_sim",
            num_episodes=1000,
            task_spec={"task": "grasp_cup"},
            physics_config={"friction": 0.5},
            copyright_owner="VLA Lab",
            requested_by=project_ctx["user_id"],
        )
        svc.start_sim_job(sim_job_id=job.id)
        for i in range(50):
            svc.record_episode(sim_job_id=job.id, episode_index=i, success=True)
        job = svc.finalize_sim_job(
            sim_job_id=job.id,
            status=SimJobStatus.FAILED,
            error_code="VLA-B01-0021",
            error_message="Isaac CUDA OOM",
        )
        assert job.status == SimJobStatus.FAILED
        assert job.error_code == "VLA-B01-0021"
        assert job.successful_episodes == 50  # 已完成保留


# === B01-R09: 部分 episode 失败 ===
class TestB01R09PartialFailure:
    def test_partial_failure_still_success(
        self, svc: SimService, project_ctx: dict
    ) -> None:
        """R09: 1000 中 50 失败 → success_rate = 95%, 状态 SUCCESS."""
        job = svc.create_sim_job(
            project_id=project_ctx["project_id"],
            task_name="R09",
            engine="isaac_sim",
            num_episodes=1000,
            task_spec={"task": "grasp_cup"},
            physics_config={"friction": 0.5},
            copyright_owner="VLA Lab",
            requested_by=project_ctx["user_id"],
        )
        svc.start_sim_job(sim_job_id=job.id)
        for i in range(950):
            svc.record_episode(sim_job_id=job.id, episode_index=i, success=True)
        for i in range(950, 1000):
            svc.record_episode(
                sim_job_id=job.id,
                episode_index=i,
                success=False,
                error_message="physics diverged",
            )
        job = svc.finalize_sim_job(sim_job_id=job.id, status=SimJobStatus.SUCCESS)
        assert job.status == SimJobStatus.SUCCESS
        assert job.successful_episodes == 950
        assert job.failed_episodes == 50
        success_rate = job.successful_episodes / (job.successful_episodes + job.failed_episodes)
        assert success_rate == 0.95


# === B01-R10: 崩溃后重试 ===
class TestB01R10Retry:
    def test_retry_failed_job(self, svc: SimService, project_ctx: dict) -> None:
        job = svc.create_sim_job(
            project_id=project_ctx["project_id"],
            task_name="R10",
            engine="isaac_sim",
            num_episodes=100,
            task_spec={"task": "grasp_cup"},
            physics_config={"friction": 0.5},
            copyright_owner="VLA Lab",
            requested_by=project_ctx["user_id"],
        )
        svc.start_sim_job(sim_job_id=job.id)  # attempt_id = 1
        job = svc.finalize_sim_job(
            sim_job_id=job.id, status=SimJobStatus.FAILED, error_code="E", error_message="m"
        )
        job = svc.retry_sim_job(sim_job_id=job.id)
        assert job.status == SimJobStatus.PENDING
        # start 增 1 → 1, retry 不增 → 1 (retry 重置后下次 start 才 +1)
        assert job.attempt_id == 1

    def test_retry_exceeds_max_attempts(self, svc: SimService, project_ctx: dict) -> None:
        job = svc.create_sim_job(
            project_id=project_ctx["project_id"],
            task_name="R10 max",
            engine="isaac_sim",
            num_episodes=10,
            task_spec={"task": "grasp_cup"},
            physics_config={"friction": 0.5},
            max_attempts=2,
            copyright_owner="VLA Lab",
            requested_by=project_ctx["user_id"],
        )
        # 手动 attempt_id
        job.attempt_id = 2
        svc.session.flush()
        svc.start_sim_job(sim_job_id=job.id)
        svc.finalize_sim_job(sim_job_id=job.id, status=SimJobStatus.FAILED)
        with pytest.raises(VLAError):
            svc.retry_sim_job(sim_job_id=job.id)


# === B01-R11: 单 worker 并发 ≤ 100 ===
class TestB01R11WorkerConcurrency:
    def test_max_concurrent_above_100_rejected(
        self, svc: SimService, project_ctx: dict
    ) -> None:
        with pytest.raises(VLAError) as exc_info:
            svc.acquire_worker(
                engine="isaac_sim", worker_id="w-001", max_concurrent=200
            )
        assert "100" in str(exc_info.value.message)

    def test_max_concurrent_100_accepted(self, svc: SimService, project_ctx: dict) -> None:
        worker = svc.acquire_worker(engine="isaac_sim", worker_id="w-002", max_concurrent=100)
        assert worker.max_concurrent_episodes == 100
        assert worker.status == "idle"


# === B01-R12: 版权声明必填 ===
class TestB01R12Copyright:
    def test_missing_copyright_rejected(
        self, svc: SimService, project_ctx: dict
    ) -> None:
        with pytest.raises(VLAError) as exc_info:
            svc.create_sim_job(
                project_id=project_ctx["project_id"],
                task_name="R12",
                engine="isaac_sim",
                num_episodes=1,
                task_spec={"task": "grasp_cup"},
                physics_config={"friction": 0.5},
                copyright_owner=None,  # 必填
                requested_by=project_ctx["user_id"],
            )
        assert exc_info.value.status_code == 422
        assert "copyright_owner" in str(exc_info.value.message)

    def test_empty_copyright_rejected(
        self, svc: SimService, project_ctx: dict
    ) -> None:
        with pytest.raises(VLAError):
            svc.create_sim_job(
                project_id=project_ctx["project_id"],
                task_name="R12 empty",
                engine="isaac_sim",
                num_episodes=1,
                task_spec={"task": "grasp_cup"},
                physics_config={"friction": 0.5},
                copyright_owner="  ",
                requested_by=project_ctx["user_id"],
            )


# === B01-R13: 重复提交识别 ===
class TestB01R13DuplicateSubmission:
    def test_same_scene_hash_duplicate_rejected(
        self, svc: SimService, project_ctx: dict
    ) -> None:
        params = {
            "task_name": "R13",
            "engine": "isaac_sim",
            "num_episodes": 10,
            "task_spec": {"task": "grasp_cup", "seed": 42},
            "physics_config": {"friction": 0.5, "gravity": 9.8},
            "copyright_owner": "VLA Lab",
            "requested_by": project_ctx["user_id"],
        }
        job1 = svc.create_sim_job(project_id=project_ctx["project_id"], **params)
        # 第 2 次相同配置 → 409
        with pytest.raises(VLAError) as exc_info:
            svc.create_sim_job(
                project_id=project_ctx["project_id"],
                **{**params, "task_name": "R13 副本"},
            )
        assert exc_info.value.code == ErrorCode.X_IDEMPOTENCY_CONFLICT
        assert job1.id in str(exc_info.value.details.get("existing_sim_job_id", ""))


# === B01-R14: 状态不允许时不可撤销 ===
class TestB01R14CancelTerminal:
    def test_cancel_success_job_rejected(
        self, svc: SimService, project_ctx: dict
    ) -> None:
        job = svc.create_sim_job(
            project_id=project_ctx["project_id"],
            task_name="R14",
            engine="isaac_sim",
            num_episodes=1,
            task_spec={"task": "grasp_cup"},
            physics_config={"friction": 0.5},
            copyright_owner="VLA Lab",
            requested_by=project_ctx["user_id"],
        )
        svc.start_sim_job(sim_job_id=job.id)
        svc.finalize_sim_job(sim_job_id=job.id, status=SimJobStatus.SUCCESS)
        with pytest.raises(VLAError):
            svc.cancel_sim_job(sim_job_id=job.id)

    def test_cancel_running_job_succeeds(
        self, svc: SimService, project_ctx: dict
    ) -> None:
        job = svc.create_sim_job(
            project_id=project_ctx["project_id"],
            task_name="R14 cancel",
            engine="isaac_sim",
            num_episodes=1,
            task_spec={"task": "grasp_cup"},
            physics_config={"friction": 0.5},
            copyright_owner="VLA Lab",
            requested_by=project_ctx["user_id"],
        )
        svc.start_sim_job(sim_job_id=job.id)
        job = svc.cancel_sim_job(sim_job_id=job.id)
        assert job.status == SimJobStatus.CANCELLED


# === B01-R15: 大规模 10K+ episodes ===
class TestB01R15LargeScale:
    def test_10k_episodes_accepted(self, svc: SimService, project_ctx: dict) -> None:
        job = svc.create_sim_job(
            project_id=project_ctx["project_id"],
            task_name="R15 10K",
            engine="isaac_sim",
            num_episodes=10_000,
            task_spec={"task": "grasp_cup"},
            physics_config={"friction": 0.5},
            copyright_owner="VLA Lab",
            requested_by=project_ctx["user_id"],
        )
        assert job.num_episodes == 10_000

    def test_zero_episodes_rejected(
        self, svc: SimService, project_ctx: dict
    ) -> None:
        with pytest.raises(VLAError):
            svc.create_sim_job(
                project_id=project_ctx["project_id"],
                task_name="R15 zero",
                engine="isaac_sim",
                num_episodes=0,
                task_spec={"task": "grasp_cup"},
                physics_config={"friction": 0.5},
                copyright_owner="VLA Lab",
                requested_by=project_ctx["user_id"],
            )


# === B01-R16: 5 预置任务模板 ===
class TestB01R16TaskTemplates:
    def test_5_preset_templates(self) -> None:
        assert len(SimService.PRESET_TASK_TEMPLATES) == 5

    def test_apply_grasp_cup_template(self, svc: SimService) -> None:
        spec = svc.apply_task_template(template_id="grasp_cup")
        assert spec["task_type"] == "manipulation"
        assert spec["object"] == "cup"

    def test_unknown_template_rejected(self, svc: SimService) -> None:
        with pytest.raises(VLAError):
            svc.apply_task_template(template_id="fly_to_moon")

    def test_overrides_applied(self, svc: SimService) -> None:
        spec = svc.apply_task_template(
            template_id="grasp_cup", overrides={"object": "bottle"}
        )
        assert spec["object"] == "bottle"


# === B01-R17: episode 重放 (重 query 已生成 episode) ===
class TestB01R17EpisodeReplay:
    def test_query_episodes_by_sim_job(
        self, svc: SimService, project_ctx: dict
    ) -> None:
        job = svc.create_sim_job(
            project_id=project_ctx["project_id"],
            task_name="R17",
            engine="isaac_sim",
            num_episodes=3,
            task_spec={"task": "grasp_cup"},
            physics_config={"friction": 0.5},
            copyright_owner="VLA Lab",
            requested_by=project_ctx["user_id"],
        )
        svc.start_sim_job(sim_job_id=job.id)
        for i in range(3):
            svc.record_episode(
                sim_job_id=job.id,
                episode_index=i,
                success=True,
                video_uri=f"s3://datalake/sim/{job.id}/ep{i}.mp4",
            )
        svc.session.flush()
        episodes = (
            svc.session.query(SimEpisode)
            .filter(SimEpisode.sim_job_id == job.id)
            .order_by(SimEpisode.episode_index)
            .all()
        )
        assert len(episodes) == 3
        assert [e.episode_index for e in episodes] == [0, 1, 2]
        assert all(e.video_uri for e in episodes)


# === Scene hash helper ===
def test_scene_hash_stable() -> None:
    h1 = _scene_hash({"task": "grasp_cup"}, {"friction": 0.5})
    h2 = _scene_hash({"task": "grasp_cup"}, {"friction": 0.5})
    assert h1 == h2
    h3 = _scene_hash({"task": "grasp_cup"}, {"friction": 0.6})
    assert h1 != h3


# === Constants ===
def test_physics_bounds() -> None:
    assert PHYSICS_PARAM_BOUNDS["friction"] == (0.0, 2.0)
    assert PHYSICS_PARAM_BOUNDS["gravity"] == (0.0, 30.0)


def test_valid_scene_templates_count() -> None:
    assert len(VALID_SCENE_TEMPLATES) >= 5
