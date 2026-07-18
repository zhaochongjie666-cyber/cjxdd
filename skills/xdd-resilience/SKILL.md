---
name: xdd-resilience
description: |
  xdd 设计层 —— 韧性锚。在 architecture（结构骨架）+ spec（行为骨架）之上做"灾难发散"。
  RDA：FMEA 失败模式 + 兜底设计 + 混沌场景 + 恢复剧本。回答：挂了会怎样 / 怎么发现 / 怎么兜 / 怎么恢复。
  8 维度失败模式 + 10 兜底模式 + 5 字段 FMEA（大项目加跨地域第 9 维 + 业务对账/幂等 2 模式 + 3 字段）。
  产出 colocation 到 architecture/{bxx-slug}/resilience/：failure-modes.md / failsafe-design.md / chaos-scenarios.md / resilience-test-plan.md / recovery-runbook.md。
  触发：韧性、resilience、混沌、chaos、失败模式、failure mode、兜底、fallback、熔断、circuit breaker、容错、降级、degradation、补偿、compensation、极端条件、业务对账、业务幂等、FMEA、灾难、recovery。
---

# xdd-resilience — 韧性锚

## 我锚定什么 / 上游 / 下游

**我锚定的是「系统挂了之后怎么办」** —— 在正常路径之外，穷举失败，设计兜底，能验证能恢复。韧性是架构的延伸：失败模式建立在 architecture 的战术之上。

| | |
|---|---|
| **上游** | `xdd-architecture`（架构 + 运维视图 §失败模型 = 韧性种子）+ `xdd-spec`（行为基线，找它的反面） |
| **我产出** | `architecture/{bxx-slug}/resilience/` 5 文档 |
| **下游消费者** | `xdd-plan`（兜底约束 + 失败注入点写进 task）、`xdd-verify`（混沌演练验兜底） |
| **回溯锚** | 每条失败模式 FXX 引用爆炸半径（RXX 规则 / API 端点）；每个兜底策略标实现位置 |

> **失败模式怎么排优先级、兜底模式怎么选、混沌测哪些 → 查 `references/resilience-decisions.md`**（韧性设计决策：爆炸半径×概率排级 / 按失败类型选兜底 / 避免>兜底>接受）。

## 边界（跟上游不重复）

| 已有层 | 覆盖 | 本层补充 |
|--------|------|---------|
| architecture SDD STRIDE | 安全威胁 | 安全威胁的**系统性失败后果** |
| architecture PDD 性能基准 | P50/P99、缓存 | **性能崩了之后**怎么活 |
| spec 行为 | 正常行为 | **系统级**失败 |
| verify 漫游 | 未知 UX 问题 | **已知失败**的可控实验 |

## 怎么做

### 1. 读骨架（必读）

1. `architecture/{bxx-slug}/architecture.md` §运维视图 §失败模型（正常路径基线 + 失败种子）
2. `architecture/event-contract.md`（事件传递方式 = 兜底设计基线）
3. `architecture/{bxx-slug}/architecture.md` §技术栈（决定哪些兜底模式可用）
4. `spec/{bxx-slug}/*.feature`（行为基线，找反面）
5. `architecture/aggregate-landscape.md`（跨聚合一致性边界 = 兜底策略边界）

### 2. 8 维度（+1 大项目）失败模式发散

按维度系统枚举，每条用 FMEA 字段描述：

**8 维度**：

| # | 维度 | 典型失败 |
|---|------|---------|
| 1 | 调度层 | 调度风暴、调度器宕机、节点失联、Leader 脑裂 |
| 2 | 网络层 | 分区、抖动、丢包、DNS 失效、TCP 半开、代理超时 |
| 3 | 状态层 | 状态漂移、版本冲突、时钟漂移、缓存不一致 |
| 4 | 资源层 | OOM、磁盘满、连接池耗尽、CPU 100%、FD 上限 |
| 5 | 数据层 | DB 主从切换、复制延迟、事务死锁、热点行 |
| 6 | 事件层 | 消息积压、重复消费、顺序错乱、DLQ 溢出 |
| 7 | 依赖层 | 第三方宕机、响应慢、错误返回、配额耗尽 |
| 8 | 流量层 | 突发流量、DDoS、爬虫、慢速连接攻击 |

