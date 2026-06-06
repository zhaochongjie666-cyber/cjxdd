# 韧性测试策略 (Resilience Test Strategy)

> L3 resilience-test-plan.md 模板的详细参考。4 层测试金字塔、自动化与手工结合、覆盖率目标。

## 1. 测试金字塔

```
                  [灾难演练]
                 /  Layer 4  \  ← L6 Phase 5.7
                /   真实环境   \
               /   真实注入     \
              [   契约测试    ]
             /   Layer 3     \   ← L5 + L3 协同
            /   失败注入 → 期望 \
           /   响应 1:1 对应 @chaos \
          [    集成测试      ]
         /    Layer 2        \   ← L5 impl
        /    业务 + 兜底协作    \
       [     单元测试          ]
      /     Layer 1            \   ← L5 impl
     /     兜底组件状态机         \
    /   配置 + 状态 + 转换        \

   ▲ 越上层越接近真实, 越少
   ▼ 越下层越快越多
```

| 层级 | 谁负责 | 范围 | 数量建议 | 通过标准 |
|------|--------|------|---------|---------|
| 单元 | L5 impl | 兜底组件自身 | 100+ | 100% 状态覆盖 |
| 集成 | L5 impl | 业务 + 兜底 | 10-20 | 每 FSXX 至少 1 |
| 契约 | L5 + L3 | 失败注入 → 期望 | 5-10 | 1:1 对应 @chaos |
| 演练 | L6 Phase 5.7 | 真实环境 | 5-10 (P0) | P0 80% PASS |

## 2. 单元测试规范

### 2.1 必测组件

L5 impl 必须为以下 10 类兜底组件提供单元测试：

| 组件 | 必测维度 |
|------|---------|
| 熔断器 | CLOSED/OPEN/HALF_OPEN 三态 + 转换 + 并发 |
| 限流器 | 正常/超限/补充/突发 + 并发 |
| 重试器 | 成功/失败/耗尽/退避 + 非 retryable |
| 降级器 | 主路径/降级路径/切换/恢复 |
| 健康检查 | 健康/亚健康/摘除/恢复 |
| 背压 | 低/中/高负载/拒绝 + 恢复 |
| 隔离池 | 正常/满/独立/隔离 |
| 幂等器 | 第一次/重复/过期/独立 key |
| 超时器 | 正常/超时/取消 |
| 监控指标 | 暴露/聚合/告警 |

### 2.2 覆盖率要求

- **行覆盖**: ≥ 90%
- **分支覆盖**: ≥ 85%
- **状态覆盖**: 100%（所有状态至少一个测试）
- **边界覆盖**: 阈值附近值（threshold-1, threshold, threshold+1）

### 2.3 测试代码规范

```python
# tests/unit/resilience/test_circuit_breaker.py
import pytest
import time
from infra.http.circuit_breaker import CircuitBreaker, State, CircuitBreakerOpenError

class TestCircuitBreaker:
    @pytest.fixture
    def cb(self):
        return CircuitBreaker(
            name="test",
            failure_threshold=3,
            success_threshold=2,
            timeout=0.1,
        )
    
    # 状态覆盖
    def test_starts_in_closed_state(self, cb):
        assert cb.state == State.CLOSED
    
    def test_closed_state_allows_successful_calls(self, cb):
        result = cb.call(lambda: "ok")
        assert result == "ok"
        assert cb.state == State.CLOSED
    
    # 转换覆盖
    def test_opens_after_threshold_failures(self, cb):
        for _ in range(3):
            with pytest.raises(ValueError):
                cb.call(lambda: (_ for _ in ()).throw(ValueError("fail")))
        assert cb.state == State.OPEN
    
    def test_open_state_rejects_calls(self, cb):
        # ... 触发 OPEN
        with pytest.raises(CircuitBreakerOpenError):
            cb.call(lambda: "ok")
    
    def test_half_open_after_timeout(self, cb):
        # ... 触发 OPEN
        time.sleep(0.15)
        assert cb.state == State.HALF_OPEN
    
    def test_half_open_closes_after_successes(self, cb):
        # ... 触发 OPEN → 等待 → HALF_OPEN
        cb.call(lambda: "ok")
        cb.call(lambda: "ok")
        assert cb.state == State.CLOSED
    
    def test_half_open_reopens_on_failure(self, cb):
        # ... 触发 OPEN → 等待 → HALF_OPEN
        with pytest.raises(ValueError):
            cb.call(lambda: (_ for _ in ()).throw(ValueError("fail")))
        assert cb.state == State.OPEN
    
    # 边界覆盖
    def test_at_threshold_minus_one_stays_closed(self, cb):
        for _ in range(2):  # threshold-1
            with pytest.raises(ValueError):
                cb.call(lambda: (_ for _ in ()).throw(ValueError("fail")))
        assert cb.state == State.CLOSED
    
    def test_at_threshold_opens(self, cb):
        for _ in range(3):  # threshold
            with pytest.raises(ValueError):
                cb.call(lambda: (_ for _ in ()).throw(ValueError("fail")))
        assert cb.state == State.OPEN
```

