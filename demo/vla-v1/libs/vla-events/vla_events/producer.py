"""VLA Kafka 事件总线 (X-R07).

事件契约 18 个 (见 .xdd/arch/event-contract.md §2):
  B01 (4): SimJobCreated/Started/EpisodeGenerated/Completed/Failed
  B02 (4): CollectionSessionStarted/EpisodeRecorded/Annotated/DatasetVersionPublished
  B03 (6): TrainingJobSubmitted/Started/MetricReported/CheckpointSaved/Completed/Failed/ModelVersionPublished
  B04 (1): EvalJobCompleted
  X (4):   PipelineRunStarted/StageCompleted/RunCompleted/RunFailed

Phase 5 实现:
  - In-process EventBus (immediate dispatch, 1 writer + N subscribers in dict)
  - Kafka 适配器 (aiokafka producer) 包装同接口
  - 至少一次投递 + 业务唯一 key 幂等
  - DLQ: 失败 3 次后入 vla.dlq.{event_type} (L3 Task 84)

事务边界 (per .xdd/arch/event-contract.md §5):
  写业务表 + 写 outbox 同一事务
  单独 worker 读 outbox → 投递到 Kafka → 标记 published
  Phase 5 简化为: 业务表 commit 后, EventBus 同步 publish (失败 retry 3 次)
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)


# === 18 事件 schema (dict, 不用 protobuf 节省依赖) ===

EVENT_SCHEMAS: dict[str, dict[str, Any]] = {
    # === B01 仿真 (5) ===
    "vla.sim.job_created": {
        "biz_line": "B01",
        "fields": ["sim_job_id", "project_id", "engine", "num_episodes", "task_name"],
    },
    "vla.sim.job_started": {
        "biz_line": "B01",
        "fields": ["sim_job_id", "project_id", "worker_id", "engine"],
    },
    "vla.sim.episode_generated": {
        "biz_line": "B01",
        "fields": ["sim_job_id", "project_id", "episode_id", "episode_index", "duration_s", "data_uri"],
    },
    "vla.sim.job_completed": {
        "biz_line": "B01",
        "fields": ["sim_job_id", "project_id", "total_episodes", "successful_episodes", "data_uri", "duration_s"],
    },
    "vla.sim.job_failed": {
        "biz_line": "B01",
        "fields": ["sim_job_id", "project_id", "error_code", "error_message", "attempt_id"],
    },
    # === B02 采集 (4) ===
    "vla.coll.session_started": {
        "biz_line": "B02",
        "fields": ["session_id", "project_id", "operator_id", "device_id"],
    },
    "vla.coll.episode_recorded": {
        "biz_line": "B02",
        "fields": ["session_id", "project_id", "episode_id", "episode_index", "frame_count"],
    },
    "vla.coll.annotated": {
        "biz_line": "B02",
        "fields": ["episode_id", "project_id", "annotator_id", "schema_version"],
    },
    "vla.coll.dataset_version_published": {
        "biz_line": "B02",
        "fields": ["dataset_version_id", "project_id", "version_tag", "episode_count"],
    },
    # === B03 训练 (7) ===
    "vla.train.job_submitted": {
        "biz_line": "B03",
        "fields": ["training_job_id", "project_id", "base_model", "dataset_version_id"],
    },
    "vla.train.job_started": {
        "biz_line": "B03",
        "fields": ["training_job_id", "project_id", "worker_id", "world_size"],
    },
    "vla.train.metric_reported": {
        "biz_line": "B03",
        "fields": ["training_job_id", "project_id", "step", "loss", "lr", "metric_name"],
    },
    "vla.train.checkpoint_saved": {
        "biz_line": "B03",
        "fields": ["training_job_id", "project_id", "checkpoint_id", "step", "metric", "uri"],
    },
    "vla.train.job_completed": {
        "biz_line": "B03",
        "fields": ["training_job_id", "project_id", "model_version_id", "final_metric", "duration_s"],
    },
    "vla.train.job_failed": {
        "biz_line": "B03",
        "fields": ["training_job_id", "project_id", "error_code", "error_message"],
    },
    "vla.train.model_version_published": {
        "biz_line": "B03",
        "fields": ["model_version_id", "project_id", "training_job_id", "version_tag"],
    },
    # === B04 评测 (1) ===
    "vla.eval.job_completed": {
        "biz_line": "B04",
        "fields": [
            "eval_job_id",
            "project_id",
            "model_version_id",
            "benchmark",
            "success_rate",
            "std_dev",
            "trial_count",
            "report_uri",
        ],
    },
    # === X 跨业务 (4) ===
    "vla.pipeline.run_started": {
        "biz_line": "X",
        "fields": ["pipeline_run_id", "project_id", "stages"],
    },
    "vla.pipeline.stage_completed": {
        "biz_line": "X",
        "fields": ["pipeline_run_id", "stage", "status", "result_ref"],
    },
    "vla.pipeline.run_completed": {
        "biz_line": "X",
        "fields": ["pipeline_run_id", "project_id", "duration_s"],
    },
    "vla.pipeline.run_failed": {
        "biz_line": "X",
        "fields": ["pipeline_run_id", "project_id", "failed_stage", "error_code"],
    },
}


class EventEnvelope:
    """事件包装: 业务字段 + 元数据 (id/ts/source/trace_id)."""

    def __init__(
        self,
        event_type: str,
        payload: dict[str, Any],
        *,
        event_id: str | None = None,
        source: str = "vla-svc",
        trace_id: str | None = None,
    ) -> None:
        if event_type not in EVENT_SCHEMAS:
            raise ValueError(f"未知事件类型: {event_type}")
        self.event_type = event_type
        self.event_id = event_id or str(uuid.uuid4())
        self.source = source
        self.payload = payload
        self.trace_id = trace_id
        self.published_at = datetime.utcnow().isoformat() + "Z"

    def to_dict(self) -> dict[str, Any]:
        return {
            "event_id": self.event_id,
            "event_type": self.event_type,
            "source": self.source,
            "published_at": self.published_at,
            "trace_id": self.trace_id,
            "payload": self.payload,
        }


class EventBus(ABC):
    """事件总线抽象接口."""

    @abstractmethod
    async def publish(self, event: EventEnvelope) -> None: ...

    @abstractmethod
    async def subscribe(
        self, event_type: str, handler: Callable[[EventEnvelope], Awaitable[None]]
    ) -> None: ...

    @abstractmethod
    async def start(self) -> None: ...

    @abstractmethod
    async def stop(self) -> None: ...


class InProcessEventBus(EventBus):
    """In-process 事件总线 — 测试/单进程部署用.

    同步发布 → 同步触发所有 subscriber. 失败重试 3 次后入 DLQ (in-memory list).
    """

    def __init__(self) -> None:
        self._subscribers: dict[str, list[Callable[[EventEnvelope], Awaitable[None]]]] = {}
        self._dlq: list[EventEnvelope] = []
        self._started = False

    async def start(self) -> None:
        self._started = True
        logger.info("InProcessEventBus started")

    async def stop(self) -> None:
        self._started = False
        logger.info("InProcessEventBus stopped, DLQ size: %d", len(self._dlq))

    async def publish(self, event: EventEnvelope) -> None:
        if not self._started:
            await self.start()
        handlers = self._subscribers.get(event.event_type, []) + self._subscribers.get("*", [])
        for handler in handlers:
            attempt = 0
            while attempt < 3:
                try:
                    await handler(event)
                    break
                except Exception as e:  # noqa: BLE001
                    attempt += 1
                    logger.warning(
                        "Handler %s failed (attempt %d/3): %s",
                        getattr(handler, "__name__", handler),
                        attempt,
                        e,
                    )
            else:
                # 3 次都失败 → DLQ
                logger.error("Handler %s 给事件 %s 3 次失败, 入 DLQ", handler, event.event_id)
                self._dlq.append(event)

    async def subscribe(
        self, event_type: str, handler: Callable[[EventEnvelope], Awaitable[None]]
    ) -> None:
        self._subscribers.setdefault(event_type, []).append(handler)
        logger.info("Handler %s subscribed to %s", getattr(handler, "__name__", handler), event_type)

    @property
    def dlq(self) -> list[EventEnvelope]:
        return list(self._dlq)


# === 全局单例 (FastAPI lifespan 管理) ===
_global_bus: EventBus | None = None


def get_event_bus() -> EventBus:
    """获取全局事件总线 (默认 InProcess)."""
    global _global_bus
    if _global_bus is None:
        _global_bus = InProcessEventBus()
    return _global_bus


def set_event_bus(bus: EventBus) -> None:
    """测试/启动时替换事件总线."""
    global _global_bus
    _global_bus = bus


def reset_event_bus() -> None:
    """测试用: 重置为 None."""
    global _global_bus
    _global_bus = None


# === 测试/本地模式开关 ===
def is_kafka_enabled() -> bool:
    """是否启用 Kafka producer (默认 False, Phase 5 用 in-process)."""
    return os.getenv("VLA_KAFKA_ENABLED", "0") == "1"
