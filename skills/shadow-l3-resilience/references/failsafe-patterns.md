# 10 个兜底设计模式（实现指南）

> L3 failsafe-design.md 模板的详细参考。每个模式包含：原理、配置参数、Python 实现骨架、单元测试要点、典型组合。

## 模式 1: 熔断 (Circuit Breaker)

**原理**: 当下游服务持续失败时，快速失败避免雪崩；故障消除后自动恢复。

**状态机**:
```
CLOSED ─[N 次失败/单位时间]→ OPEN ─[M 秒后]→ HALF_OPEN ─[K 次成功]→ CLOSED
  │                            │                  │
  └─[正常调用]──────────────────┘                  └─[K 次失败]→ OPEN
```

**配置参数**:
| 参数 | 默认值 | 含义 |
|------|--------|------|
| `failure_threshold` | 5 | 触发 OPEN 的失败次数 |
| `success_threshold` | 3 | HALF_OPEN → CLOSED 需要的成功次数 |
| `timeout` | 60s | OPEN → HALF_OPEN 等待时间 |
| `excluded_exceptions` | [] | 不计入失败的异常（如业务 4xx）|

**Python 实现骨架** (`infra/http/circuit_breaker.py`):
```python
import time
from enum import Enum
from threading import Lock
from typing import Callable, TypeVar, ParamSpec

P = ParamSpec("P")
T = TypeVar("T")

class State(str, Enum):
    CLOSED = "CLOSED"
    OPEN = "OPEN"
    HALF_OPEN = "HALF_OPEN"

class CircuitBreakerOpenError(Exception):
    """Raised when circuit is OPEN and a call is attempted."""

class CircuitBreaker:
    def __init__(
        self,
        name: str,
        failure_threshold: int = 5,
        success_threshold: int = 3,
        timeout: float = 60.0,
    ):
        self.name = name
        self.failure_threshold = failure_threshold
        self.success_threshold = success_threshold
        self.timeout = timeout
        self._state = State.CLOSED
        self._failure_count = 0
        self._success_count = 0
        self._opened_at = 0.0
        self._lock = Lock()
    
    @property
    def state(self) -> State:
        with self._lock:
            if self._state == State.OPEN and time.monotonic() - self._opened_at >= self.timeout:
                self._state = State.HALF_OPEN
                self._success_count = 0
            return self._state
    
    def call(self, fn: Callable[P, T], *args: P.args, **kwargs: P.kwargs) -> T:
        state = self.state
        if state == State.OPEN:
            raise CircuitBreakerOpenError(f"{self.name} is OPEN")
        
        try:
            result = fn(*args, **kwargs)
        except Exception:
            self._on_failure()
            raise
        else:
            self._on_success()
            return result
    
    def _on_failure(self):
        with self._lock:
            self._failure_count += 1
            if self._state == State.HALF_OPEN or self._failure_count >= self.failure_threshold:
                self._state = State.OPEN
                self._opened_at = time.monotonic()
                self._success_count = 0
    
    def _on_success(self):
        with self._lock:
            self._failure_count = 0
            if self._state == State.HALF_OPEN:
                self._success_count += 1
                if self._success_count >= self.success_threshold:
                    self._state = State.CLOSED
                    self._success_count = 0
```

**单元测试** (必须):
- ✅ CLOSED 状态正常调用
- ✅ 连续 N 次失败 → OPEN
- ✅ OPEN 状态调用立即抛 CircuitBreakerOpenError
- ✅ OPEN 等待 timeout → HALF_OPEN
- ✅ HALF_OPEN 累计 K 次成功 → CLOSED
- ✅ HALF_OPEN 单次失败 → 立即 OPEN
- ✅ 多线程并发安全

**典型组合**:
- 熔断 + 降级（FS11-a + FS11-b）
- 熔断 + 重试（熔断 OPEN 后停止重试）
- 熔断 + 监控（暴露 state 指标）

---

## 模式 2: 降级 (Degradation)

**原理**: 核心链路保留，非核心功能砍掉或返回缓存，保证核心业务可用。

**降级触发**:
- 熔断器 OPEN
- 资源压力（CPU > 90%, 内存 > 90%）
- 手动启用（运营活动时主动降级非核心）

**降级策略**:
- **功能降级**: 返回 mock 数据 + 标记 degraded
- **数据降级**: 返回缓存的上次成功结果
- **链路降级**: 跳过非关键步骤（如不发通知）
- **优雅降级**: UI 显示降级提示

