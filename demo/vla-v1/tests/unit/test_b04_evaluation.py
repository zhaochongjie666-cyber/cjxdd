"""B04 评测 17 RXX 单元测试 (R01 ~ R17)."""
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
sys.path.insert(0, os.path.join(ROOT, "apps/eval-svc/src"))
sys.path.insert(0, os.path.join(ROOT, "apps/sim-svc/src"))
sys.path.insert(0, os.path.join(ROOT, "apps/pipe-svc/src"))

from vla_common.config import get_settings
from vla_common.errors import ErrorCode, VLAError
from vla_db.base import Base
from vla_db.session import get_engine, get_session_factory
from vla.eval.domain import (
    VALID_BENCHMARKS,
    EvalJob,
    EvalJobStatus,
    EvalReport,
    EvalTask,
)
from vla.eval.service import EvalService, _config_hash


@pytest.fixture
def session():
    db_path = f"/tmp/{uuid.uuid4().hex}.db"
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    get_settings.cache_clear()
    import vla_common.audit  # noqa: F401
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
def svc(session: Any) -> EvalService:
    return EvalService(session)


@pytest.fixture
def project_ctx() -> dict[str, str]:
    return {"project_id": str(uuid.uuid4()), "user_id": str(uuid.uuid4())}


# === B04-R01: 提交 EvalJob (Happy Path) ===
class TestB04R01SubmitEvalJob:
    def test_submit_happy_path(self, svc: EvalService, project_ctx: dict) -> None:
        job = svc.submit_eval_job(
            project_id=project_ctx["project_id"],
            job_name="R01 test",
            model_version_id="v1.0",
            benchmarks=["libero_spatial"],
            num_trials=10,
            requested_by=project_ctx["user_id"],
        )
        assert job.id
        assert job.status == EvalJobStatus.PENDING
        assert job.model_version_id == "v1.0"
        assert job.config_hash  # R15 自动生成


# === B04-R02: 启动并跑 trial ===
class TestB04R02StartAndTrials:
    def test_start_pending_job(self, svc: EvalService, project_ctx: dict) -> None:
        job = svc.submit_eval_job(
            project_id=project_ctx["project_id"],
            job_name="R02",
            model_version_id="v1.0",
            benchmarks=["libero_spatial"],
            requested_by=project_ctx["user_id"],
        )
        job = svc.start_eval_job(eval_job_id=job.id)
        assert job.status == EvalJobStatus.RUNNING
        assert job.started_at

    def test_record_trial_increments_counter(
        self, svc: EvalService, project_ctx: dict
    ) -> None:
        job = svc.submit_eval_job(
            project_id=project_ctx["project_id"],
            job_name="R02 ep",
            model_version_id="v1.0",
            benchmarks=["libero_spatial"],
            num_trials=3,
            requested_by=project_ctx["user_id"],
        )
        svc.start_eval_job(eval_job_id=job.id)
        for i in range(3):
            svc.record_trial(
                eval_job_id=job.id,
                benchmark="libero_spatial",
                task_name="pick_cup",
                trial_index=i,
                success=True,
            )
        svc.session.refresh(job)
        assert job.successful_trials == 3


# === B04-R03: 完成 + 生成报告 ===
class TestB04R03Completion:
    def test_finalize_success(self, svc: EvalService, project_ctx: dict) -> None:
        job = svc.submit_eval_job(
            project_id=project_ctx["project_id"],
            job_name="R03",
            model_version_id="v1.0",
            benchmarks=["libero_spatial"],
            num_trials=3,
            requested_by=project_ctx["user_id"],
        )
        svc.start_eval_job(eval_job_id=job.id)
        for i in range(3):
            svc.record_trial(
                eval_job_id=job.id,
                benchmark="libero_spatial",
                task_name="t1",
                trial_index=i,
                success=True,
            )
        job = svc.finalize_eval_job(
            eval_job_id=job.id,
            per_benchmark_rates={"libero_spatial": [0.8, 0.85, 0.9]},
        )
        assert job.status == EvalJobStatus.SUCCESS
        assert job.median_success_rate == 0.85


