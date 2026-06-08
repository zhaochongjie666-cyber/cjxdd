"""VLA Platform Step 7 Smoke Test.

启动 docker-compose / SQLite 跑 alembic / 验证 Hello API + DB 写入 + 错误码.
跑法: pytest tests/smoke/test_hello.py -v (需要先起 sim-svc uvicorn).

Scaffold 阶段断言 (>= 5 项, 实际 10 项):
  1.  测试框架已加载
  2.  /health 返回 200 + db=up
  3.  POST /v1/projects 写入 DB → 201 + 包含新 id
  4.  GET /v1/projects 列出刚创建的项目
  5.  GET /v1/projects/{id} 单个查询返回 200
  6.  POST /v1/sim/jobs 写入 sim_jobs 表 → 201
  7.  GET /v1/sim/jobs 列出当前项目
  8.  POST /v1/sim/jobs 缺 X-User-Id → 422 (validation)
  9.  POST /v1/sim/jobs engine 不合法 → 422
  10. /openapi.json 端点数 >= 5

xdd cross-BDD smoke: 1 个 Gherkin 场景 (X-R01 跨业务线认证).
"""
from __future__ import annotations

import os
import time
import uuid
from pathlib import Path

import httpx
import pytest

# Smoke test 假定 sim-svc 已在 18001 端口跑起来 (scaffold 验证用)
# CI 跑时: docker compose up sim-svc 然后 pytest
BASE_URL = os.getenv("VLA_SIM_SVC_URL", "http://127.0.0.1:18001")


