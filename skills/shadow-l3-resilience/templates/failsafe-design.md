# {slug} 兜底设计

> 对应 L1 业务线: {biz_dir}
> 上游: failure-modes.md（每个 FXX → 至少一个 FSXX）
> 方法论: 10 兜底模式 (S/M 规模) / 12 兜底模式 (L 规模, scale.l3_extended_mode=true)
> 范围: 每个失败模式必须有兜底策略，每个兜底策略必须有实现位置

---

## 0. 规模判定

| scale | 兜底模式数 | 必含模式 |
|-------|----------|---------|
| S | 10 模式 ≥ 5 选 | — |
| M | 10 模式 ≥ 5 选 (建议 7+) | — |
| **L** | **12 模式 ≥ 8 选** | **业务对账 (FS11) + 业务幂等 (FS12) 必含** |

---

## 0.5. 兜底模式索引 (12 模式, L 规模)

| 模式 | 名称 | 防御深度 | 适用维度 | 实现位置约定 | 规模 |
|------|------|---------|---------|------------|------|
| FS-1 | 熔断 (Circuit Breaker) | — | NET/DEP | `infra/http/circuit_breaker.py` | S/M/L |
| FS-2 | 降级 (Degradation) | — | NET/DEP | `domain/services/degraded.py` | S/M/L |
| FS-3 | 补偿 (Compensation / Saga) | — | DAT/EVT | `domain/sagas/{slug}_saga.py` | S/M/L |
| FS-4 | 重试 (Retry w/ backoff) | — | NET/EVT | `infra/http/retry.py` | S/M/L |
| FS-5 | 限流 (Rate Limit) | — | RES/TRF | `infra/middleware/rate_limit.py` | S/M/L |
| FS-6 | 背压 (Backpressure) | — | EVT | `infra/queue/backpressure.py` | S/M/L |
| FS-7 | 隔离 (Bulkhead) | — | RES | `infra/pools/{pool}_bulkhead.py` | S/M/L |
| FS-8 | 幂等 (Idempotency Key - 技术) | — | NET/EVT | `domain/decorators/idempotent.py` | S/M/L |
| FS-9 | 超时 (Timeout) | — | NET/DEP | `infra/http/timeout.py` | S/M/L |
| FS-10 | 健康检查 (Health Check) | — | ALL | `app/api/routes/health.py` | S/M/L |
| **FS-11** | **业务对账 (Reconciliation)** | **事后** | **DAT/MRG** | **`domain/reconciliation/reconciler.py`** | **L** |
| **FS-12** | **业务幂等 (Business Idempotency)** | **3 层** | **DAT/EVT** | **`domain/idempotency/business_idempotent.py`** | **L** |

> 命名规范: FSXX 编号与 failure-modes.md FXX 一一对应。FSXX = "该 FXX 失败模式的兜底策略"。同一失败模式可有 FSXX-a (主) / FSXX-b (辅) 多个子策略。
> 模式 11/12 仅 L 规模 (`l3_extended_mode=true`) 必填。S/M 规模 10 模式足够。

---

## 1. 调度层兜底（FS01-FS04）

### FS01: Nomad 调度风暴兜底

**对应失败**: F01 (Nomad 调度风暴)
**防御深度**: 3 层

| 层 | 模式 | 配置参数 | 实现位置 | 触发条件 | 失效检测 |
|----|------|---------|---------|---------|---------|
| L1 | 限流 (Rate Limit) | `MAX_CONCURRENT_TASKS=100`, `RATE_PER_SEC=10` | `infra/scheduler/quota.py` | 并发任务 > 100 | task_reject_count > 0 |
| L2 | 优先级队列 | `priority={"CRITICAL": 0, "HIGH": 1, "NORMAL": 2}` | `domain/queues/priority.py` | 队列长度 > 500 | 队列堆积 |
| L3 | OOM 自杀重启 | `max_memory_mb=2048` | `infra/scheduler/oom_watcher.py` | memory > 90% | container OOM killed |

