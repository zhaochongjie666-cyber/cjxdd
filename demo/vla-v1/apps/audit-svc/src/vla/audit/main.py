"""Audit service — 7 年保留审计日志查询 (X-R06 / X-R12)."""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Any

from fastapi import Depends, FastAPI, Header, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

# Scaffold: SQLite 模式
if os.getenv("DATABASE_URL") is None and os.getenv("VLA_SCAFFOLD_SQLITE", "1") == "1":
    os.environ["DATABASE_URL"] = "sqlite:///:memory:"

from vla_common.audit import AuditLog
from vla_common.errors import ErrorCode, VLAError
from vla_common.middleware import (
    RLSSessionMiddleware,
    VLAErrorHandlerMiddleware,
)
from vla_common.rbac import check_permission
from vla_db.session import get_engine, get_session, init_db


class AuditLogView(BaseModel):
    id: str
    ts_utc: str
    actor_user_id: str
    actor_role: str | None
    project_id: str | None
    action: str
    target_resource_id: str | None
    target_resource_type: str | None
    result: str
    reason: str | None
    request_id: str | None
    ip: str | None
    extra: dict[str, Any] | None


class AuditLogList(BaseModel):
    items: list[AuditLogView]
    next_cursor: str | None
    has_more: bool


@asynccontextmanager
async def lifespan(app: FastAPI):
    # import 触发 ORM 注册
    from vla_common.audit import AuditLog  # noqa: F401

    init_db()
    yield


app = FastAPI(
    title="VLA audit-svc (X 跨业务线审计)",
    version="0.1.0",
    description="7 年保留审计日志 (X-R06 / X-R12)",
    lifespan=lifespan,
)
app.add_middleware(VLAErrorHandlerMiddleware)
app.add_middleware(RLSSessionMiddleware)


@app.get("/health")
def health() -> dict[str, str]:
    try:
        engine = get_engine()
        with engine.connect() as conn:
            from sqlalchemy import text

            conn.execute(text("SELECT 1"))
        return {"status": "ok", "db": "up"}
    except Exception as e:  # noqa: BLE001
        return {"status": "degraded", "db": f"down: {type(e).__name__}"}


@app.get("/v1/audit/logs", response_model=AuditLogList)
def list_audit_logs(
    project_id: str | None = Query(None, description="按 project 过滤"),
    actor_user_id: str | None = Query(None, description="按 actor 过滤"),
    action: str | None = Query(None, description="按 action 过滤 (e.g. create_sim_job)"),
    result: str | None = Query(None, description="按 result 过滤 (success/fail/denied)"),
    days: int = Query(7, ge=1, le=2555, description="最近 N 天 (默认 7, max 7 年)"),
    cursor: str | None = Query(None, description="游标 (ts_utc + id, 上一页末条)"),
    page_size: int = Query(20, ge=1, le=100),
    x_user_id: str = Header(..., alias="X-User-Id"),
    x_user_role: str = Header("sre", alias="X-User-Role"),
    session: Session = Depends(get_session),
) -> AuditLogList:
    """X-R06 / X-R12: 审计日志查询 (走游标分页 X-R10.x).

    权限: 仅 SRE / ADMIN 角色可看.
    """
    check_permission(role=x_user_role, action="view_audit_log")
    if not x_user_id:
        raise VLAError(
            ErrorCode.X_AUTH_MISSING_API_KEY, "X-User-Id required", status_code=401
        )

    since = datetime.utcnow() - timedelta(days=days)
    q = session.query(AuditLog).filter(AuditLog.ts_utc >= since)
    if project_id:
        q = q.filter(AuditLog.project_id == project_id)
    if actor_user_id:
        q = q.filter(AuditLog.actor_user_id == actor_user_id)
    if action:
        q = q.filter(AuditLog.action == action)
    if result:
        q = q.filter(AuditLog.result == result)
    if cursor:
        # cursor = "ts_utc|id" (URL-safe base64 by caller)
        try:
            ts_str, cur_id = cursor.split("|", 1)
            ts = datetime.fromisoformat(ts_str)
            q = q.filter(
                (AuditLog.ts_utc < ts) | ((AuditLog.ts_utc == ts) & (AuditLog.id < cur_id))
            )
        except ValueError:
            raise VLAError(
                ErrorCode.X_VALIDATION_FAILED,
                f"invalid cursor: {cursor}",
                status_code=400,
            )

    # 顺序: ts_utc DESC, id DESC
    q = q.order_by(AuditLog.ts_utc.desc(), AuditLog.id.desc())
    # 拿 page_size+1 判断 has_more
    rows = q.limit(page_size + 1).all()
    has_more = len(rows) > page_size
    rows = rows[:page_size]

    items = [
        AuditLogView(
            id=r.id,
            ts_utc=r.ts_utc.isoformat(),
            actor_user_id=r.actor_user_id,
            actor_role=r.actor_role,
            project_id=r.project_id,
            action=r.action,
            target_resource_id=r.target_resource_id,
            target_resource_type=r.target_resource_type,
            result=r.result,
            reason=r.reason,
            request_id=r.request_id,
            ip=r.ip,
            extra=r.extra,
        )
        for r in rows
    ]
    next_cursor = None
    if has_more and rows:
        last = rows[-1]
        next_cursor = f"{last.ts_utc.isoformat()}|{last.id}"

    return AuditLogList(items=items, next_cursor=next_cursor, has_more=has_more)


@app.get("/v1/audit/logs/{log_id}", response_model=AuditLogView)
def get_audit_log(
    log_id: str,
    x_user_id: str = Header(..., alias="X-User-Id"),
    x_user_role: str = Header("sre", alias="X-User-Role"),
    session: Session = Depends(get_session),
) -> AuditLogView:
    check_permission(role=x_user_role, action="view_audit_log")
    log = session.get(AuditLog, log_id)
    if not log:
        raise VLAError(
            ErrorCode.X_RESOURCE_NOT_FOUND, f"audit_log {log_id} not found", status_code=404
        )
    return AuditLogView(
        id=log.id,
        ts_utc=log.ts_utc.isoformat(),
        actor_user_id=log.actor_user_id,
        actor_role=log.actor_role,
        project_id=log.project_id,
        action=log.action,
        target_resource_id=log.target_resource_id,
        target_resource_type=log.target_resource_type,
        result=log.result,
        reason=log.reason,
        request_id=log.request_id,
        ip=log.ip,
        extra=log.extra,
    )


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "vla-audit-svc", "version": "0.1.0", "phase": "5-execute", "docs": "/docs"}