**+1 大项目加**：跨地域/多活（机房级故障、跨地域一致性、异地同步延迟）。

**FMEA 字段**（每条失败模式）：

| 字段 | 含义 | 示例（网络分区） |
|------|------|----------------|
| 触发条件 | 什么时候发生 | 下游 API 5s 内 3 次超时 |
| 爆炸半径 | 影响哪些规则/端点 | R03 标注、R05 采集 |
| 检测信号 | 怎么发现 | http_client 超时率 > 30% |
| 兜底策略 | 怎么应对 | 熔断 + 降级 + 重试 |
| 恢复路径 | 怎么自愈 | 熔断器 HALF_OPEN + 草稿自动 sync |
| Owner *(大项目)* | 谁负责 | #payment-oncall |
| SLO 关联 *(大项目)* | 资金/可用性/性能/合规 | 可用性 |
| 回滚时长 *(大项目)* | 多久恢复 | 资金类 5min / 性能类 1h |

**目标**：至少覆盖 6 个维度，大项目覆盖跨地域。漏维度即断。

### 3. 兜底设计（10 模式，大项目 +2）

`failsafe-design.md` 每个失败模式指定兜底策略 + **实现位置**：

| # | 模式 | 何时用 |
|---|------|--------|
| 1 | 熔断 Circuit Breaker | 下游异常时快速失败 |
| 2 | 降级 Degradation | 核心链路兜底 |
| 3 | 补偿 Compensation/Saga | 跨聚合事务失败回滚 |
| 4 | 重试 Retry w/ backoff | 幂等操作瞬时失败 |
| 5 | 限流 Rate Limit | 保护下游 |
| 6 | 背压 Backpressure | 上下游速度匹配 |
| 7 | 隔离 Bulkhead | 故障不传染 |
| 8 | 幂等 Idempotency Key | 重复操作无副作用 |
| 9 | 超时 Timeout | 永远设上限 |
| 10 | 健康检查 Health Check | 自我感知 + 摘除 |
| 11 | 业务对账 Reconciliation *(大项目)* | 跨系统最终一致兜底 |
| 12 | 业务幂等 *(大项目)* | 业务唯一约束 + 状态机幂等 |

**目标**：至少选 5 个模式，大项目选 8+（必含业务对账 + 业务幂等）。

`failsafe-design.md` 每个失败模式一行（兜底策略 + 实现位置 + 实施状态）：

```markdown
| 失败模式 FXX | 兜底模式 | 实现位置 | 实施 |
|-------------|---------|---------|------|
| F01 Worker 断网 | 重试 w/ backoff | app/workers/queue.py:42 | - [ ] |
| F12 提交服务超时 | 熔断 Circuit Breaker | app/services/submit.py:88 | - [ ] |
```

**「实施」列语义**：
- `- [x]` = 该兜底在代码有 `@failure-mode-FXX` 关联实现且 chaos 演练该场景兜底真生效；`- [ ]` = 未实施
- 运行时状态，不参与韧性设计内容评审冻结；可由 `xdd-verify/scripts/sync-contract-checkboxes` 半自动翻转

**标签格式规约**：failsafe-design 每个兜底条目用 `@failure-mode-FXX`（**连字符，连写**，与 chaos-scenarios 一致），指向它兜底的失败模式。禁止空格分写（`@failure-mode FXX` ❌ → `@failure-mode-FXX` ✅），否则韧性覆盖率 grep 会漏匹配。

### 4. 混沌场景（@chaos Gherkin）

