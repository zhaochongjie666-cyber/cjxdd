# {slug} 韧性测试计划

> 对应 L1 业务线: {biz_dir}
> 上游: failure-modes.md + failsafe-design.md + chaos-scenarios.md
> 方法论: 4 层测试金字塔（单元 / 集成 / 契约 / 灾难演练）
> 范围: 每个 FSXX 兜底策略必须有测试路径

---

## 0. 测试金字塔

```
              [灾难演练]  ← L6 Phase 5.7 在真实环境跑
             [契约测试]   ← L5 L3 协同, 验证失败注入 → 期望响应
            [集成测试]    ← L5 impl 集成兜底组件
           [单元测试]     ← L5 impl 单个兜底组件
```

| 层级 | 谁负责 | 测试什么 | 通过标准 |
|------|--------|---------|---------|
| 单元 | L5 impl | 熔断器开关、限流器配置、超时设置 | 100% 覆盖兜底组件的所有状态 |
| 集成 | L5 impl | 聚合 + 兜底协作 | 每个 FSXX 至少 1 个集成测试 |
| 契约 | L5 + L3 | 失败注入 → 期望响应 | 符合 chaos-scenarios.md 的 Gherkin 行为 |
| 灾难演练 | L6 Phase 5.7 | 真实环境 + 真实注入 | P0 场景 80% PASS |

---

## 1. 测试矩阵（失败模式 × 兜底策略 × 测试层级）

| 失败 ID | 失败名称 | 兜底 ID | 单元 | 集成 | 契约 | 灾难演练 | 测试文件 |
|---------|---------|---------|------|------|------|---------|---------|
| F01 | 调度风暴 | FS01-a 限流 | ✅ | ✅ | ✅ | ✅ | `tests/chaos/test_f01.py` |
| F01 | 调度风暴 | FS01-b 优先级 | ✅ | ✅ | ❌ | ❌ | `tests/unit/queues/test_priority.py` |
| F11 | 网络分区 | FS11-a 熔断 | ✅ | ✅ | ✅ | ✅ | `tests/chaos/test_f11.py` |
| F11 | 网络分区 | FS11-b 降级 | ✅ | ✅ | ✅ | ✅ | `tests/chaos/test_f11.py` |
| F11 | 网络分区 | FS11-c 幂等重试 | ✅ | ✅ | ✅ | ❌ | `tests/unit/http/test_idempotent.py` |
| F12 | 网络抖动 | FS12 超时 | ✅ | ✅ | ✅ | ✅ | `tests/chaos/test_f12.py` |
| F21 | 状态漂移 | FS21 版本号 | ✅ | ✅ | ❌ | ❌ | `tests/unit/storage/test_version.py` |
| F24 | 缓存击穿 | FS24 singleflight | ✅ | ✅ | ✅ | ✅ | `tests/chaos/test_f24.py` |
| F31 | OOM | FS31 限流+重启 | ✅ | ✅ | ✅ | ✅ | `tests/chaos/test_f31.py` |
| F33 | 连接池耗尽 | FS33 队列降级 | ✅ | ✅ | ✅ | ✅ | `tests/chaos/test_f33.py` |
| F41 | DB 主从切换 | FS41 重试+检测 | ✅ | ✅ | ✅ | ✅ | `tests/chaos/test_f41.py` |
| F44 | 热点行 | FS44 分片 | ✅ | ✅ | ❌ | ❌ | `tests/unit/db/test_shard.py` |
| F51 | 消息积压 | FS51 背压 | ✅ | ✅ | ✅ | ✅ | `tests/chaos/test_f51.py` |
| F52 | 重复消费 | FS52 业务幂等 | ✅ | ✅ | ✅ | ❌ | `tests/unit/services/test_idempotent.py` |
| F61 | 第三方宕机 | FS61 熔断+降级 | ✅ | ✅ | ✅ | ✅ | `tests/chaos/test_f61.py` |
| F62 | 第三方慢 | FS62 超时+缓存 | ✅ | ✅ | ✅ | ❌ | `tests/unit/cache/test_swr.py` |
| F71 | 突发流量 | FS71 限流+削峰 | ✅ | ✅ | ✅ | ✅ | `tests/chaos/test_f71.py` |
| ... | ... | ... | ... | ... | ... | ... | ... |

---

## 2. 单元测试规范

每个兜底组件必须有单元测试，覆盖：