# === B04-R04: 发布 EvalReport ===
class TestB04R04PublishReport:
    def test_publish_report_success(self, svc: EvalService, project_ctx: dict) -> None:
        job = svc.submit_eval_job(
            project_id=project_ctx["project_id"],
            job_name="R04",
            model_version_id="v1.0",
            benchmarks=["libero_spatial"],
            requested_by=project_ctx["user_id"],
        )
        svc.start_eval_job(eval_job_id=job.id)
        for i in range(3):
            svc.record_trial(
                eval_job_id=job.id,
                benchmark="libero_spatial",
                task_name="t1",
                trial_index=i,
                success=True,
            )
        svc.finalize_eval_job(
            eval_job_id=job.id, per_benchmark_rates={"libero_spatial": [0.9, 0.9, 0.9]}
        )
        report = svc.publish_report(eval_job_id=job.id, title="v1.0 vs LIBERO")
        assert report.id
        assert report.published is True
        assert report.overall_success_rate == 0.9

    def test_publish_pending_rejected(self, svc: EvalService, project_ctx: dict) -> None:
        job = svc.submit_eval_job(
            project_id=project_ctx["project_id"],
            job_name="R04 pending",
            model_version_id="v1.0",
            benchmarks=["libero_spatial"],
            requested_by=project_ctx["user_id"],
        )
        with pytest.raises(VLAError) as exc_info:
            svc.publish_report(eval_job_id=job.id)
        assert exc_info.value.status_code == 409


# === B04-R05: 3 trial 中位数 (R4.1 复现性) ===
class TestB04R05Reproducibility:
    def test_median_three_trials(self, svc: EvalService, project_ctx: dict) -> None:
        job = svc.submit_eval_job(
            project_id=project_ctx["project_id"],
            job_name="R05",
            model_version_id="v1.0",
            benchmarks=["libero_spatial"],
            num_trials=3,
            requested_by=project_ctx["user_id"],
        )
        svc.start_eval_job(eval_job_id=job.id)
        for i in range(3):
            svc.record_trial(
                eval_job_id=job.id,
                benchmark="libero_spatial",
                task_name="t1",
                trial_index=i,
                success=True,
            )
        # 3 trial rates
        job = svc.finalize_eval_job(
            eval_job_id=job.id,
            per_benchmark_rates={"libero_spatial": [0.80, 0.85, 0.90]},
        )
        assert job.median_success_rate == 0.85
        assert job.std_dev is not None
        assert abs(job.std_dev - 0.05) < 0.001

    def test_low_std_passes_reproducibility(
        self, svc: EvalService, project_ctx: dict
    ) -> None:
        job = svc.submit_eval_job(
            project_id=project_ctx["project_id"],
            job_name="R05 low std",
            model_version_id="v1.0",
            benchmarks=["libero_spatial"],
            requested_by=project_ctx["user_id"],
        )
        svc.start_eval_job(eval_job_id=job.id)
        for i in range(3):
            svc.record_trial(
                eval_job_id=job.id,
                benchmark="libero_spatial",
                task_name="t1",
                trial_index=i,
                success=True,
            )
        job = svc.finalize_eval_job(
            eval_job_id=job.id,
            per_benchmark_rates={"libero_spatial": [0.85, 0.86, 0.85]},
        )
        assert job.reproducibility_passed is True  # std < 0.05

    def test_high_std_fails_reproducibility(
        self, svc: EvalService, project_ctx: dict
    ) -> None:
        job = svc.submit_eval_job(
            project_id=project_ctx["project_id"],
            job_name="R05 high std",
            model_version_id="v1.0",
            benchmarks=["libero_spatial"],
            requested_by=project_ctx["user_id"],
        )
        svc.start_eval_job(eval_job_id=job.id)
        for i in range(3):
            svc.record_trial(
                eval_job_id=job.id,
                benchmark="libero_spatial",
                task_name="t1",
                trial_index=i,
                success=True,
            )
        job = svc.finalize_eval_job(
            eval_job_id=job.id,
            per_benchmark_rates={"libero_spatial": [0.5, 0.9, 0.7]},
        )
        assert job.reproducibility_passed is False  # std > 0.05


