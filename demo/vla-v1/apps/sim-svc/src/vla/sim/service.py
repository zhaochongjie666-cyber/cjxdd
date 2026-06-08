"""B01 Sim service — Saga 状态机 + 业务逻辑 (R01 ~ R17).

实操:
  - create_sim_job: B01-R01/R02/R06/R07/R12/R13 入口
  - start_sim_job: B01-R04/R08 启动 + episode 生成
  - record_episode: B01-R04/R05/R09 每个 episode 完成
  - finalize_sim_job: B01-R05/R10 完成
  - cancel_sim_job: B01-R14 取消
  - upload_scene_asset: B01-R03
  - resume_from_last: B01-R10 重试
  - 幂等: scene_hash (B01-R13)
"""
from __future__ import annotations

import hashlib
import json
import logging
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from vla_common.errors import ErrorCode, VLAError
from vla_common.idempotency import check_or_store
from vla_events.producer import EventEnvelope, get_event_bus

from vla.sim.domain import (
    PHYSICS_PARAM_BOUNDS,
    SceneAsset,
    SimEpisode,
    SimJob,
    SimJobStatus,
    SimWorker,
    VALID_SCENE_TEMPLATES,
    validate_physics_config,
)

logger = logging.getLogger(__name__)


def _scene_hash(task_spec: dict[str, Any], physics_config: dict[str, Any] | None) -> str:
    """B01-R13: scene_hash 用于重复提交识别."""
    canonical = json.dumps(
        {"task_spec": task_spec, "physics_config": physics_config or {}}, sort_keys=True, default=str
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:32]