---

## 3. 集成测试规范

### 3.1 测试范围

集成测试验证业务逻辑 + 兜底组件的协作，重点是**状态机正确** + **数据流正确** + **审计日志完整**。

### 3.2 测试模式

```python
# tests/integration/test_f11_annotation_resilience.py
import pytest
from unittest.mock import patch
from domain.services.annotation_service import AnnotationService
from infra.storage.db import get_db

class TestAnnotationSubmitUnderNetworkPartition:
    @pytest.fixture
    async def service(self, db):
        return AnnotationService(db=db)
    
    @pytest.fixture
    async def in_progress_annotation(self, db):
        a = await create_annotation(status="IN_PROGRESS", values=[Value(label="car")])
        return a
    
    async def test_submit_degrades_to_local_draft_when_circuit_open(
        self, service, in_progress_annotation
    ):
        # Given: 下游 API 持续失败, 熔断器打开
        with patch("infra.http.annotation_api.submit") as mock_submit:
            mock_submit.side_effect = TimeoutError("api timeout")
            
            # 3 次失败触发熔断
            for _ in range(3):
                with pytest.raises(AnnotationSubmitError):
                    await service.submit(in_progress_annotation.id)
            
            # When: 第 4 次提交
            result = await service.submit(in_progress_annotation.id)
        
        # Then: 降级到本地草稿
        assert result.status == AnnotationStatus.DRAFT_LOCAL
        assert result.degraded is True
        assert result.retry_count == 0  # 熔断后不再重试
        assert result.next_sync_at is not None
        
        # 草稿存到 local_drafts
        local_draft = await db.fetch_one(
            "SELECT * FROM local_drafts WHERE annotation_id = :id",
            {"id": in_progress_annotation.id},
        )
        assert local_draft is not None
        assert local_draft.values == in_progress_annotation.values
    
    async def test_draft_syncs_to_primary_after_recovery(
        self, service, in_progress_annotation, db
    ):
        # Given: 已降级到本地草稿
        await service.submit(in_progress_annotation.id)  # 触发降级
        # ... mock API 持续失败 → 草稿产生
        
        # When: API 恢复 + 触发 sync
        with patch("infra.http.annotation_api.submit") as mock_submit:
            mock_submit.return_value = {"status": "SUBMITTED"}
            
            sync_result = await service.sync_local_drafts()
        
        # Then: 草稿 sync 成功
        assert sync_result.success_count == 1
        assert sync_result.failed_count == 0
        
        # 主存储状态正确
        annotation = await db.fetch_one(
            "SELECT * FROM annotations WHERE id = :id",
            {"id": in_progress_annotation.id},
        )
        assert annotation.status == "SUBMITTED"
        assert annotation.values == in_progress_annotation.values  # 无丢失
```

### 3.3 集成测试覆盖矩阵

每个 FSXX 至少 1 个集成测试，验证：

| 维度 | 测试内容 |
|------|---------|
| 触发条件 | 模拟失败 → 兜底生效 |
| 状态转换 | 故障中 → 恢复 → 正常 |
| 数据流 | 降级路径 + 恢复路径 |
| 审计日志 | 降级触发/恢复/操作完整 |
| 用户感知 | 业务响应（状态码/返回值）|