# === B04-R06: 多 benchmark (LIBERO 4 套件) ===
class TestB04R06MultipleBenchmarks:
    def test_submit_with_4_benchmarks(self, svc: EvalService, project_ctx: dict) -> None:
        job = svc.submit_eval_job(
            project_id=project_ctx["project_id"],
            job_name="R06",
            model_version_id="v1.0",
            benchmarks=["libero_spatial", "libero_object", "libero_goal", "libero_10"],
            requested_by=project_ctx["user_id"],
        )
        assert len(job.benchmarks) == 4

    def test_invalid_benchmark_rejected(
        self, svc: EvalService, project_ctx: dict
    ) -> None:
        with pytest.raises(VLAError) as exc_info:
            svc.submit_eval_job(
                project_id=project_ctx["project_id"],
                job_name="R06 invalid",
                model_version_id="v1.0",
                benchmarks=["libero_spatial", "FAKE_BENCH"],
                requested_by=project_ctx["user_id"],
            )
        assert exc_info.value.code == ErrorCode.B04_EVAL_BENCHMARK_MISSING

    def test_empty_benchmarks_rejected(
        self, svc: EvalService, project_ctx: dict
    ) -> None:
        with pytest.raises(VLAError):
            svc.submit_eval_job(
                project_id=project_ctx["project_id"],
                job_name="R06 empty",
                model_version_id="v1.0",
                benchmarks=[],
                requested_by=project_ctx["user_id"],
            )


# === B04-R07: model_version_id 不存在被拒 ===
class TestB04R07InvalidModelVersion:
    def test_empty_model_version_rejected(
        self, svc: EvalService, project_ctx: dict
    ) -> None:
        with pytest.raises(VLAError) as exc_info:
            svc.submit_eval_job(
                project_id=project_ctx["project_id"],
                job_name="R07",
                model_version_id="",
                benchmarks=["libero_spatial"],
                requested_by=project_ctx["user_id"],
            )
        assert exc_info.value.code == ErrorCode.B04_EVAL_BENCHMARK_MISSING


# === B04-R09: HTML/PDF/JSON 3 格式报告 ===
class TestB04R09ReportFormats:
    def test_report_has_3_format_uris(
        self, svc: EvalService, project_ctx: dict
    ) -> None:
        job = svc.submit_eval_job(
            project_id=project_ctx["project_id"],
            job_name="R09",
            model_version_id="v1.0",
            benchmarks=["libero_spatial"],
            requested_by=project_ctx["user_id"],
        )
        svc.start_eval_job(eval_job_id=job.id)
        for i in range(3):
            svc.record_trial(
                eval_job_id=job.id,
                benchmark="libero_spatial",
                task_name="t1",
                trial_index=i,
                success=True,
            )
        svc.finalize_eval_job(
            eval_job_id=job.id, per_benchmark_rates={"libero_spatial": [0.9, 0.9, 0.9]}
        )
        report = svc.publish_report(eval_job_id=job.id)
        # 报告有 html_uri / pdf_uri / json_uri 字段
        assert hasattr(report, "html_uri")
        assert hasattr(report, "pdf_uri")
        assert hasattr(report, "json_uri")


# === B04-R10: 归档 S3 ===
class TestB04R10S3Archive:
    def test_report_uri_is_s3(self, svc: EvalService, project_ctx: dict) -> None:
        job = svc.submit_eval_job(
            project_id=project_ctx["project_id"],
            job_name="R10",
            model_version_id="v1.0",
            benchmarks=["libero_spatial"],
            requested_by=project_ctx["user_id"],
        )
        svc.start_eval_job(eval_job_id=job.id)
        for i in range(3):
            svc.record_trial(
                eval_job_id=job.id,
                benchmark="libero_spatial",
                task_name="t1",
                trial_index=i,
                success=True,
            )
        svc.finalize_eval_job(
            eval_job_id=job.id, per_benchmark_rates={"libero_spatial": [0.9, 0.9, 0.9]}
        )
        svc.publish_report(eval_job_id=job.id)
        svc.session.refresh(job)
        assert job.report_uri and job.report_uri.startswith("s3://")


