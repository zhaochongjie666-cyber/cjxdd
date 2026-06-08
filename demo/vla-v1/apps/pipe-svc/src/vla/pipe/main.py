"""Pipe service FastAPI 入口 — X 跨业务线编排 (X-R01 ~ X-R12)."""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

# Scaffold 阶段: SQLite 模式
if os.getenv("DATABASE_URL") is None and os.getenv("VLA_SCAFFOLD_SQLITE", "1") == "1":
    os.environ["DATABASE_URL"] = "sqlite:///:memory:"

from vla_common.audit import write_audit
from vla_common.errors import ErrorCode, VLAError
from vla_common.middleware import (
    RLSSessionMiddleware,
    VLAErrorHandlerMiddleware,
    current_project_id,
    current_user_id,
)
from vla_common.rbac import check_permission
from vla_db.session import get_engine, get_session, init_db

from vla.pipe.models import PipelineRun, PipelineRunStatus, PipelineStage
from vla.pipe.saga import PipeSaga


# === Pydantic schemas ===
class PipelineRunCreate(BaseModel):
    task_description: str = Field(..., min_length=1, max_length=1024)
    stages: list[str] | None = None  # 默认 4 阶段


class StageView(BaseModel):
    stage: str
    stage_index: int
    status: str
    resource_id: str | None
    attempt_count: int
    error_code: str | None
    error_message: str | None
    started_at: str | None
    completed_at: str | None


class PipelineRunView(BaseModel):
    id: str
    project_id: str
    task_description: str
    status: str
    current_stage_index: int
    started_at: str | None
    completed_at: str | None
    failure_reason: str | None
    created_by: str
    created_at: str
    stages: list[StageView]


class StageActionRequest(BaseModel):
    stage_index: int
    action: str = Field(..., pattern=r"^(retry|skip)$")


# === Lifespan ===
@asynccontextmanager
async def lifespan(app: FastAPI):
    # import models 以触发 ORM 注册
    from vla.pipe.models import PipelineRun, PipelineStage  # noqa: F401

    init_db()
    yield


# === FastAPI app ===
app = FastAPI(
    title="VLA pipe-svc (X 跨业务线编排)",
    version="0.1.0",
    description="PipelineRun / Saga / Stage 编排 (X-R01 ~ X-R12)",
    lifespan=lifespan,
)
app.add_middleware(VLAErrorHandlerMiddleware)
app.add_middleware(RLSSessionMiddleware)


# === Endpoints ===
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


@app.post(
    "/v1/pipeline/runs",
    response_model=PipelineRunView,
    status_code=status.HTTP_201_CREATED,
)
def start_pipeline_run(
    body: PipelineRunCreate,
    x_user_id: str = Header(..., alias="X-User-Id"),
    x_project_id: str = Header(..., alias="X-Project-Id"),
    x_user_role: str = Header("pm", alias="X-User-Role"),
    session: Session = Depends(get_session),
) -> PipelineRunView:
    """X-R01: 启动 1 键端到端 pipeline."""
    check_permission(role=x_user_role, action="start_pipeline_run")
    if not x_user_id or not x_project_id:
        raise VLAError(
            ErrorCode.X_AUTH_MISSING_API_KEY,
            "X-User-Id + X-Project-Id headers required",
            status_code=401,
        )

    saga = PipeSaga(session)
    run = saga.start(
        project_id=x_project_id,
        task_description=body.task_description,
        created_by=x_user_id,
        stages=body.stages,
    )

    # 审计
    write_audit(
        actor_user_id=x_user_id,
        actor_role=x_user_role,
        project_id=x_project_id,
        action="start_pipeline_run",
        target_resource_id=run.id,
        target_resource_type="pipeline_run",
        result="success",
        session=session,
    )
    session.commit()
    session.refresh(run)

    return _to_view(run, session)


@app.get(
    "/v1/pipeline/runs",
    response_model=list[PipelineRunView],
)
def list_pipeline_runs(
    x_user_id: str = Header(..., alias="X-User-Id"),
    x_project_id: str = Header(..., alias="X-Project-Id"),
    x_user_role: str = Header("pm", alias="X-User-Role"),
    session: Session = Depends(get_session),
) -> list[PipelineRunView]:
    """列当前项目的 pipeline_run."""
    check_permission(role=x_user_role, action="view_pipeline_run")
    if not x_user_id or not x_project_id:
        raise VLAError(
            ErrorCode.X_AUTH_MISSING_API_KEY, "X-User-Id + X-Project-Id required", status_code=401
        )
    runs = (
        session.query(PipelineRun)
        .filter(PipelineRun.project_id == x_project_id)
        .order_by(PipelineRun.created_at.desc())
        .all()
    )
    return [_to_view(r, session) for r in runs]


@app.get(
    "/v1/pipeline/runs/{run_id}",
    response_model=PipelineRunView,
)
def get_pipeline_run(
    run_id: str,
    x_user_id: str = Header(..., alias="X-User-Id"),
    x_project_id: str = Header(..., alias="X-Project-Id"),
    x_user_role: str = Header("pm", alias="X-User-Role"),
    session: Session = Depends(get_session),
) -> PipelineRunView:
    check_permission(role=x_user_role, action="view_pipeline_run")
    run = session.get(PipelineRun, run_id)
    if not run or run.project_id != x_project_id:
        raise VLAError(
            ErrorCode.X_RESOURCE_NOT_FOUND, f"pipeline_run {run_id} not found", status_code=404
        )
    return _to_view(run, session)