---

## 4. 契约测试规范

### 4.1 契约测试与混沌场景 1:1

```python
# tests/chaos/test_f11.py
import pytest
from chaos.faults import NetworkPartition
from chaos.assertions import assert_circuit_open

@pytest.mark.chaos
@pytest.mark.failure_mode("F11")
async def test_annotation_submit_degrades_under_network_partition():
    """对应 chaos-scenarios.md § 2.1 F11 P0 场景 1"""
    
    # Given (与混沌场景的 Background 一致)
    service = await get_annotation_service()
    annotator = await login_annotator("annotator1")
    task = await create_task_in_progress()
    
    # When (与混沌场景的 When 一致, 用 chaos 工具)
    with NetworkPartition(target="annotation-api", duration=30):
        result = await service.submit(task.annotation_id)
    
    # Then (与混沌场景的 Then 一致)
    assert_circuit_open(service.circuit_breaker, expected_state="OPEN")
    assert result.status == "DRAFT_LOCAL"
    assert result.degraded is True
    
    # 撤销注入
    # chaos 工具自动撤销, 也可手动 await chaos.recover()
    
    # 验证恢复
    await wait_for_circuit_close(service.circuit_breaker, timeout=35)
    sync_result = await service.sync_local_drafts()
    assert sync_result.success_count >= 1
```

### 4.2 混沌测试工具

**chaos.faults** 模块提供注入器：

```python
# chaos/faults.py
import contextlib
import subprocess
import time

@contextlib.contextmanager
def NetworkPartition(target: str, duration: int = 30):
    """注入网络分区: iptables 阻断到 target 端口的流量"""
    cmd_block = f"iptables -A OUTPUT -p tcp --dport {target} -j DROP"
    cmd_unblock = f"iptables -D OUTPUT -p tcp --dport {target} -j DROP"
    subprocess.run(cmd_block, shell=True, check=True)
    try:
        yield
        time.sleep(duration)
    finally:
        subprocess.run(cmd_unblock, shell=True, check=True)

@contextlib.contextmanager
def ContainerOOM(container: str, memory_mb: int = 100):
    """注入 OOM: 限制容器内存"""
    subprocess.run(f"docker update --memory {memory_mb}m {container}", shell=True)
    try:
        yield
    finally:
        subprocess.run(f"docker update --memory 2g {container}", shell=True)

@contextlib.contextmanager
def NetworkLatency(iface: str = "eth0", delay_ms: int = 1000, duration: int = 30):
    """注入网络延迟"""
    subprocess.run(f"tc qdisc add dev {iface} root netem delay {delay_ms}ms", shell=True)
    try:
        yield
        time.sleep(duration)
    finally:
        subprocess.run(f"tc qdisc del dev {iface} root", shell=True)
```

**chaos.assertions** 模块提供断言：

```python
# chaos/assertions.py
import asyncio

async def assert_circuit_open(cb, expected_state: str, timeout: float = 5.0):
    """断言熔断器在 timeout 内进入 expected_state"""
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        if cb.state.value == expected_state:
            return
        await asyncio.sleep(0.1)
    raise AssertionError(f"circuit breaker did not reach {expected_state} within {timeout}s, current={cb.state}")

async def wait_for_circuit_close(cb, timeout: float = 35.0):
    """等待熔断器转 CLOSED"""
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        if cb.state.value == "CLOSED":
            return
        await asyncio.sleep(0.5)
    raise AssertionError(f"circuit breaker did not close within {timeout}s, current={cb.state}")

async def assert_data_integrity(original, current, fields: list[str]):
    """断言数据完整性: current 的 fields 与 original 一致"""
    for field in fields:
        assert getattr(current, field) == getattr(original, field), \
            f"data integrity failed: {field} differs"
```

---

## 5. 灾难演练 (L6 Phase 5.7)

### 5.1 执行流程

