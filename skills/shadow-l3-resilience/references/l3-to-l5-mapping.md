# L3 → L5 传导规则 (L3 to L5 Mapping)

> L3 韧性层产出如何被 L5 Harness 计划消费、如何被 L6 灾难演练执行、Reviewer 怎么审计。

## 1. 传导链全景

```
L1.5 architecture.md ──┐
                       ├→ L3 failure-modes.md (FXX) ────────┐
L2 e2e.md ─────────────┤                                       │
                       ├→ L3 failsafe-design.md (FSXX) ──────┤
L1 research.md ────────┤                                       │
                       ├→ L3 chaos-scenarios.md (@chaos) ────┤
                       │                                       ↓
                       └→ L3 resilience-test-plan.md ───→ L5 plan
                       └→ L3 recovery-runbook.md ────────→ L6 deploy
                                                          → Reviewer
```

## 2. L3 → L5 Harness 计划

### 2.1 消费什么

| L3 产物 | L5 消费什么 | L5 在哪段使用 |
|---------|------------|--------------|
| `failure-modes.md` | FMEA 5 字段（触发/爆炸半径/检测/兜底/恢复）| "全局约束 → 兜底约束"段 |
| `failsafe-design.md` | FSXX 实现位置（具体文件路径）| "全局约束 → 兜底约束"段 + "逐文件指令"段 |
| `chaos-scenarios.md` | @chaos P0 场景的注入点 | "失败注入点"子段 + 韧性测试文件 |
| `resilience-test-plan.md` | 测试矩阵 + 单元/集成/契约测试路径 | "韧性测试文件"段 (3.4) |

### 2.2 L5 计划的新增段

L5 plan 在 L3 存在时必须新增/修改以下段（详细格式见 `shadow-l5-plan/SKILL.md` § 2.6, § 3.4, § 3.5）:

**§ 2.6 兜底约束段** (在"全局约束"段后追加):
```markdown
### 兜底约束 (L3 韧性层)

| 失败模式 ID | 兜底策略 | 实现位置 | 触发条件 | 恢复路径 | L3 引用 |
|------------|---------|---------|---------|---------|--------|
| F01 (调度层) | 限流 + 优先级 | infra/scheduler/quota.py | 并发 > 100 | 自动消化 | failure-modes.md §F01 |
| F11 (网络层) | 熔断 + 降级 | infra/http/circuit_breaker.py | 5s 内 3 次失败 | 探测恢复 | failsafe-design.md §F11 |
| ... | ... | ... | ... | ... | ... |
```

**§ 3.4 韧性测试文件段** (在 E2E 测试段后追加):
- 1 个新测试文件: `tests/chaos/{failure_mode}.py`
- 对应 @chaos P0 场景
- 用 `chaos.faults` 工具 + `chaos.assertions`

**§ 3.5 失败注入点 + 降级路径子段** (每个后端/前端文件追加):
- 失败注入点: 该文件可能注入什么失败（@pytest.mark.failure_mode("FXX")）
- 降级路径: 失败中 + 恢复后两阶段行为

### 2.3 逐文件指令新增子段示例

```markdown
### 文件: backend/domain/services/annotation_service.py

**上下文**: 标注聚合根的提交操作
**规则**: annotation-R03 (B02-N08)

#### 失败注入点 (L3 传导)
- F11 (网络分区): 注入点 = `http_client.post()`, 模拟下游 API 5s 超时
- F23 (事件积压): 注入点 = `event_bus.publish()`, 模拟队列已满
- 注入工具: `tests/chaos/faults.py::NetworkPartition` + `EventQueueFull`

#### 降级路径 (L3 传导)
- 失败 F11 → 降级到本地草稿 (`infra/storage/local_draft.py`), status = DRAFT_LOCAL
- 失败 F23 → 降级到同步重试 (`infra/event_sync.py`), 指数退避 1s/2s/4s
- 自动恢复: 故障消除后, 触发 `sync_local_drafts()` 把降级数据回写主存储
- 数据完整性: 降级期间不允许用户操作丢失, 完整审计日志
```

### 2.4 L5 计划的检查更新

L5 plan 的"逐文件检查"在原 6 项检查后追加 2 项:

| # | 检查项 |
|---|--------|
| 1 | 每个方法覆盖 spec RXX 规则 |
| 2 | 校验条件与 flow.mermaid 一致 |
| 3 | 事件与 event-contract.md 一致 |
| 4 | 聚合与 aggregate-landscape.md 一致 |
| 5 | API 调用与 architecture.md 一致 |
| 6 | 前端行为与 wire.svg 一致 |
| 7 | **(L3) 失败注入点覆盖 failsafe-design.md 中本文件相关策略** |
| 8 | **(L3) 降级路径定义了"故障中"和"恢复后"两阶段** |

