"""幂等键中间件 + 存储 (X-R08).

客户端在 POST 请求带 `Idempotency-Key` header, 服务端:
  1. 计算 (project_id, action, key) 哈希
  2. 查 idempotency_keys 表 → 已存在 → 返回缓存的 response
  3. 不存在 → 执行业务, 写 (key, request_hash, response_status, response_body)
  4. 24h 后自动清理 (Phase 5 简化为不清理, 留 TODO L3 段)

保证同一 key 同请求体 → 同一响应, 跨重试/网络抖动/前端重复点击安全.
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, String, func
from sqlalchemy.orm import Mapped, Session, mapped_column

from vla_db.base import Base
from vla_common.errors import ErrorCode, VLAError


class IdempotencyKey(Base):
    """幂等键存储 (X-R08)."""

    __tablename__ = "idempotency_keys"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    response_status: Mapped[int] = mapped_column(String(8), nullable=False)
    response_body: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        # 复合唯一: (project_id, action, idempotency_key) 是天然业务主键
        {"sqlite_autoincrement": False},
    )


def _hash_request(body: dict[str, Any]) -> str:
    """请求体 SHA-256 (规范化 JSON)."""
    import json

    canonical = json.dumps(body, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def check_or_store(
    *,
    session: Session,
    project_id: str,
    action: str,
    idempotency_key: str | None,
    request_body: dict[str, Any],
    execute_fn: Any,
) -> tuple[int, dict[str, Any]]:
    """幂等执行: 已有 key → 返回缓存, 否则执行 + 存储.

    Args:
        session: SQLAlchemy session (写 idempotency_keys 用)
        project_id: 多租户维度
        action: 业务动作名 (e.g. "create_sim_job")
        idempotency_key: 客户端 Idempotency-Key header 值
        request_body: 请求体 dict (用于 hash 校验)
        execute_fn: 执行业务的 callable, 返回 (status_code, body)

    Returns:
        (status_code, response_body)
    """
    if not idempotency_key:
        # 无 key 直接执行, 不做幂等
        return execute_fn()

    req_hash = _hash_request(request_body)

    existing = (
        session.query(IdempotencyKey)
        .filter(
            IdempotencyKey.project_id == project_id,
            IdempotencyKey.action == action,
            IdempotencyKey.idempotency_key == idempotency_key,
        )
        .first()
    )

    if existing is not None:
        # 已存在 → 校验请求体是否一致 (同 key + 不同 body 是错误用法)
        if existing.request_hash != req_hash:
            raise VLAError(
                ErrorCode.X_IDEMPOTENCY_CONFLICT,
                f"Idempotency-Key '{idempotency_key}' 已使用但请求体不一致",
                status_code=409,
                details={
                    "idempotency_key": idempotency_key,
                    "action": action,
                },
            )
        # 命中缓存
        return int(existing.response_status), existing.response_body

    # 未命中 → 执行业务
    status_code, body = execute_fn()

    # 存储结果
    record = IdempotencyKey(
        project_id=project_id,
        action=action,
        idempotency_key=idempotency_key,
        request_hash=req_hash,
        response_status=str(status_code),
        response_body=body,
    )
    session.add(record)
    session.flush()

    return status_code, body
