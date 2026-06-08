"""B03 Train service — Saga 状态机 + 业务逻辑 (R01~R17, 核心 8)."""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from vla_common.errors import ErrorCode, VLAError
from vla_events.producer import EventEnvelope, get_event_bus

from vla.train.domain import (
    VALID_BASE_MODELS,
    Checkpoint,
    ModelVersion,
    TrainingJob,
    TrainingJobStatus,
    TrainWorker,
)

logger = logging.getLogger(__name__)

# NaN 滑动窗口 (R06) 默认 10 步
NAN_WINDOW_SIZE = 10


def _config_hash(
    base_model: str, dataset_version_id: str, hyperparams: dict[str, Any]
) -> str:
    """B03-R15: (base + dataset + hp) 重复识别."""
    canonical = json.dumps(
        {"base": base_model, "ds": dataset_version_id, "hp": hyperparams},
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:32]


class TrainService:
    """B03 业务逻辑层."""

    def __init__(self, session: Session) -> None:
        self.session = session

    # === B03-R01: 提交 TrainingJob ===
    def submit_training_job(
        self,
        *,
        project_id: str,
        job_name: str,
        base_model: str,
        dataset_version_id: str,
        hyperparams: dict[str, Any],
        num_gpus: int = 8,
        batch_size: int = 32,
        learning_rate: float = 2e-5,
        num_epochs: int = 7,
        mode: str = "full",
        checkpoint_freq: int = 500,
        requested_by: str,
    ) -> TrainingJob:
        """R01 / R07 / R11 / R13 / R15."""
        # R07/R11: 校验基线模型
        if base_model not in VALID_BASE_MODELS:
            raise VLAError(
                ErrorCode.B03_TRAIN_DATASET_MISSING,
                f"VLA-B03-0021 基线模型 '{base_model}' 不支持, 5 预置: {sorted(VALID_BASE_MODELS)}",
                status_code=422,
                details={"valid_models": sorted(VALID_BASE_MODELS)},
            )

        # R07: dataset_version_id 必填 (存在性校验留给 B02 API 调用, 此处非空校验)
        if not dataset_version_id or not dataset_version_id.strip():
            raise VLAError(
                ErrorCode.B03_TRAIN_DATASET_MISSING,
                "VLA-B03-0021 dataset_version_id 必填",
                status_code=422,
            )

        # R11: LoRA / QLoRA 模式校验
        if mode not in {"full", "lora", "qlora"}:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"mode 必须是 full / lora / qlora, 当前 '{mode}'",
                status_code=422,
            )
        # R11: QLoRA 1 卡
        if mode in ("lora", "qlora") and num_gpus != 1:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"{mode} 模式必须 num_gpus=1 (当前 {num_gpus})",
                status_code=422,
            )

        # R15: 重复识别
        cfg_hash = _config_hash(base_model, dataset_version_id, hyperparams)
        existing = (
            self.session.query(TrainingJob)
            .filter(
                TrainingJob.project_id == project_id,
                TrainingJob.config_hash == cfg_hash,
                TrainingJob.status.notin_(
                    [TrainingJobStatus.FAILED, TrainingJobStatus.CANCELLED, TrainingJobStatus.SUCCESS]
                ),
            )
            .first()
        )
        if existing:
            raise VLAError(
                ErrorCode.X_IDEMPOTENCY_CONFLICT,
                f"VLA-B03-0015 同 (base+dataset+hp) 已有活跃 TrainingJob ({existing.id})",
                status_code=409,
            )

        job = TrainingJob(
            project_id=project_id,
            job_name=job_name,
            base_model=base_model,
            dataset_version_id=dataset_version_id,
            hyperparams=hyperparams,
            num_gpus=num_gpus,
            batch_size=batch_size,
            learning_rate=learning_rate,
            num_epochs=num_epochs,
            mode=mode,
            checkpoint_freq=checkpoint_freq,
            config_hash=cfg_hash,
            requested_by=requested_by,
            status=TrainingJobStatus.PENDING,
        )
        self.session.add(job)
        self.session.flush()
        return job

    # === B03-R02: 启动 + 上报 metric ===
    def start_training_job(
        self, *, training_job_id: str, k8s_pod_id: str | None = None, k8s_node_id: str | None = None
    ) -> TrainingJob:
        """PENDING → RUNNING."""
        job = self._get_job(training_job_id)
        if job.status != TrainingJobStatus.PENDING:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"TrainingJob 状态 {job.status} 不允许 start (需要 PENDING)",
                status_code=409,
            )
        job.status = TrainingJobStatus.RUNNING
        job.started_at = datetime.utcnow()
        job.attempt_id += 1
        job.k8s_pod_id = k8s_pod_id
        job.k8s_node_id = k8s_node_id
        self.session.flush()
        return job

    def report_metric(
        self, *, training_job_id: str, step: int, loss: float, lr: float | None = None
    ) -> TrainingJob:
        """R02: 上报 1 个 step 的 metric. R06: NaN 滑动窗口 10 步检测."""
        import math

        job = self._get_job(training_job_id)
        if job.status != TrainingJobStatus.RUNNING:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"TrainingJob 状态 {job.status} 不允许 report_metric",
                status_code=409,
            )
        job.current_step = step
        job.current_loss = loss
        # NaN 滑动窗口 (R06)
        is_nan = math.isnan(loss) if isinstance(loss, float) else False
        window = list(job.nan_window or [])
        window.append(is_nan)
        if len(window) > NAN_WINDOW_SIZE:
            window = window[-NAN_WINDOW_SIZE:]
        job.nan_window = window

        # R06: 10 步全 NaN → 自动停止
        if len(window) == NAN_WINDOW_SIZE and all(window):
            self._publish_event_safe(
                "vla.train.job_failed",
                {
                    "training_job_id": job.id,
                    "project_id": job.project_id,
                    "error_code": "VLA-B03-0011",
                    "error_message": "NaN 滑动窗口 10 步全 NaN, 自动停止",
                },
            )
            job.status = TrainingJobStatus.FAILED
            job.error_code = "VLA-B03-0011"
            job.error_message = "NaN sliding window detected"
        self.session.flush()
        return job

    # === B03-R03: Checkpoint 自动保存 ===
    def save_checkpoint(
        self,
        *,
        training_job_id: str,
        step: int,
        val_loss: float | None,
        file_uri: str,
        file_size_bytes: int | None = None,
        is_best: bool = False,
    ) -> Checkpoint:
        """R03: checkpoint 自动保存. R04: 滚动保留 best 1 + 最近 5."""
        job = self._get_job(training_job_id)
        if job.status != TrainingJobStatus.RUNNING:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"TrainingJob 状态 {job.status} 不允许 save_checkpoint",
                status_code=409,
            )
        ckpt = Checkpoint(
            training_job_id=job.id,
            project_id=job.project_id,
            step=step,
            metric_val_loss=val_loss,
            is_best=is_best,
            file_uri=file_uri,
            file_size_bytes=file_size_bytes,
        )
        self.session.add(ckpt)
        self.session.flush()  # 触发 ckpt.id 赋值
        job.last_checkpoint_id = ckpt.id
        if is_best:
            job.best_checkpoint_id = ckpt.id

        # R04: 滚动保留 (best 1 + 最近 5 = 总 6)
        self._apply_checkpoint_retention(training_job_id=job.id)
        self.session.flush()
        return ckpt

    def _apply_checkpoint_retention(self, *, training_job_id: str) -> None:
        """R04: best 1 + 最近 5. 其余 is_retained=False."""
        all_ckpts = (
            self.session.query(Checkpoint)
            .filter(Checkpoint.training_job_id == training_job_id)
            .order_by(Checkpoint.step.desc())
            .all()
        )
        if not all_ckpts:
            return
        # best 1: val_loss 最低
        with_loss = [c for c in all_ckpts if c.metric_val_loss is not None]
        if with_loss:
            best = min(with_loss, key=lambda c: c.metric_val_loss)
            best.is_best = True
        # 最近 5 (按 step DESC)
        recent_5 = all_ckpts[:5]
        # 保留: best + recent 5
        retain_ids = {c.id for c in recent_5}
        if with_loss:
            retain_ids.add(best.id)
        for c in all_ckpts:
            c.is_retained = c.id in retain_ids

    # === B03-R05: 发布 ModelVersion ===
    def publish_model_version(
        self, *, training_job_id: str, version_tag: str, published_by: str
    ) -> ModelVersion:
        """R05: 训练完成 (SUCCESS) 后发布 ModelVersion."""
        job = self._get_job(training_job_id)
        if job.status != TrainingJobStatus.SUCCESS:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"VLA-B03-0005 TrainingJob 状态 {job.status} 不允许发布 (需要 SUCCESS)",
                status_code=409,
            )
        if not job.best_checkpoint_id:
            raise VLAError(
                ErrorCode.B03_TRAIN_CHECKPOINT_CORRUPT,
                "VLA-B03-0005 必须先有 best_checkpoint 才能发布 ModelVersion",
                status_code=400,
            )

        mv = ModelVersion(
            project_id=job.project_id,
            training_job_id=job.id,
            version_tag=version_tag,
            base_model=job.base_model,
            dataset_version_id=job.dataset_version_id,
            checkpoint_id=job.best_checkpoint_id,
            final_metric=job.current_loss,
            published_by=published_by,
            published_at=datetime.utcnow(),
        )
        self.session.add(mv)
        job.published_model_version_id = mv.id
        self.session.flush()
        self._publish_event_safe(
            "vla.train.model_version_published",
            {
                "model_version_id": mv.id,
                "project_id": mv.project_id,
                "training_job_id": job.id,
                "version_tag": version_tag,
            },
        )
        return mv

    # === B03-R08: OOM 自动降 batch 50% ===
    def oom_retry(self, *, training_job_id: str) -> TrainingJob:
        """R08: OOM 触发, 降 batch 50% + grad_accum=2, 重试 1 次."""
        job = self._get_job(training_job_id)
        if job.status != TrainingJobStatus.FAILED:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"TrainingJob 状态 {job.status} 不允许 oom_retry (需要 FAILED)",
                status_code=409,
            )
        if job.error_code != "VLA-B03-0031":
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"只有 OOM 错误 (VLA-B03-0031) 才能 oom_retry, 当前 {job.error_code}",
                status_code=409,
            )
        # batch 降 50%
        new_batch = max(1, job.batch_size // 2)
        old_batch = job.batch_size
        job.batch_size = new_batch
        # hyperparams 记录
        hp = dict(job.hyperparams or {})
        hp["oom_retry_count"] = hp.get("oom_retry_count", 0) + 1
        hp["original_batch_size"] = old_batch
        job.hyperparams = hp
        job.status = TrainingJobStatus.PENDING
        job.error_code = None
        job.error_message = None
        self.session.flush()
        return job

    # === B03-R09: 节点 down → PAUSED ===
    def node_down_pause(self, *, training_job_id: str) -> TrainingJob:
        """R09: K8s 节点 down → PAUSED (待 resume from last ckpt)."""
        job = self._get_job(training_job_id)
        if job.status != TrainingJobStatus.RUNNING:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"TrainingJob 状态 {job.status} 不允许 node_down_pause",
                status_code=409,
            )
        job.status = TrainingJobStatus.PAUSED
        job.error_code = "VLA-B03-0009"
        job.error_message = "K8s node down, paused for resume"
        self.session.flush()
        return job

    # === B03-R10: resume from last checkpoint ===
    def resume_training_job(self, *, training_job_id: str) -> TrainingJob:
        """R10: 从 last_checkpoint 恢复."""
        job = self._get_job(training_job_id)
        if job.status not in (TrainingJobStatus.PAUSED, TrainingJobStatus.FAILED):
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"TrainingJob 状态 {job.status} 不允许 resume (需要 PAUSED/FAILED)",
                status_code=409,
            )
        job.status = TrainingJobStatus.RUNNING
        job.error_code = None
        job.error_message = None
        job.started_at = datetime.utcnow()
        self.session.flush()
        return job

    # === B03-R11: 手动 stop ===
    def stop_training_job(self, *, training_job_id: str) -> TrainingJob:
        """R11: 用户手动 stop. 终态 CANCELLED."""
        job = self._get_job(training_job_id)
        if job.status in TrainingJobStatus.TERMINAL:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"TrainingJob 已 {job.status}, 不可 stop",
                status_code=409,
            )
        job.status = TrainingJobStatus.CANCELLED
        job.completed_at = datetime.utcnow()
        self.session.flush()
        return job

    # === B03-R12: running 不可 resume ===
    def cannot_resume_running(self, *, training_job_id: str) -> None:
        """R12: 状态机 lock — RUNNING 状态不可 resume."""
        job = self._get_job(training_job_id)
        if job.status == TrainingJobStatus.RUNNING:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"VLA-B03-0012 TrainingJob 已 RUNNING, 不可 resume",
                status_code=409,
            )

    # === B03-R12: finalize (success) ===
    def finalize_training_job(
        self, *, training_job_id: str, status: str = TrainingJobStatus.SUCCESS
    ) -> TrainingJob:
        """结束 TrainingJob (success / failed)."""
        job = self._get_job(training_job_id)
        if job.status in TrainingJobStatus.TERMINAL:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"TrainingJob 已 {job.status}, 不可 finalize",
                status_code=409,
            )
        job.status = status
        job.completed_at = datetime.utcnow()
        self.session.flush()
        if status == TrainingJobStatus.SUCCESS:
            self._publish_event_safe(
                "vla.train.job_completed",
                {
                    "training_job_id": job.id,
                    "project_id": job.project_id,
                    "model_version_id": job.published_model_version_id or "",
                    "final_metric": job.current_loss or 0.0,
                    "duration_s": (
                        (job.completed_at - job.started_at).total_seconds()
                        if job.started_at
                        else 0.0
                    ),
                },
            )
        return job

    # === 内部 ===
    def _get_job(self, training_job_id: str) -> TrainingJob:
        job = self.session.get(TrainingJob, training_job_id)
        if not job:
            raise VLAError(
                ErrorCode.X_RESOURCE_NOT_FOUND,
                f"VLA-B03-0040 TrainingJob {training_job_id} not found",
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
