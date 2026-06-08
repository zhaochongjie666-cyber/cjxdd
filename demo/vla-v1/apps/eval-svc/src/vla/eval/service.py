"""B04 Eval service — Saga 状态机 + 业务逻辑 (R01 ~ R17)."""
from __future__ import annotations

import hashlib
import json
import logging
import statistics
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from vla_common.errors import ErrorCode, VLAError
from vla_events.producer import EventEnvelope, get_event_bus

from vla.eval.domain import (
    VALID_BENCHMARKS,
    EvalJob,
    EvalJobStatus,
    EvalReport,
    EvalTask,
    EvalWorker,
)

logger = logging.getLogger(__name__)


def _config_hash(model_version_id: str, benchmarks: list[str], num_trials: int) -> str:
    """B04-R15: 重复提交识别 (model + benchmark + trial_count)."""
    canonical = json.dumps(
        {"model": model_version_id, "benchmarks": sorted(benchmarks), "num_trials": num_trials},
        sort_keys=True,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:32]


class EvalService:
    """B04 Eval 业务逻辑层."""

    def __init__(self, session: Session) -> None:
        self.session = session

    # === B04-R01: 提交 EvalJob (Happy Path) ===
    def submit_eval_job(
        self,
        *,
        project_id: str,
        job_name: str,
        model_version_id: str,
        benchmarks: list[str],
        num_trials: int = 3,
        requested_by: str,
    ) -> EvalJob:
        """B04-R01 / R06 / R15.

        校验:
          - model_version_id 必存在 (R07 — 这里简化为任意非空 UUID)
          - benchmarks 至少 1, 全部在 VALID_BENCHMARKS
          - num_trials >= 1, 推荐 3 (R05 复现性)
          - 重复识别 (R15)
        """
        if not model_version_id or not model_version_id.strip():
            raise VLAError(
                ErrorCode.B04_EVAL_BENCHMARK_MISSING,
                "VLA-B04-0011 model_version_id 必填",
                status_code=422,
            )

        if not benchmarks:
            raise VLAError(
                ErrorCode.B04_EVAL_BENCHMARK_MISSING,
                "VLA-B04-0012 至少 1 个 benchmark",
                status_code=422,
            )
        unknown = [b for b in benchmarks if b not in VALID_BENCHMARKS]
        if unknown:
            raise VLAError(
                ErrorCode.B04_EVAL_BENCHMARK_MISSING,
                f"VLA-B04-0012 未知 benchmark: {unknown}",
                status_code=422,
                details={"valid_benchmarks": sorted(VALID_BENCHMARKS)},
            )

        if num_trials < 1:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"num_trials 必须 ≥ 1 (当前 {num_trials})",
                status_code=422,
            )

        # B04-R15: 重复识别
        cfg_hash = _config_hash(model_version_id, benchmarks, num_trials)
        existing = (
            self.session.query(EvalJob)
            .filter(
                EvalJob.project_id == project_id,
                EvalJob.config_hash == cfg_hash,
                EvalJob.status.notin_(
                    [EvalJobStatus.FAILED, EvalJobStatus.CANCELLED, EvalJobStatus.SUCCESS]
                ),
            )
            .first()
        )
        if existing:
            raise VLAError(
                ErrorCode.X_IDEMPOTENCY_CONFLICT,
                f"VLA-B04-0015 同 (model+benchmark+trial) 已有活跃 EvalJob ({existing.id})",
                status_code=409,
                details={"existing_eval_job_id": existing.id},
            )

        job = EvalJob(
            project_id=project_id,
            job_name=job_name,
            model_version_id=model_version_id,
            benchmarks=benchmarks,
            num_trials=num_trials,
            config_hash=cfg_hash,
            requested_by=requested_by,
            status=EvalJobStatus.PENDING,
        )
        self.session.add(job)
        self.session.flush()
        return job

    # === B04-R02: 启动 EvalJob ===
    def start_eval_job(self, *, eval_job_id: str) -> EvalJob:
        """PENDING → RUNNING."""
        job = self._get_job(eval_job_id)
        if job.status != EvalJobStatus.PENDING:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"EvalJob 状态 {job.status} 不允许 start (需要 PENDING)",
                status_code=409,
            )
        job.status = EvalJobStatus.RUNNING
        job.started_at = datetime.utcnow()
        self.session.flush()
        return job

    # === B04-R02/R05: 记录 trial 完成 ===
    def record_trial(
        self,
        *,
        eval_job_id: str,
        benchmark: str,
        task_name: str,
        trial_index: int,
        success: bool,
        duration_s: float | None = None,
        video_uri: str | None = None,
        error_message: str | None = None,
    ) -> EvalTask:
        """B04-R02: 记录 1 个 trial 结果."""
        job = self._get_job(eval_job_id)
        if job.status != EvalJobStatus.RUNNING:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"EvalJob 状态 {job.status} 不允许 record_trial (需要 RUNNING)",
                status_code=409,
            )
        task = EvalTask(
            eval_job_id=job.id,
            project_id=job.project_id,
            benchmark=benchmark,
            task_name=task_name,
            trial_index=trial_index,
            status="success" if success else "failed",
            success=success,
            duration_s=duration_s,
            video_uri=video_uri,
            error_message=error_message,
            completed_at=datetime.utcnow() if success else None,
        )
        self.session.add(task)
        if success:
            job.successful_trials += 1
        else:
            job.failed_trials += 1
        self.session.flush()
        return task

    # === B04-R03/R05: 完成 EvalJob (3 trial 中位数) ===
    def finalize_eval_job(
        self,
        *,
        eval_job_id: str,
        per_benchmark_rates: dict[str, list[float]] | None = None,
        status: str = EvalJobStatus.SUCCESS,
        error_code: str | None = None,
        error_message: str | None = None,
    ) -> EvalJob:
        """B04-R03 完成 + B04-R05 计算 3 trial 中位数 (R4.1 复现性).

        per_benchmark_rates: 每个 benchmark 的 trial 成功率列表 (e.g. {"libero_spatial": [0.9, 0.92, 0.88]})
        """
        job = self._get_job(eval_job_id)
        if job.status in EvalJobStatus.TERMINAL:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"EvalJob 已 {job.status}, 不可 finalize",
                status_code=409,
            )
        job.status = status
        job.completed_at = datetime.utcnow()
        if error_code:
            job.error_code = error_code
        if error_message:
            job.error_message = error_message

        # B04-R05: 3 trial 中位数 + std < 5%
        if per_benchmark_rates:
            overall_rates: list[float] = []
            for bench, rates in per_benchmark_rates.items():
                if rates:
                    overall_rates.extend(rates)
            if overall_rates:
                job.median_success_rate = statistics.median(overall_rates)
                if len(overall_rates) >= 2:
                    job.std_dev = statistics.stdev(overall_rates)
                else:
                    job.std_dev = 0.0
                # std < 5% 复现性通过
                job.reproducibility_passed = (job.std_dev or 0.0) < 0.05

        self.session.flush()

        # 发 EvalJobCompleted 事件
        if status == EvalJobStatus.SUCCESS:
            self._publish_event_safe(
                "vla.eval.job_completed",
                {
                    "eval_job_id": job.id,
                    "project_id": job.project_id,
                    "model_version_id": job.model_version_id,
                    "benchmark": (job.benchmarks or ["unknown"])[0],
                    "success_rate": job.median_success_rate or 0.0,
                    "std_dev": job.std_dev or 0.0,
                    "trial_count": job.num_trials,
                    "report_uri": job.report_uri or "",
                },
            )
        return job

    # === B04-R04: 发布 EvalReport ===
    def publish_report(
        self, *, eval_job_id: str, title: str | None = None
    ) -> EvalReport:
        """B04-R04: 发布 EvalReport. 触发 EvalReportPublished 事件 (X 跨业务)."""
        job = self._get_job(eval_job_id)
        if job.status != EvalJobStatus.SUCCESS:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"VLA-B04-0014 EvalJob 状态 {job.status} 不允许发布报告 (需要 SUCCESS)",
                status_code=409,
            )
        if not job.median_success_rate:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                "VLA-B04-0014 必须先 finalize 算出 success_rate 才能发布",
                status_code=400,
            )

        report = EvalReport(
            eval_job_id=job.id,
            project_id=job.project_id,
            model_version_id=job.model_version_id,
            title=title or f"EvalReport-{job.id[:8]}",
            overall_success_rate=job.median_success_rate,
            per_task_metrics={},
            published=True,
            published_at=datetime.utcnow(),
        )
        self.session.add(report)
        job.report_published = True
        job.report_uri = f"s3://reports/{job.id}/index.html"
        self.session.flush()
        return report

    # === B04-R12: 取消 ===
    def cancel_eval_job(self, *, eval_job_id: str) -> EvalJob:
        """B04-R12: 取消 EvalJob."""
        job = self._get_job(eval_job_id)
        if job.status in EvalJobStatus.TERMINAL:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"VLA-B04-0012 EvalJob 已 {job.status}, 不可取消",
                status_code=409,
            )
        job.status = EvalJobStatus.CANCELLED
        job.completed_at = datetime.utcnow()
        self.session.flush()
        return job

    # === B04-R11: 部分 trial 失败不计入分母 ===
    def should_count_trial(self, *, error_code: str | None) -> bool:
        """B04-R11: trial 失败分两类: 业务失败 (计入) vs 系统错误 (不计入).

        业务失败: 推理结果错 (success=False, 真实失败)
        系统错误: vLLM 崩溃 / 超时 (不计入 success_rate 分母)
        """
        if not error_code:
            return True  # 业务失败, 计入
        system_errors = {"VLA-B04-0001", "VLA-B04-0021", "VLA-B04-0022"}  # 超时/vLLM 崩溃
        return error_code not in system_errors

    # === B04-R13: ModelVersion compare (A/B 对比) ===
    def compare_model_versions(
        self, *, model_a_id: str, model_b_id: str, benchmark: str
    ) -> dict[str, Any]:
        """B04-R13: A/B 对比 — 同 benchmark 下两个 ModelVersion 的中位数差."""
        a_jobs = (
            self.session.query(EvalJob)
            .filter(
                EvalJob.model_version_id == model_a_id,
                EvalJob.status == EvalJobStatus.SUCCESS,
            )
            .order_by(EvalJob.completed_at.desc())
            .limit(10)
            .all()
        )
        b_jobs = (
            self.session.query(EvalJob)
            .filter(
                EvalJob.model_version_id == model_b_id,
                EvalJob.status == EvalJobStatus.SUCCESS,
            )
            .order_by(EvalJob.completed_at.desc())
            .limit(10)
            .all()
        )
        a_rates = [j.median_success_rate for j in a_jobs if j.median_success_rate]
        b_rates = [j.median_success_rate for j in b_jobs if j.median_success_rate]
        return {
            "model_a_id": model_a_id,
            "model_b_id": model_b_id,
            "benchmark": benchmark,
            "model_a_runs": len(a_rates),
            "model_b_runs": len(b_rates),
            "model_a_median": statistics.median(a_rates) if a_rates else None,
            "model_b_median": statistics.median(b_rates) if b_rates else None,
            "delta": (
                statistics.median(b_rates) - statistics.median(a_rates)
                if a_rates and b_rates
                else None
            ),
        }

    # === 内部 ===
    def _get_job(self, eval_job_id: str) -> EvalJob:
        job = self.session.get(EvalJob, eval_job_id)
        if not job:
            raise VLAError(
                ErrorCode.X_RESOURCE_NOT_FOUND,
                f"VLA-B04-0040 EvalJob {eval_job_id} not found",
                status_code=404,
            )
        return job

    def _publish_event_safe(self, event_type: str, payload: dict[str, Any]) -> None:
        import asyncio

        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        if loop.is_running():
            logger.info("EventBus publish skipped (loop running), type=%s", event_type)
            return
        try:
            loop.run_until_complete(
                get_event_bus().publish(EventEnvelope(event_type=event_type, payload=payload))
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("Event publish failed: %s", e)