| 组件 | 必测场景 | 必测状态 |
|------|---------|---------|
| 熔断器 (CircuitBreaker) | 正常 / 失败累积 / 触发 OPEN / 计时器 / 探测 / 恢复 | CLOSED, OPEN, HALF_OPEN |
| 限流器 (RateLimiter) | 正常 / 超限拒绝 / 桶满 / 补充 / 突发 | ALLOW, REJECT |
| 重试器 (Retry) | 成功 / 失败重试 / 达到上限 / 退避 | SUCCESS, RETRY, EXHAUSTED |
| 降级器 (Degradation) | 主路径 / 降级路径 / 切换 / 恢复 | NORMAL, DEGRADED |
| 健康检查 (HealthCheck) | 健康 / 亚健康 / 摘除 / 恢复 | HEALTHY, UNHEALTHY, REMOVED |
| 背压 (Backpressure) | 低负载 / 中负载 / 高负载 / 拒绝 | FLOW, THROTTLE, REJECT |

**测试代码模板**：

```python
# tests/unit/resilience/test_circuit_breaker.py
import pytest
from infra.http.circuit_breaker import CircuitBreaker, State

class TestCircuitBreaker:
    def test_closed_state_allows_requests(self):
        cb = CircuitBreaker(failure_threshold=3)
        assert cb.state == State.CLOSED
        result = cb.call(lambda: "ok")
        assert result == "ok"
    
    def test_opens_after_threshold_failures(self):
        cb = CircuitBreaker(failure_threshold=3)
        for _ in range(3):
            with pytest.raises(ValueError):
                cb.call(lambda: (_ for _ in ()).throw(ValueError("fail")))
        assert cb.state == State.OPEN
    
    def test_half_open_after_timeout(self):
        cb = CircuitBreaker(failure_threshold=3, reset_timeout=1)
        for _ in range(3):
            with pytest.raises(ValueError):
                cb.call(lambda: (_ for _ in ()).throw(ValueError("fail")))
        assert cb.state == State.OPEN
        time.sleep(1.1)
        assert cb.state == State.HALF_OPEN
    
    def test_closes_on_half_open_success(self):
        cb = CircuitBreaker(failure_threshold=3, reset_timeout=0.1)
        for _ in range(3):
            with pytest.raises(ValueError):
                cb.call(lambda: (_ for _ in ()).throw(ValueError("fail")))
        time.sleep(0.2)
        cb.call(lambda: "recovered")
        assert cb.state == State.CLOSED
```

**覆盖率要求**: 兜底组件单元测试 ≥ 90%。

---

## 3. 集成测试规范

每个 FSXX 兜底策略至少 1 个集成测试，验证与业务逻辑的协作：

```python
# tests/integration/test_f11_circuit_breaker_integration.py
import pytest
from domain.services.annotation_service import AnnotationService
from infra.http.circuit_breaker import CircuitBreakerOpenError

class TestAnnotationSubmitUnderNetworkPartition:
    async def test_submit_degrades_to_local_draft_when_circuit_open(self):
        service = AnnotationService(...)
        
        # 模拟下游 API 持续失败, 熔断器打开
        with mock_api_failure(api="annotation-api", duration=30):
            for _ in range(3):
                with pytest.raises(SomeTransientError):
                    await service.submit(annotation_id="A001")
            
            # 第 4 次应触发降级
            result = await service.submit(annotation_id="A001")
            
            assert result.status == "DRAFT_LOCAL"
            assert result.degraded is True
            assert result.retry_count == 0  # 熔断后不再重试
            assert result.next_sync_at is not None
    
    async def test_draft_syncs_to_primary_after_recovery(self):
        # ... 反向验证: 故障恢复后, 草稿自动 sync
        pass
```

**集成测试范围**:
- 业务逻辑 + 兜底组件协作
- 状态机正确转换
- 数据流（降级路径 + 恢复路径）
- 审计日志完整

---

## 4. 契约测试规范

契约测试把 L3 `chaos-scenarios.md` 的 @chaos 场景翻译为代码：

