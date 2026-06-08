"""API Gateway — 简化为 Kong 兼容路由 + 限流 + 认证 stub.

Phase 5 简化: 1 个 FastAPI app 监听 :18000, 按 path 前缀路由到 sim/coll/train/eval/pipe/audit.
生产环境: Kong / Envoy + Service Mesh (Istio).
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import Depends, FastAPI, Header, Request, status
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

# Scaffold: SQLite 模式
if os.getenv("DATABASE_URL") is None and os.getenv("VLA_SCAFFOLD_SQLITE", "1") == "1":
    os.environ["DATABASE_URL"] = "sqlite:///:memory:"

from vla_common.errors import ErrorCode, VLAError
from vla_common.middleware import RLSSessionMiddleware, VLAErrorHandlerMiddleware


# === 后端服务 URL (生产走 K8s Service DNS) ===
SVC_URLS = {
    "sim": os.getenv("VLA_SIM_URL", "http://127.0.0.1:18001"),
    "coll": os.getenv("VLA_COLL_URL", "http://127.0.0.1:18002"),
    "train": os.getenv("VLA_TRAIN_URL", "http://127.0.0.1:18003"),
    "eval": os.getenv("VLA_EVAL_URL", "http://127.0.0.1:18004"),
    "pipe": os.getenv("VLA_PIPE_URL", "http://127.0.0.1:18005"),
    "audit": os.getenv("VLA_AUDIT_URL", "http://127.0.0.1:18006"),
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(
    title="VLA API Gateway",
    version="0.1.0",
    description="Kong 兼容路由 (Phase 5 简化: in-process proxy)",
    lifespan=lifespan,
)
app.add_middleware(VLAErrorHandlerMiddleware)
app.add_middleware(RLSSessionMiddleware)


# === 限流 (token bucket, 100 QPS/角色, in-memory) ===
import asyncio
import time
from collections import defaultdict

_token_buckets: dict[str, tuple[float, float]] = defaultdict(lambda: (100.0, time.time()))
_rate_lock = asyncio.Lock()


async def rate_limit_check(role: str) -> None:
    """100 QPS/角色 (per X-R10.2 / arch §11.4)."""
    async with _rate_lock:
        tokens, last_refill = _token_buckets[role]
        now = time.time()
        elapsed = now - last_refill
        tokens = min(100.0, tokens + elapsed * 100.0)
        if tokens < 1.0:
            raise VLAError(
                ErrorCode.X_RATE_LIMITED,
                f"角色 '{role}' 触发限流 (100 QPS 上限)",
                status_code=429,
                details={"role": role, "limit_qps": 100},
            )
        tokens -= 1.0
        _token_buckets[role] = (tokens, now)


# === Auth (X-R03): 验证 X-User-Id + X-User-Role 必填 ===
async def require_auth(
    x_user_id: str = Header(None, alias="X-User-Id"),
    x_user_role: str = Header(None, alias="X-User-Role"),
) -> tuple[str, str]:
    if not x_user_id:
        raise VLAError(
            ErrorCode.X_AUTH_MISSING_API_KEY, "X-User-Id header required", status_code=401
        )
    if not x_user_role:
        raise VLAError(
            ErrorCode.X_AUTH_MISSING_API_KEY, "X-User-Role header required", status_code=401
        )
    await rate_limit_check(x_user_role)
    return x_user_id, x_user_role


# === 代理 (proxy) ===
@app.api_route(
    "/api/{svc}/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
)
async def proxy(
    svc: str,
    path: str,
    request: Request,
    auth: tuple[str, str] = Depends(require_auth),
) -> Response:
    """代理 /api/{svc}/{path} → SVC_URLS[svc] + path.

    保留 X-User-Id / X-User-Role / X-Project-Id / X-Request-Id / Idempotency-Key 头.
    """
    if svc not in SVC_URLS:
        raise VLAError(
            ErrorCode.X_RESOURCE_NOT_FOUND,
            f"未知 service '{svc}', 已知: {list(SVC_URLS.keys())}",
            status_code=404,
        )

    user_id, role = auth
    target = f"{SVC_URLS[svc]}/v1/{path}"
    # 透传必要 headers
    forward_headers = {
        k: v
        for k, v in request.headers.items()
        if k.lower()
        in (
            "x-user-id",
            "x-user-role",
            "x-project-id",
            "x-admin",
            "x-request-id",
            "idempotency-key",
            "content-type",
            "accept",
        )
    }

    body = await request.body()
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.request(
                method=request.method,
                url=target,
                headers=forward_headers,
                content=body,
            )
        except httpx.ConnectError as e:
            raise VLAError(
                ErrorCode.X_INTERNAL_ERROR,
                f"后端 {svc} 不可达: {e}",
                status_code=503,
                details={"svc": svc, "target": target},
            )
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        headers={k: v for k, v in resp.headers.items() if k.lower() not in ("transfer-encoding",)},
    )


# === Health / Ready ===
@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "vla-api-gateway"}


@app.get("/ready")
def ready() -> dict[str, Any]:
    """ready: 验证各后端可达 (Phase 5 简化: 静态, Phase 6 加 health 探测)."""
    return {"status": "ok", "backends": list(SVC_URLS.keys())}


@app.get("/")
def root() -> dict[str, str]:
    return {
        "service": "vla-api-gateway",
        "version": "0.1.0",
        "phase": "5-execute",
        "routes": [f"/api/{s}/* → {u}" for s, u in SVC_URLS.items()],
        "docs": "/docs",
    }