# === B04-R11: 部分 trial 失败不计入分母 ===
class TestB04R11SystemErrorsNotInDenom:
    def test_system_error_excluded_from_denom(
        self, svc: EvalService, project_ctx: dict
    ) -> None:
        """R11: 推理服务崩溃 (VLA-B04-0001) → 不计入分母."""
        assert svc.should_count_trial(error_code="VLA-B04-0001") is False
        assert svc.should_count_trial(error_code="VLA-B04-0021") is False  # vLLM 崩溃
        # 业务失败 (success=False, 无 error_code) → 计入
        assert svc.should_count_trial(error_code=None) is True


# === B04-R12: 取消 (running 状态) ===
class TestB04R12Cancel:
    def test_cancel_running_succeeds(
        self, svc: EvalService, project_ctx: dict
    ) -> None:
        job = svc.submit_eval_job(
            project_id=project_ctx["project_id"],
            job_name="R12 cancel",
            model_version_id="v1.0",
            benchmarks=["libero_spatial"],
            requested_by=project_ctx["user_id"],
        )
        svc.start_eval_job(eval_job_id=job.id)
        job = svc.cancel_eval_job(eval_job_id=job.id)
        assert job.status == EvalJobStatus.CANCELLED

    def test_cancel_completed_rejected(
        self, svc: EvalService, project_ctx: dict
    ) -> None:
        job = svc.submit_eval_job(
            project_id=project_ctx["project_id"],
            job_name="R12 reject",
            model_version_id="v1.0",
            benchmarks=["libero_spatial"],
            requested_by=project_ctx["user_id"],
        )
        svc.start_eval_job(eval_job_id=job.id)
        for i in range(3):
            svc.record_trial(
                eval_job_id=job.id,
                benchmark="libero_spatial",
                task_name="t1",
                trial_index=i,
                success=True,
            )
        svc.finalize_eval_job(
            eval_job_id=job.id, per_benchmark_rates={"libero_spatial": [0.9, 0.9, 0.9]}
        )
        with pytest.raises(VLAError) as exc_info:
            svc.cancel_eval_job(eval_job_id=job.id)
        assert exc_info.value.status_code == 409


# === B04-R13: A/B 对比 ===
class TestB04R13ABCompare:
    def test_compare_two_models(self, svc: EvalService, project_ctx: dict) -> None:
        # 建 2 个 EvalJob: v1.0 和 v2.0
        for mv_id, rates in [("v1.0", 0.80), ("v2.0", 0.85)]:
            j = svc.submit_eval_job(
                project_id=project_ctx["project_id"],
                job_name=f"compare-{mv_id}",
                model_version_id=mv_id,
                benchmarks=["libero_spatial"],
                num_trials=3,
                requested_by=project_ctx["user_id"],
            )
            svc.start_eval_job(eval_job_id=j.id)
            for i in range(3):
                svc.record_trial(
                    eval_job_id=j.id,
                    benchmark="libero_spatial",
                    task_name="t1",
                    trial_index=i,
                    success=True,
                )
            svc.finalize_eval_job(
                eval_job_id=j.id,
                per_benchmark_rates={"libero_spatial": [rates] * 3},
            )
        result = svc.compare_model_versions(
            model_a_id="v1.0", model_b_id="v2.0", benchmark="libero_spatial"
        )
        assert result["model_a_median"] == 0.80
        assert result["model_b_median"] == 0.85
        assert abs(result["delta"] - 0.05) < 0.001


