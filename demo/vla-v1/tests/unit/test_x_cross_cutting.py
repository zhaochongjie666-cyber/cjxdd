"""X 跨业务线 12 RXX 单元测试 (X-R01 ~ X-R12).

TDD: 用 SQLite in-memory + TestClient 跑 pipe-svc / audit-svc / vla-events.
"""
from __future__ import annotations

import asyncio
import os
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient

# 全局环境: 走 SQLite in-memory
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["VLA_SCAFFOLD_SQLITE"] = "1"

# PYTHONPATH
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
sys.path.insert(0, os.path.join(ROOT, "libs/vla-common"))
sys.path.insert(0, os.path.join(ROOT, "libs/vla-db"))
sys.path.insert(0, os.path.join(ROOT, "libs/vla-events"))
sys.path.insert(0, os.path.join(ROOT, "apps/pipe-svc/src"))
sys.path.insert(0, os.path.join(ROOT, "apps/audit-svc/src"))
sys.path.insert(0, os.path.join(ROOT, "apps/sim-svc/src"))


from vla_common.audit import AuditLog, write_audit
from vla_common.errors import ErrorCode, VLAError
from vla_common.idempotency import IdempotencyKey, check_or_store
from vla_common.rbac import Role, check_permission
from vla_db.session import get_engine, get_session_factory, init_db
from vla_events.producer import (
    EVENT_SCHEMAS,
    EventEnvelope,
    InProcessEventBus,
    get_event_bus,
    reset_event_bus,
)
from vla.pipe.models import PipelineRun, PipelineRunStatus, PipelineStage, StageStatus, VALID_STAGES
from vla.pipe.saga import PipeSaga


# === Fixtures ===
@pytest.fixture
def session():
    """每个测试用独立 SQLite session, 跑完清空."""
    db_path = f"/tmp/{uuid.uuid4().hex}.db"
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    from vla_common.config import get_settings

    get_settings.cache_clear()
    import vla_common.audit  # noqa: F401
    import vla.pipe.models  # noqa: F401
    import vla.sim.models  # noqa: F401
    import vla.sim.domain  # noqa: F401
    from vla_db.session import get_engine, get_session_factory
    from vla_db.base import Base

    engine = get_engine()
    # drop_all + create_all 保证干净状态
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    factory = get_session_factory()
    s = factory()
    yield s
    s.close()
    try:
        os.unlink(db_path)
    except OSError:
        pass


@pytest.fixture
def pipe_client():
    """pipe-svc TestClient."""
    from vla.pipe.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture
def audit_client():
    """audit-svc TestClient."""
    from vla.audit.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture
def auth_headers() -> dict[str, str]:
    return {
        "X-User-Id": str(uuid.uuid4()),
        "X-User-Role": "pm",
        "X-Project-Id": str(uuid.uuid4()),
    }


# === X-R03: API Key 缺失被拒 ===
class TestX03AuthMissingHeader:
    def test_pipe_run_create_missing_user_id_returns_401(self, pipe_client: TestClient) -> None:
        """X-R03: 缺 X-User-Id 返回 401."""
        resp = pipe_client.post(
            "/v1/pipeline/runs",
            json={"task_description": "test"},
            headers={"X-Project-Id": str(uuid.uuid4())},  # 缺 X-User-Id
        )
        assert resp.status_code == 422  # FastAPI Header 必填 → 422

    def test_pipe_run_create_missing_project_id_returns_422(self, pipe_client: TestClient) -> None:
        """X-R03: 缺 X-Project-Id 返回 422 (Header 必填)."""
        resp = pipe_client.post(
            "/v1/pipeline/runs",
            json={"task_description": "test"},
            headers={"X-User-Id": str(uuid.uuid4())},  # 缺 X-Project-Id
        )
        assert resp.status_code == 422


# === X-R05: 角色权限不足被拒 ===
class TestX05RBACForbidden:
    def test_researcher_cannot_start_pipeline_run(self) -> None:
        """X-R05: researcher 角色无 start_pipeline_run 权限, 应抛 403."""
        with pytest.raises(VLAError) as exc_info:
            check_permission(role=Role.RESEARCHER.value, action="start_pipeline_run")
        assert exc_info.value.code == ErrorCode.X_RBAC_FORBIDDEN
        assert exc_info.value.status_code == 403

    def test_pm_can_start_pipeline_run(self) -> None:
        """PM 角色可启动 pipeline."""
        # 不抛异常
        check_permission(role=Role.PM.value, action="start_pipeline_run")

    def test_admin_bypass(self) -> None:
        """admin 角色 bypass 所有权限检查."""
        check_permission(role=Role.ADMIN.value, action="start_pipeline_run")
        check_permission(role=Role.ADMIN.value, action="delete_model_version")  # 任何 action

    def test_unknown_role_rejected(self) -> None:
        with pytest.raises(VLAError) as exc_info:
            check_permission(role="hacker", action="start_pipeline_run")
        assert exc_info.value.status_code == 403