**Python 实现骨架** (`domain/services/degraded.py`):
```python
from contextlib import contextmanager
from typing import Callable, TypeVar
import logging

T = TypeVar("T")
log = logging.getLogger(__name__)

class DegradationActive(Exception):
    """Raised when degradation is active and a non-core call is attempted."""

class DegradationManager:
    def __init__(self):
        self._active_modes: set[str] = set()
    
    def enable(self, mode: str) -> None:
        log.warning(f"degradation enabled: {mode}")
        self._active_modes.add(mode)
    
    def disable(self, mode: str) -> None:
        log.info(f"degradation disabled: {mode}")
        self._active_modes.discard(mode)
    
    def is_active(self, mode: str = "default") -> bool:
        return mode in self._active_modes or "all" in self._active_modes

# Singleton
degradation = DegradationManager()

def degrade_to(mock_value: T, mode: str = "default") -> T:
    """Decorator: when degradation is active, return mock value."""
    def decorator(fn: Callable[..., T]) -> Callable[..., T]:
        def wrapper(*args, **kwargs) -> T:
            if degradation.is_active(mode):
                log.info(f"{fn.__name__} degraded to mock")
                return mock_value
            return fn(*args, **kwargs)
        return wrapper
    return decorator

@contextmanager
def degradation_mode(mode: str):
    """Context manager: temporarily enable degradation."""
    degradation.enable(mode)
    try:
        yield
    finally:
        degradation.disable(mode)
```

**单元测试** (必须):
- ✅ 默认状态（降级未启用）调用原函数
- ✅ 启用降级后返回 mock 值
- ✅ 多模式隔离（mode A 启用不影响 mode B）
- ✅ 临时降级（context manager 退出后恢复）

**典型组合**:
- 降级 + 缓存（FS61-c：用上次结果作为降级数据）
- 降级 + 监控（暴露降级率）
- 降级 + UI 提示（前端展示降级状态）

---

## 模式 3: 补偿 (Compensation / Saga)

**原理**: 跨聚合事务失败时，通过反向操作回滚已成功的步骤。

**适用场景**:
- 订单 + 库存 + 支付的分布式事务
- 多步骤业务流程任一步失败需回滚

**实现模式**:
- **Orchestration**: 中心化协调器（推荐）
- **Choreography**: 事件驱动（适合松耦合）

**Python 实现骨架** (`domain/sagas/saga_orchestrator.py`):
```python
from dataclasses import dataclass
from typing import Callable, Awaitable

@dataclass
class SagaStep:
    name: str
    action: Callable[[], Awaitable[None]]
    compensation: Callable[[], Awaitable[None]]

class Saga:
    def __init__(self, steps: list[SagaStep]):
        self.steps = steps
    
    async def execute(self) -> None:
        executed: list[SagaStep] = []
        try:
            for step in self.steps:
                await step.action()
                executed.append(step)
        except Exception as e:
            # 反向补偿
            for step in reversed(executed):
                try:
                    await step.compensation()
                except Exception as comp_err:
                    log.error(f"compensation failed for {step.name}: {comp_err}")
            raise SagaRollbackError(f"saga failed at {executed[-1].name if executed else 'first'}: {e}")

# 使用示例
async def place_order_saga():
    return Saga(steps=[
        SagaStep(
            name="create_order",
            action=order_service.create,
            compensation=order_service.cancel,
        ),
        SagaStep(
            name="reserve_inventory",
            action=inventory_service.reserve,
            compensation=inventory_service.release,
        ),
        SagaStep(
            name="charge_payment",
            action=payment_service.charge,
            compensation=payment_service.refund,
        ),
    ])
```

**单元测试** (必须):
- ✅ 全部成功路径
- ✅ 中间步骤失败 → 触发反向补偿
- ✅ 补偿失败 → 记录错误但不抛
- ✅ 步骤顺序保证（先执行后补偿）

**典型组合**:
- 补偿 + 事件（每步发布事件，事件订阅者执行补偿）
- 补偿 + 超时（补偿也有 timeout）

---

## 模式 4: 重试 (Retry with Backoff)

**原理**: 瞬时失败时自动重试，指数退避避免雪崩。

**配置参数**:
| 参数 | 默认值 | 含义 |
|------|--------|------|
| `max_retries` | 3 | 最大重试次数 |
| `initial_delay` | 1.0s | 第一次重试延迟 |
| `max_delay` | 30.0s | 单次重试最大延迟 |
| `backoff_factor` | 2.0 | 退避倍数 |
| `jitter` | 0.1 | 抖动比例（避免同步）|

