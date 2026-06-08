"""VLA Platform 统一错误码体系.

格式: VLA-{BXX}-{NNNN}
  BXX: 业务线 (X0=跨业务线, B01-B04 业务, Pipe=PipeCtx, Audit=AuditCtx)
  NNNN: 4 位数字, 业务内单调递增

定义见 .xdd/arch/architecture.md §6 + .xdd/arch/event-contract.md.
"""
from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel


class ErrorCode(str, Enum):
    """统一错误码枚举. 字符串值就是 VLA-{BXX}-{NNNN}."""

    # === X 跨业务线 (X-R01 ~ X-R12) ===
    X_AUTH_MISSING_API_KEY = "VLA-X0-0001"
    X_AUTH_INVALID_API_KEY = "VLA-X0-0002"
    X_AUTH_EXPIRED = "VLA-X0-0003"
    X_RBAC_FORBIDDEN = "VLA-X0-0010"
    X_RLS_TENANT_MISMATCH = "VLA-X0-0020"
    X_VALIDATION_FAILED = "VLA-X0-0030"
    X_RESOURCE_NOT_FOUND = "VLA-X0-0040"
    X_IDEMPOTENCY_CONFLICT = "VLA-X0-0050"
    X_RATE_LIMITED = "VLA-X0-0060"
    X_INTERNAL_ERROR = "VLA-X0-0099"

    # === B01 仿真 ===
    B01_SIM_ENGINE_UNAVAILABLE = "VLA-B01-0001"
    B01_SIM_TIMEOUT = "VLA-B01-0002"
    B01_SIM_OOM = "VLA-B01-0003"
    B01_SIM_PHYSICS_DIVERGED = "VLA-B01-0004"
    B01_SIM_INVALID_TASK_SPEC = "VLA-B01-0010"
    B01_SIM_INVALID_SCENE = "VLA-B01-0011"

    # === B02 采集 ===
    B02_COLL_DEVICE_OFFLINE = "VLA-B02-0001"
    B02_COLL_FRAME_TIMESTAMP_DRIFT = "VLA-B02-0002"
    B02_COLL_EPISODE_INCOMPLETE = "VLA-B02-0003"
    B02_COLL_ANNOTATION_KAPPA_LOW = "VLA-B02-0004"
    B02_COLL_DATASET_VALIDATION_FAILED = "VLA-B02-0010"

    # === B03 训练 ===
    B03_TRAIN_OOM = "VLA-B03-0001"
    B03_TRAIN_NAN_LOSS = "VLA-B03-0002"
    B03_TRAIN_DISTRIBUTED_SYNC_FAIL = "VLA-B03-0003"
    B03_TRAIN_DATASET_MISSING = "VLA-B03-0004"
    B03_TRAIN_CHECKPOINT_CORRUPT = "VLA-B03-0005"

    # === B04 评测 ===
    B04_EVAL_INFERENCE_TIMEOUT = "VLA-B04-0001"
    B04_EVAL_REPRODUCIBILITY_FAIL = "VLA-B04-0002"
    B04_EVAL_BENCHMARK_MISSING = "VLA-B04-0003"

    # === Pipe ===
    PIPE_SAGA_COMPENSATION_FAILED = "VLA-PIPE-0001"
    PIPE_STAGE_TIMEOUT = "VLA-PIPE-0002"
    PIPE_DAG_INVALID = "VLA-PIPE-0010"


class ErrorResponse(BaseModel):
    """统一错误响应 (OpenAPI 文档化)."""

    code: ErrorCode
    message: str
    details: dict[str, Any] | None = None
    request_id: str | None = None


class VLAError(Exception):
    """VLA 业务异常基类. 抛出后由 FastAPI 异常处理器转为 ErrorResponse."""

    def __init__(
        self,
        code: ErrorCode,
        message: str,
        status_code: int = 400,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}
        super().__init__(message)

    def to_response(self, request_id: str | None = None) -> ErrorResponse:
        return ErrorResponse(
            code=self.code,
            message=self.message,
            details=self.details,
            request_id=request_id,
        )
