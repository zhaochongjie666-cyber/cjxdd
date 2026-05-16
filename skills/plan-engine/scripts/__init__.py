"""
Plan Engine - 计划执行引擎

执行基于 DAG 的任务计划，支持：
- 任务状态管理
- 并行任务执行
- 疑惑澄清机制
- 质量检查点
- 动态重规划
"""

from .plan_engine import (
    PlanEngine,
    Task,
    SubTask,
    Question,
    TaskStatus,
    Plan,
    Dependency,
    HistoryEntry,
)

__version__ = "1.0.0"
__all__ = [
    "PlanEngine",
    "Task",
    "SubTask",
    "Question",
    "TaskStatus",
    "Plan",
    "Dependency",
    "HistoryEntry",
]
