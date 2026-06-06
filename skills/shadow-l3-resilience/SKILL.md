---
name: shadow-l3-resilience
alias: Shadow·L3-Resilience
methodology: RDA — Resilience-Driven Architecture (FMEA + Chaos Engineering + Resilience Engineering)
description: |
  Shadow L3 韧性设计 — 在 L1.5 ADD+SDD+PDD（架构骨架）和 L2 BDD+CM（行为骨架）之上做"灾难发散"。
  标准模式 (S/M 规模): 8 维度失败模式 + 10 兜底模式 + 5 字段 FMEA。
  扩展模式 (L 规模, scale.l3_extended_mode=true): 9 维度 (+跨地域/多活) + 12 模式 (+业务对账/业务幂等) + 8 字段 FMEA (+Owner/SLO 关联/回滚时长)。
  产出 5 份文档：failure-modes.md / failsafe-design.md / chaos-scenarios.md / resilience-test-plan.md / recovery-runbook.md。
  与 L1/L1.5/L2 互补不重复：L1.5 SDD 只覆盖 STRIDE 6 类安全威胁，L1.5 PDD 只覆盖性能正常态，L2 BDD 只覆盖行为级并发/会话/误用，本层覆盖"系统性失败的可控实验"。
  软门禁：缺文件不阻塞流水线，只警告。`.shadow/scale.l3_required: true` 时所有规模强制使用；L 规模时 `.shadow/scale.l3_extended_mode: true` 自动启用 9 维 + 12 模式 + 8 字段。
  触发：韧性、resilience、混沌、chaos、失败模式、failure mode、兜底、fallback、熔断、circuit breaker、容错、fault tolerance、降级、degradation、补偿、compensation、极端条件、extreme conditions、RDA、业务对账、reconciliation、业务幂等、business idempotency、跨地域、multi-region。
version: "1.1.0"
---

# Shadow·RDA — 韧性驱动架构

## 角色

在 **ADD（架构）** + **BDD（验收）** 骨架上做"灾难发散"，回答四个问题：

1. **系统挂了会怎样？** → `failure-modes.md`（8 维度 FMEA 目录）
2. **怎么发现挂了？** → `failsafe-design.md`（检测信号 + 兜底策略 + 实现位置）
3. **怎么兜住？** → `chaos-scenarios.md`（@chaos Gherkin 场景 + 注入点）
4. **怎么恢复？** → `recovery-runbook.md`（运维值班剧本 + 故障消除后自愈路径）

**与 L1.5 SDD/PDD 的边界**（不重复也不漏）：

| 已有层 | 覆盖 | L3 补充 |
|--------|------|--------|
| L1.5 SDD STRIDE | Spoofing/Tampering/Repudiation/Info Disclosure/**DoS**/EoP | 6 类安全威胁的**系统性失败后果**（如 DoS 不只"防 DoS"，还包含"已被 DoS 时降级到核心服务"） |
| L1.5 PDD 性能基准 | P50/P99、连接池、缓存 | **性能崩了之后**怎么活（连接池耗尽 → 队列降级 + 用户感知提示） |
| L2 覆盖矩阵维度 10/11/12 | 行为级并发/会话连续/误操作 | **系统级**失败（调度器挂、网络分区、事件积压、DB 脑裂） |
| L6 Phase 5.6 漫游 | 未知 UX 问题 | **已知失败**的可控实验（chaos drill 验证兜底真的工作） |

**摩天大厦隐喻**：L1.5 是钢筋骨架，L2 是房间布置，L3 是**消防/抗震/避难层**。

## 怎么做

### 1. 读骨架（必读）

按优先顺序读：

1. **L1.5 architecture.md** § 6 API 端点清单（确认"正常路径"基线）
2. **L1.5 event-contract.md**（事件传递方式 = 兜底设计基线）
3. **L1.5 architecture.md** § 3 技术栈决策（决定哪些兜底模式可用，如 Redis Streams 才能做背压）
4. **L2 e2e.md**（确认 BDD 行为基线，找它的反面）
5. **L1 research.md** § 限界上下文（跨边界失败点）
6. **L1.5 aggregate-landscape.md**（跨聚合一致性边界 = 兜底策略边界）

**消费表**（写在 status.md 必读段）：