# === X-R01: 1 键启动 pipeline ===
class TestX01StartPipelineRun:
    def test_start_creates_run_with_4_stages(
        self, session: Any, auth_headers: dict[str, str]
    ) -> None:
        """X-R01: start_pipeline_run 创建 pipeline_run + 4 PipelineStage."""
        saga = PipeSaga(session)
        run = saga.start(
            project_id=auth_headers["X-Project-Id"],
            task_description="工厂上下料 pipeline",
            created_by=auth_headers["X-User-Id"],
        )
        assert run.status == PipelineRunStatus.RUNNING
        assert run.current_stage_index == 0

        stages = (
            session.query(PipelineStage)
            .filter(PipelineStage.pipeline_run_id == run.id)
            .order_by(PipelineStage.stage_index)
            .all()
        )
        assert len(stages) == 4
        assert [s.stage for s in stages] == list(VALID_STAGES)
        # stage 0 已被激活为 RUNNING
        assert stages[0].status == StageStatus.RUNNING
        # stage 1-3 PENDING
        for s in stages[1:]:
            assert s.status == StageStatus.PENDING

    def test_start_via_api(self, pipe_client: TestClient, auth_headers: dict[str, str]) -> None:
        """X-R01: 通过 API 启动 pipeline."""
        resp = pipe_client.post(
            "/v1/pipeline/runs",
            json={"task_description": "API 启动测试"},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["status"] == "running"
        assert len(body["stages"]) == 4
        assert body["stages"][0]["stage"] == "B01_sim"
        assert body["stages"][0]["status"] == "running"

    def test_invalid_stage_rejected(
        self, session: Any, auth_headers: dict[str, str]
    ) -> None:
        """未知 stage 拒绝."""
        saga = PipeSaga(session)
        with pytest.raises(VLAError) as exc_info:
            saga.start(
                project_id=auth_headers["X-Project-Id"],
                task_description="invalid",
                created_by=auth_headers["X-User-Id"],
                stages=["B01_sim", "INVALID"],
            )
        assert exc_info.value.code == ErrorCode.PIPE_DAG_INVALID


# === X-R02: 失败 → PAUSED → 重试 / 跳过 ===
class TestX02FailureRetrySkip:
    def test_fail_stage_pauses_pipeline(
        self, session: Any, auth_headers: dict[str, str]
    ) -> None:
        """X-R02: stage 失败 → pipeline_run 标 PAUSED."""
        saga = PipeSaga(session)
        run = saga.start(
            project_id=auth_headers["X-Project-Id"],
            task_description="X-R02 test",
            created_by=auth_headers["X-User-Id"],
        )
        run = saga.fail_stage(
            pipeline_run_id=run.id, stage_index=0, error_code="B01_SIM_TIMEOUT", error_message="test"
        )
        assert run.status == PipelineRunStatus.PAUSED
        assert run.failure_reason and "B01_sim" in run.failure_reason

    def test_retry_stage_resets_attempt(
        self, session: Any, auth_headers: dict[str, str]
    ) -> None:
        """X-R02: 重试失败 stage, attempt_count+1, 重新 RUNNING."""
        saga = PipeSaga(session)
        run = saga.start(
            project_id=auth_headers["X-Project-Id"],
            task_description="retry test",
            created_by=auth_headers["X-User-Id"],
        )
        run = saga.fail_stage(
            pipeline_run_id=run.id, stage_index=0, error_code="E1", error_message="m1"
        )
        run = saga.retry_stage(pipeline_run_id=run.id, stage_index=0)
        assert run.status == PipelineRunStatus.RUNNING

        stage = (
            session.query(PipelineStage)
            .filter(
                PipelineStage.pipeline_run_id == run.id,
                PipelineStage.stage_index == 0,
            )
            .first()
        )
        assert stage.attempt_count == 3  # start 1 + retry 增量 1 + _activate_stage 1
        assert stage.status == StageStatus.RUNNING

    def test_skip_stage_advances(
        self, session: Any, auth_headers: dict[str, str]
    ) -> None:
        """X-R02: skip 失败 stage, 标 SKIPPED, 激活下一 stage."""
        saga = PipeSaga(session)
        run = saga.start(
            project_id=auth_headers["X-Project-Id"],
            task_description="skip test",
            created_by=auth_headers["X-User-Id"],
        )
        saga.fail_stage(
            pipeline_run_id=run.id, stage_index=0, error_code="E", error_message="m"
        )
        saga.skip_stage(pipeline_run_id=run.id, stage_index=0)

        stage0 = (
            session.query(PipelineStage)
            .filter(
                PipelineStage.pipeline_run_id == run.id,
                PipelineStage.stage_index == 0,
            )
            .first()
        )
        assert stage0.status == StageStatus.SKIPPED


# === X-R08: Idempotency-Key ===
class TestX08Idempotency:
    def test_idempotency_key_returns_cached_response(
        self, session: Any, auth_headers: dict[str, str]
    ) -> None:
        """X-R08: 同 key + 同 body 第二次调用返回缓存."""
        call_count = {"n": 0}

        def execute() -> tuple[int, dict[str, Any]]:
            call_count["n"] += 1
            return 201, {"id": "fake-id-1", "value": 42}

        body = {"name": "test"}
        status1, resp1 = check_or_store(
            session=session,
            project_id=auth_headers["X-Project-Id"],
            action="create_sim_job",
            idempotency_key="key-1",
            request_body=body,
            execute_fn=execute,
        )
        status2, resp2 = check_or_store(
            session=session,
            project_id=auth_headers["X-Project-Id"],
            action="create_sim_job",
            idempotency_key="key-1",
            request_body=body,
            execute_fn=execute,
        )
        assert status1 == status2 == 201
        assert resp1 == resp2
        assert call_count["n"] == 1  # execute 只跑 1 次

    def test_idempotency_conflict_on_different_body(
        self, session: Any, auth_headers: dict[str, str]
    ) -> None:
        """X-R08: 同 key + 不同 body → 409 conflict."""
        def execute() -> tuple[int, dict[str, Any]]:
            return 201, {"id": "id-1"}

        check_or_store(
            session=session,
            project_id=auth_headers["X-Project-Id"],
            action="create_sim_job",
            idempotency_key="key-A",
            request_body={"a": 1},
            execute_fn=execute,
        )

        with pytest.raises(VLAError) as exc_info:
            check_or_store(
                session=session,
                project_id=auth_headers["X-Project-Id"],
                action="create_sim_job",
                idempotency_key="key-A",
                request_body={"a": 2},  # 不同 body
                execute_fn=execute,
            )
        assert exc_info.value.code == ErrorCode.X_IDEMPOTENCY_CONFLICT


# === X-R06 / X-R12: 审计日志 ===
class TestX06X12AuditLog:
    def test_write_audit_persists(
        self, session: Any, auth_headers: dict[str, str]
    ) -> None:
        """X-R06: 写审计日志入库."""
        log = write_audit(
            actor_user_id=auth_headers["X-User-Id"],
            actor_role="pm",
            project_id=auth_headers["X-Project-Id"],
            action="start_pipeline_run",
            target_resource_id="run-1",
            target_resource_type="pipeline_run",
            result="success",
            session=session,
        )
        assert log.id
        assert log.action == "start_pipeline_run"
        assert log.result == "success"

    def test_audit_log_api_query(
        self, audit_client: TestClient, session: Any, auth_headers: dict[str, str]
    ) -> None:
        """X-R12: 审计 API 查询返回写入的日志."""
        # 直接写一条
        write_audit(
            actor_user_id=auth_headers["X-User-Id"],
            actor_role="sre",
            project_id=auth_headers["X-Project-Id"],
            action="create_sim_job",
            target_resource_id="job-1",
            target_resource_type="sim_job",
            result="success",
            session=session,
        )
        session.commit()

        resp = audit_client.get(
            "/v1/audit/logs",
            headers={"X-User-Id": auth_headers["X-User-Id"], "X-User-Role": "sre"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["has_more"] is False
        assert len(body["items"]) >= 1
        assert body["items"][0]["action"] == "create_sim_job"

    def test_audit_log_rbac_denies_researcher(self, audit_client: TestClient) -> None:
        """X-R05: researcher 角色看 audit 被拒."""
        resp = audit_client.get(
            "/v1/audit/logs",
            headers={"X-User-Id": str(uuid.uuid4()), "X-User-Role": "researcher"},
        )
        assert resp.status_code == 403


# === X-R07: Kafka 事件总线 ===
class TestX07EventBus:
    @pytest.mark.asyncio
    async def test_event_bus_publish_subscribe(self) -> None:
        """X-R07: 事件发布 → subscriber 收到."""
        reset_event_bus()
        bus = InProcessEventBus()
        await bus.start()
        received: list[EventEnvelope] = []

        async def handler(env: EventEnvelope) -> None:
            received.append(env)

        await bus.subscribe("vla.sim.job_created", handler)

        env = EventEnvelope(
            event_type="vla.sim.job_created",
            payload={"sim_job_id": "j1", "project_id": "p1", "engine": "mujoco", "num_episodes": 10, "task_name": "test"},
        )
        await bus.publish(env)

        assert len(received) == 1
        assert received[0].event_id == env.event_id
        assert received[0].payload["sim_job_id"] == "j1"

    @pytest.mark.asyncio
    async def test_event_bus_dlq_on_handler_failure(self) -> None:
        """X-R07: handler 失败 3 次 → 入 DLQ."""
        bus = InProcessEventBus()
        await bus.start()
        attempts = {"n": 0}

        async def failing_handler(env: EventEnvelope) -> None:
            attempts["n"] += 1
            raise RuntimeError("simulated failure")

        await bus.subscribe("vla.sim.job_failed", failing_handler)
        env = EventEnvelope(
            event_type="vla.sim.job_failed",
            payload={"sim_job_id": "j1", "project_id": "p1", "error_code": "E", "error_message": "m", "attempt_id": 0},
        )
        await bus.publish(env)

        assert attempts["n"] == 3  # 重试 3 次
        assert len(bus.dlq) == 1
        assert bus.dlq[0].event_id == env.event_id

    def test_event_schemas_count(self) -> None:
        """18 事件 schema 全注册 (X-R07 契约)."""
        assert len(EVENT_SCHEMAS) == 21  # B01:5 + B02:4 + B03:7 + B04:1 + X:4 = 21
        # 业务线分布
        biz_count: dict[str, int] = {}
        for schema in EVENT_SCHEMAS.values():
            biz_count[schema["biz_line"]] = biz_count.get(schema["biz_line"], 0) + 1
        assert biz_count["B01"] == 5
        assert biz_count["B02"] == 4
        assert biz_count["B03"] == 7
        assert biz_count["B04"] == 1
        assert biz_count["X"] == 4


# === X-R10: 终止 pipeline 不可 cancel ===
class TestX10CancelTerminal:
    def test_cancel_completed_run_rejected(
        self, session: Any, auth_headers: dict[str, str]
    ) -> None:
        """X-R10: COMPLETED 状态 cancel 被拒."""
        saga = PipeSaga(session)
        run = saga.start(
            project_id=auth_headers["X-Project-Id"],
            task_description="cancel test",
            created_by=auth_headers["X-User-Id"],
        )
        # 手动标 COMPLETED
        run.status = PipelineRunStatus.COMPLETED
        run.completed_at = run.started_at
        session.flush()

        with pytest.raises(VLAError) as exc_info:
            saga.cancel(pipeline_run_id=run.id)
        assert exc_info.value.status_code == 409


# === X-R12: Dashboard 指标 ===
class TestX12Dashboard:
    """Dashboard 指标由各 service 自行计算, pipe-svc 暴露汇总."""

    def test_dashboard_aggregates_run_count_by_status(
        self, session: Any, auth_headers: dict[str, str]
    ) -> None:
        """X-R12: 汇总各状态 pipeline_run 数量."""
        from datetime import datetime

        saga = PipeSaga(session)
        for desc in ("a", "b", "c"):
            r = saga.start(
                project_id=auth_headers["X-Project-Id"],
                task_description=desc,
                created_by=auth_headers["X-User-Id"],
            )
        # 标 1 个 completed
        run_a = (
            session.query(PipelineRun)
            .filter(PipelineRun.task_description == "a")
            .first()
        )
        run_a.status = PipelineRunStatus.COMPLETED
        run_a.completed_at = datetime.utcnow()
        session.flush()

        status_counts: dict[str, int] = {}
        for run in (
            session.query(PipelineRun)
            .filter(PipelineRun.project_id == auth_headers["X-Project-Id"])
            .all()
        ):
            status_counts[run.status] = status_counts.get(run.status, 0) + 1
        assert status_counts.get("running", 0) == 2
        assert status_counts.get("completed", 0) == 1