**Python 实现骨架** (`infra/http/idempotent_retry.py`):
```python
import asyncio
import random
from typing import Callable, Awaitable, TypeVar

T = TypeVar("T")

class RetryExhausted(Exception):
    """Raised when all retries are exhausted."""

async def retry_with_backoff(
    fn: Callable[[], Awaitable[T]],
    *,
    max_retries: int = 3,
    initial_delay: float = 1.0,
    max_delay: float = 30.0,
    backoff_factor: float = 2.0,
    jitter: float = 0.1,
    retryable_exceptions: tuple = (Exception,),
) -> T:
    last_exception = None
    for attempt in range(max_retries + 1):
        try:
            return await fn()
        except retryable_exceptions as e:
            last_exception = e
            if attempt == max_retries:
                break
            delay = min(initial_delay * (backoff_factor ** attempt), max_delay)
            delay += delay * jitter * (random.random() * 2 - 1)  # ±jitter
            await asyncio.sleep(delay)
    raise RetryExhausted(f"retries exhausted after {max_retries + 1} attempts") from last_exception
```

**单元测试** (必须):
- ✅ 第一次成功 → 直接返回
- ✅ 失败后重试 → 第 N 次成功
- ✅ 全部失败 → 抛 RetryExhausted
- ✅ 退避时间正确（jitter 在范围内）
- ✅ 非 retryable 异常立即抛（不重试）

**典型组合**:
- 重试 + 熔断（熔断 OPEN 后停止重试）
- 重试 + 幂等键（保证重试不产生副作用）

---

## 模式 5: 限流 (Rate Limit)

**原理**: 限制单位时间内的请求数，保护下游不被冲垮。

**算法**:
- **Token Bucket**: 平滑突发
- **Leaky Bucket**: 强制平滑
- **Sliding Window**: 精确控制
- **Fixed Window**: 简单但不精确

**Python 实现骨架** (`infra/middleware/rate_limit.py`):
```python
import asyncio
import time
from collections import deque

class RateLimiter:
    """Token bucket rate limiter."""
    
    def __init__(self, rate: float, capacity: int):
        """rate: tokens per second; capacity: max burst."""
        self.rate = rate
        self.capacity = capacity
        self._tokens = capacity
        self._last_refill = time.monotonic()
        self._lock = asyncio.Lock()
    
    async def acquire(self, tokens: int = 1) -> bool:
        async with self._lock:
            now = time.monotonic()
            elapsed = now - self._last_refill
            self._tokens = min(self.capacity, self._tokens + elapsed * self.rate)
            self._last_refill = now
            
            if self._tokens >= tokens:
                self._tokens -= tokens
                return True
            return False
```

**配置示例**:
```yaml
rate_limit:
  per_ip: 100  # 100 QPS per IP
  per_user: 10  # 10 QPS per user
  global: 10000  # 10000 QPS total
  burst_multiplier: 1.5
```

**单元测试** (必须):
- ✅ 正常调用
- ✅ 超过容量拒绝
- ✅ 时间推移后桶补充
- ✅ 并发安全（多协程同时 acquire）

**典型组合**:
- 限流 + 监控（暴露拒绝率）
- 限流 + 熔断（被限流的请求不计为失败）
- 限流 + 削峰（限流 + 优先级队列）

---

## 模式 6: 背压 (Backpressure)

**原理**: 上下游速度不匹配时，下游告诉上游"慢点发"。

**实现方式**:
- **同步**: 下游用 flow control（TCP 窗口）
- **异步**: 队列长度超过阈值时 producer 限速
- **响应式**: Reactive Streams (RxPy)

**Python 实现骨架** (`infra/queue/backpressure.py`):
```python
import asyncio
from typing import Generic, TypeVar

T = TypeVar("T")

class BackpressureQueue(Generic[T]):
    """Queue with backpressure: producer blocks when consumer is slow."""
    
    def __init__(self, max_size: int, high_watermark: int = None):
        self._queue: asyncio.Queue[T] = asyncio.Queue(maxsize=max_size)
        self._high_watermark = high_watermark or max_size // 2
        self._paused = asyncio.Event()
        self._paused.set()  # Initially not paused
    
    @property
    def is_paused(self) -> bool:
        return not self._paused.is_set()
    
    @property
    def size(self) -> int:
        return self._queue.qsize()
    
    async def put(self, item: T) -> None:
        await self._paused.wait()  # Wait if paused
        await self._queue.put(item)
        if self._queue.qsize() >= self._high_watermark:
            self._paused.clear()  # Pause producers
    
    async def get(self) -> T:
        item = await self._queue.get()
        if self._queue.qsize() < self._high_watermark:
            self._paused.set()  # Resume producers
        return item
```

