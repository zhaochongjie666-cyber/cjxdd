"""VLA sim-svc — FastAPI 入口 (Hello API scaffold).

scaffold 阶段: 6 个端点 + 错误码 + RLS middleware + OpenAPI 文档.
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, Header, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

# scaffold 阶段: 走 SQLite (无 Docker), production 用 PG (URL 从 settings 读)
if os.getenv("DATABASE_URL") is None and os.getenv("VLA_SCAFFOLD_SQLITE", "1") == "1":
    os.environ["DATABASE_URL"] = "sqlite:///:memory:"

from vla_common.errors import (  # noqa: E402
    ErrorCode,
    ErrorResponse,
    VLAError,
)
from vla_common.middleware import (  # noqa: E402
    RLSSessionMiddleware,
    VLAErrorHandlerMiddleware,
    current_project_id,
    current_user_id,
    is_admin,
)
from vla_db.session import get_engine, get_session, init_db  # noqa: E402

from vla.sim.models import Project, SimJob  # noqa: E402


# === Pydantic schemas ===
class HealthResponse(BaseModel):
    status: str = "ok"
    services: dict[str, str]
    version: str = "0.1.0"


class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    slug: str = Field(..., pattern=r"^[a-z0-9-]{1,64}$")
    description: str | None = None


class ProjectResponse(BaseModel):
    id: str
    name: str
    slug: str
    description: str | None
    owner_id: str
    created_at: str

    model_config = {"from_attributes": True}


class SimJobCreate(BaseModel):
    task_name: str = Field(..., min_length=1, max_length=255)
    engine: str = Field(..., pattern=r"^(isaac_sim|mujoco|genesis)$")
    num_episodes: int = Field(1, ge=1, le=10000)
    task_spec: dict[str, Any] = Field(default_factory=dict)
    physics_config: dict[str, Any] | None = None


class SimJobResponse(BaseModel):
    id: str
    project_id: str
    task_name: str
    engine: str
    num_episodes: int
    status: str
    created_at: str

    model_config = {"from_attributes": True}


# === Lifespan ===
@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动时建表 (scaffold 阶段用 SQLAlchemy ORM, 跑通后切 Alembic)."""
    init_db()
    yield


# === FastAPI app ===
app = FastAPI(
    title="VLA sim-svc (B01 数据仿真)",
    version="0.1.0",
    description="Scaffold 阶段: 6 端点 Hello API + RLS + 错误码 VLA-{BXX}-{NNNN}",
    lifespan=lifespan,
)

# 中间件顺序: RLS (注入 contextvar) → 错误处理 (捕获异常)
app.add_middleware(VLAErrorHandlerMiddleware)
app.add_middleware(RLSSessionMiddleware)


# === 1. /health ===
@app.get("/health", response_model=HealthResponse, tags=["meta"])
def health() -> HealthResponse:
    """健康检查: 返回 200 + 各依赖状态.

    scaffold 阶段: 只检查 DB 连通 (Redis/Kafka/S3 留给 Phase 5).
    """
    services: dict[str, str] = {}
    try:
        engine = get_engine()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        services["db"] = "up"
    except Exception as e:  # noqa: BLE001
        services["db"] = f"down: {type(e).__name__}"

    # scaffold 阶段不强求 Redis/Kafka (后续 Phase 接)
    services["redis"] = "skipped (scaffold)"
    services["kafka"] = "skipped (scaffold)"
    services["s3"] = "skipped (scaffold)"

    return HealthResponse(status="ok", services=services)


# === 2-3. /v1/projects CRUD ===
@app.post(
    "/v1/projects",
    response_model=ProjectResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["projects"],
    responses={400: {"model": ErrorResponse}},
)
def create_project(
    body: ProjectCreate,
    x_user_id: str = Header(..., alias="X-User-Id"),
    session: Session = Depends(get_session),
) -> ProjectResponse:
    """创建项目 (X-R03 RLS 隔离)."""
    if not x_user_id:
        raise VLAError(
            ErrorCode.X_AUTH_MISSING_API_KEY,
            "X-User-Id header required",
            status_code=401,
        )

    # slug 唯一性检查
    existing = session.query(Project).filter(Project.slug == body.slug).first()
    if existing:
        raise VLAError(
            ErrorCode.X_VALIDATION_FAILED,
            f"project slug '{body.slug}' already exists",
            status_code=409,
            details={"slug": body.slug},
        )

    project = Project(
        name=body.name,
        slug=body.slug,
        description=body.description,
        owner_id=x_user_id,
    )
    session.add(project)
    session.commit()
    session.refresh(project)

    return ProjectResponse(
        id=str(project.id),
        name=project.name,
        slug=project.slug,
        description=project.description,
        owner_id=str(project.owner_id),
        created_at=project.created_at.isoformat(),
    )