**状态机**:

```
NORMAL ─[并发>100]→ LIMITING ─[队列>500]→ DEGRADED ─[OOM]→ KILLED
  ↑                    │                      │              │
  └────[恢复 30s]──────┴────[恢复 60s]────────┴─[Nomad 重启]─┘
```

**实现关键点**:
- 限流用 token bucket，每秒补充 10 个 token
- 优先级队列用 Redis sorted set，score = priority
- OOM watcher 每 5s 检查一次，触发后用 `docker restart`

**失效检测指标**:
- `task_reject_total > 100/min` → 告警
- `queue_depth_p99 > 500` → 告警
- `oom_kill_count > 3/hour` → 严重告警

**关联 FMEA**: [F01](../../L3-resilience/{biz_dir}/failure-modes.md#f01)

---

### FS02-FS04: 调度器宕机 / 节点失联 / Leader 脑裂

> 这三种失败由 Nomad 自身 HA 机制处理, 应用层只需做健康检查和告警。
> 详细兜底由 Nomad operator 负责, 不在 L3 范围。

**应用层职责**:
- 健康检查: `app/api/routes/health.py::check_nomad()` 探测 Nomad server
- 告警: Nomad server down 立即 PagerDuty
- 数据完整性: 任务状态写本地 WAL, 恢复后 rejoin

---

## 2. 网络层兜底（FS11-FS14）

### FS11: 网络分区兜底（熔断 + 降级 + 幂等重试）

**对应失败**: F11 (网络分区)
**防御深度**: 3 层

| 层 | 模式 | 配置参数 | 实现位置 | 触发条件 | 失效检测 |
|----|------|---------|---------|---------|---------|
| L1 | 熔断 (Circuit Breaker) | `failure_threshold=3`, `timeout=5s`, `reset_timeout=30s` | `infra/http/circuit_breaker.py` | 5s 内 3 次失败 | circuit_state = OPEN |
| L2 | 降级 (Degradation) | `degraded_to="local_draft"` | `domain/services/degraded.py::save_local_draft()` | 熔断 OPEN | status = DRAFT_LOCAL |
| L3 | 幂等重试 (Idempotent Retry) | `max_retries=3`, `backoff=exponential(1s, 2s, 4s)` | `infra/http/idempotent_retry.py` | 瞬时失败 (5xx/timeout) | retry_count < max |

**状态机**:

```
CLOSED ─[3次失败/5s]→ OPEN ─[30s]→ HALF_OPEN ─[1次成功]→ CLOSED
  │                     │              │
  └─[正常]─成功──────────┘              └─[1次失败]→ OPEN
```

**降级路径**:
- 数据流向: 业务调用 → CB wrapper → 重试 → 降级到 local_draft
- 降级期间: UI 显示 "已存为草稿, 网络恢复后自动提交" 横幅
- 降级存储: `infra/storage/local_draft.py` (SQLite + 文件双写)
- 同步机制: `infra/sync/draft_syncer.py` 每 30s 检查并回写

**幂等键 (Idempotency Key)**:
- 客户端生成: `uuid4()` per request
- 服务端存: `infra/idempotency/store.py` (Redis, TTL=24h)
- 重复请求: 返回缓存响应, 不重新执行

**关联 FMEA**: [F11](../../L3-resilience/{biz_dir}/failure-modes.md#f11)

---

### FS12: 网络抖动兜底（缓冲 + 重试 + 超时）

**对应失败**: F12 (网络抖动)
**防御深度**: 2 层

| 层 | 模式 | 配置参数 | 实现位置 | 触发条件 | 失效检测 |
|----|------|---------|---------|---------|---------|
| L1 | 超时 (Timeout) | `connect_timeout=2s`, `read_timeout=10s` | `infra/http/timeout.py` | 任何 HTTP 调用 | 永远设上限 |
| L2 | 缓冲 (Buffer) | `jitter_buffer_ms=100` | `infra/network/jitter_buffer.py` | 延迟突增 | buffer 满 → 拒绝 |

**关联 FMEA**: [F12](../../L3-resilience/{biz_dir}/failure-modes.md#f12)

---

### FS13 / FS14: DNS 失效 / TCP 半开

> FS13 用 IP 直连 + DNS 缓存, FS14 用 TCP keepalive。
> 详细见 `references/failsafe-patterns.md` § 7-8。

---

## 3. 状态层兜底（FS21-FS24）

### FS21: 状态漂移兜底

| 层 | 模式 | 实现位置 | 触发条件 |
|----|------|---------|---------|
| L1 | 版本号对比 | `domain/aggregates/{aggregate}.py::check_version()` | 副本版本不一致 |
| L2 | 强一致读 | `infra/storage/strong_read.py` | 关键路径 |

### FS22: 版本冲突兜底

| 层 | 模式 | 实现位置 | 触发条件 |
|----|------|---------|---------|
| L1 | 乐观锁重试 | `domain/aggregates/{aggregate}.py` | conflict 错误 |
| L2 | 用户提示 | `frontend/src/components/ConflictDialog.tsx` | 重试 3 次仍冲突 |

### FS23: 时钟漂移兜底

| 层 | 模式 | 实现位置 | 触发条件 |
|----|------|---------|---------|
| L1 | NTP 同步检查 | `infra/clock/ntp_check.py` | 偏移 > 1s |
| L2 | 业务时间用 monotonic clock | `domain/clock.py::now_monotonic()` | 避免 wall clock 漂移 |

### FS24: 缓存击穿兜底

| 层 | 模式 | 实现位置 | 触发条件 |
|----|------|---------|---------|
| L1 | singleflight | `infra/cache/singleflight.py` | 同一 key 并发读 |
| L2 | 后台预热 | `domain/cache/warmer.py` | 热点 key 过期前 60s |

---

## 4. 资源层兜底（FS31-FS34）

### FS31: OOM 兜底

| 层 | 模式 | 配置参数 | 实现位置 | 触发条件 | 失效检测 |
|----|------|---------|---------|---------|---------|
| L1 | 限流 (Rate Limit) | `qps_limit = max(10, available_memory_mb / 100)` | `infra/middleware/dynamic_rate_limit.py` | memory > 80% | 限流生效 |
| L2 | 容器重启 | `restart_policy=on-failure:5` | docker-compose | OOM killed | container exit 137 |
| L3 | 健康检查摘除 | `health_check_interval=5s` | k8s livenessProbe | 连续 3 次失败 | pod removed from service |

### FS32: 磁盘满兜底

| 层 | 模式 | 实现位置 | 触发条件 |
|----|------|---------|---------|
| L1 | 自动清理 | `infra/storage/cleanup.py::cleanup_old_files()` | usage > 90% |
| L2 | 拒绝写 | `infra/middleware/disk_check.py` | usage > 95% |
| L3 | 告警 | PagerDuty P1 | usage > 95% 持续 5min |

### FS33: 连接池耗尽兜底

| 层 | 模式 | 实现位置 | 触发条件 |
|----|------|---------|---------|
| L1 | 限流 | `infra/db/pool_monitor.py` | wait_count > 0 |
| L2 | 队列降级 | `domain/queue/db_queue.py` | wait_count > 50 |
| L3 | 健康检查告警 | `app/api/routes/health.py` | pool.exhausted |

### FS34: CPU 100% 兜底

| 层 | 模式 | 实现位置 | 触发条件 |
|----|------|---------|---------|
| L1 | 限速 | `infra/cpu/cpu_limiter.py` | CPU > 80% |
| L2 | 自动扩容 | HPA | CPU > 70% 持续 5min |
| L3 | 慢查询排查 | `infra/db/slow_query_log.py` | 持续 30min |

---

## 5. 数据层兜底（FS41-FS44）

### FS41: DB 主从切换兜底

| 层 | 模式 | 实现位置 | 触发条件 |
|----|------|---------|---------|
| L1 | 应用层重试 | `infra/db/retry.py` | 5 次内自动重试 |
| L2 | 新主库检测 | `infra/db/primary_detector.py` | 60s 内检测新主 |
| L3 | 写降级（队列） | `domain/queue/write_queue.py` | 持续 60s 仍无主库 |

### FS42: 复制延迟兜底

| 层 | 模式 | 实现位置 | 触发条件 |
|----|------|---------|---------|
| L1 | 强制读主 | `infra/db/read_strategy.py::force_primary()` | lag > 5s |
| L2 | 告警 | `infra/monitoring/replication_lag.py` | lag > 1s |

### FS43: 事务死锁兜底

| 层 | 模式 | 实现位置 | 触发条件 |
|----|------|---------|---------|
| L1 | 自动重试 | `infra/db/deadlock_retry.py` | deadlock_detected |
| L2 | 锁顺序约束 | 编码规范 | 代码 review |

### FS44: 热点行兜底

| 层 | 模式 | 实现位置 | 触发条件 |
|----|------|---------|---------|
| L1 | 分片 (Sharding) | `domain/aggregates/{aggregate}.py::shard_by_id()` | 单行 QPS > 100 |
| L2 | 异步合并 | `domain/services/async_merge.py` | 写完异步 sync |

---

## 6. 事件层兜底（FS51-FS54）

### FS51: 消息积压兜底

| 层 | 模式 | 实现位置 | 触发条件 |
|----|------|---------|---------|
| L1 | 背压 (Backpressure) | `infra/queue/backpressure.py` | DLQ > 1000 |
| L2 | 限流生产端 | `infra/queue/producer_throttle.py` | 队列 > 500 |
| L3 | 临时扩容 consumer | `infra/queue/autoscale.py` | lag > 60s |

### FS52: 重复消费兜底

| 层 | 模式 | 实现位置 | 触发条件 |
|----|------|---------|---------|
| L1 | 业务幂等 | `domain/decorators/idempotent.py` | 重复 event_id |

### FS53: 顺序错乱兜底

| 层 | 模式 | 实现位置 | 触发条件 |
|----|------|---------|---------|
| L1 | 单 partition | `infra/queue/partition_strategy.py` | 顺序敏感业务 |
| L2 | 业务重排 | `domain/services/reorder.py` | 业务侧时间戳 |

### FS54: 订阅者宕机兜底

| 层 | 模式 | 实现位置 | 触发条件 |
|----|------|---------|---------|
| L1 | 自动 rebalance | broker 内置 | consumer 退出 |
| L2 | 死信重投 | `infra/queue/dlq_replay.py` | consumer 持续失败 |

---

## 7. 依赖层兜底（FS61-FS64）

### FS61: 第三方宕机兜底

| 层 | 模式 | 实现位置 | 触发条件 |
|----|------|---------|---------|
| L1 | 熔断 | `infra/http/circuit_breaker.py` | 5xx 率 > 50% |
| L2 | 降级到 mock | `domain/adapters/{third_party}_mock.py` | CB OPEN |
| L3 | 缓存上次成功结果 | `infra/cache/third_party_cache.py` | TTL=1h |

### FS62: 第三方响应慢兜底

| 层 | 模式 | 实现位置 | 触发条件 |
|----|------|---------|---------|
| L1 | 超时 | `infra/http/timeout.py` | 任何外部调用 |
| L2 | 缓存降级 | `infra/cache/stale_while_revalidate.py` | timeout 触发 |

### FS63: 配额耗尽兜底

| 层 | 模式 | 实现位置 | 触发条件 |
|----|------|---------|---------|
| L1 | 退避 | `infra/http/retry.py` | 429 错误 |
| L2 | 排队 | `domain/queue/third_party_queue.py` | 持续 429 |

### FS64: 凭据失效兜底

| 层 | 模式 | 实现位置 | 触发条件 |
|----|------|---------|---------|
| L1 | 提示用户更新 | `frontend/src/components/CredentialExpiredDialog.tsx` | 401/403 |
| L2 | 告警 | PagerDuty | 凭据失效 |

---

## 8. 流量层兜底（FS71-FS74）

### FS71: 突发流量兜底

| 层 | 模式 | 实现位置 | 触发条件 |
|----|------|---------|---------|
| L1 | 限流 (Rate Limit) | `infra/middleware/rate_limit.py` | QPS > capacity * 0.8 |
| L2 | 弹性扩缩容 | HPA / Nomad | CPU > 70% 持续 5min |
| L3 | 削峰 (Load Shedding) | `infra/middleware/load_shedder.py` | CPU > 90% |

### FS72: DDoS 兜底

| 层 | 模式 | 实现位置 | 触发条件 |
|----|------|---------|---------|
| L1 | WAF 封禁 | cloud WAF | 异常 IP |
| L2 | CDN 清洗 | CDN | 大规模攻击 |
| L3 | 黑洞路由 | ISP | 持续攻击 |

### FS73: 慢速连接兜底

| 层 | 模式 | 实现位置 | 触发条件 |
|----|------|---------|---------|
| L1 | 限速 | `infra/middleware/slow_loris_defense.py` | 连接时长 > 30s |
| L2 | 主动断开 | nginx timeout | 超时 |

### FS74: 大请求体兜底

| 层 | 模式 | 实现位置 | 触发条件 |
|----|------|---------|---------|
| L1 | 拒绝 | `infra/middleware/body_size_limit.py` | > 100MB |
| L2 | 用户提示 | `frontend/src/components/UploadError.tsx` | 上传失败 |

---

## 9. 兜底策略与实现位置对照表

| 兜底策略 ID | 模式 | 实现位置 | 单元测试 | 集成测试 |
|------------|------|---------|---------|---------|
| FS01-a | 限流 | `infra/scheduler/quota.py` | `tests/unit/scheduler/test_quota.py` | `tests/chaos/test_f01.py` |
| FS01-b | 优先级队列 | `domain/queues/priority.py` | `tests/unit/queues/test_priority.py` | `tests/chaos/test_f01.py` |
| FS11-a | 熔断 | `infra/http/circuit_breaker.py` | `tests/unit/http/test_cb.py` | `tests/chaos/test_f11.py` |
| FS11-b | 降级 | `domain/services/degraded.py` | `tests/unit/services/test_degraded.py` | `tests/chaos/test_f11.py` |
| FS11-c | 幂等重试 | `infra/http/idempotent_retry.py` | `tests/unit/http/test_idempotent.py` | `tests/chaos/test_f11.py` |
| ... | ... | ... | ... | ... |

---

## 10. 上下游溯源

- **上游**: `failure-modes.md`（每个 FSXX 对应一个 FXX）
- **下游**:
  - `chaos-scenarios.md`: 每个 FSXX → 至少一个 @chaos 场景
  - `resilience-test-plan.md`: 每个 FSXX → 测试矩阵行
  - `recovery-runbook.md`: 每个 FSXX → 恢复步骤
  - L5 harness-plan.md: 兜底约束段引用 FSXX

---

## 自检清单

- [ ] 每个失败模式（FXX）至少 1 个兜底策略（FSXX）
- [ ] 每个 FSXX 的"实现位置"是具体文件路径或组件名
- [ ] 防御深度 ≥ 1（高严重等级 ≥ 2）
- [ ] 触发条件用具体阈值（不是"高负载"）
- [ ] 失效检测指标可观测
- [ ] 兜底策略 ≥ 5 种不同模式
- [ ] 上下游溯源完整

---

## 9. 业务对账兜底 (FS11) — L 规模扩展

> **本章节仅在 L 规模 (`l3_extended_mode=true`) 时必填。**

### FS11: 业务对账 (Reconciliation)

**对应失败**: F82 (跨地域一致性违反) 等所有业务层数据不一致场景
**防御深度**: 1 层 (事后兜底)
**实现**: `domain/reconciliation/reconciler.py` (Python 骨架见 references/failsafe-patterns.md § 11)

### FS11 系列: 5 类典型业务对账

#### FS11-a: 订单-库存对账

| 字段 | 内容 |
|------|------|
| 触发 | 每 24h 跑批 (`0 2 * * *`) |
| 数据源 | orders DB + inventory DB |
| 容差 | 0 件 (资金/库存类零容差) |
| 自动修复 | 是 (重试 saga 补偿) |
| 升级 | #inventory-oncall |

**实现位置**:
- 跑批脚本: `domain/reconciliation/order_inventory.py::run_daily()`
- 修复逻辑: `domain/sagas/inventory_reserve.py::compensate()`
- 告警: PagerDuty "#inventory-oncall" / P1

#### FS11-b: 订单-支付对账

| 字段 | 内容 |
|------|------|
| 触发 | 每 24h 跑批 |
| 数据源 | orders DB + alipay API + wechat API |
| 容差 | 0 元 |
| 自动修复 | 是 (saga 补偿) |
| 升级 | #payment-oncall + #finance |

**实现位置**:
- 跑批: `domain/reconciliation/order_payment.py`
- 修复: `domain/sagas/payment_request.py::compensate()`
- 告警: PagerDuty "#payment-oncall" / P1

#### FS11-c: 订单-物流对账

| 字段 | 内容 |
|------|------|
| 触发 | 每 24h 跑批 |
| 数据源 | orders DB + 菜鸟 API |
| 容差 | 1h 时间差 (物流有延迟) |
| 自动修复 | 否 (人工核对物流状态) |
| 升级 | #logistics-oncall |

#### FS11-d: 用户余额对账

| 字段 | 内容 |
|------|------|
| 触发 | 每 24h 跑批 |
| 数据源 | balance DB + transaction_log |
| 容差 | 0 元 (资金类) |
| 自动修复 | 是 (重放 transaction_log) |
| 升级 | #finance + #payment-oncall |

#### FS11-e: 营销优惠对账

| 字段 | 内容 |
|------|------|
| 触发 | 每 24h 跑批 |
| 数据源 | coupon DB + orders DB |
| 容差 | 0.01 元 (优惠可舍入) |
| 自动修复 | 否 (运营核对) |
| 升级 | #marketing-oncall |

---

## 10. 业务幂等兜底 (FS12) — L 规模扩展

> **本章节仅在 L 规模 (`l3_extended_mode=true`) 时必填。**

### FS12: 业务幂等 (3 层防护)

**实现**: `domain/idempotency/business_idempotent.py` (Python 骨架见 references/failsafe-patterns.md § 12)

**3 层防护**:

| 层 | 实现 | 例子 |
|---|------|------|
| L1 技术幂等 | Redis Idempotency-Key (FS8 复用) | 支付 API 5min 内同 key 返同结果 |
| L2 业务唯一键 | DB UNIQUE constraint | order_id / payment_id / coupon_id UNIQUE |
| L3 状态机幂等 | 状态转换合法性 | 已 SUBMITTED 不能再 SUBMITTED |

### FS12 系列: 5 类典型业务幂等

#### FS12-a: 支付幂等

| 字段 | 内容 |
|------|------|
| 业务唯一键 | payment_id (客户端生成) |
| 状态机 | PENDING→PAID→REFUNDED |
| 违反后果 | 双扣/漏扣 (资金类, 零容差) |
| 实现 | `domain/payment/idempotent.py` + 装饰器 `@business_idempotent` |

#### FS12-b: 订单幂等

| 字段 | 内容 |
|------|------|
| 业务唯一键 | order_id (服务端生成) |
| 状态机 | PENDING→PAID→SHIPPED→DELIVERED |
| 违反后果 | 重复订单 |
| 实现 | `domain/order/idempotent.py` |

#### FS12-c: 库存扣减幂等

| 字段 | 内容 |
|------|------|
| 业务唯一键 | (order_id, sku_id) UNIQUE |
| 状态机 | RESERVED→DEDUCTED |
| 违反后果 | 超卖/少卖 |
| 实现 | `domain/inventory/idempotent.py` |

#### FS12-d: 优惠券核销幂等

| 字段 | 内容 |
|------|------|
| 业务唯一键 | (coupon_id, order_id) UNIQUE |
| 状态机 | UNUSED→USED |
| 违反后果 | 重复核销 |
| 实现 | `domain/coupon/idempotent.py` |

#### FS12-e: 退款幂等

| 字段 | 内容 |
|------|------|
| 业务唯一键 | refund_id (服务端生成) |
| 状态机 | REQUESTED→APPROVED→COMPLETED |
| 违反后果 | 双退/漏退 |
| 实现 | `domain/refund/idempotent.py` |

---

## 11. 跨地域/多活兜底 (FS81-FS85) — L 规模扩展

> **本章节仅在 L 规模 (`l3_extended_mode=true`) 时必填。**

### FS81: 机房级故障 (DNS 切换 + 流量调度)

**对应失败**: F81 (机房级故障)
**防御深度**: 3 层

| 层 | 模式 | 配置 | 实现位置 | 触发 | 状态机 |
|----|------|------|---------|------|--------|
| L1 | DNS 切换 | TTL=60s, 异地双 DNS | `infra/multi_region/dns_failover.py` | 健康检查失败 5s | PRIMARY→SECONDARY |
| L2 | 流量调度 | 灰度 10%/50%/100% | `infra/multi_region/gradual_failover.py` | 切机房后 P99 上升 | 10%→50%→100% |
| L3 | 异地只读 | 写排队, 读就近 | `infra/multi_region/geo_routing.py` | 异地写延迟 > 阈值 | WRITE_QUEUE |

### FS82: 跨地域一致性 (业务对账 + Saga 补偿 + 强制读主)

**对应失败**: F82 (跨地域一致性违反)
**防御深度**: 4 层

| 层 | 模式 | 实现 | 触发 |
|----|------|------|------|
| L1 | 业务对账 (FS11-a/b/d) | `domain/reconciliation/order_payment.py` | 每 24h 跑批 |
| L2 | Saga 补偿 (FS3) | `domain/sagas/order_payment_saga.py::compensate()` | 异地写入冲突 |
| L3 | 强制读主 | `infra/db/read_strategy.py::force_primary()` | replica_lag > 5s |
| L4 | 人工对账 | PagerDuty "#payment-oncall" | 自动修复失败 |

### FS83: 异地数据同步延迟 (监控 + 强制读主 + 流量调度)

**对应失败**: F83 (异地数据同步延迟)
**防御深度**: 3 层

| 层 | 模式 | 实现 |
|----|------|------|
| L1 | 监控告警 | `infra/monitoring/replication_lag.py` |
| L2 | 强制读主 | `infra/db/read_strategy.py::force_primary()` |
| L3 | 流量调度 | 切到低延迟机房 |

### FS84: 机房切换回滚 (灰度切流 + 自动回滚)

**对应失败**: F84 (机房切换回滚)
**防御深度**: 3 层

| 层 | 模式 | 实现 |
|----|------|------|
| L1 | 灰度切流 | 10% → 50% → 100% |
| L2 | 自动回滚 | P99 不达标时立即回切 |
| L3 | 人工监控 | 切流期间 PagerDuty 告警 |

### FS85: 跨地域延迟 (就近接入 + 边缘缓存 + 异步化)

**对应失败**: F85 (跨地域延迟)
**防御深度**: 3 层

| 层 | 模式 | 实现 |
|----|------|------|
| L1 | 就近接入 | `infra/multi_region/geo_routing.py` (DNS 地理最近) |
| L2 | 边缘缓存 | `infra/cache/edge_cache.py` (CDN) |
| L3 | 跨地域异步化 | 写后即返回, 异步同步 |