**单元测试** (必须):
- ✅ 正常生产/消费
- ✅ 队列满时生产者阻塞
- ✅ 消费后生产者恢复
- ✅ 高水位/低水位正确触发

**典型组合**:
- 背压 + 限流（背压 + 入口限流双重保护）
- 背压 + 监控（暴露队列深度）

---

## 模式 7: 隔离 (Bulkhead)

**原理**: 把不同业务的资源池分开，故障不传染。

**实现方式**:
- **线程池隔离**: 不同业务用不同线程池
- **连接池隔离**: 不同业务用不同 DB 连接池
- **进程隔离**: 不同业务用不同进程

**Python 实现骨架** (`infra/pools/bulkhead.py`):
```python
import asyncio
from contextlib import asynccontextmanager
from typing import AsyncIterator

class BulkheadPool:
    """Isolated resource pool: failures in one don't affect others."""
    
    def __init__(self, name: str, max_size: int):
        self.name = name
        self._semaphore = asyncio.Semaphore(max_size)
        self._in_use = 0
        self._max_size = max_size
    
    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[None]:
        acquired = await self._semaphore.acquire()
        if not acquired:
            raise BulkheadFull(f"{self.name} bulkhead full (max={self._max_size})")
        self._in_use += 1
        try:
            yield
        finally:
            self._in_use -= 1
            self._semaphore.release()

# 使用示例
db_pool_critical = BulkheadPool("db-critical", max_size=10)
db_pool_analytics = BulkheadPool("db-analytics", max_size=5)

async def query_critical():
    async with db_pool_critical.acquire():
        return await db.execute("SELECT ...")

async def query_analytics():
    async with db_pool_analytics.acquire():
        return await db.execute("SELECT ...")
```

**单元测试** (必须):
- ✅ 正常获取/释放
- ✅ 超过 max_size 拒绝
- ✅ 一个池满不影响另一个

**典型组合**:
- 隔离 + 限流（隔离池内再做限流）
- 隔离 + 监控（暴露各池使用率）

---

## 模式 8: 幂等 (Idempotency)

**原理**: 同一操作执行多次与执行一次效果相同。

**实现方式**:
- **业务幂等**: 业务逻辑天然幂等（SET 而非 INCR）
- **唯一键去重**: 客户端传 Idempotency-Key，服务端缓存结果
- **数据库约束**: 利用唯一索引（重复插入报错）

**Python 实现骨架** (`domain/decorators/idempotent.py`):
```python
import functools
import hashlib
import json
from typing import Callable, Awaitable
import redis.asyncio as redis

class IdempotencyStore:
    def __init__(self, redis_client: redis.Redis, ttl: int = 86400):
        self.redis = redis_client
        self.ttl = ttl
    
    async def get_or_set(self, key: str, fn: Callable[[], Awaitable[dict]]) -> dict:
        cached = await self.redis.get(f"idempotency:{key}")
        if cached:
            return json.loads(cached)
        result = await fn()
        await self.redis.setex(f"idempotency:{key}", self.ttl, json.dumps(result))
        return result

def idempotent(store: IdempotencyStore, key_fn: Callable[..., str]):
    """Decorator: dedupe based on key derived from arguments."""
    def decorator(fn: Callable[..., Awaitable[dict]]):
        @functools.wraps(fn)
        async def wrapper(*args, **kwargs) -> dict:
            key = key_fn(*args, **kwargs)
            return await store.get_or_set(key, lambda: fn(*args, **kwargs))
        return wrapper
    return decorator

# 使用示例
@idempotent(store, key_fn=lambda **kw: kw.get("idempotency_key", ""))
async def create_order(order_data: dict, idempotency_key: str) -> dict:
    return await order_service.create(order_data)
```

**单元测试** (必须):
- ✅ 第一次执行，缓存结果
- ✅ 重复 key 直接返回缓存
- ✅ TTL 过期后重新执行
- ✅ 不同 key 独立缓存

**典型组合**:
- 幂等 + 重试（重试不会产生副作用）
- 幂等 + 分布式锁（同一 key 加锁执行）

---

## 模式 9: 超时 (Timeout)