def _wait_for_service(timeout: float = 30.0) -> None:
    """等服务起来."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            r = httpx.get(f"{BASE_URL}/health", timeout=2.0)
            if r.status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.5)
    pytest.skip(f"sim-svc 不可达 @ {BASE_URL} (跑 docker compose 或 uvicorn 后重试)")


@pytest.fixture(scope="module", autouse=True)
def svc():
    _wait_for_service()


@pytest.fixture
def user_id() -> str:
    return f"u-smoke-{uuid.uuid4().hex[:8]}"


@pytest.fixture
def headers(user_id: str) -> dict[str, str]:
    return {"X-User-Id": user_id, "Content-Type": "application/json"}


# ===== 1. 测试框架已加载 =====
def test_pytest_loaded() -> None:
    """验证 pytest 框架自身."""
    import pytest as _pt

    assert _pt.__version__


# ===== 2. /health =====
def test_health_returns_200_with_db_up() -> None:
    r = httpx.get(f"{BASE_URL}/health", timeout=5.0)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["services"]["db"] == "up"


# ===== 3. POST /v1/projects =====
def test_create_project_writes_db(user_id: str, headers: dict[str, str]) -> None:
    r = httpx.post(
        f"{BASE_URL}/v1/projects",
        headers=headers,
        json={"name": "Smoke Test", "slug": f"smoke-{user_id[:8]}"},
        timeout=5.0,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert "id" in body
    assert body["owner_id"] == user_id


# ===== 4. GET /v1/projects =====
def test_list_projects_includes_just_created(
    user_id: str, headers: dict[str, str]
) -> None:
    slug = f"smoke-list-{user_id[:8]}"
    httpx.post(
        f"{BASE_URL}/v1/projects",
        headers=headers,
        json={"name": "List Test", "slug": slug},
        timeout=5.0,
    )
    r = httpx.get(f"{BASE_URL}/v1/projects", headers=headers, timeout=5.0)
    assert r.status_code == 200
    projects = r.json()
    slugs = [p["slug"] for p in projects]
    assert slug in slugs, f"刚创建的 {slug} 不在列表 {slugs}"


# ===== 5. GET /v1/projects/{id} =====
def test_get_project_by_id(user_id: str, headers: dict[str, str]) -> None:
    created = httpx.post(
        f"{BASE_URL}/v1/projects",
        headers=headers,
        json={"name": "Get One", "slug": f"smoke-get-{user_id[:8]}"},
        timeout=5.0,
    ).json()
    r = httpx.get(
        f"{BASE_URL}/v1/projects/{created['id']}",
        headers=headers,
        timeout=5.0,
    )
    assert r.status_code == 200
    assert r.json()["id"] == created["id"]


# ===== 6. POST /v1/sim/jobs =====
def test_create_sim_job_writes_db(user_id: str, headers: dict[str, str]) -> None:
    proj = httpx.post(
        f"{BASE_URL}/v1/projects",
        headers=headers,
        json={"name": "SimProj", "slug": f"smoke-sim-{user_id[:8]}"},
        timeout=5.0,
    ).json()
    r = httpx.post(
        f"{BASE_URL}/v1/sim/jobs",
        headers={**headers, "X-Project-Id": proj["id"]},
        json={
            "task_name": "smoke task",
            "engine": "isaac_sim",
            "num_episodes": 2,
            "task_spec": {"instruction": "pick up the cup"},
        },
        timeout=5.0,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "created"
    assert body["project_id"] == proj["id"]


# ===== 7. GET /v1/sim/jobs =====
def test_list_sim_jobs_empty_then_with_one(
    user_id: str, headers: dict[str, str]
) -> None:
    proj = httpx.post(
        f"{BASE_URL}/v1/projects",
        headers=headers,
        json={"name": "ListSim", "slug": f"smoke-listsim-{user_id[:8]}"},
        timeout=5.0,
    ).json()
    r0 = httpx.get(
        f"{BASE_URL}/v1/sim/jobs",
        headers={**headers, "X-Project-Id": proj["id"]},
        timeout=5.0,
    )
    assert r0.status_code == 200
    assert r0.json() == []  # 空列表 OK

    httpx.post(
        f"{BASE_URL}/v1/sim/jobs",
        headers={**headers, "X-Project-Id": proj["id"]},
        json={"task_name": "t1", "engine": "mujoco", "num_episodes": 1, "task_spec": {}},
        timeout=5.0,
    )
    r1 = httpx.get(
        f"{BASE_URL}/v1/sim/jobs",
        headers={**headers, "X-Project-Id": proj["id"]},
        timeout=5.0,
    )
    assert len(r1.json()) == 1


# ===== 8. 错误路径: 缺 auth =====
def test_sim_job_requires_auth() -> None:
    r = httpx.post(
        f"{BASE_URL}/v1/sim/jobs",
        json={"task_name": "x", "engine": "isaac_sim"},
        timeout=5.0,
    )
    # Pydantic 校验 Header 必填 → 422
    assert r.status_code == 422, r.text


# ===== 9. 错误路径: engine 不合法 =====
def test_sim_job_invalid_engine(
    user_id: str, headers: dict[str, str]
) -> None:
    proj = httpx.post(
        f"{BASE_URL}/v1/projects",
        headers=headers,
        json={"name": "P", "slug": f"smoke-bad-{user_id[:8]}"},
        timeout=5.0,
    ).json()
    r = httpx.post(
        f"{BASE_URL}/v1/sim/jobs",
        headers={**headers, "X-Project-Id": proj["id"]},
        json={"task_name": "x", "engine": "DOES_NOT_EXIST"},
        timeout=5.0,
    )
    assert r.status_code == 422


# ===== 10. OpenAPI 端点数 =====
def test_openapi_has_5_plus_endpoints() -> None:
    r = httpx.get(f"{BASE_URL}/openapi.json", timeout=5.0)
    assert r.status_code == 200
    paths = r.json()["paths"]
    # 至少 5 业务端点: /health, /, /v1/projects (POST/GET), /v1/projects/{id} (GET),
    # /v1/sim/jobs (POST/GET) = 6+ 路径
    assert len(paths) >= 5, f"端点数 {len(paths)} < 5: {list(paths)}"


# ===== 11. xdd 跨业务线 BDD 场景: X-R01 认证 =====
@pytest.mark.parametrize(
    "missing_header",
    ["X-User-Id", "X-Project-Id"],
)
def test_x_r01_missing_header_rejected(
    missing_header: str, user_id: str
) -> None:
    """X-R01: 跨业务线认证 — 缺 X-User-Id 或 X-Project-Id 必拒绝.

    对应 Gherkin:
      Scenario: 跨业务线接口要求 X-User-Id + X-Project-Id 双 header
        Given 一个未认证请求 (缺 X-User-Id 或 X-Project-Id)
        When POST /v1/sim/jobs
        Then 返回 401 或 422
    """
    headers = {"Content-Type": "application/json"}
    if missing_header != "X-User-Id":
        headers["X-User-Id"] = user_id
    if missing_header != "X-Project-Id":
        headers["X-Project-Id"] = str(uuid.uuid4())
    r = httpx.post(
        f"{BASE_URL}/v1/sim/jobs",
        headers=headers,
        json={"task_name": "x", "engine": "isaac_sim"},
        timeout=5.0,
    )
    # 缺 header 时 FastAPI 返 422 (validation) — 视为拒绝
    assert r.status_code in (401, 422), f"缺 {missing_header} 应被拒绝, 实际 {r.status_code}"


# ===== 12. 文件系统: scaffold 产物 =====
def test_scaffold_files_exist() -> None:
    """验证 scaffold 7 步产物都到位 (文件系统层断言)."""
    root = Path(__file__).resolve().parents[2]
    must_exist = [
        "pyproject.toml",
        "README.md",
        ".gitignore",
        ".env.example",
        "pytest.ini",
        "docker-compose.yml",
        "docker-compose.test.yml",
        "docker-compose.dev.yml",
        "apps/sim-svc/alembic.ini",
        "apps/sim-svc/src/vla/sim/main.py",
        "apps/sim-svc/Dockerfile",
        "apps/coll-svc/migrations/versions/002_init_collection.py",
        "apps/train-svc/migrations/versions/003_init_training.py",
        "apps/eval-svc/migrations/versions/004_init_evaluation.py",
        "apps/pipe-svc/migrations/versions/005_init_pipeline.py",
        "apps/audit-svc/migrations/versions/006_init_audit.py",
        "apps/audit-svc/migrations/versions/007_rls_policies.py",
        "libs/vla-common/vla_common/errors.py",
        "libs/vla-db/vla_db/session.py",
        "tests/unit/test_env.py",
        "infra/docker/prometheus/prometheus.yml",
        "infra/docker/kong.yml",
        "infra/migrations/initdb/01-extensions.sh",
    ]
    missing = [p for p in must_exist if not (root / p).exists()]
    assert not missing, f"scaffold 缺失文件: {missing}"