| 上游 | 消费什么 | 用于哪份产出 |
|------|---------|------------|
| L1.5 architecture.md | 技术栈、API 端点、文件清单 | 全部 5 份（决定可用的兜底模式）|
| L1.5 event-contract.md | 事件传递方式（同步/异步/重试）| failsafe-design.md（事件层失败兜底）|
| L1.5 aggregate-landscape.md | 聚合边界、一致性边界 | failure-modes.md（爆炸半径）、failsafe-design.md（补偿/Saga）|
| L2 e2e.md | BDD 场景、覆盖矩阵 | chaos-scenarios.md（基线 → 反面）|
| L1 research.md | 限界上下文 | failure-modes.md（跨上下文失败）|

### 2. 8 维度 (标准) / 9 维度 (扩展 L 规模) 发散（穷举失败模式）

按 9 个维度系统枚举失败模式，**不能漏**。每条失败模式用 FMEA 字段描述（标准 5 字段 / 扩展 8 字段）：

**FMEA 字段对照**：

| 字段 | 标准模式 | 扩展模式 (L 规模) | 含义 | 示例 (F12 网络分区) |
|------|----------|------------------|------|-------------------|
| 1 | ✅ | ✅ | **触发条件** | 下游 API 5s 内 3 次超时 |
| 2 | ✅ | ✅ | **爆炸半径** | annotation-R03, collection-R05 (B01-N05/B02-N08) |
| 3 | ✅ | ✅ | **检测信号** | http_client 超时率 > 30% |
| 4 | ✅ | ✅ | **兜底策略** | 熔断 + 降级 + 重试 |
| 5 | ✅ | ✅ | **恢复路径** | 熔断器 HALF_OPEN + 草稿自动 sync |
| 6 | ❌ | ✅ | **Owner** | #payment-oncall (L 规模跨团队必填) |
| 7 | ❌ | ✅ | **SLO 关联** | 资金 / 可用性 / 性能 / 合规 (多选) |
| 8 | ❌ | ✅ | **回滚时长** | 资金类 5min / 性能类 1h / 合规类 24h |

**8 维度速记** (S/M 规模):

| # | 维度 | 典型失败 |
|---|------|---------|
| 1 | **调度层** | Nomad 调度风暴、调度器宕机、节点失联、Leader 脑裂 |
| 2 | **网络层** | 分区、抖动、丢包、DNS 失效、TCP 半开、代理超时 |
| 3 | **状态层** | 状态漂移、版本冲突、时钟漂移、缓存不一致、击穿/雪崩/穿透 |
| 4 | **资源层** | OOM、磁盘满、连接池耗尽、CPU 100%、FD 上限、线程池耗尽 |
| 5 | **数据层** | DB 主从切换、复制延迟、事务死锁、热点行、长事务、索引失效 |
| 6 | **事件层** | 消息积压、重复消费、顺序错乱、订阅者宕机、DLQ 溢出、事件丢失 |
| 7 | **依赖层** | 第三方宕机、响应慢、错误返回、配额耗尽、凭据失效、协议变更 |
| 8 | **流量层** | 突发流量、DDoS、爬虫、慢速连接攻击、大请求体 |

**9 维度速记** (L 规模, 扩展模式 - 加第 9 维度):

| # | 维度 | 典型失败 (新增) |
|---|------|----------------|
| 9 | **跨地域/多活** (MRG) | 机房级故障、跨地域一致性、异地数据同步延迟、机房切换回滚、跨地域延迟 |

完整 9 维度发散指南见 `references/failure-mode-catalog.md`。

**规模与维度对应**:

| 规模 | 启用维度 | 兜底模式 | FMEA 字段 |
|------|---------|---------|-----------|
| S | 8 维 ≥ 4 | 10 模式 ≥ 5 | 5 字段 |
| M | 8 维 ≥ 6 | 10 模式 ≥ 5 (建议补 12) | 5 字段 |
| **L** | **9 维 ≥ 6** | **12 模式 ≥ 8** | **8 字段** |

### 3. 兜底设计（10 模式标准 / 12 模式扩展）

`failsafe-design.md` 中每个失败模式必须指定兜底策略，策略来自以下 10/12 个模式（按"防御深度"组合使用）：

**10 模式 (标准, S/M 规模)**:

| # | 模式 | 何时用 | 实现位置示例 |
|---|------|--------|------------|
| 1 | **熔断** (Circuit Breaker) | 下游异常时快速失败 | `infra/http/circuit_breaker.py` |
| 2 | **降级** (Degradation) | 核心链路兜底，非核心砍掉 | `domain/services/degraded.py` |
| 3 | **补偿** (Compensation / Saga) | 跨聚合事务失败回滚 | `domain/sagas/{slug}_saga.py` |
| 4 | **重试** (Retry w/ backoff) | 幂等操作瞬时失败 | `infra/http/retry.py` |
| 5 | **限流** (Rate Limit) | 保护下游不被冲垮 | `infra/middleware/rate_limit.py` |
| 6 | **背压** (Backpressure) | 上下游速度匹配 | `infra/queue/backpressure.py` |
| 7 | **隔离** (Bulkhead) | 故障不传染 | `infra/pools/{pool}_bulkhead.py` |
| 8 | **幂等** (Idempotency Key) | 重复操作不产生副作用 (技术幂等) | `domain/decorators/idempotent.py` |
| 9 | **超时** (Timeout) | 永远设上限 | `infra/http/timeout.py` |
| 10 | **健康检查** (Health Check) | 自我感知 + 摘除 | `app/api/routes/health.py` |

**+2 模式 (扩展, L 规模 - 加业务兜底)**:

| # | 模式 | 何时用 | 实现位置示例 |
|---|------|--------|------------|
| 11 | **业务对账** (Reconciliation) | 跨系统/跨服务状态最终一致性兜底 (L 规模电商/支付/资金类必用) | `domain/reconciliation/reconciler.py` |
| 12 | **业务幂等** (Business Idempotency) | 业务唯一约束 + 状态机幂等 (支付幂等键、订单防重) | `domain/idempotency/business_idempotent.py` |

每个模式的实现要点、配置参数、失效检测详见 `references/failsafe-patterns.md`。

**Nomad 调度风暴示例**（来自用户原始诉求）：

| 字段 | 内容 |
|------|------|
| 失败 ID | F01 |
| 维度 | 调度层 |
| 触发条件 | 并发 Nomad 任务 > 1000，调度队列堆积 |
| 爆炸半径 | collection-R01~R05 (B01-N01~N05) 全部采集任务延迟 |
| 检测信号 | Nomad alloc 排队数 > 500 + 调度延迟 P99 > 5s |
| 兜底策略 | ① 限流（BatchSize=100/s）+ ② 优先级队列 + ③ OOM 自杀重启 + ④ 健康检查摘除 |
| 恢复路径 | 积压消化后自动 rejoin + 告警人工确认 |

### 4. 混沌场景（@chaos Gherkin）

`chaos-scenarios.md` 把每个高优先级失败模式翻译成可执行的 Gherkin 场景。

**强制标签**：
- `@chaos` — 标记这是混沌场景
- `@failure-mode-FXX` — 关联 failure-modes.md 的 FXX
- `@P0` / `@P1` — 优先级
- `@covers-RXX` / `@covers-BXX-NYY` — 关联 L1 规则和节点

**完整 @chaos 场景模板**：

```gherkin
@chaos @P0 @failure-mode-F12 @covers-annotation-R03 (B02-N08)
Scenario: 网络分区下标注提交降级
  Given 服务已启动 (docker compose up -d --wait)
    And 标注员已登录 (annotator_session fixture)
    And 任务 TASK-001 状态 IN_PROGRESS
  
  When 注入: 模拟下游 annotation-api 端口网络分区 30s
    And (具体命令: iptables -A OUTPUT -p tcp --dport annotation-api -j DROP)
    And 标注员尝试 POST /api/annotations/TASK-001/submit
  
  Then 5s 内触发熔断 (circuit_state = OPEN)
    And 标注自动降级到本地草稿 (status = DRAFT_LOCAL)
    And UI 显示 "已存为草稿, 网络恢复后自动提交" 横幅
    And 3 次重试后熔断器状态保持 OPEN (避免雪崩)
  
  When 撤销注入: iptables -D OUTPUT -p tcp --dport annotation-api -j DROP
  
  Then 30s 内熔断器自动转 HALF_OPEN
    And 草稿自动 sync 到主存储
    And 标注状态变为 SUBMITTED
    And 数据完整性断言: 标注的 values 与降级前一致 (无丢失)
```

**注入方式必须具体**（不是"模拟网络故障"这种空话）：