`chaos-scenarios.md` 把高优先级失败模式翻译成可执行 Gherkin。强制标签：`@chaos` + `@failure-mode-FXX` + `@P0/@P1` + `@covers-RXX`。Gherkin 语法/具体值写法 → 详见 `xdd-gherkin-plus` skill。

```gherkin
@chaos @P0 @failure-mode-F12 @covers-R03
Scenario: 网络分区下提交降级
  Given 服务已启动 (docker compose up -d --wait)
    And 用户已登录
  When 注入: iptables -A OUTPUT -p tcp --dport <port> -j DROP
    And 用户尝试 POST /api/annotations/submit
  Then 5s 内触发熔断 (circuit_state = OPEN)
    And 自动降级到本地草稿 (status = DRAFT_LOCAL)
    And UI 显示"已存为草稿，网络恢复后自动提交"
  When 撤销注入: iptables -D OUTPUT -p tcp --dport <port> -j DROP
  Then 30s 内熔断器转 HALF_OPEN
    And 草稿自动 sync，状态变 SUBMITTED
```

**注入必须具体**（不是"模拟网络故障"空话）：

| 失败类型 | 注入命令 |
|---------|---------|
| 网络分区 | `iptables -A OUTPUT -p tcp --dport <port> -j DROP` |
| 服务冻结 | `docker pause <c>` / `kill -STOP <pid>` |
| 进程崩溃 | `kill -9 <pid>` / `docker kill <c>` |
| OOM | `docker update --memory 100m <c>` + stress-ng |
| 磁盘满 | `dd if=/dev/zero of=/tmp/fill ...` |
| DB 慢查询 | 锁表 + `SELECT pg_sleep(30)` |
| 队列积压 | 关闭 consumer |
| 时钟漂移 | `date -s "+10 minutes"` |
| DNS 失效 | 改 `/etc/hosts` 指向不存在 IP |

5 类真注入（network/resource/state/data/dependency）有现成脚本：`scripts/chaos-runner.sh`（可移植 bash，在 docker compose 环境跑）。

### 5. 韧性测试计划

`resilience-test-plan.md` 把混沌场景转测试矩阵：

| 失败模式 | 自动化测试 | 手工测试 | 巡检项 |
|---------|-----------|---------|--------|
| F12 网络分区 | chaos/test_f12.py | iptables 现场演练 | tcp 连接数 |

### 6. 恢复剧本（运维值班用）

`recovery-runbook.md`：每条故障症状 → 立即动作 → 根因诊断树 → 恢复步骤。不写"联系运维"空话，每步有具体命令（docker/redis-cli/psql），区分自动恢复 vs 人工介入，含回滚路径。

## 产出（colocation 到 architecture 同业务线目录）

```
.xdd/design/architecture/{bxx-slug}/resilience/
├── failure-modes.md         # 失败模式目录 (FMEA 8 维 × 字段)
├── failsafe-design.md       # 兜底设计 (10 模式 × 实现位置)
├── chaos-scenarios.md       # 混沌场景 (@chaos Gherkin + 注入命令)
├── resilience-test-plan.md  # 韧性测试计划 (测试矩阵)
└── recovery-runbook.md      # 恢复剧本 (运维值班，具体命令)
```

## 自检

```
□ failure-modes.md 每行 5 字段完整（大项目 8 字段）+ 至少 1 个 RXX/端点引用？
□ 覆盖 ≥ 6 维度（大项目含跨地域）？
□ failsafe-design.md 每个兜底策略有"实现位置"？
□ 选了 ≥ 5 模式（大项目 ≥ 8 含对账+幂等）？
□ chaos-scenarios.md 每个 When 有具体注入命令（非空话）？
□ resilience-test-plan.md 每个失败模式有自动化 + 手工路径？
□ recovery-runbook.md 每步有具体命令，区分自动/人工？
□ 爆炸半径引用了 RXX 或 API 端点（跟 spec/architecture 对齐）？
□ 注入命令能在 docker compose 环境跑？
□ design/ 产物不引用 xdd_run（design 是持久锚，长期保留）？
```