```python
# tests/chaos/test_f11.py
import pytest
from chaos.faults import NetworkPartition
from chaos.assertions import assert_circuit_open, assert_data_integrity

@pytest.mark.chaos
@pytest.mark.failure_mode("F11")
async def test_annotation_submit_degrades_under_network_partition():
    \"\"\"对应 chaos-scenarios.md § 2.1 F11 第一个场景\"\"\"
    # Given: 服务已启动, 标注员已登录
    service = AnnotationService(...)
    annotator = await login_annotator("annotator1")
    task = await create_task(status="IN_PROGRESS")
    
    # When: 注入网络分区 30s
    with NetworkPartition(target="annotation-api", duration=30):
        # 标注员尝试提交
        result = await service.submit(annotation_id=task.annotation_id)
    
    # Then: 兜底行为
    assert_circuit_open(service.circuit_breaker, expected_state="OPEN")
    assert result.status == "DRAFT_LOCAL"
    assert result.degraded is True
    
    # 数据完整性: 草稿保存
    local_draft = await load_local_draft(task.annotation_id)
    assert local_draft.values == task.annotation_values
    
    # When: 网络恢复
    await wait_for_circuit_close(timeout=35)
    
    # Then: 草稿自动 sync
    sync_result = await sync_local_drafts()
    assert sync_result.success_count == 1
    final = await load_annotation(task.annotation_id)
    assert final.status == "SUBMITTED"
    assert final.values == task.annotation_values
```

**契约测试要求**:
- 1:1 对应 chaos-scenarios.md 的 @chaos P0 场景
- 测试名引用 chaos-scenarios.md 章节
- 注入用 chaos.faults 工具（NetworkPartition, OOM, ClockSkew...）
- 断言用 chaos.assertions 工具

---

## 5. 灾难演练（L6 Phase 5.7）

L6 灾难演练在 docker compose 启动的真实环境跑，对应 chaos-scenarios.md 的 P0 场景。

**执行流程**:

```bash
# 1. 启动服务
docker compose up -d --wait

# 2. 准备测试数据
python tests/chaos/setup_data.py

# 3. 跑 P0 场景 (按 chaos-scenarios.md 顺序)
pytest tests/chaos/ -m "chaos and P0" \
  --tb=short \
  --evidence-dir=chaos-drill-evidence/ \
  --junit-xml=chaos-drill-evidence/results.xml

# 4. 收集证据
cp -r logs/ chaos-drill-evidence/logs/
docker stats --no-stream > chaos-drill-evidence/resources.txt

# 5. 生成报告
python tests/chaos/generate_report.py
```

**演练产出**:
- `chaos-drill-evidence/F01/` 每个 P0 场景一个目录
- `chaos-drill-evidence/F01/inject.log` 注入命令历史
- `chaos-drill-evidence/F01/before.png` / `after.png` 监控截图
- `chaos-drill-evidence/F01/db_state.json` 数据库状态对比
- `chaos-drill-evidence/results.xml` 测试结果
- `chaos-drill-evidence/issues.json` 发现的问题

**通过标准**:
- P0 场景 ≥ 80% PASS
- P0 失败问题全部有 root_cause + fix_suggestion
- 数据完整性 100% (故障期间不丢数据)
- 恢复时间 < SLO 阈值

---

## 6. 持续韧性验证（巡检）

L6 上线后, 持续监控:

| 监控项 | 阈值 | 告警级别 |
|--------|------|---------|
| 熔断器跳变次数 | > 10/hour | P2 |
| 限流拒绝率 | > 5% | P2 |
| OOM kill 次数 | > 0 | P1 |
| 连接池 wait_count | > 0 持续 60s | P2 |
| 草稿同步延迟 | > 5min | P1 |
| 第三方降级率 | > 1% | P2 |

**定期演练**: 每月 1 次完整 P0 灾难演练 (L6 回归)。

---

## 7. 测试覆盖率目标

| 层级 | 覆盖率目标 | 度量方式 |
|------|-----------|---------|
| 单元 | ≥ 90% 兜底组件行覆盖 | pytest --cov |
| 集成 | 100% FSXX 至少 1 个 | 测试矩阵 |
| 契约 | 100% P0 @chaos 场景 | 测试矩阵 |
| 灾难演练 | ≥ 80% P0 PASS | L6 报告 |

---

## 8. 上下游溯源

- **上游**: chaos-scenarios.md (@chaos P0 场景) + failsafe-design.md (FSXX)
- **下游**:
  - L5 harness-plan.md: "失败注入点"段引用本计划
  - L6 Phase 5.7: 灾难演练引用契约测试 + 本计划
  - 持续监控: 巡检项来自本计划 § 6

---

## 自检清单