| 失败类型 | 注入方式（具体命令）|
|---------|------------------|
| 网络分区 | `iptables -A OUTPUT -p tcp --dport <port> -j DROP` |
| 服务冻结 | `docker pause <container>` / `kill -STOP <pid>` |
| 进程崩溃 | `kill -9 <pid>` / `docker kill <container>` |
| OOM | `docker update --memory 100m <container>` + `stress-ng --vm 1 --vm-bytes 200m` |
| 磁盘满 | `dd if=/dev/zero of=/tmp/fill bs=1M count=<available>` |
| DB 慢查询 | `pg_terminate_backend(pid)` + 锁表 + `SELECT pg_sleep(30)` |
| 队列积压 | `rabbitmqctl stop_app` / 关闭 consumer |
| 时钟漂移 | `date -s "+10 minutes"` (需 root 沙箱) |
| DNS 失效 | 修改 `/etc/hosts` 指向不存在 IP |
| 第三方超时 | mock adapter + `asyncio.sleep(60)` |

详细 Gherkin 写法见 `references/chaos-scenario-guide.md`。

### 5. 韧性测试计划

`resilience-test-plan.md` 把混沌场景转译为可执行的测试矩阵：

| 失败模式 | 自动化测试 | 手工测试 | 巡检项 |
|---------|-----------|---------|--------|
| F01 调度风暴 | chaos/test_f01.py | runbook §F01 复盘 | Nomad 队列监控 |
| F12 网络分区 | chaos/test_f12.py | iptables 现场演练 | tcp 连接数 |

**测试层级**：

- **单元测试**（L5 impl）：单个兜底组件的开关/配置/状态
- **集成测试**（L5 impl + L3 chaos）：聚合 + 兜底协作
- **契约测试**（L3 ↔ L5）：失败注入 → 期望响应
- **灾难演练**（L6 Phase 5.7）：真环境 + 真实注入

详细测试策略见 `references/resilience-test-guide.md`。

### 6. 恢复剧本（运维值班用）

`recovery-runbook.md` 是人工操作的剧本，每条故障症状 → 立即动作 → 根因诊断树 → 恢复步骤。

**关键原则**：
- 不写"联系运维"这种空话
- 每步有具体命令（kubectl/docker/redis-cli/psql）
- 区分"自动恢复"和"人工介入"
- 包含回滚路径

详细模板见 `templates/recovery-runbook.md` 和 `references/runbook-template.md`。

## 产出

> **生命周期角色**:`design_baseline` 设计基线。`failure-modes.md` / `failsafe-design.md` / `chaos-scenarios.md` / `resilience-test-plan.md` / `recovery-runbook.md` 5 份文档均跨迭代复用,改后触发 L5 Plan 兜底约束 + L5-impl 实装 + L6 Phase 5.7 灾难演练 + Reviewer R08 韧性审计。详见 `.shadow/shadow-schema.json:lifecycle_artifacts` → `failure-modes` / `failsafe-design` / `chaos-scenarios` / `resilience-test-plan` / `recovery-runbook`。

5 份文档，路径规范：

```
.shadow/L3-resilience/
└── BXX-{slug}/
    ├── failure-modes.md           # 失败模式目录 (FMEA 8 维度 × 5 字段)
    ├── failsafe-design.md         # 兜底设计 (10 模式 × 实现位置)
    ├── chaos-scenarios.md         # 混沌场景 (@chaos Gherkin)
    ├── resilience-test-plan.md    # 韧性测试计划 (测试矩阵)
    └── recovery-runbook.md        # 恢复剧本 (运维值班用)
```

每份的详细模板见 `templates/`。

## 约束

### 必填字段

- **failure-modes.md**：每行必须有 5 字段完整 + 至少 1 个 RXX/BXX-NYY 引用
- **failsafe-design.md**：每个兜底策略必须有"实现位置"（不是"在某处"）
- **chaos-scenarios.md**：每个 Scenario 的 When 步骤必须有**具体注入命令**
- **resilience-test-plan.md**：每个失败模式必须有自动化 + 手工测试路径
- **recovery-runbook.md**：每步恢复必须有具体命令

### 8/9 维度约束

- S 规模: 8 维 ≥ 4
- M 规模: 8 维 ≥ 6
- L 规模 (l3_extended_mode=true): 9 维 ≥ 6
- 漏维度即断（reviewer 阶段 R01 失败）