@app.get(
    "/v1/projects",
    response_model=list[ProjectResponse],
    tags=["projects"],
)
def list_projects(
    x_user_id: str = Header(..., alias="X-User-Id"),
    session: Session = Depends(get_session),
) -> list[ProjectResponse]:
    """列出当前用户的项目 (X-R03 RLS)."""
    if not x_user_id:
        raise VLAError(
            ErrorCode.X_AUTH_MISSING_API_KEY,
            "X-User-Id header required",
            status_code=401,
        )
    # scaffold 阶段: 简化为查 owner_id (无 RLS session var 注入)
    projects = session.query(Project).filter(Project.owner_id == x_user_id).all()
    return [
        ProjectResponse(
            id=str(p.id),
            name=p.name,
            slug=p.slug,
            description=p.description,
            owner_id=str(p.owner_id),
            created_at=p.created_at.isoformat(),
        )
        for p in projects
    ]


# === 4-5. /v1/sim/jobs CRUD ===
@app.post(
    "/v1/sim/jobs",
    response_model=SimJobResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["sim"],
    responses={400: {"model": ErrorResponse}},
)
def create_sim_job(
    body: SimJobCreate,
    x_user_id: str = Header(..., alias="X-User-Id"),
    x_project_id: str = Header(..., alias="X-Project-Id"),
    session: Session = Depends(get_session),
) -> SimJobResponse:
    """创建仿真任务 (B01-R01 入口).

    写入 sim_jobs 表 + (Phase 5 后) 发布 SimJobCreated 事件到 Kafka.
    """
    if not x_user_id or not x_project_id:
        raise VLAError(
            ErrorCode.X_AUTH_MISSING_API_KEY,
            "X-User-Id + X-Project-Id headers required",
            status_code=401,
        )

    # 验证项目存在
    project = session.query(Project).filter(Project.id == x_project_id).first()
    if not project:
        raise VLAError(
            ErrorCode.X_RESOURCE_NOT_FOUND,
            f"project {x_project_id} not found",
            status_code=404,
        )

    sim_job = SimJob(
        project_id=x_project_id,
        task_name=body.task_name,
        engine=body.engine,
        num_episodes=body.num_episodes,
        task_spec=body.task_spec,
        physics_config=body.physics_config,
        status="created",
        requested_by=x_user_id,
    )
    session.add(sim_job)
    session.commit()
    session.refresh(sim_job)

    return SimJobResponse(
        id=str(sim_job.id),
        project_id=str(sim_job.project_id),
        task_name=sim_job.task_name,
        engine=sim_job.engine,
        num_episodes=sim_job.num_episodes,
        status=sim_job.status,
        created_at=sim_job.created_at.isoformat(),
    )


@app.get(
    "/v1/sim/jobs",
    response_model=list[SimJobResponse],
    tags=["sim"],
)
def list_sim_jobs(
    x_user_id: str = Header(..., alias="X-User-Id"),
    x_project_id: str = Header(..., alias="X-Project-Id"),
    session: Session = Depends(get_session),
) -> list[SimJobResponse]:
    """列出当前项目的仿真任务 (空列表 OK)."""
    if not x_user_id or not x_project_id:
        raise VLAError(
            ErrorCode.X_AUTH_MISSING_API_KEY,
            "X-User-Id + X-Project-Id headers required",
            status_code=401,
        )
    jobs = session.query(SimJob).filter(SimJob.project_id == x_project_id).all()
    return [
        SimJobResponse(
            id=str(j.id),
            project_id=str(j.project_id),
            task_name=j.task_name,
            engine=j.engine,
            num_episodes=j.num_episodes,
            status=j.status,
            created_at=j.created_at.isoformat(),
        )
        for j in jobs
    ]


# === 6. /v1/projects/{id} GET 单个 ===
@app.get(
    "/v1/projects/{project_id}",
    response_model=ProjectResponse,
    tags=["projects"],
    responses={404: {"model": ErrorResponse}},
)
def get_project(
    project_id: str,
    x_user_id: str = Header(..., alias="X-User-Id"),
    session: Session = Depends(get_session),
) -> ProjectResponse:
    """获取单个项目 (X-R03 RLS 隔离, 跨租户访问返回 404)."""
    project = session.query(Project).filter(Project.id == project_id).first()
    if not project or str(project.owner_id) != x_user_id:
        raise VLAError(
            ErrorCode.X_RESOURCE_NOT_FOUND,
            f"project {project_id} not found",
            status_code=404,
        )
    return ProjectResponse(
        id=str(project.id),
        name=project.name,
        slug=project.slug,
        description=project.description,
        owner_id=str(project.owner_id),
        created_at=project.created_at.isoformat(),
    )


# === OpenAPI 自定义 ===
@app.get("/", tags=["meta"])
def root() -> dict[str, str]:
    return {
        "service": "vla-sim-svc",
        "version": "0.1.0",
        "phase": "2.7-scaffold",
        "docs": "/docs",
        "openapi": "/openapi.json",
    }