@app.post(
    "/v1/pipeline/runs/{run_id}/stages/{stage_index}/complete",
    response_model=PipelineRunView,
)
def complete_stage(
    run_id: str,
    stage_index: int,
    resource_id: str | None = None,
    x_user_id: str = Header(..., alias="X-User-Id"),
    x_project_id: str = Header(..., alias="X-Project-Id"),
    x_user_role: str = Header("pm", alias="X-User-Role"),
    session: Session = Depends(get_session),
) -> PipelineRunView:
    """业务服务回调: stage 完成 (X-R07 事件触发或 API 显式调用)."""
    check_permission(role=x_user_role, action="view_pipeline_run")
    saga = PipeSaga(session)
    run = saga.complete_stage(
        pipeline_run_id=run_id, stage_index=stage_index, resource_id=resource_id
    )
    write_audit(
        actor_user_id=x_user_id,
        actor_role=x_user_role,
        project_id=x_project_id,
        action="retry_pipeline_stage",
        target_resource_id=run.id,
        target_resource_type="pipeline_stage",
        result="success",
        extra={"stage_index": stage_index, "resource_id": resource_id},
        session=session,
    )
    session.commit()
    session.refresh(run)
    return _to_view(run, session)


@app.post(
    "/v1/pipeline/runs/{run_id}/stages/{stage_index}/fail",
    response_model=PipelineRunView,
)
def fail_stage(
    run_id: str,
    stage_index: int,
    error_code: str = "PIPE_STAGE_TIMEOUT",
    error_message: str = "Stage failed (default)",
    x_user_id: str = Header(..., alias="X-User-Id"),
    x_project_id: str = Header(..., alias="X-Project-Id"),
    x_user_role: str = Header("pm", alias="X-User-Role"),
    session: Session = Depends(get_session),
) -> PipelineRunView:
    """业务服务回调: stage 失败 → pipeline_run 标 PAUSED (X-R02)."""
    check_permission(role=x_user_role, action="view_pipeline_run")
    saga = PipeSaga(session)
    run = saga.fail_stage(
        pipeline_run_id=run_id,
        stage_index=stage_index,
        error_code=error_code,
        error_message=error_message,
    )
    session.commit()
    session.refresh(run)
    return _to_view(run, session)


@app.post(
    "/v1/pipeline/runs/{run_id}/stages/action",
    response_model=PipelineRunView,
)
def stage_action(
    run_id: str,
    body: StageActionRequest,
    x_user_id: str = Header(..., alias="X-User-Id"),
    x_project_id: str = Header(..., alias="X-Project-Id"),
    x_user_role: str = Header("pm", alias="X-User-Role"),
    session: Session = Depends(get_session),
) -> PipelineRunView:
    """X-R02: 对失败 stage 做 retry / skip 操作."""
    check_permission(role=x_user_role, action="start_pipeline_run")
    saga = PipeSaga(session)
    if body.action == "retry":
        run = saga.retry_stage(pipeline_run_id=run_id, stage_index=body.stage_index)
    elif body.action == "skip":
        run = saga.skip_stage(pipeline_run_id=run_id, stage_index=body.stage_index)
    else:
        raise VLAError(
            ErrorCode.X_VALIDATION_FAILED,
            f"未知 action '{body.action}', 只支持 retry/skip",
            status_code=400,
        )
    session.commit()
    session.refresh(run)
    return _to_view(run, session)


@app.post(
    "/v1/pipeline/runs/{run_id}/cancel",
    response_model=PipelineRunView,
)
def cancel_run(
    run_id: str,
    x_user_id: str = Header(..., alias="X-User-Id"),
    x_project_id: str = Header(..., alias="X-Project-Id"),
    x_user_role: str = Header("pm", alias="X-User-Role"),
    session: Session = Depends(get_session),
) -> PipelineRunView:
    """X-R10: 取消 pipeline. 已终止 (>7 天) 不可重启 — 在 cancel 校验后追加重启限制."""
    check_permission(role=x_user_role, action="start_pipeline_run")
    saga = PipeSaga(session)
    run = saga.cancel(pipeline_run_id=run_id)
    session.commit()
    session.refresh(run)
    return _to_view(run, session)


# === helpers ===
def _to_view(run: PipelineRun, session: Session) -> PipelineRunView:
    stages = (
        session.query(PipelineStage)
        .filter(PipelineStage.pipeline_run_id == run.id)
        .order_by(PipelineStage.stage_index)
        .all()
    )
    return PipelineRunView(
        id=run.id,
        project_id=run.project_id,
        task_description=run.task_description,
        status=run.status,
        current_stage_index=run.current_stage_index,
        started_at=run.started_at.isoformat() if run.started_at else None,
        completed_at=run.completed_at.isoformat() if run.completed_at else None,
        failure_reason=run.failure_reason,
        created_by=run.created_by,
        created_at=run.created_at.isoformat(),
        stages=[
            StageView(
                stage=s.stage,
                stage_index=s.stage_index,
                status=s.status,
                resource_id=s.resource_id,
                attempt_count=s.attempt_count,
                error_code=s.error_code,
                error_message=s.error_message,
                started_at=s.started_at.isoformat() if s.started_at else None,
                completed_at=s.completed_at.isoformat() if s.completed_at else None,
            )
            for s in stages
        ],
    )


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "vla-pipe-svc", "version": "0.1.0", "phase": "5-execute", "docs": "/docs"}