```bash
# 1. 启动真实环境
docker compose up -d --wait

# 2. 准备测试数据
python -m tests.chaos.setup_data \
  --users 10 \
  --tasks 100 \
  --annotations 200

# 3. 跑 P0 场景
pytest tests/chaos/ \
  -m "chaos and P0" \
  --tb=short \
  --junit-xml=chaos-drill-evidence/results.xml \
  --evidence-dir=chaos-drill-evidence/

# 4. 收集证据
mkdir -p chaos-drill-evidence/{logs,monitoring,db_state,screenshots}
cp -r logs/* chaos-drill-evidence/logs/
docker stats --no-stream > chaos-drill-evidence/monitoring/resources.txt

# 5. 生成报告
python -m tests.chaos.generate_report \
  --evidence chaos-drill-evidence/ \
  --output chaos-drill-report.md
```

### 5.2 证据结构

```
chaos-drill-evidence/
├── F01/
│   ├── inject.log           # 注入命令历史
│   ├── monitoring_before.png  # 注入前监控
│   ├── monitoring_during.png  # 注入中监控
│   ├── monitoring_after.png   # 注入后监控
│   ├── business_log.txt     # 业务日志
│   ├── db_state.json        # DB 状态对比
│   └── result.json          # 测试结果
├── F11/
│   ├── ...
├── results.xml              # pytest junit
├── issues.json              # 发现的问题
└── summary.md               # 演练总结
```

### 5.3 通过标准

| 标准 | 阈值 |
|------|------|
| P0 场景通过率 | ≥ 80% |
| 数据完整性 | 100% (零丢失) |
| 恢复时间 | < SLO 阈值 |
| 监控完整 | 所有失败模式可观测 |
| 证据完整 | 每个场景有 5 类证据 |

### 5.4 问题分级

| 等级 | 含义 | 行动 |
|------|------|------|
| P0 | 兜底没工作（系统崩/数据丢失/卡死） | 阻塞 L6 PASS |
| P1 | 兜底工作但行为不优雅 | 必须报告 + 修复建议 |
| P2 | 兜底工作但恢复不自动 | 记录改进项 |

---

## 6. 持续韧性验证

### 6.1 巡检项

| 监控项 | 阈值 | 告警级别 |
|--------|------|---------|
| 熔断器跳变次数 | > 10/hour | P2 |
| 限流拒绝率 | > 5% | P2 |
| OOM kill 次数 | > 0 | P1 |
| 连接池 wait_count | > 0 持续 60s | P2 |
| 草稿同步延迟 | > 5min | P1 |
| 第三方降级率 | > 1% | P2 |
| 健康检查失败次数 | > 3 连续 | P1 |

### 6.2 定期演练

- **每月 1 次**: 完整 P0 灾难演练（L6 回归）
- **每季度 1 次**: 跨业务线协同演练
- **重大变更后**: 立即跑受影响失败模式
- **生产事故后**: 复盘 + 写新的失败模式

---

## 7. 覆盖率目标

| 层级 | 覆盖率目标 | 度量方式 |
|------|-----------|---------|
| 单元 | ≥ 90% 行 + 100% 状态 | pytest --cov |
| 集成 | 100% FSXX 至少 1 个 | 测试矩阵 |
| 契约 | 100% P0 @chaos 场景 | 测试矩阵 |
| 灾难演练 | ≥ 80% P0 PASS | L6 报告 |

---

## 8. 测试金字塔的应用

### 8.1 开发节奏

```
1. 先写单元测试 (TDD 红)
2. 实现兜底组件 (TDD 绿)
3. 写集成测试 (业务 + 兜底协作)
4. 写契约测试 (1:1 对应 @chaos)
5. 灾难演练 (L6)
```

### 8.2 失败修复流程

```
测试失败
  ↓
 哪层失败？
  ├─ 单元 → 改实现, 修测试
  ├─ 集成 → 检查业务逻辑 + 兜底协作
  ├─ 契约 → 检查 @chaos 场景与实现一致性
  └─ 灾难演练 → 检查真实环境配置
```

### 8.3 测试与 L3 产物关系

