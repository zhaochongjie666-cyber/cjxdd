"""FastAPI 中间件: RLS session var + 错误处理 + 请求 ID.

X-R01 (API Key 认证) + X-R03 (RLS 多租户) + X-R10 (审计) 的统一入口.
"""
from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from contextvars import ContextVar
from typing import Any

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from vla_common.errors import VLAError

# 上下文变量: RLS session var 透传到 SQLAlchemy session
current_user_id: ContextVar[str | None] = ContextVar("current_user_id", default=None)
current_project_id: ContextVar[str | None] = ContextVar("current_project_id", default=None)
is_admin: ContextVar[bool] = ContextVar("is_admin", default=False)
current_request_id: ContextVar[str | None] = ContextVar("current_request_id", default=None)


class RLSSessionMiddleware(BaseHTTPMiddleware):
    """从 X-Project-Id 头读 project_id, 注入到 PG session var.

    调用方在处理请求时通过 contextvar 拿值, 通过 SQLAlchemy event 设置 PG session var.
    """

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        request_id = request.headers.get("X-Request-Id") or str(uuid.uuid4())
        current_request_id.set(request_id)

        # X-Project-Id: 多租户隔离 (B01-B04 + Pipe 所有写入)
        project_id = request.headers.get("X-Project-Id")
        if project_id:
            current_project_id.set(project_id)

        # X-User-Id: 当前用户 (审计 + 用户 RLS)
        user_id = request.headers.get("X-User-Id")
        if user_id:
            current_user_id.set(user_id)

        # X-Admin: admin bypass RLS
        if request.headers.get("X-Admin") == "true":
            is_admin.set(True)

        response = await call_next(request)
        response.headers["X-Request-Id"] = request_id
        return response


class VLAErrorHandlerMiddleware(BaseHTTPMiddleware):
    """统一错误处理: VLAError → ErrorResponse JSON, 其他异常 → 500."""

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        try:
            return await call_next(request)
        except VLAError as e:
            return _error_response(e, request)
        except Exception as e:  # noqa: BLE001
            # 兜底
            from vla_common.errors import ErrorCode

            return JSONResponse(
                status_code=500,
                content={
                    "code": ErrorCode.X_INTERNAL_ERROR,
                    "message": f"内部错误: {type(e).__name__}",
                    "request_id": current_request_id.get(),
                },
            )


def _error_response(e: VLAError, request: Request) -> JSONResponse:
    return JSONResponse(
        status_code=e.status_code,
        content={
            "code": e.code,
            "message": e.message,
            "details": e.details,
            "request_id": current_request_id.get(),
        },
    )
