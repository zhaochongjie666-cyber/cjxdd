"""L3 韧性: 通用 retry + circuit breaker + saga 补偿框架 (Task 81).

实现 .xdd/L3-resilience/failsafe-design.md §1 12 模式中的:
  1. 通用 retry (3 次指数退避)
  2. Circuit Breaker (CLOSED / OPEN / HALF_OPEN)

Phase 5 简化版, 业务调用方:
  retry_with_backoff(fn, max_attempts=3) → result
  CircuitBreaker(failure_threshold=5, reset_timeout=60) → call_with_breaker
"""
from __future__ import annotations

import asyncio
import logging
import random
import time
from collections.abc import Awaitable, Callable
from enum import Enum
from typing import Any, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")


def retry_with_backoff(
    fn: Callable[..., Awaitable[T]],
    *,
    max_attempts: int = 3,
    base_delay_s: float = 0.1,
    max_delay_s: float = 5.0,
    exceptions: tuple[type[Exception], ...] = (Exception,),
    jitter: bool = True,
) -> Awaitable[T]:
    """通用 retry: 指数退避 + 抖动. 失败 max_attempts 次后抛最后异常.

    使用:
      result = await retry_with_backoff(my_async_fn, max_attempts=3)
    """
    async def _run() -> T:
        last_exc: Exception | None = None
        for attempt in range(1, max_attempts + 1):
            try:
                return await fn()
            except exceptions as e:
                last_exc = e
                if attempt >= max_attempts:
                    logger.error("retry exhausted after %d attempts: %s", attempt, e)
                    raise
                delay = min(base_delay_s * (2 ** (attempt - 1)), max_delay_s)
                if jitter:
                    delay = delay * (0.5 + random.random())
                logger.warning(
                    "retry attempt %d/%d failed: %s, sleeping %.2fs",
                    attempt,
                    max_attempts,
                    e,
                    delay,
                )
                await asyncio.sleep(delay)
        # 不可达, 防御性
        assert last_exc is not None
        raise last_exc

    return _run()


# === Circuit Breaker ===
class CircuitState(str, Enum):
    CLOSED = "closed"  # 正常
    OPEN = "open"  # 熔断
    HALF_OPEN = "half_open"  # 半开 (试探)


class CircuitBreakerOpen(Exception):
    """Circuit 熔断, 请求被拒."""


class CircuitBreaker:
    """Circuit Breaker — 失败阈值触发熔断, reset_timeout 后半开试探."""

    def __init__(
        self,
        *,
        name: str = "default",
        failure_threshold: int = 5,
        reset_timeout_s: float = 60.0,
        half_open_max_calls: int = 1,
    ) -> None:
        self.name = name
        self.failure_threshold = failure_threshold
        self.reset_timeout_s = reset_timeout_s
        self.half_open_max_calls = half_open_max_calls
        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._opened_at: float | None = None
        self._half_open_calls = 0

    @property
    def state(self) -> CircuitState:
        if self._state == CircuitState.OPEN and self._opened_at is not None:
            if time.time() - self._opened_at >= self.reset_timeout_s:
                # 切到半开
                self._state = CircuitState.HALF_OPEN
                self._half_open_calls = 0
        return self._state

    async def call(self, fn: Callable[..., Awaitable[T]]) -> T:
        state = self.state
        if state == CircuitState.OPEN:
            raise CircuitBreakerOpen(
                f"circuit '{self.name}' is OPEN, request rejected"
            )
        if state == CircuitState.HALF_OPEN:
            if self._half_open_calls >= self.half_open_max_calls:
                raise CircuitBreakerOpen(
                    f"circuit '{self.name}' HALF_OPEN quota exhausted"
                )
            self._half_open_calls += 1

        try:
            result = await fn()
        except Exception:
            self._on_failure()
            raise
        else:
            self._on_success()
            return result

    def _on_failure(self) -> None:
        self._failure_count += 1
        if self._state == CircuitState.HALF_OPEN:
            # 半开失败 → 重新打开
            self._state = CircuitState.OPEN
            self._opened_at = time.time()
            logger.warning("circuit '%s' HALF_OPEN → OPEN", self.name)
        elif self._failure_count >= self.failure_threshold:
            self._state = CircuitState.OPEN
            self._opened_at = time.time()
            logger.warning(
                "circuit '%s' → OPEN (failures=%d)",
                self.name,
                self._failure_count,
            )

    def _on_success(self) -> None:
        if self._state == CircuitState.HALF_OPEN:
            self._state = CircuitState.CLOSED
            self._failure_count = 0
            self._half_open_calls = 0
            logger.info("circuit '%s' HALF_OPEN → CLOSED (recovered)", self.name)
        elif self._state == CircuitState.CLOSED:
            self._failure_count = 0

    def reset(self) -> None:
        """测试用: 强制重置."""
        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._opened_at = None
        self._half_open_calls = 0


# === 全局 CB 池 (按 name 索引) ===
_circuit_breakers: dict[str, CircuitBreaker] = {}


def get_circuit_breaker(
    name: str,
    *,
    failure_threshold: int = 5,
    reset_timeout_s: float = 60.0,
) -> CircuitBreaker:
    """获取或创建 CB."""
    if name not in _circuit_breakers:
        _circuit_breakers[name] = CircuitBreaker(
            name=name,
            failure_threshold=failure_threshold,
            reset_timeout_s=reset_timeout_s,
        )
    return _circuit_breakers[name]


def reset_all_circuits() -> None:
    """测试用."""
    _circuit_breakers.clear()
