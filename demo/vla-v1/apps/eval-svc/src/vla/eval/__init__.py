"""eval-svc: B04 模型评测."""
from vla.eval.domain import VALID_BENCHMARKS, EvalJob, EvalJobStatus, EvalReport, EvalTask
from vla.eval.service import EvalService

__all__ = [
    "VALID_BENCHMARKS",
    "EvalJob",
    "EvalJobStatus",
    "EvalReport",
    "EvalTask",
    "EvalService",
]
