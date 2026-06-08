"""审计中间件 + AuditLog ORM (X-R06/X-R12).

调用方模式:
  1. request 进来 → 审计中间件记录 request start (action=action_name, target=resource)
  2. 业务代码执行 → 同事务内 (或异步队列) 记录 result
  3. request 完成 → 审计中间件补 result=success/fail

为 Phase 5 简化:
  - 同步写 audit_logs 表 (用同一 session)
  - 5 字段必含: ts_utc / actor_user_id / action / target_resource_id / result / reason
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, String, Text, func
from sqlalchemy.orm import Mapped, Session, mapped_column

from vla_db.base import Base
from vla_db.session import get_session_factory


class AuditLog(Base):
    """审计日志 (X-R06 / X-R12).

    7 年保留, 业务用户无 DELETE 权限 (PG GRANT 走迁移 SQL).
    """

    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    ts_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    actor_user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    actor_role: Mapped[str | None] = mapped_column(String(64), nullable=True)
    project_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    target_resource_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    target_resource_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    result: Mapped[str] = mapped_column(String(16), nullable=False)  # success / fail / denied
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    extra: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)


def write_audit(
    *,
    actor_user_id: str,
    action: str,
    result: str,
    target_resource_id: str | None = None,
    target_resource_type: str | None = None,
    actor_role: str | None = None,
    project_id: str | None = None,
    reason: str | None = None,
    request_id: str | None = None,
    ip: str | None = None,
    extra: dict[str, Any] | None = None,
    session: Session | None = None,
) -> AuditLog:
    """写一条审计日志.

    提供 session 时加入该 session 事务; 否则新建临时 session.
    """
    log = AuditLog(
        actor_user_id=actor_user_id,
        action=action,
        result=result,
        target_resource_id=target_resource_id,
        target_resource_type=target_resource_type,
        actor_role=actor_role,
        project_id=project_id,
        reason=reason,
        request_id=request_id,
        ip=ip,
        extra=extra,
    )
    if session is not None:
        session.add(log)
        session.flush()
    else:
        factory = get_session_factory()
        with factory() as s:
            s.add(log)
            s.commit()
    return log


# 关键操作 (auto-record via middleware / decorator)
AUDITED_ACTIONS = frozenset(
    {
        "create_sim_job",
        "cancel_sim_job",
        "create_collection_session",
        "submit_annotation",
        "publish_dataset_version",
        "submit_training_job",
        "stop_training_job",
        "publish_model_version",
        "submit_eval_job",
        "publish_eval_report",
        "start_pipeline_run",
        "pause_pipeline_run",
        "retry_pipeline_stage",
    }
)