**原理**: 任何远程调用都设上限，避免无限等待。

**配置参数**:
- `connect_timeout`: 建立连接的超时
- `read_timeout`: 读取响应的超时
- `total_timeout`: 整个请求的总超时

**Python 实现骨架** (`infra/http/timeout.py`):
```python
import asyncio
from typing import Callable, Awaitable, TypeVar

T = TypeVar("T")

class TimeoutError(Exception):
    pass

async def with_timeout(
    fn: Callable[[], Awaitable[T]],
    timeout: float,
    error_message: str = "operation timed out",
) -> T:
    try:
        return await asyncio.wait_for(fn(), timeout=timeout)
    except asyncio.TimeoutError as e:
        raise TimeoutError(f"{error_message} (>{timeout}s)") from e
```

**单元测试** (必须):
- ✅ 正常完成
- ✅ 超时抛 TimeoutError
- ✅ 取消传播（asyncio.CancelledError）

**典型组合**:
- 超时 + 重试（超时算失败，触发重试）
- 超时 + 熔断（超时计入熔断器失败）
- 超时 + 降级（超时触发降级）

---

## 模式 10: 健康检查 (Health Check)

**原理**: 应用层自我感知健康状态，被基础设施摘除或重启。

**健康检查类型**:
- **Liveness**: 进程是否活着（失败 → 重启）
- **Readiness**: 进程是否准备好接流量（失败 → 摘除）
- **Startup**: 启动过程是否完成

**Python 实现骨架** (`app/api/routes/health.py`):
```python
from fastapi import APIRouter, Response
import asyncio
import time

router = APIRouter()

@router.get("/health/live")
async def liveness():
    """Liveness: just confirm process is alive."""
    return {"status": "alive"}

@router.get("/health/ready")
async def readiness(response: Response):
    """Readiness: check all critical dependencies."""
    checks = await asyncio.gather(
        check_db(),
        check_redis(),
        check_nomad(),
        return_exceptions=True,
    )
    failed = [name for name, ok in checks if not ok]
    if failed:
        response.status_code = 503
        return {"status": "unready", "failed": failed}
    return {"status": "ready", "checks": dict(checks)}

async def check_db() -> tuple[str, bool]:
    try:
        await db.execute("SELECT 1")
        return ("db", True)
    except Exception:
        return ("db", False)
```

**单元测试** (必须):
- ✅ 所有依赖健康 → 200
- ✅ 任一依赖不健康 → 503
- ✅ 健康检查自身超时可控

**典型组合**:
- 健康检查 + 摘除（k8s readinessProbe）
- 健康检查 + 告警（连续 3 次失败触发告警）

---

## 模式组合矩阵

| 兜底 | 熔断 | 降级 | 补偿 | 重试 | 限流 | 背压 | 隔离 | 幂等 | 超时 | 健康检查 |
|------|------|------|------|------|------|------|------|------|------|---------|
| 熔断 | — | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| 降级 | ✅ | — | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| 补偿 | ❌ | ❌ | — | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| 重试 | ✅ | ❌ | ❌ | — | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| 限流 | ❌ | ✅ | ❌ | ❌ | — | ✅ | ✅ | ❌ | ❌ | ❌ |
| 背压 | ❌ | ❌ | ❌ | ❌ | ✅ | — | ❌ | ❌ | ❌ | ❌ |
| 隔离 | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | — | ❌ | ❌ | ❌ |
| 幂等 | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | — | ❌ | ❌ |
| 超时 | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | — | ❌ |
| 健康检查 | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | — |

**符号说明**:
- ✅ 经常组合使用
- ❌ 不组合（语义重复或冲突）

**推荐组合**（防御深度）:
1. **网络层兜底**: 熔断 + 降级 + 重试 + 超时 + 幂等
2. **资源层兜底**: 限流 + 隔离 + 健康检查
3. **事件层兜底**: 背压 + 重试 + 幂等
4. **数据层兜底**: 重试 + 补偿 + 超时

---

## 模式 11: 业务对账 (Reconciliation) — L 规模扩展

**原理**: 跨系统/跨服务的业务状态, 最终通过**定期跑批对账**保证一致性。对账是**事后兜底**, 不同于技术兜底(运行时)。

> **本模式仅在 L 规模 (`l3_extended_mode: true`) 时必填。** 业务对账是电商/支付/资金类 L 规模项目的核心可靠性手段。