- [ ] 测试矩阵覆盖所有 FSXX
- [ ] 每个 FSXX 至少 1 个测试层级 (单元/集成/契约/演练)
- [ ] 单元测试 ≥ 90% 覆盖率
- [ ] 契约测试 1:1 对应 chaos-scenarios.md
- [ ] 灾难演练 P0 ≥ 80% PASS
- [ ] 巡检项有阈值 + 告警级别
- [ ] 上下游溯源完整

---

## 9. L 规模扩展测试策略 (l3_extended_mode=true)

> **本章节仅在 L 规模 (`l3_extended_mode=true`) 时必填。** L 规模项目除了 S/M 规模的 4 层测试金字塔外, 还需补充:

### 9.1 业务对账测试 (FS11)

**测试层级**: 集成 + 灾难演练 (新增)

| 测试类型 | 内容 | 频率 |
|---------|------|------|
| 单元 | Reconciler 拉取 + 对比 + 容差过滤 | CI |
| 集成 | 多数据源拉取 + 自动修复 (mock 失败) | CI |
| 契约 | 业务对账发现 inconsistencies → 自动修复 | 周 |
| **灾难演练** | **业务对账跑批触发 + 资金不一致告警** | **月** |

**L 规模必跑场景**:
- 订单-支付对账 (FS11-b): 5 类典型不一致 (已支付未创建订单 / 已创建未支付 / 双扣 / 漏扣 / 金额错)
- 库存-订单对账 (FS11-a): 超卖 / 少卖
- 用户余额对账 (FS11-d): 重放 transaction_log

### 9.2 业务幂等测试 (FS12)

**测试层级**: 单元 + 集成 + 契约 (新增, 3 层防护都要测)

| 层 | 测试内容 |
|---|---------|
| L1 技术幂等 | Redis key 同 key 5min 内只执行 1 次 |
| L2 业务唯一键 | DB UNIQUE 拦截重复 INSERT (IntegrityError) |
| L3 状态机 | 非法转换抛 IdempotencyViolation, 同状态重入抛 IdempotencyViolation |

**L 规模必跑场景**:
- 支付幂等 (FS12-a): 并发 10 次同 payment_id, 只成功 1 次
- 订单幂等 (FS12-b): 同 order_id 重复提交
- 库存幂等 (FS12-c): 同 (order_id, sku_id) 重复扣减
- 优惠券幂等 (FS12-d): 同 coupon_id 多次核销

### 9.3 跨地域/多活测试 (FS81-FS85)

**测试层级**: 契约 + 灾难演练 (新增)

| 测试类型 | 内容 | 频率 |
|---------|------|------|
| 单元 | DNS 切换器 / 灰度切流器 | CI |
| 集成 | 双机房数据同步 + 强制读主 | CI |
| 契约 | DNS 切机房 + 切回 (灰度 10/50/100) | 周 |
| **灾难演练** | **整机房断电 + 跨地域一致性 + 跨地域延迟** | **季度** |

**L 规模必跑场景**: 见 chaos-scenarios.md § 9 (5 个 P0 @chaos 场景)

### 9.4 L 规模覆盖率目标

| 层级 | L 规模目标 |
|------|----------|
| 单元 | ≥ 90% (S/M 同) |
| 集成 | 100% FSXX 至少 1 个 (S/M 同, 12 模式 ≥ 12 测试) |
| 契约 | 100% P0 @chaos (S/M: 11 个, L: 16 个) |
| **业务对账** | **≥ 5 类对账类型** |
| **业务幂等** | **5 类典型业务都测 (支付/订单/库存/优惠券/退款)** |
| **跨地域演练** | **季度 1 次** |
| 灾难演练 | P0 80% PASS (S/M 同) |

### 9.5 持续韧性验证 (L 规模)

**新增巡检项**:

| 监控项 | 阈值 | 告警级别 | Owner |
|--------|------|---------|-------|
| 业务对账 inconsistencies > 0 | 0 (资金类) / 0.01 (优惠) | P1 | #payment-oncall |
| 业务对账跑批延迟 > 1h | < 2:00 + 1h | P2 | #data-oncall |
| 业务幂等违反次数 | > 0 (资金类) | P1 | #payment-oncall |
| 机房切换次数 | > 0 (非计划) | P1 | #infra-oncall |
| 跨地域 replica_lag | > 5s | P2 | #infra-oncall |
| 跨地域调用 P99 | > 200ms | P2 | #infra-oncall |