## 3. L3 → L6 灾难演练

### 3.1 消费什么

| L3 产物 | L6 消费什么 | L6 在哪段使用 |
|---------|------------|--------------|
| `chaos-scenarios.md` | @chaos P0 场景 (注入命令 + 期望行为) | Phase 5.7 灾难演练 |
| `recovery-runbook.md` | 故障症状 + 立即动作 + 恢复步骤 | Phase 5.7 注入后操作 |

### 3.2 L6 Phase 5.7 新增

L6 在 L3 存在时必须新增 Phase 5.7 灾难演练（详细见 `shadow-l6-deploy/SKILL.md` Phase 5.7）:

**输入**:
- L3 `chaos-scenarios.md` 的 @chaos P0 场景
- L3 `recovery-runbook.md` 的故障症状 + 恢复步骤

**执行**:
1. 启动服务 (docker compose up -d --wait)
2. 准备测试数据
3. 跑 P0 场景 (注入 + 观察 + 恢复)
4. 收集证据
5. 写 issues.json

**输出**:
- `chaos-drill-evidence/FXX/` 每个 P0 场景一个目录
- `chaos-drill-evidence/results.xml` 测试结果
- `chaos-drill-evidence/issues.json` 发现问题

### 3.3 L6 部署报告新增章节

L6 报告必须新增"韧性验证"章节:

```markdown
## 11. 韧性验证 (L3 灾难演练)

| 失败模式 | 场景来源 | 注入方式 | 兜底行为 | 恢复时间 | 结果 |
|---------|---------|---------|---------|---------|------|
| F01 | chaos-scenarios §F01 | Nomad 并发 1500 | 限流生效 | N/A | ✅ |
| F11 | chaos-scenarios §F11 | iptables DROP | 熔断 OPEN + 降级 | 30s | ✅ |
| ... | ... | ... | ... | ... | ... |

**通过率**: 9/11 (82%, 阈值 80%)

**未通过场景**:
- F51 (消息积压): 消费者扩容后 lag 仍 > 60s → P1 问题, 详见 issues.json

**issues.json 摘要**:
- P0: 0
- P1: 2 (F51 扩容失效, F72 限流误伤正常流量)
- P2: 1 (F33 监控告警延迟 30s)
```

### 3.4 L6 自检新增项

L6 自检清单在原 29 项后追加 5 项:

| # | 检查项 |
|---|--------|
| 30 | L3 韧性验证章节存在 (纯前端豁免) |
| 31 | L3 chaos-scenarios P0 场景至少 80% 跑过 |
| 32 | L3 灾难演练证据目录存在 |
| 33 | L3 P0 兜底问题有根因 + 修复建议 |
| 34 | L3 失败模式 FMEA 五字段均被验证 |

## 4. L3 → Reviewer

### 4.1 消费什么

| L3 产物 | Reviewer 消费什么 | Reviewer 模式 |
|---------|------------------|--------------|
| `failure-modes.md` | FMEA 5 字段完整性 | `audit_type=resilience` |
| `failsafe-design.md` | FSXX 实现位置 | `audit_type=resilience` |
| `chaos-scenarios.md` | @chaos 场景可执行性 | `audit_type=resilience` |
| `resilience-test-plan.md` | 测试矩阵覆盖 | `audit_type=resilience` |
| L5 harness plan 的"兜底约束"段 | L3 → L5 传导 | `audit_type=chain` |
| L6 deploy report 的"韧性验证"章节 | L3 → L6 验证 | `audit_type=chain` |

### 4.2 Reviewer audit_type=resilience 12 项检查

（详细见 `shadow-reviewer/SKILL.md` § Resilience Audit）

| # | 检查项 | 通过标准 | FAIL 责任层 |
|---|--------|---------|-----------|
| R01 | failure-modes 8 维度覆盖 | ≥4 (S) / ≥6 (M/L) | L3 |
| R02 | 每个失败模式 5 字段 | 完整 | L3 |
| R03 | 失败模式引用 RXX | ≥1 | L3 |
| R04 | failsafe-design 实现位置 | 具体路径 | L3 |
| R05 | 兜底策略 ≥ 5 种 | 熔断/降级/补偿等 | L3 |
| R06 | chaos-scenarios @chaos 标签 | 必填 | L3 |
| R07 | 注入方式具体 | Given-When-Then 有命令 | L3 |
| R08 | L5 plan 引用 L3 | 兜底约束段每行可追溯 | L5 Plan |
| R09 | L5 plan 失败注入点段 | 存在 | L5 Plan |
| R10 | L6 灾难演练证据 | chaos-drill-evidence/ | L6 |
| R11 | L6 issues.json 根因 + 修复 | 存在 | L6 |
| R12 | runbook 可执行 | 每步有命令 | L3 |