**与 10 模式区别**:
- 10 模式都是**技术级、运行时**兜底 (熔断/降级/重试/...)
- 模式 11 是**业务级、事后**兜底 (跑批核对 + 异常单修复)
- 模式 11 触发条件是"定期执行"或"数据不一致"而非"运行时失败"

**配置参数**:
| 参数 | 默认值 | 含义 |
|------|--------|------|
| `reconcile_window` | 24h | 对账时间窗口（拉取 N 小时内的所有单据）|
| `reconcile_cron` | `0 2 * * *` | 每日凌晨 2 点跑批 |
| `tolerance` | 0 | 容差（资金类 0 容差, 非资金类可设小金额容差）|
| `auto_repair` | false | 是否自动修复（true 时尝试重试/补偿, false 时仅告警）|
| `escalation` | PagerDuty | 异常单升级路径 |
| `sources` | list | 数据源 (订单 DB / 库存 DB / 支付网关 API / ...) |

**Python 实现骨架** (`domain/reconciliation/reconciler.py`):
```python
import asyncio
from datetime import datetime
from typing import Callable, Awaitable
import logging

log = logging.getLogger(__name__)

class Reconciler:
    """业务对账器: 跨系统状态最终一致性兜底。"""
    
    def __init__(
        self,
        name: str,
        sources: list[Callable[[datetime, datetime], Awaitable[list[dict]]]],
        key_fn: Callable[[dict], str],
        compare_fn: Callable[[list[dict]], list[dict]],
        auto_repair: bool = False,
        tolerance: float = 0,
        escalation: str = "PagerDuty",
    ):
        self.name = name
        self.sources = sources
        self.key_fn = key_fn
        self.compare_fn = compare_fn
        self.auto_repair = auto_repair
        self.tolerance = tolerance
        self.escalation = escalation
    
    async def run(self, start: datetime, end: datetime) -> dict:
        """执行对账: 拉取 -> 对比 -> 容差过滤 -> 自动修复 -> 升级"""
        # 1. 拉取所有数据源 (并行)
        all_data = await asyncio.gather(*[s(start, end) for s in self.sources])
        
        # 2. 对比找不一致
        inconsistencies = self.compare_fn(all_data)
        
        # 3. 过滤容差内
        real_issues = [i for i in inconsistencies 
                      if abs(i.get('delta', 0)) > self.tolerance]
        
        # 4. 自动修复或仅告警
        if self.auto_repair:
            repair_results = await asyncio.gather(
                *[self._try_repair(i) for i in real_issues]
            )
            unresolved = [i for i, r in zip(real_issues, repair_results) if not r]
        else:
            unresolved = real_issues
        
        # 5. 升级未解决
        if unresolved:
            await self._escalate(unresolved)
        
        return {
            "name": self.name,
            "window": [start.isoformat(), end.isoformat()],
            "checked": sum(len(d) for d in all_data),
            "inconsistencies": len(real_issues),
            "auto_repaired": len(real_issues) - len(unresolved) if self.auto_repair else 0,
            "unresolved": unresolved,
        }
    
    async def _try_repair(self, issue: dict) -> bool:
        """尝试自动修复: 重试 / 补偿"""
        try:
            log.info(f"attempting auto-repair: {issue}")
            # 实际项目: 调用 saga 补偿 / 重试 API
            return True
        except Exception as e:
            log.error(f"auto-repair failed: {issue}, err={e}")
            return False
    
    async def _escalate(self, unresolved: list[dict]) -> None:
        """升级未解决: PagerDuty / 财务人工 / 运维 oncall"""
        log.error(f"escalating {len(unresolved)} unresolved issues to {self.escalation}")
        # 实际项目: 调 PagerDuty API
```

**单元测试** (必须):
- ✅ 拉取多数据源成功 (并行不阻塞)
- ✅ 对比函数正确发现不一致
- ✅ 容差过滤生效 (容差内不升级)
- ✅ auto_repair=true 修复成功
- ✅ auto_repair=true 修复失败 → 升级
- ✅ auto_repair=false 仅告警
- ✅ 空数据源处理 (边界)
- ✅ 数据源拉取异常 → 不中断整个对账

**典型组合**:
- 业务对账 + 告警 (L 规模必用, P1 告警)
- 业务对账 + 自动修复 (资金类 0 容差 + saga 补偿)
- 业务对账 + 审计日志 (合规场景必用)
- 业务对账 + Saga 补偿 (兜底修复手段)