class SimService:
    """B01 Sim 业务逻辑层 (Saga 状态机 + 域校验)."""

    def __init__(self, session: Session) -> None:
        self.session = session

    # === B01-R01/R02/R06/R07/R12/R13: 创建 SimJob ===
    def create_sim_job(
        self,
        *,
        project_id: str,
        task_name: str,
        engine: str,
        num_episodes: int,
        task_spec: dict[str, Any],
        physics_config: dict[str, Any] | None,
        scene_template_id: str | None = None,
        scene_asset_id: str | None = None,
        randomization_applied: bool = False,
        copyright_owner: str | None = None,
        requested_by: str,
        idempotency_key: str | None = None,
        max_attempts: int = 3,
    ) -> SimJob:
        """B01-R01 创建 SimJob. 多重校验:
          - 物理参数域合法性 (B01-R06)
          - 场景模板存在性 (B01-R07)
          - 版权声明必填 (B01-R12)
          - 重复提交识别 (B01-R13)
          - num_episodes >= 1 (B01-R15)
        """
        # B01-R15: num_episodes ≥ 1
        if num_episodes < 1:
            raise VLAError(
                ErrorCode.B01_SIM_INVALID_TASK_SPEC,
                f"num_episodes 必须 ≥ 1 (当前 {num_episodes})",
                status_code=422,
            )
        # B01-R12: 版权声明必填
        if not copyright_owner or not copyright_owner.strip():
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                "B01-R12 版权声明必填 (copyright_owner)",
                status_code=422,
                details={"field": "copyright_owner"},
            )

        # B01-R06: 物理参数校验
        errors = validate_physics_config(physics_config)
        if errors:
            raise VLAError(
                ErrorCode.B01_SIM_INVALID_TASK_SPEC,
                f"VLA-B01-0011 物理参数越界: {'; '.join(errors)}",
                status_code=422,
                details={"errors": errors, "bounds": {k: v for k, v in PHYSICS_PARAM_BOUNDS.items()}},
            )

        # B01-R07: scene_template 存在性
        if scene_template_id and scene_template_id not in VALID_SCENE_TEMPLATES:
            raise VLAError(
                ErrorCode.B01_SIM_INVALID_SCENE,
                f"VLA-B01-0012 场景模板不存在: '{scene_template_id}'",
                status_code=422,
                details={"valid_templates": sorted(VALID_SCENE_TEMPLATES)},
            )

        # B01-R13: scene_hash 重复提交识别
        scene_hash = _scene_hash(task_spec, physics_config)
        existing = (
            self.session.query(SimJob)
            .filter(
                SimJob.project_id == project_id,
                SimJob.scene_hash == scene_hash,
                SimJob.status.notin_(
                    [SimJobStatus.FAILED, SimJobStatus.CANCELLED, SimJobStatus.SUCCESS]
                ),
            )
            .first()
        )
        if existing:
            raise VLAError(
                ErrorCode.X_IDEMPOTENCY_CONFLICT,
                f"VLA-B01-0013 同 scene_hash 已有活跃 SimJob ({existing.id})",
                status_code=409,
                details={"existing_sim_job_id": existing.id, "scene_hash": scene_hash},
            )

        sim_job = SimJob(
            project_id=project_id,
            task_name=task_name,
            engine=engine,
            num_episodes=num_episodes,
            task_spec=task_spec,
            physics_config=physics_config,
            scene_template_id=scene_template_id,
            scene_asset_id=scene_asset_id,
            randomization_applied=randomization_applied,
            scene_hash=scene_hash,
            copyright_owner=copyright_owner,
            requested_by=requested_by,
            max_attempts=max_attempts,
            status=SimJobStatus.PENDING,
        )
        self.session.add(sim_job)
        self.session.flush()

        # 发 SimJobCreated 事件
        self._publish_event_safe(
            "vla.sim.job_created",
            {
                "sim_job_id": sim_job.id,
                "project_id": project_id,
                "engine": engine,
                "num_episodes": num_episodes,
                "task_name": task_name,
            },
        )
        return sim_job

    # === B01-R04: 启动 SimJob + 触发 episode 生成 ===
    def start_sim_job(
        self,
        *,
        sim_job_id: str,
        worker_id: str | None = None,
    ) -> SimJob:
        """B01-R04 启动 SimJob (从 PENDING → RUNNING). 触发 SimJobStarted 事件."""
        sim_job = self._get_job(sim_job_id)
        if sim_job.status != SimJobStatus.PENDING:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"SimJob 状态 {sim_job.status} 不允许 start (需要 PENDING)",
                status_code=409,
            )
        sim_job.status = SimJobStatus.RUNNING
        sim_job.started_at = datetime.utcnow()
        sim_job.attempt_id += 1
        self.session.flush()
        self._publish_event_safe(
            "vla.sim.job_started",
            {
                "sim_job_id": sim_job.id,
                "project_id": sim_job.project_id,
                "worker_id": worker_id or "mock-worker",
                "engine": sim_job.engine,
            },
        )
        return sim_job

    # === B01-R04/R05/R09: 记录 episode 完成 ===
    def record_episode(
        self,
        *,
        sim_job_id: str,
        episode_index: int,
        success: bool,
        actual_physics: dict[str, Any] | None = None,
        video_uri: str | None = None,
        observation_uri: str | None = None,
        action_uri: str | None = None,
        duration_s: float | None = None,
        error_message: str | None = None,
    ) -> SimEpisode:
        """B01-R04: 记录 1 个 episode. B01-R05: 累计计数."""
        sim_job = self._get_job(sim_job_id)
        if sim_job.status != SimJobStatus.RUNNING:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"SimJob 状态 {sim_job.status} 不允许 record_episode (需要 RUNNING)",
                status_code=409,
            )
        episode = SimEpisode(
            sim_job_id=sim_job.id,
            project_id=sim_job.project_id,
            episode_index=episode_index,
            status="success" if success else "failed",
            actual_physics=actual_physics,
            video_uri=video_uri,
            observation_uri=observation_uri,
            action_uri=action_uri,
            duration_s=duration_s,
            error_message=error_message,
            finalized_at=datetime.utcnow() if success else None,
        )
        self.session.add(episode)
        if success:
            sim_job.successful_episodes += 1
        else:
            sim_job.failed_episodes += 1
        self.session.flush()
        if success:
            self._publish_event_safe(
                "vla.sim.episode_generated",
                {
                    "sim_job_id": sim_job.id,
                    "project_id": sim_job.project_id,
                    "episode_id": episode.id,
                    "episode_index": episode_index,
                    "duration_s": duration_s or 0.0,
                    "data_uri": video_uri or "",
                },
            )
        return episode

    # === B01-R05/R09/R10: 完成 SimJob ===
    def finalize_sim_job(
        self,
        *,
        sim_job_id: str,
        status: str = SimJobStatus.SUCCESS,
        error_code: str | None = None,
        error_message: str | None = None,
    ) -> SimJob:
        """B01-R05: 标 SimJob 完成. B01-R09: 部分 episode 失败不影响 success 状态.

        业务规则: successful >= 0 都允许标 SUCCESS, 失败 episode 已在 record_episode 计数.
        """
        sim_job = self._get_job(sim_job_id)
        if sim_job.status in SimJobStatus.TERMINAL:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"SimJob 已 {sim_job.status}, 不可 finalize",
                status_code=409,
            )
        sim_job.status = status
        sim_job.completed_at = datetime.utcnow()
        if error_code:
            sim_job.error_code = error_code
        if error_message:
            sim_job.error_message = error_message
        self.session.flush()
        if status == SimJobStatus.SUCCESS:
            self._publish_event_safe(
                "vla.sim.job_completed",
                {
                    "sim_job_id": sim_job.id,
                    "project_id": sim_job.project_id,
                    "total_episodes": sim_job.successful_episodes + sim_job.failed_episodes,
                    "successful_episodes": sim_job.successful_episodes,
                    "data_uri": f"s3://datalake/sim/{sim_job.id}/",
                    "duration_s": (
                        (sim_job.completed_at - sim_job.started_at).total_seconds()
                        if sim_job.started_at
                        else 0.0
                    ),
                },
            )
        else:
            self._publish_event_safe(
                "vla.sim.job_failed",
                {
                    "sim_job_id": sim_job.id,
                    "project_id": sim_job.project_id,
                    "error_code": error_code or "VLA-B01-9999",
                    "error_message": error_message or "unknown",
                    "attempt_id": sim_job.attempt_id,
                },
            )
        return sim_job

    # === B01-R14: 取消 (不可撤销已完成的) ===
    def cancel_sim_job(self, *, sim_job_id: str) -> SimJob:
        """B01-R14: 取消 SimJob. TERMINAL 状态不可 cancel."""
        sim_job = self._get_job(sim_job_id)
        if sim_job.status in SimJobStatus.TERMINAL:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"VLA-B01-0014 SimJob 已 {sim_job.status}, 不可取消",
                status_code=409,
            )
        sim_job.status = SimJobStatus.CANCELLED
        sim_job.completed_at = datetime.utcnow()
        self.session.flush()
        return sim_job

    # === B01-R10: 重试 (从 FAILED → PENDING 重新激活) ===
    def retry_sim_job(self, *, sim_job_id: str) -> SimJob:
        """B01-R10: 重试 FAILED 状态的 SimJob."""
        sim_job = self._get_job(sim_job_id)
        if sim_job.status != SimJobStatus.FAILED:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"SimJob 状态 {sim_job.status} 不允许 retry (需要 FAILED)",
                status_code=409,
            )
        if sim_job.attempt_id >= sim_job.max_attempts:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"SimJob 已达最大重试次数 {sim_job.max_attempts}",
                status_code=409,
            )
        sim_job.status = SimJobStatus.PENDING
        sim_job.error_code = None
        sim_job.error_message = None
        sim_job.successful_episodes = 0
        sim_job.failed_episodes = 0
        self.session.flush()
        return sim_job

    # === B01-R03: 上传 SceneAsset ===
    def upload_scene_asset(
        self,
        *,
        project_id: str,
        name: str,
        format: str,
        file_uri: str,
        size_bytes: int | None,
        physics_config: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
        copyright_owner: str | None = None,
        uploaded_by: str,
    ) -> SceneAsset:
        """B01-R03: 上传 3D 资产 (USD / MJCF / glTF)."""
        valid_formats = frozenset({"usd", "mjcf", "obj", "gltf", "glb"})
        if format not in valid_formats:
            raise VLAError(
                ErrorCode.B01_SIM_INVALID_SCENE,
                f"资产 format 非法: '{format}', 必须是 {sorted(valid_formats)}",
                status_code=422,
            )
        asset = SceneAsset(
            project_id=project_id,
            name=name,
            format=format,
            file_uri=file_uri,
            size_bytes=size_bytes,
            physics_config=physics_config,
            metadata_=metadata,
            copyright_owner=copyright_owner,
            uploaded_by=uploaded_by,
            status="ready",  # 简化: 上传即 ready (生产应走 validating)
            validated_at=datetime.utcnow(),
        )
        self.session.add(asset)
        self.session.flush()
        return asset

    # === B01-R11: 单 worker 并发上限 100 ===
    def acquire_worker(
        self,
        *,
        engine: str,
        worker_id: str,
        max_concurrent: int = 100,
    ) -> SimWorker:
        """B01-R11: 注册 / 获取 worker. 校验 max_concurrent ≤ 100."""
        if max_concurrent > 100:
            raise VLAError(
                ErrorCode.B01_SIM_INVALID_TASK_SPEC,
                f"max_concurrent_episodes 不能超过 100 (当前 {max_concurrent})",
                status_code=422,
            )
        worker = (
            self.session.query(SimWorker).filter(SimWorker.worker_id == worker_id).first()
        )
        if worker is None:
            worker = SimWorker(
                engine=engine,
                worker_id=worker_id,
                max_concurrent_episodes=max_concurrent,
                status="idle",
            )
            self.session.add(worker)
            self.session.flush()
        return worker

    # === B01-R15: 大规模 (10K+ episodes) ===
    def validate_scale(self, *, num_episodes: int) -> None:
        """B01-R15: num_episodes 1 ~ 100K. >100K 警告但不拒绝 (走分批 worker)."""
        if num_episodes < 1:
            raise VLAError(
                ErrorCode.B01_SIM_INVALID_TASK_SPEC,
                f"num_episodes 必须 ≥ 1 (当前 {num_episodes})",
                status_code=422,
            )

    # === B01-R16: 任务模板 (5 预置) ===
    PRESET_TASK_TEMPLATES = frozenset(
        {"grasp_cup", "place_object", "push_box", "fold_cloth", "pour_water"}
    )

    def apply_task_template(
        self, *, template_id: str, overrides: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """B01-R16: 5 预置任务模板. overrides 覆盖 task_spec 字段."""
        if template_id not in self.PRESET_TASK_TEMPLATES:
            raise VLAError(
                ErrorCode.B01_SIM_INVALID_TASK_SPEC,
                f"VLA-B01-0016 未知任务模板: '{template_id}', 5 预置: {sorted(self.PRESET_TASK_TEMPLATES)}",
                status_code=422,
            )
        base = {
            "grasp_cup": {"task_type": "manipulation", "object": "cup", "action": "grasp"},
            "place_object": {"task_type": "manipulation", "action": "place", "target": "table"},
            "push_box": {"task_type": "manipulation", "object": "box", "action": "push"},
            "fold_cloth": {"task_type": "deformable", "object": "cloth", "action": "fold"},
            "pour_water": {"task_type": "liquid", "object": "cup", "action": "pour"},
        }[template_id]
        if overrides:
            base.update(overrides)
        return base

    # === 内部 ===
    def _get_job(self, sim_job_id: str) -> SimJob:
        sim_job = self.session.get(SimJob, sim_job_id)
        if not sim_job:
            raise VLAError(
                ErrorCode.X_RESOURCE_NOT_FOUND,
                f"VLA-B01-0040 SimJob {sim_job_id} not found",
                status_code=404,
            )
        return sim_job

    def _publish_event_safe(self, event_type: str, payload: dict[str, Any]) -> None:
        """发事件 (Phase 5 简化: 同步发, 测试 loop 不可用时跳过)."""
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