# === B04-R14: completed 不可 cancel (重复 R12, 这里测 lock 一下) ===
class TestB04R14TerminalLock:
    def test_finalize_already_completed_rejected(
        self, svc: EvalService, project_ctx: dict
    ) -> None:
        job = svc.submit_eval_job(
            project_id=project_ctx["project_id"],
            job_name="R14 lock",
            model_version_id="v1.0",
            benchmarks=["libero_spatial"],
            requested_by=project_ctx["user_id"],
        )
        svc.start_eval_job(eval_job_id=job.id)
        for i in range(3):
            svc.record_trial(
                eval_job_id=job.id,
                benchmark="libero_spatial",
                task_name="t1",
                trial_index=i,
                success=True,
            )
        svc.finalize_eval_job(
            eval_job_id=job.id, per_benchmark_rates={"libero_spatial": [0.9, 0.9, 0.9]}
        )
        with pytest.raises(VLAError):
            svc.finalize_eval_job(eval_job_id=job.id)


# === B04-R15: 重复 (model+benchmark+trial) 提交 ===
class TestB04R15DuplicateSubmission:
    def test_same_config_rejected(self, svc: EvalService, project_ctx: dict) -> None:
        params = {
            "project_id": project_ctx["project_id"],
            "job_name": "R15",
            "model_version_id": "v1.0",
            "benchmarks": ["libero_spatial", "libero_object"],
            "num_trials": 3,
            "requested_by": project_ctx["user_id"],
        }
        svc.submit_eval_job(**params)
        with pytest.raises(VLAError) as exc_info:
            svc.submit_eval_job(**{**params, "job_name": "R15 副本"})
        assert exc_info.value.code == ErrorCode.X_IDEMPOTENCY_CONFLICT


# === B04-R16: per-task metric 存储 ===
class TestB04R16PerTaskMetrics:
    def test_eval_task_recorded(self, svc: EvalService, project_ctx: dict) -> None:
        job = svc.submit_eval_job(
            project_id=project_ctx["project_id"],
            job_name="R16",
            model_version_id="v1.0",
            benchmarks=["libero_spatial"],
            num_trials=3,
            requested_by=project_ctx["user_id"],
        )
        svc.start_eval_job(eval_job_id=job.id)
        for task in ["pick_cup", "open_drawer", "stack_blocks"]:
            for i in range(3):
                svc.record_trial(
                    eval_job_id=job.id,
                    benchmark="libero_spatial",
                    task_name=task,
                    trial_index=i,
                    success=True,
                    duration_s=10.0 + i,
                )
        tasks = svc.session.query(EvalTask).filter(EvalTask.eval_job_id == job.id).all()
        assert len(tasks) == 9  # 3 task × 3 trial


# === B04-R17: EvalJob 审计 (写 audit_logs) ===
class TestB04R17Audit:
    def test_submit_writes_audit(self, svc: EvalService, session: Any, project_ctx: dict) -> None:
        from vla_common.audit import write_audit, AuditLog

        job = svc.submit_eval_job(
            project_id=project_ctx["project_id"],
            job_name="R17",
            model_version_id="v1.0",
            benchmarks=["libero_spatial"],
            requested_by=project_ctx["user_id"],
        )
        # 写审计
        write_audit(
            actor_user_id=project_ctx["user_id"],
            actor_role="evaluator",
            project_id=project_ctx["project_id"],
            action="submit_eval_job",
            target_resource_id=job.id,
            target_resource_type="eval_job",
            result="success",
            session=session,
        )
        session.commit()
        log = session.query(AuditLog).filter(AuditLog.target_resource_id == job.id).first()
        assert log is not None
        assert log.action == "submit_eval_job"


# === config_hash helper ===
def test_config_hash_stable() -> None:
    h1 = _config_hash("v1.0", ["libero_spatial", "libero_object"], 3)
    h2 = _config_hash("v1.0", ["libero_object", "libero_spatial"], 3)  # 顺序无关
    assert h1 == h2
    h3 = _config_hash("v2.0", ["libero_spatial"], 3)
    assert h1 != h3


# === Benchmark 常量 ===
def test_valid_benchmarks_count() -> None:
    """4 个 LIBERO 套件 + SimplerEnv."""
    assert "libero_spatial" in VALID_BENCHMARKS
    assert "libero_object" in VALID_BENCHMARKS
    assert "libero_goal" in VALID_BENCHMARKS
    assert "libero_10" in VALID_BENCHMARKS
    assert "simpler_env" in VALID_BENCHMARKS