### 4.3 Reviewer audit_type=chain 6+1 段

L3 出现后, chain 审计新增 3 段:

| 段 | 验证内容 |
|----|----------|
| L1+L1.5→L3 | L3 failure-modes.md 覆盖 L1 全部 RXX |
| L3→L5 Plan | L3 failsafe-design.md 兜底策略在 L5 plan 全部出现 |
| L3→L5 Impl | L5 plan 失败注入点段被 L5 impl 实装 |
| L3→L6 | L3 chaos-scenarios P0 在 L6 灾难演练执行 |

## 5. 完整示例 (Nomad 调度类业务)

### 5.1 失败模式 (L3 failure-modes.md)

| F01 | Nomad 调度风暴 | 并发任务 > 1000 | collection-R01~R05 (B01-N01~N05) | Nomad 队列 > 500 | FS01 | 高 | 自动消化 |

### 5.2 兜底设计 (L3 failsafe-design.md)

```markdown
### FS01: Nomad 调度风暴兜底

| 层 | 模式 | 配置 | 实现位置 |
|----|------|------|---------|
| L1 | 限流 | MAX=100, RATE=10/s | infra/scheduler/quota.py |
| L2 | 优先级队列 | CRITICAL/HIGH/NORMAL | domain/queues/priority.py |
| L3 | OOM 自杀重启 | max=2GB | infra/scheduler/oom_watcher.py |
```

### 5.3 L5 兜底约束段 (L5 harness-plan.md)

```markdown
### 兜底约束 (L3 韧性层)

| 失败模式 ID | 兜底策略 | 实现位置 | 触发条件 | 恢复路径 |
|------------|---------|---------|---------|---------|
| F01 | 限流 + 优先级 + OOM 保护 | infra/scheduler/quota.py + domain/queues/priority.py + infra/scheduler/oom_watcher.py | 并发 > 100 | 自动消化 |
```

### 5.4 L5 失败注入点子段 (L5 harness-plan.md)

```markdown
### 文件: backend/infra/scheduler/quota.py

#### 失败注入点 (L3 传导)
- F01 (调度风暴): 注入点 = `quota.acquire()`, mock 并发 1500
- 注入工具: `tests/chaos/test_f01.py::test_quota_under_storm`

#### 降级路径 (L3 传导)
- 失败 F01 → 限流生效 (accept 100, reject 1400)
- 自动恢复: 流量回落后 quota 自然恢复
```

### 5.5 L6 灾难演练 (L6 chaos-drill-evidence/F01/)

```
F01/
├── inject.log        # nomad job dispatch 1500 个任务的命令历史
├── monitoring.png    # Nomad 队列监控截图
├── result.json       # {"pass": true, "accept": 100, "reject": 1400}
└── issues.json       # []
```

### 5.6 Reviewer 审计 (audit_type=resilience)

```json
{
  "R01": "PASS - 8 维度全覆盖",
  "R02": "PASS - F01 5 字段完整",
  "R03": "PASS - 引用 collection-R01~R05",
  "R04": "PASS - 实现位置具体",
  "R05": "PASS - 5 种模式 (限流/优先级/OOM/重试/健康检查)",
  "R06": "PASS - 2 个 @chaos 场景",
  "R07": "PASS - 注入命令具体 (nomad job dispatch)",
  "R08": "PASS - L5 plan 兜底约束段有 F01 行",
  "R09": "PASS - L5 plan 失败注入点段存在",
  "R10": "PASS - chaos-drill-evidence/F01/ 存在",
  "R11": "PASS - issues.json 为空 (无 P0 问题)",
  "R12": "PASS - runbook §4.3 有具体命令"
}
```

## 6. 关键约束

1. **L3 必跑**: `scale.l3_required = true` 时, 所有规模项目必须过 L3
2. **双向追溯**: 每个 FXX 必须引用 RXX, 每个 FSXX 必须有实现位置
3. **完整闭环**: L3 failure-modes → failsafe-design → chaos-scenarios → L5 兜底约束 → L5 失败注入点 → L6 灾难演练 → Reviewer 审计
4. **不阻塞**: L3 软门禁, 缺文件不阻塞, 只警告
5. **不重复**: L3 互补 L1.5 SDD/PDD/L2 BDD/L6 Phase 5.6, 不重复