| L3 产物 | 消费哪层测试 |
|---------|------------|
| `failure-modes.md` (FMEA 目录) | 定义测试范围 |
| `failsafe-design.md` (FSXX) | 单元 + 集成测试 |
| `chaos-scenarios.md` (@chaos 场景) | 契约测试 |
| `resilience-test-plan.md` (本产物) | 协调 4 层测试 |
| L6 Phase 5.7 | 灾难演练 |

---

## 9. L 规模扩展测试 (l3_extended_mode=true)

> **本节仅在 L 规模 (`l3_extended_mode=true`) 时使用。**

### 9.1 业务对账测试

**测试层次 (新增)**:

| 层级 | 测试内容 | 工具 |
|------|---------|------|
| 单元 | Reconciler 拉取/对比/容差过滤 | pytest + mock 数据源 |
| 集成 | 真实 DB + 真实 API 拉取 | docker compose test profile |
| 契约 | 业务对账发现 inconsistencies → 自动修复 | pytest + 真实不一致数据 |
| **灾难演练** | **业务对账跑批触发 + 资金不一致告警** | **生产环境 + 跑批调度** |

**L 规模必跑对账类型 (5 类)**:
1. 订单-支付对账 (FS11-b, 0 容差, 资金类)
2. 订单-库存对账 (FS11-a, 0 容差, 库存类)
3. 订单-物流对账 (FS11-c, 1h 容差, 物流类)
4. 用户余额对账 (FS11-d, 0 容差, 资金类)
5. 营销优惠对账 (FS11-e, 0.01 容差, 优惠类)

### 9.2 业务幂等测试

**测试层次 (3 层防护都要测)**:

| 层 | 测试内容 |
|---|---------|
| L1 技术幂等 | Redis key 同 key 5min 内只执行 1 次 |
| L2 业务唯一键 | DB UNIQUE 拦截重复 INSERT (IntegrityError) |
| L3 状态机 | 非法转换抛 IdempotencyViolation, 同状态重入抛 IdempotencyViolation |

**L 规模必跑业务幂等 (5 类)**:
1. 支付幂等 (FS12-a, payment_id UNIQUE)
2. 订单幂等 (FS12-b, order_id UNIQUE)
3. 库存扣减幂等 (FS12-c, (order_id, sku_id) UNIQUE)
4. 优惠券核销幂等 (FS12-d, (coupon_id, order_id) UNIQUE)
5. 退款幂等 (FS12-e, refund_id UNIQUE)

### 9.3 跨地域/多活测试

**测试层次**:

| 层级 | 测试内容 |
|------|---------|
| 单元 | DNS 切换器 / 灰度切流器 / 异地对账 |
| 集成 | 双机房数据同步 + 强制读主 + 业务对账 |
| 契约 | DNS 切机房 (10% → 50% → 100%) + 切回 |
| **灾难演练** | **整机房断电 + 跨地域一致性 + 跨地域延迟 (季度)** |

L 规模必跑跨地域 @chaos 场景: 见 chaos-scenarios.md § 9 (5 个 P0 场景: F81-F85)

### 9.4 持续韧性验证 (L 规模)

**新增监控项**:

| 监控项 | 阈值 | 告警级别 | Owner |
|--------|------|---------|-------|
| 业务对账 inconsistencies > 0 (资金类) | 0 | P1 | #payment-oncall |
| 业务对账跑批延迟 > 1h | < 2:00 + 1h | P2 | #data-oncall |
| 业务幂等违反次数 (FS12) | > 0 (资金类) | P1 | #payment-oncall |
| 机房切换次数 (非计划) | > 0 | P1 | #infra-oncall |
| 跨地域 replica_lag | > 5s | P2 | #infra-oncall |
| 跨地域调用 P99 | > 200ms | P2 | #infra-oncall |
| Saga 补偿失败率 | > 1% | P1 | #backend-oncall |

**定期演练 (L 规模)**:
- **每月 1 次**: 业务对账演练 (FS11) + 业务幂等演练 (FS12)
- **每季度 1 次**: 跨地域演练 (FS81-FS85) + 业务对账跑批演练
- **重大变更后**: 立即跑受影响失败模式
- **生产事故后**: 复盘 + 写新的失败模式