**业务对账典型应用** (L 规模电商):
| 对账类型 | 数据源 | 容差 | 自动修复 | 升级 |
|---------|--------|------|---------|------|
| 订单-库存对账 | orders DB + inventory DB | 0 | 是 (重新扣减) | 库存 oncall |
| 订单-支付对账 | orders DB + alipay API | 0 | 是 (saga 补偿) | 财务 + 支付 oncall |
| 订单-物流对账 | orders DB + 菜鸟 API | 1h 时间差 | 否 | 物流 oncall |
| 用户余额对账 | balance DB + transaction log | 0 | 是 (重放) | 财务 oncall |
| 营销优惠对账 | coupon DB + orders DB | 0.01 | 否 | 营销 oncall |

---

## 模式 12: 业务幂等 (Business Idempotency) — L 规模扩展

**原理**: 业务层面保证同一操作执行多次与一次效果相同, **不仅靠技术幂等键**, 还要靠**业务唯一约束** + **业务状态机幂等**。

> **本模式仅在 L 规模 (`l3_extended_mode: true`) 时必填。** 业务幂等是支付/订单/资金类 L 规模项目的核心防护。

**与 模式 8 幂等 (Idempotency Key) 区别**:
- 模式 8: **技术幂等** (Redis key, 5min 内同 key 返同结果)
- 模式 12: **业务幂等** (业务唯一约束 + 状态机幂等, 永久有效)

**三层幂等防护**:
| 层 | 模式 | 实现 | 例子 |
|---|------|------|------|
| L1 | 技术幂等 | Idempotency-Key (Redis) | 支付 API 5min 内同 key 返同结果 |
| L2 | 业务唯一键 | 数据库 UNIQUE 约束 | order_id UNIQUE, 重复 INSERT 报错 |
| L3 | 状态机幂等 | 状态转换合法性检查 | 已 SUBMITTED 不能再 SUBMITTED |

**Python 实现骨架** (`domain/idempotency/business_idempotent.py`):
```python
import functools
from enum import Enum
from typing import Callable, Awaitable, TypeVar
import logging

T = TypeVar("T")
log = logging.getLogger(__name__)

class IdempotencyViolation(Exception):
    """业务幂等违反: 重复执行同一操作但状态机不允许"""
    pass

class StateMachine:
    """状态机幂等: 同一状态不会重入, 非法转换拒绝"""
    def __init__(self, transitions: dict[Enum, set[Enum]]):
        self.transitions = transitions
    
    def can_transition(self, from_state: Enum, to_state: Enum) -> bool:
        if from_state == to_state:
            return False  # 同状态重入 = 幂等违反
        return to_state in self.transitions.get(from_state, set())
    
    def assert_transition(self, from_state: Enum, to_state: Enum) -> None:
        if not self.can_transition(from_state, to_state):
            raise IdempotencyViolation(
                f"invalid transition: {from_state} -> {to_state}"
            )

# 使用示例: 订单状态机
class OrderStatus(str, Enum):
    PENDING   = "PENDING"
    PAID      = "PAID"
    SHIPPED   = "SHIPPED"
    DELIVERED = "DELIVERED"
    CANCELLED = "CANCELLED"
    REFUNDED  = "REFUNDED"

order_state_machine = StateMachine({
    OrderStatus.PENDING:    {OrderStatus.PAID, OrderStatus.CANCELLED},
    OrderStatus.PAID:       {OrderStatus.SHIPPED, OrderStatus.REFUNDED},
    OrderStatus.SHIPPED:     {OrderStatus.DELIVERED, OrderStatus.REFUNDED},
    OrderStatus.CANCELLED:   set(),  # 终态
    OrderStatus.REFUNDED:    set(),  # 终态
    OrderStatus.DELIVERED:   set(),  # 终态
})

def business_idempotent(
    key_fn: Callable[..., str],
    state_machine: StateMachine = None,
    db_unique_constraint: str = None,
):
    """装饰器: 业务幂等 — 三层防护
    Args:
        key_fn: 业务唯一键生成函数 (如 lambda **kw: kw['order_id'])
        state_machine: 状态机实例 (如 order_state_machine)
        db_unique_constraint: DB UNIQUE 约束名 (如 'uq_order_id')
    """
    def decorator(fn: Callable[..., Awaitable[T]]) -> Callable[..., Awaitable[T]]:
        @functools.wraps(fn)
        async def wrapper(*args, **kwargs) -> T:
            # L1: 技术幂等 (Redis key, 5min TTL)
            # - 由模式 8 Idempotency-Key 装饰器处理
            
            # L2: 业务唯一键 (DB UNIQUE constraint)
            # - 由 DB 物理约束保证, 重复 INSERT 抛 IntegrityError
            # - 这里只校验 key 存在性
            key = key_fn(*args, **kwargs)
            if not key:
                raise ValueError("idempotency key required")
            
            # L3: 状态机幂等 (转换合法性)
            if state_machine and "from_state" in kwargs and "to_state" in kwargs:
                state_machine.assert_transition(
                    kwargs["from_state"],
                    kwargs["to_state"],
                )
            
            return await fn(*args, **kwargs)
        return wrapper
    return decorator


# 使用示例
@business_idempotent(
    key_fn=lambda **kw: kw.get("order_id"),
    state_machine=order_state_machine,
    db_unique_constraint="uq_order_id",
)
async def submit_order(order_id: str, from_state: OrderStatus, to_state: OrderStatus):
    """提交订单 — 三层幂等防护"""
    # 实际实现: 创建订单 + 状态转换
    pass
```

