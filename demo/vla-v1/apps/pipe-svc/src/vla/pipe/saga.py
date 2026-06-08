"""Pipe Saga 编排器 (X-R02 / X-R11).

4 阶段顺序执行, 失败可暂停 + 重试.
补偿 (compensation): 后续 stage 失败不影响前面 stage 已成功的成果.
  - B01 episode 已写入 MinIO → 不删
  - B02 已上传 dataset_version → 不删
  - B03 last_good_checkpoint 已存 → 保留, 重试时 resume
  - B04 partial eval_result → 保留, partial report

Saga 状态机:
  start(pipeline_run) → 激活 stage 0
  on_stage_completed(stage) → 激活下一 stage
  on_stage_failed(stage) → 标 stage=FAILED, pipeline_run=PAUSED (等用户决策)
  retry_stage(stage) → attempt_count+1, 重新激活
  skip_stage(stage) → 标 SKIPPED, 激活下一 stage
  cancel(pipeline_run) → 标 CANCELLED
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from vla_common.errors import ErrorCode, VLAError
from vla_events.producer import EventEnvelope, get_event_bus

from vla.pipe.models import (
    PipelineRun,
    PipelineRunStatus,
    PipelineStage,
    StageStatus,
    VALID_STAGES,
)

logger = logging.getLogger(__name__)


class PipeSaga:
    """Pipe 编排器 (saga 状态机)."""

    def __init__(self, session: Session) -> None:
        self.session = session

    # === 启动 pipeline ===
    def start(
        self,
        *,
        project_id: str,
        task_description: str,
        created_by: str,
        stages: list[str] | None = None,
    ) -> PipelineRun:
        """启动 1 个 pipeline_run (X-R01).

        默认 4 阶段: B01_sim → B02_coll → B03_train → B04_eval.
        """
        if stages is None:
            stages = list(VALID_STAGES)
        else:
            for s in stages:
                if s not in VALID_STAGES:
                    raise VLAError(
                        ErrorCode.PIPE_DAG_INVALID,
                        f"未知 stage '{s}', 必须是 {VALID_STAGES}",
                        status_code=400,
                        details={"valid_stages": list(VALID_STAGES)},
                    )

        run = PipelineRun(
            project_id=project_id,
            task_description=task_description,
            status=PipelineRunStatus.RUNNING,
            current_stage_index=0,
            started_at=datetime.utcnow(),
            created_by=created_by,
        )
        self.session.add(run)
        self.session.flush()

        # 创建 4 stage records
        for idx, stage in enumerate(stages):
            self.session.add(
                PipelineStage(
                    pipeline_run_id=run.id,
                    project_id=project_id,
                    stage=stage,
                    stage_index=idx,
                    status=StageStatus.PENDING,
                )
            )
        self.session.flush()

        # 激活 stage 0
        self._activate_stage(run, 0)

        # 发 PipelineRunStarted 事件
        # 同步 publish (Phase 5) — EventBus dispatch 同步执行
        import asyncio

        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        if loop.is_running():
            # 测试环境: 不真正 publish, 仅记录
            logger.info("EventBus publish skipped (loop running), stage=%s", stages[0])
        else:
            loop.run_until_complete(
                get_event_bus().publish(
                    EventEnvelope(
                        event_type="vla.pipeline.run_started",
                        payload={
                            "pipeline_run_id": run.id,
                            "project_id": project_id,
                            "stages": stages,
                        },
                    )
                )
            )

        return run

    # === 完成 stage (由业务服务回调) ===
    def complete_stage(
        self, *, pipeline_run_id: str, stage_index: int, resource_id: str | None
    ) -> PipelineRun:
        """标 stage 完成, 激活下一 stage 或完成整个 run."""
        run = self._get_run(pipeline_run_id)
        stage = self._get_stage(run, stage_index)

        if stage.status not in (StageStatus.PENDING, StageStatus.RUNNING):
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"stage {stage.stage} 状态 {stage.status} 不允许完成",
                status_code=409,
                details={"stage": stage.stage, "status": stage.status},
            )

        stage.status = StageStatus.COMPLETED
        stage.resource_id = resource_id
        stage.completed_at = datetime.utcnow()
        self.session.flush()

        # 发 StageCompleted 事件
        self._publish_event(
            "vla.pipeline.stage_completed",
            {
                "pipeline_run_id": run.id,
                "stage": stage.stage,
                "status": StageStatus.COMPLETED,
                "result_ref": resource_id,
            },
        )

        # 激活下一 stage
        next_idx = stage_index + 1
        if next_idx >= len(VALID_STAGES):
            # 全部完成
            run.status = PipelineRunStatus.COMPLETED
            run.completed_at = datetime.utcnow()
            self.session.flush()
            self._publish_event(
                "vla.pipeline.run_completed",
                {"pipeline_run_id": run.id, "project_id": run.project_id, "duration_s": self._duration(run)},
            )
        else:
            run.current_stage_index = next_idx
            self._activate_stage(run, next_idx)

        return run

    # === stage 失败 (X-R02) ===
    def fail_stage(
        self, *, pipeline_run_id: str, stage_index: int, error_code: str, error_message: str
    ) -> PipelineRun:
        """stage 失败 → pipeline_run 标 PAUSED (非 FAILED, 等用户决策)."""
        run = self._get_run(pipeline_run_id)
        stage = self._get_stage(run, stage_index)

        if run.status in PipelineRunStatus.TERMINAL:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"pipeline_run 已 {run.status}, 不可再 fail stage",
                status_code=409,
            )

        stage.status = StageStatus.FAILED
        stage.error_code = error_code
        stage.error_message = error_message
        self.session.flush()

        run.status = PipelineRunStatus.PAUSED
        run.failure_reason = f"{stage.stage}: {error_code} - {error_message}"
        self.session.flush()

        self._publish_event(
            "vla.pipeline.stage_completed",
            {
                "pipeline_run_id": run.id,
                "stage": stage.stage,
                "status": StageStatus.FAILED,
                "result_ref": None,
            },
        )
        self._publish_event(
            "vla.pipeline.run_failed",
            {
                "pipeline_run_id": run.id,
                "project_id": run.project_id,
                "failed_stage": stage.stage,
                "error_code": error_code,
            },
        )
        return run

    # === 重试 stage (X-R02) ===
    def retry_stage(self, *, pipeline_run_id: str, stage_index: int) -> PipelineRun:
        """重试失败的 stage (attempt_count+1, 重新激活)."""
        run = self._get_run(pipeline_run_id)
        if run.status != PipelineRunStatus.PAUSED:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"pipeline_run 状态 {run.status} 不允许重试 (需要 PAUSED)",
                status_code=409,
            )
        stage = self._get_stage(run, stage_index)
        if stage.status != StageStatus.FAILED:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"stage {stage.stage} 状态 {stage.status} 不允许重试 (需要 FAILED)",
                status_code=409,
            )

        stage.status = StageStatus.PENDING
        stage.error_code = None
        stage.error_message = None
        stage.attempt_count += 1
        self.session.flush()

        run.status = PipelineRunStatus.RUNNING
        run.last_retry_at = datetime.utcnow()
        self.session.flush()
        self._activate_stage(run, stage_index)
        return run

    # === 跳过 stage (X-R02) ===
    def skip_stage(self, *, pipeline_run_id: str, stage_index: int) -> PipelineRun:
        """跳过失败的 stage, 标 SKIPPED, 激活下一 stage."""
        run = self._get_run(pipeline_run_id)
        if run.status != PipelineRunStatus.PAUSED:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"pipeline_run 状态 {run.status} 不允许 skip (需要 PAUSED)",
                status_code=409,
            )
        stage = self._get_stage(run, stage_index)
        if stage.status != StageStatus.FAILED:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"stage {stage.stage} 状态 {stage.status} 不允许 skip (需要 FAILED)",
                status_code=409,
            )

        stage.status = StageStatus.SKIPPED
        stage.completed_at = datetime.utcnow()
        self.session.flush()

        # 激活下一 stage (跳过 complete_stage, 因为 skipped 状态不应再变 completed)
        next_idx = stage_index + 1
        if next_idx >= len(VALID_STAGES):
            # 全部 stage 都已结束
            run.status = PipelineRunStatus.COMPLETED
            run.completed_at = datetime.utcnow()
            self.session.flush()
            self._publish_event(
                "vla.pipeline.run_completed",
                {"pipeline_run_id": run.id, "project_id": run.project_id, "duration_s": self._duration(run)},
            )
        else:
            run.current_stage_index = next_idx
            run.status = PipelineRunStatus.RUNNING
            self.session.flush()
            self._activate_stage(run, next_idx)
        return run

    # === 取消 (X-R10) ===
    def cancel(self, *, pipeline_run_id: str) -> PipelineRun:
        """取消 pipeline_run. 已终止 (>7 天) 不可重启 — 在 API 层校验."""
        run = self._get_run(pipeline_run_id)
        if run.status in PipelineRunStatus.TERMINAL:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"pipeline_run 状态 {run.status} 不允许 cancel",
                status_code=409,
            )
        run.status = PipelineRunStatus.CANCELLED
        run.completed_at = datetime.utcnow()
        self.session.flush()
        return run

    # === 内部 ===
    def _get_run(self, pipeline_run_id: str) -> PipelineRun:
        run = self.session.get(PipelineRun, pipeline_run_id)
        if not run:
            raise VLAError(
                ErrorCode.X_RESOURCE_NOT_FOUND,
                f"pipeline_run {pipeline_run_id} not found",
                status_code=404,
            )
        return run

    def _get_stage(self, run: PipelineRun, stage_index: int) -> PipelineStage:
        stages = (
            self.session.query(PipelineStage)
            .filter(
                PipelineStage.pipeline_run_id == run.id,
                PipelineStage.stage_index == stage_index,
            )
            .all()
        )
        if not stages:
            raise VLAError(
                ErrorCode.X_RESOURCE_NOT_FOUND,
                f"stage {stage_index} not found in run {run.id}",
                status_code=404,
            )
        return stages[0]

    def _activate_stage(self, run: PipelineRun, stage_index: int) -> None:
        """激活 stage (status=PENDING → RUNNING, 准备业务调用).

        Phase 5 简化: 仅标 RUNNING, 不实际调用业务服务 (pipe-svc 跟 B01-B04 走同一进程演示).
        真实环境: 走 Kafka 事件 (StageActivated) 触发业务服务启动.
        """
        stage = self._get_stage(run, stage_index)
        stage.status = StageStatus.RUNNING
        stage.started_at = datetime.utcnow()
        stage.attempt_count += 1
        self.session.flush()

    def _publish_event(self, event_type: str, payload: dict[str, Any]) -> None:
        """同步发事件 (Phase 5 简化)."""
        import asyncio

        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        if loop.is_running():
            logger.info("EventBus publish skipped (loop running), type=%s", event_type)
        else:
            loop.run_until_complete(
                get_event_bus().publish(EventEnvelope(event_type=event_type, payload=payload))
            )

    def _duration(self, run: PipelineRun) -> float:
        if not run.started_at or not run.completed_at:
            return 0.0
        return (run.completed_at - run.started_at).total_seconds()