### 10/12 模式约束

- S 规模: 10 模式 ≥ 5 选
- M 规模: 10 模式 ≥ 5 选 (建议 7+)
- L 规模 (l3_extended_mode=true): 12 模式 ≥ 8 选 (必须含 业务对账 + 业务幂等)

### FMEA 字段约束

- 标准模式: 5 字段必填 (触发/爆炸半径/检测/兜底/恢复)
- 扩展模式 (L 规模): 8 字段必填 (加 Owner/SLO 关联/回滚时长), 不允许 TBD

### 与上游一致性

- 失败模式的"爆炸半径"列必须引用 L1 RXX 或 L1.5 API 端点
- 兜底策略的"实现位置"必须与 L1.5 文件清单对齐
- 混沌场景的注入命令必须能在 docker compose 环境下执行
- recovery-runbook 的命令必须在生产 + 测试环境都可跑

### 与下游传导

- L5 plan 引用 `failsafe-design.md` 写"兜底约束"段
- L5 plan 引用 `chaos-scenarios.md` 写"失败注入点"段
- L6 Phase 5.7 灾难演练引用 `chaos-scenarios.md` 的 P0 子集
- Reviewer `audit_type=resilience` 检查 L3 → L5/L6 传导完整性

## 软门禁

```bash
bash skills/shadow-l3-resilience/scripts/gate-check-l3.sh <slug>
```

**软门禁行为**：
- 5 份文件任一缺失 → 打印警告，**不阻塞**
- 文件行数不达标 → 打印警告，**不阻塞**
- 缺维度覆盖 → 打印警告，**不阻塞**
- `l3_extended_mode=true` 但维度/模式/字段不达标 → 打印警告 (新增)
- 仅打印状态，exit code 永远 0

**为什么是软门禁**：L3 是"补遗"层，缺 L3 不应该阻塞主流程。但 `.shadow/scale.l3_required: true` 时，新项目必须在 L5 之前显式标注 L3 ✅（schema 模板已包含 L3 行）。

### 扩展模式 (l3_extended_mode) 联动

`.shadow/scale.md` 的 `l3_extended_mode` 字段控制是否启用 9 维 + 12 模式 + 8 字段：

| scale | l3_extended_mode (默认) | 输出 |
|-------|------------------------|------|
| S | false | 8 维 + 10 模式 + 5 字段 |
| M | false | 8 维 + 10 模式 + 5 字段 (建议补 12 模式) |
| L | **true** (建议) | 9 维 + 12 模式 + 8 字段 |

Walker 在 L 规模判定时自动设置 `l3_extended_mode=true`。可手动覆盖。

## 传导链追溯

```
L1.5 architecture.md ──┐
                       ├→ L3 failure-modes.md (FXX 标 RXX/BXX-NYY) ─┐
L2 e2e.md ─────────────┤                                              ├→ L5 plan ─→ L5 impl ─→ L6
                       └→ L3 failsafe-design.md (FSXX 实现位置) ────┤
                                                                      ↓
                                                              L3 chaos-scenarios.md (@chaos)
```

**双向追溯**：
- 上行：每个 FXX 引用 RXX/BXX-NYY（L1）/API（L1.5）
- 下行：每个 FXX 在 L5 plan 的某 Batch 文件指令中实现
- 验证：reviewer `audit_type=resilience` 模式扫描这条链

## 边界声明（再次强调）

L3 **不重复**：
- L1.5 SDD 6 类 STRIDE 威胁（DoS 仅其中之一）
- L1.5 PDD 性能基准与缓存策略（性能正常态）
- L2 覆盖矩阵 14 维度（行为级）
- L6 Phase 5.6 漫游（未知 UX 问题）

L3 **互补**：
- L1.5 SDD 提供的"防 DoS" → L3 提供"被 DoS 时降级到核心服务"
- L1.5 PDD 提供的"连接池 = 20" → L3 提供"连接池耗尽 → 队列降级 + 用户感知"
- L2 维度 11 "会话连续性" → L3 提供"会话状态存储崩溃 → 重建路径"
- L6 5.6 漫游发现的"未知 UX 问题" → L3 把"已知失败"做可控实验

## 完整示例

> 完整示例（Nomad 调度类 + 标注类业务）见 `references/l3-to-l5-mapping.md` 和 `templates/` 5 份模板。