**单元测试** (必须):
- ✅ L1 技术幂等: 同 key 5min 内返同结果
- ✅ L2 业务唯一键: 重复 INSERT DB 报错 (IntegrityError)
- ✅ L3 状态机幂等: 同状态重入抛 IdempotencyViolation
- ✅ L3 状态机: 非法转换抛 IdempotencyViolation
- ✅ 三层同时启用: 任何一层失败都拒绝
- ✅ 终态 (CANCELLED/REFUNDED/DELIVERED) 不能转换

**典型组合**:
- 业务幂等 + 重试 (重试不会产生副作用)
- 业务幂等 + 业务对账 (对账发现业务幂等违反时修复)
- 业务幂等 + 限流 (防止同一 key 被高频重试)

**业务幂等典型应用** (L 规模电商):
| 业务 | 业务唯一键 | 状态机 | 违反后果 |
|------|----------|--------|---------|
| 支付 | payment_id (客户端生成) | PENDING→PAID→REFUNDED | 双扣/漏扣 |
| 订单 | order_id (服务端生成) | PENDING→PAID→SHIPPED→DELIVERED | 重复订单 |
| 库存扣减 | (order_id, sku_id) UNIQUE | RESERVED→DEDUCTED | 超卖/少卖 |
| 优惠券核销 | coupon_id + order_id UNIQUE | UNUSED→USED | 重复核销 |
| 退款 | refund_id (服务端生成) | REQUESTED→APPROVED→COMPLETED | 双退/漏退 |

---

## 模式组合矩阵 (12 模式)

| 兜底 | 1 熔断 | 2 降级 | 3 补偿 | 4 重试 | 5 限流 | 6 背压 | 7 隔离 | 8 幂等 | 9 超时 | 10 健康 | 11 对账 | 12 业务幂等 |
|------|------|------|------|------|------|------|------|------|------|------|------|------|
| 1 熔断 | — | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| 2 降级 | ✅ | — | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| 3 补偿 | ❌ | ❌ | — | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ |
| 4 重试 | ✅ | ❌ | ❌ | — | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ |
| 5 限流 | ❌ | ✅ | ❌ | ❌ | — | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 6 背压 | ❌ | ❌ | ❌ | ❌ | ✅ | — | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 7 隔离 | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | — | ❌ | ❌ | ❌ | ❌ | ❌ |
| 8 幂等 (技术) | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | — | ❌ | ❌ | ❌ | ✅ |
| 9 超时 | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | — | ❌ | ❌ | ❌ |
| 10 健康检查 | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | — | ❌ | ❌ |
| **11 业务对账** | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | — | ❌ |
| **12 业务幂等** | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | — |

**符号说明**:
- ✅ 经常组合使用
- ❌ 不组合 (语义重复或冲突)

**推荐组合** (防御深度, 含 L 规模扩展):
1. **网络层兜底**: 熔断 + 降级 + 重试 + 超时 + 业务幂等 (L 规模含 12)
2. **资源层兜底**: 限流 + 隔离 + 健康检查
3. **事件层兜底**: 背压 + 重试 + 技术幂等
4. **数据层兜底**: 重试 + 补偿 + 超时
5. **L 规模资金类兜底**: Saga 补偿 (3) + 业务幂等 (12) + 业务对账 (11) — 三层防护
6. **L 规模跨地域兜底**: DNS failover (FS81) + 业务对账 (11) + Saga 补偿 (3) — 异地一致性