---

## 7. L 规模扩展映射 (l3_extended_mode=true)

> **本节仅在 L 规模 (`l3_extended_mode=true`) 时使用。**

### 7.1 L5 额外消费 (业务对账 + 业务幂等)

**L5 Plan "逐文件指令" 新增 2 个子段** (在 § 3.5 失败注入点/降级路径后追加):

```markdown
#### 业务对账测试点 (L3 传导, L 规模)
- FS11-a 订单-库存对账: tests/chaos/reconciliation/test_order_inventory.py
- FS11-b 订单-支付对账: tests/chaos/reconciliation/test_order_payment.py
- 测试方法: 直接 SQL 制造不一致 → 跑批 → 断言自动修复

#### 业务幂等测试点 (L3 传导, L 规模)
- FS12-a 支付幂等: 3 层防护测试 (Redis key + DB UNIQUE + 状态机)
- FS12-b 订单幂等: 同 order_id 重复提交测试
- 测试方法: 并发 10 次同 payment_id → 断言只成功 1 次
```

**L5 Plan "全局约束" 新增子段** (在 § 2.6 兜底约束后追加):

```markdown
### 业务对账约束 (L3 韧性层, L 规模)
- 业务对账跑批 cron: `0 2 * * *` (每日凌晨 2 点)
- 对账容差: 资金类 0 元, 物流类 1h, 优惠类 0.01 元
- 自动修复: 资金类启用, 其他可选
- 升级路径: PagerDuty #payment-oncall (P1)
- 实现位置: domain/reconciliation/{type}.py

### 业务幂等约束 (L3 韧性层, L 规模)
- 业务唯一键: order_id / payment_id / refund_id / (coupon_id, order_id) 全部 DB UNIQUE
- 状态机幂等: 终态 (CANCELLED/REFUNDED/DELIVERED) 不可再转换
- 装饰器: @business_idempotent(key_fn, state_machine)
- 实现位置: domain/idempotency/business_idempotent.py
```

### 7.2 L6 Phase 5.7 新增演练段 (跨地域 + 业务对账)

**L6 灾难演练 Phase 5.7 新增 § 5.7.1 跨地域演练**:

```bash
# 跨地域 @chaos 场景 (来自 L3 chaos-scenarios.md § 9)
pytest tests/chaos/cross_region/ -m "chaos and P0 and cross_region" \
  --tb=short \
  --junit-xml=chaos-drill-evidence/cross_region/results.xml
```

**L6 灾难演练 Phase 5.7 新增 § 5.7.2 业务对账演练**:

```bash
# 业务对账演练 (5 类对账必跑)
pytest tests/chaos/reconciliation/ \
  -m "chaos and P0" \
  --junit-xml=chaos-drill-evidence/reconciliation/results.xml
```

### 7.3 Reviewer audit_type=resilience L 规模扩展检查

**原 12 项 R 检查, L 规模新增 5 项**:

| # | 检查项 | 通过标准 | FAIL 责任层 |
|---|--------|---------|-----------|
| R13 | failure-modes 9 维度覆盖 | ≥6 含维度 9 跨地域 | L3 |
| R14 | FMEA 8 字段完整 | Owner/SLO 关联/回滚时长 必填 | L3 |
| R15 | 兜底策略 ≥ 8 选 | 含业务对账 (FS11) + 业务幂等 (FS12) | L3 |
| R16 | L5 plan 业务对账测试段 | 5 类对账都测 | L5 Plan |
| R17 | L6 跨地域演练 P0 | 5 个 F8X 场景必跑 | L6 |

### 7.4 L 规模上下游消费总结

**L 规模数据流**:
```
L1.5 architecture (含异地复制策略)
    ↓
L3 failure-modes (9 维 + 8 字段)
    ↓
L3 failsafe-design (12 模式 + FS81-FS85 + FS11/FS12)
    ↓
L3 chaos-scenarios (16 个 P0 @chaos)
    ↓
L5 plan 兜底约束 (含业务对账/业务幂等测试)
    ↓
L5 plan 失败注入点 + 降级路径 (含跨地域演练)
    ↓
L5 impl (实装 FS11/FS12 + FS81-FS85)
    ↓
L6 Phase 5.7 灾难演练 (16 P0 @chaos)
    ↓
Reviewer audit_type=resilience (17 项 R 检查)
```
