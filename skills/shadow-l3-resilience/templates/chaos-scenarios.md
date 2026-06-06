# {slug} 混沌测试场景

> 对应 L1 业务线: {biz_dir}
> 上游: failure-modes.md + failsafe-design.md
> 标签规范: 每个 Scenario 必须有 `@chaos` + `@failure-mode-FXX` + `@P0`/`@P1` + `@covers-RXX (BXX-NYY)`
> 注入约束: When 步骤必须有具体命令（不是"模拟失败"这种空话）

---

## 0. 标签规范

```gherkin
@chaos @P0 @failure-mode-F01 @covers-collection-R01 (B01-N01)
Scenario: Nomad 调度风暴下任务延迟但系统不崩
  ...
```

| 标签 | 必填 | 含义 |
|------|------|------|
| `@chaos` | ✅ | 标记这是混沌场景（与 L2 BDD 场景区分） |
| `@failure-mode-FXX` | ✅ | 关联 failure-modes.md |
| `@P0` / `@P1` | ✅ | 优先级（P0 = 必跑，P1 = 选跑） |
| `@covers-RXX` | ✅ | 关联 L1 spec 规则 |
| `@covers-BXX-NYY` | ✅ | 关联 L1 流程节点 |
| `@severity-high/medium/low` | ❌ | 选填，标记严重等级 |

---

## 1. 调度层（SCH）

### 1.1 F01: Nomad 调度风暴

```gherkin
@chaos @P0 @failure-mode-F01 @severity-high @covers-collection-R01 (B01-N01)
Feature: Nomad 调度风暴兜底验证

  Background:
    Given 服务已启动 (docker compose up -d --wait)
      And Nomad cluster 健康 (3 server + 5 client)
      And 当前有 50 个 IN_PROGRESS 任务

  @chaos @P0 @failure-mode-F01
  Scenario: 并发任务达上限时, 系统限流而非崩溃
    When 注入: 在 10s 内提交 1500 个并发任务
      And (具体命令: for i in $(seq 1 1500); do nomad job dispatch -meta seq=$i data-collector & done)
    Then 限流生效: reject_count > 0
      And 队列有序处理: accepted_count = 100 (限流阈值)
      And P99 延迟 < 10s (可接受降级)
      And 无 OOM: container memory < 90%
      And UI 显示 "任务较多, 排队中" 提示

  @chaos @P0 @failure-mode-F01
  Scenario: 任务过载触发 OOM 时, 容器自动重启
    Given 任务队列长度 > 1000
    When 注入: docker update --memory 200m nomad-client-1
      And (持续提交任务触发 OOM)
    Then container 被 OOM killed
      And Nomad 自动 reschedule 任务到其他 client
      And 系统在 60s 内恢复处理
      And 数据完整性: 已完成的任务状态正确
```

### 1.2 F02 / F03 / F04

> F02 (调度器宕机) / F03 (节点失联) / F04 (Leader 脑裂) 由 Nomad HA 处理, 详细场景见 Nomad 官方 chaos 测试。L3 只验证应用层响应:

```gherkin
@chaos @P1 @failure-mode-F02
Scenario: Nomad server 宕机时, 应用层健康检查快速 fail
  When 注入: docker stop nomad-server-1
  Then 应用层 /api/health 在 30s 内返回 503
    And 告警立即触发
    And 客户端 UI 显示 "服务暂不可用, 正在恢复"
  When 注入: docker start nomad-server-1
  Then 60s 内 Nomad 恢复 quorum
    And 应用层 /api/health 返回 200
    And 任务自动 rejoin
```

---

## 2. 网络层（NET）

### 2.1 F11: 网络分区

```gherkin
@chaos @P0 @failure-mode-F11 @severity-high @covers-annotation-R03 (B02-N08)
Feature: 网络分区下标注提交降级

  Background:
    Given 服务已启动 (docker compose up -d --wait)
      And 标注员已登录 (session fixture: annotator1)
      And 任务 TASK-001 状态 IN_PROGRESS
      And annotation-api 健康

  @chaos @P0 @failure-mode-F11
  Scenario: 下游 API 网络分区 30s, 标注自动降级
    When 注入: 模拟 annotation-api 端口网络分区 30s
      And (具体命令: iptables -A OUTPUT -p tcp --dport 8001 -j DROP)
      And 标注员点击 "提交标注"
    Then 5s 内熔断器状态 = OPEN
      And 3 次重试后熔断器保持 OPEN (避免雪崩)
      And 标注自动降级到本地草稿 (status = DRAFT_LOCAL)
      And UI 显示横幅: "已存为草稿, 网络恢复后自动提交"
      And 草稿存到 local_draft 存储 (infra/storage/local_draft.py)
    When 撤销注入: iptables -D OUTPUT -p tcp --dport 8001 -j DROP
    Then 30s 内熔断器自动转 HALF_OPEN
      And 草稿自动 sync 到主存储
      And 标注状态变为 SUBMITTED
      And 数据完整性断言: values 与降级前一致 (无丢失)
      And 审计日志完整: 降级触发 + 草稿保存 + 同步完成

  @chaos @P1 @failure-mode-F11
  Scenario: 反复网络抖动, 熔断器不应频繁跳变
    When 注入: 模拟网络抖动 10 次 (每次 100ms 丢包, 间隔 1s)
      And (具体命令: tc qdisc add dev eth0 root netem loss 50% duration 100ms; sleep 1; ...)
    Then 熔断器跳变次数 < 5
      And 重试合理 (不雪崩)
      And 最终系统状态正确
```

### 2.2 F12: 网络抖动

```gherkin
@chaos @P1 @failure-mode-F12
Scenario: 持续 1s 延迟, 系统不应卡死
  When 注入: 持续 1s 网络延迟 5min
    And (具体命令: tc qdisc add dev eth0 root netem delay 1000ms)
  Then P99 延迟 < 2s
    And 用户 UI 显示 loading 状态
    And 超时机制生效 (10s read_timeout)
    And 业务最终成功
  When 撤销: tc qdisc del dev eth0 root
```

### 2.3 F13 / F14

> F13 (DNS 失效) / F14 (TCP 半开) 详见 `references/chaos-scenario-guide.md` § 5.3-5.4

---

## 3. 状态层（STA）

### 3.1 F21: 状态漂移

```gherkin
@chaos @P1 @failure-mode-F21
Scenario: 多副本读路径, 状态版本不一致被检测
  Given 3 个 API 副本运行
    And 写入数据: collection COL-001
  When 注入: 强制副本 2 的缓存失效 (redis-cli DEL collection:COL-001:cache:replica2)
    And 立即读取 COL-001
  Then 副本 2 重新加载 (lag < 1s)
    And 数据一致: 3 副本读结果相同
    And 告警: version_mismatch > 0
```

### 3.2 F24: 缓存击穿

```gherkin
@chaos @P0 @failure-mode-F24 @covers-annotation-R01 (B02-N06)
Scenario: 热点 key 过期瞬间, 不打挂 DB
  Given 热点 key "task:TASK-001" 已设置
  When 注入: 同时发起 1000 个读取请求
    And (redis-cli DEL task:TASK-001 让 key 过期)
    And (ab -c 1000 -n 1000 http://api/tasks/TASK-001 &)
  Then singleflight 生效: DB 查询次数 < 10 (而非 1000)
    And 所有请求最终返回成功
    And DB QPS < 100 (未打挂)
    And 后续请求走缓存
```

---

## 4. 资源层（RES）

### 4.1 F31: OOM

```gherkin
@chaos @P0 @failure-mode-F31 @severity-high
Scenario: 内存持续增长触发 OOM, 容器自动重启且不丢数据
  When 注入: 持续上传大文件触发内存增长
    And (具体命令: docker update --memory 500m backend; for i in $(seq 1 1000); do curl -F "file=@/tmp/big" http://api/upload & done)
  Then 监控显示 memory 持续上升
    And 到达 500m 时 OOM killed
    And container 自动重启 (restart_policy=on-failure:5)
    And 健康检查摘除 → 重新加入 service
    And 业务恢复时间 < 30s
    And 写操作未完成的数据写入本地 WAL, 恢复后回放
```

### 4.2 F33: 连接池耗尽

```gherkin
@chaos @P0 @failure-mode-F33
Scenario: DB 连接池耗尽, 队列降级生效
  Given DB 连接池 max=20
  When 注入: 持续 30s 发起 100 并发慢查询
    And (具体命令: psql -c "SELECT pg_sleep(30);" & ; for i in $(seq 1 100); do curl http://api/heavy-endpoint & done)
  Then wait_count > 0 (连接等待)
    And 队列降级生效: 非核心接口返回 503
    And 核心接口降级: 返回缓存的最后已知结果
    And 慢查询结束后, 60s 内连接池恢复
    And 健康检查指标: pool.wait_count 归零
```

---

## 5. 数据层（DAT）

### 5.1 F41: DB 主从切换

```gherkin
@chaos @P0 @failure-mode-F41 @severity-high
Scenario: 主库故障, 应用层自动重试不丢数据
  Given PostgreSQL primary + replica
  When 注入: docker stop postgres-primary
    And (具体命令: docker stop postgres-primary)
  Then 30s 内 replica 检测到 primary 失效
    And 触发自动 failover
    And 应用层重试机制生效 (5 次重试)
    And 写操作在 60s 内恢复
    And 数据完整性: 切换期间提交的写操作最终一致
    And 告警: primary_failover 触发
```

### 5.2 F44: 热点行

```gherkin
@chaos @P1 @failure-mode-F44
Scenario: 热点行高并发写, 分片 + 异步合并生效
  Given 单行 record 热点 (QPS=500)
  When 注入: 持续 5min 500 QPS 写同一行
  Then 分片生效: 实际写分散到 10 个分片
    And 异步合并: 每 30s 合并分片结果到主行
    And P99 延迟 < 100ms
    And 无死锁
```

---

## 6. 事件层（EVT）

### 6.1 F51: 消息积压

```gherkin
@chaos @P0 @failure-mode-F51 @severity-high
Scenario: 消费者跟不上, 背压 + 自动扩容
  Given Redis Streams, 队列长度 = 0
  When 注入: 暂停所有 consumer (docker pause consumer-1 consumer-2 ...)
    And (具体命令: docker pause $(docker ps -q --filter name=consumer))
    And 持续生产 10000 个事件
  Then 背压生效: producer 被限流
    And DLQ 长度增长, 但 < 1000 (限流阈值)
    And 监控告警: queue_depth > 500
  When 撤销: docker unpause consumer-*
  Then 自动扩容: 临时起 2 个 consumer
    And 5min 内队列消化到 < 100
    And DLQ 长度稳定
    And 事件零丢失
```

### 6.2 F52: 重复消费

```gherkin
@chaos @P1 @failure-mode-F52
Scenario: 同 event_id 重复消费, 业务幂等去重
  Given consumer 已处理 event_id=E001
  When 注入: 重新投递 E001 (rabbitmqctl publish ...)
  Then 业务侧检测到重复
  And 幂等去重: 第二次处理返回 "ALREADY_PROCESSED"
  And 业务数据无副作用 (订单不被重复创建)
```

---

## 7. 依赖层（DEP）

### 7.1 F61: 第三方宕机

```gherkin
@chaos @P0 @failure-mode-F61 @severity-high @covers-collection-R05 (B01-N05)
Scenario: 第三方 API 宕机, 熔断 + 降级到 mock
  Given 第三方 geo-coding API 健康
  When 注入: 第三方持续返回 503
    And (具体命令: mock -p 9999 'return 503')
    And 触发 10 个需要 geo-coding 的请求
  Then 熔断: 5xx 率 > 50% 触发 CB OPEN
  And 降级到 mock 数据 (lat=0, lng=0 + 标记 "degraded")
  And UI 显示 "位置服务降级" 提示
  And 业务功能可用 (不阻塞主流程)
  When 撤销: 第三方恢复
  Then 30s 内 CB 转 HALF_OPEN
  And 探测成功 → CLOSED
  And 真实数据恢复使用
```

### 7.2 F63: 配额耗尽

```gherkin
@chaos @P1 @failure-mode-F63
Scenario: 第三方 rate limit 持续触发, 退避 + 排队
  Given 第三方 API 配额 100 QPS
  When 注入: 持续发送 200 QPS
  Then 退避生效: 429 错误率下降 (退避指数 1s/2s/4s/8s)
  And 排队: 超出部分进第三方队列
  And 业务侧: 用户看到 "请求较多, 请稍候"
  And 配额恢复后队列消化
```

---

## 8. 流量层（TRF）

### 8.1 F71: 突发流量

```gherkin
@chaos @P0 @failure-mode-F71 @severity-high
Scenario: QPS 突增 10x, 限流 + 削峰
  Given 正常 QPS = 100
  When 注入: 5s 内 QPS 突增到 1000
    And (具体命令: ab -c 1000 -n 5000 -t 5 http://api/)
  Then 限流生效: 接受 QPS = 100, 拒绝 = 900
  And 削峰: 非核心接口返回 503 + Retry-After header
  And 核心接口可用
  And 队列堆积 < 阈值
  And 流量回落后, 系统自动恢复
```

### 8.2 F72: DDoS

```gherkin
@chaos @P1 @failure-mode-F72
Scenario: 单 IP 高频请求, WAF 封禁
  Given 正常 client 来自 10 个不同 IP
  When 注入: 单 IP (10.0.0.99) 在 1s 内发送 1000 个请求
    And (具体命令: ab -c 100 -n 1000 -t 1 -B 10.0.0.99 http://api/)
  Then WAF 检测: 10.0.0.99 异常
  And 10s 后自动封禁 (或人工确认)
  And 其他 IP 正常服务
  And 持续监控: 该 IP 仍被封
```

---

## 9. P0 场景总览（必跑清单）

> L6 Phase 5.7 灾难演练至少跑完 P0 场景的 80%。

| 失败 ID | 维度 | P0 场景数 | 必跑 | 备注 |
|---------|------|----------|------|------|
| F01 | 调度层 | 2 | ✅ | 限流 + OOM |
| F11 | 网络层 | 2 | ✅ | 熔断降级 + 反复抖动 |
| F24 | 状态层 | 1 | ✅ | 缓存击穿 |
| F31 | 资源层 | 1 | ✅ | OOM |
| F33 | 资源层 | 1 | ✅ | 连接池耗尽 |
| F41 | 数据层 | 1 | ✅ | DB 主从切换 |
| F51 | 事件层 | 1 | ✅ | 消息积压 |
| F61 | 依赖层 | 1 | ✅ | 第三方宕机 |
| F71 | 流量层 | 1 | ✅ | 突发流量 |
| **总计** | — | **11** | — | P0 必跑 |

---

## 10. 上下游溯源

- **上游**: failure-modes.md（FXX）+ failsafe-design.md（FSXX 实现位置）
- **下游**:
  - L5 harness-plan.md: "失败注入点"段引用 @chaos 场景
  - L6 Phase 5.7: 灾难演练执行 P0 场景
  - L3 resilience-test-plan.md: 测试矩阵引用 @chaos 场景

---

## 自检清单

- [ ] 每个 Scenario 有 4 个必填标签
- [ ] When 步骤有具体命令（不是"模拟失败"）
- [ ] Then 步骤有可断言的指标
- [ ] P0 场景覆盖 8 维度至少 4 个
- [ ] 每个失败模式至少 1 个 @chaos 场景
- [ ] 数据完整性断言（注入 → 恢复后无丢失）
- [ ] 上下游溯源完整

---

## 9. 跨地域/多活 P0 场景 (L 规模扩展)

> **本章节仅在 L 规模 (`l3_extended_mode=true`) 时必填。** 跨地域/多活的灾难演练是 L 规模电商/支付的核心可靠性手段。

### 9.1 F81: 机房级故障

```gherkin
@chaos @P0 @failure-mode-F81 @severity-high @covers-collection-R05 (B01-N05)
Feature: 机房级故障下 DNS 切机房

  Background:
    Given 服务已启动 (双机房 primary + secondary)
      And 健康检查正常 (双方机房)

  @chaos @P0 @failure-mode-F81
  Scenario: 整机房断电, DNS 切机房后业务恢复
    When 注入: 模拟整机房网络断电
      And (具体命令: docker network disconnect host-network backend-primary)
    Then 5s 内健康检查批量失败 (5/5 实例)
    And 60s 内 DNS 切机房 (TTL=60s)
    And 切机房后业务恢复 (P99 < 1s)
    And 异地用户路由到 secondary 机房
    And 数据零丢失 (写操作排队, 恢复后回放)
  When 撤销: docker network connect host-network backend-primary
  Then 灰度切回 (10% → 50% → 100%)
  And 切回期间 P99 < 1.5s (允许 1.5x 临时劣化)
  And 切回后状态: PRIMARY = 100%
```

### 9.2 F82: 跨地域一致性违反

```gherkin
@chaos @P0 @failure-mode-F82 @severity-high @covers-order-R08 (B02-N08)
Feature: 跨地域双机房同订单写入, 业务对账修复

  Background:
    Given 双机房已启动 (primary + replica)
      And 同一 order_id 在两机房分别提交支付

  @chaos @P0 @failure-mode-F82
  Scenario: 双机房同 order_id 支付, 业务对账发现并修复
    When 注入: 模拟跨地域同步延迟 > 60s
      And (具体命令: iptables -A OUTPUT -p tcp --dport 5432 -d replica-ip -j DROP)
      And order_id=ORD-001 在 primary 机房支付成功
      And order_id=ORD-001 在 replica 机房尝试再次支付
    Then 业务唯一键 (order_id UNIQUE) 拦截第二次支付
    And DB IntegrityError 抛出
    And 业务对账 (FS11-b 订单-支付对账) 发现 inconsistencies > 0
    And 自动修复: saga 补偿 (回滚第二次支付)
    And 数据一致性: order_id=ORD-001 只成功支付一次
    And 审计日志完整: 第一次支付 + 第二次拦截 + saga 补偿
  When 撤销: iptables -D OUTPUT -p tcp --dport 5432 -d replica-ip -j DROP
  Then replica 同步延迟恢复 (< 5s)
  And 业务对账 inconsistencies = 0
```

### 9.3 F83: 异地数据同步延迟

```gherkin
@chaos @P0 @failure-mode-F83 @severity-high
Feature: 异地数据同步延迟下强制读主

  Background:
    Given primary + replica 已启动
      And replica_lag_seconds < 1

  @chaos @P0 @failure-mode-F83
  Scenario: 跨地域同步延迟 > 5s, 强制读主
    When 注入: 模拟跨地域网络延迟 200ms 持续 10min
      And (具体命令: tc qdisc add dev eth0 root netem delay 200ms)
    Then 监控告警: replica_lag_seconds > 5
    And 自动触发强制读主 (FS83)
    And 读路径: 所有读请求路由到 primary
    And 用户读到的数据 < 1s 旧
  When 撤销: tc qdisc del dev eth0 root
  Then replica_lag_seconds < 5
  And 强制读主回退到就近接入
```

### 9.4 F84: 机房切换回滚

```gherkin
@chaos @P0 @failure-mode-F84
Feature: 机房切换 P99 上升时自动回滚

  Background:
    Given primary 机房正常
      And secondary 机房 P99 = 50ms

  @chaos @P0 @failure-mode-F84
  Scenario: 切机房后 P99 上升, 自动回切
    When 注入: 切机房到 secondary (10%)
      And (具体命令: 修改 DNS 权重 10% → secondary)
      And secondary 机房人为加延迟 (P99 = 500ms)
    Then 切机房后 P99 上升 (50ms → 500ms, 10x)
    And 自动回滚: 30s 内 P99 > 200ms 触发回切
    And 切回 PRIMARY = 100%
  When 撤销: secondary 机房延迟恢复
  Then P99 < 100ms
```

### 9.5 F85: 跨地域延迟

```gherkin
@chaos @P1 @failure-mode-F85
Feature: 跨地域延迟下就近接入

  Background:
    Given 用户在异地机房 (地理距离 1000km)
      And 默认接入 primary 机房

  @chaos @P1 @failure-mode-F85
  Scenario: 异地用户就近接入 secondary
    When 注入: primary 机房到异地用户的延迟 > 300ms
      And (具体命令: tc qdisc add dev eth0 root netem delay 300ms)
    Then 监控告警: 异地用户 P99 > 200ms
    And DNS 就近解析到 secondary 机房
    And 异地用户 P99 < 50ms
  When 撤销: tc qdisc del dev eth0 root
  Then 异地用户就近解析回 primary (DNS 权重恢复)
```

---

## 10. 业务对账 P0 场景 (L 规模扩展)

> **本章节仅在 L 规模 (`l3_extended_mode=true`) 时必填。** 业务对账演练验证 FS11 兜底真的工作。

### 10.1 业务对账发现跨地域不一致

```gherkin
@chaos @P0 @failure-mode-F82 @covers-order-R08 (B02-N08)
Feature: 业务对账发现订单-支付不一致

  Background:
    Given 业务对账服务已启动 (cron 0 2 * * *)
      And 过去 24h 订单-支付对账基线 inconsistencies = 0

  @chaos @P0 @failure-mode-F82
  Scenario: 业务对账发现不一致 → 自动修复 → 升级
    When 注入: 制造跨地域订单-支付不一致
      And (具体命令: 直接 SQL 修改 order_id=ORD-001 status=PAID 但 alipay API 返回 status=UNPAID)
      And 触发跑批: python -m domain.reconciliation.order_payment.run
    Then 对账执行: 拉取 orders + alipay 数据
    And 对比函数发现 inconsistencies: order_id=ORD-001 状态不一致
    And 容差过滤: tolerance=0, 真实问题 1 条
    And 自动修复: saga 补偿 (FS11-b 配置 auto_repair=true)
    And 修复成功: order_id=ORD-001 status=UNPAID
    And 业务对账日志: 1 条修复记录
    And 审计日志: 修复前后状态对比
  When 注入: 制造对账无法自动修复的不一致 (DB 不可写)
  Then 对账执行: 拉取 + 对比 + 容差过滤成功
    And 自动修复失败 (DB 不可写)
    And 升级: PagerDuty "#payment-oncall" 1 条
    And 资金不一致: 0 (未解决, 人工介入)
```

### 10.2 业务幂等测试

```gherkin
@chaos @P0 @failure-mode-F82 @covers-payment-R12 (B04-N12)
Feature: 业务幂等 — 3 层防护

  Background:
    Given 支付服务已启动
      And payment_id=PAY-001 业务唯一键 UNIQUE

  @chaos @P0 @failure-mode-F82
  Scenario: 重复提交支付请求, 业务幂等拒绝
    When 注入: 同一 payment_id=PAY-001 并发提交 10 次
      And (具体命令: for i in $(seq 1 10); do curl -X POST /api/payments -d '{"payment_id":"PAY-001",...}' & done)
    Then L1 技术幂等: Redis key PAY-001 5min 内只执行 1 次
    And L2 业务唯一键: DB UNIQUE 拦截重复 INSERT (9 次 IntegrityError)
    And L3 状态机: 状态机 PENDING→PAID 转换只成功 1 次 (其余 IdempotencyViolation)
    And 最终结果: 支付只成功 1 次, 金额正确
    And 资金零差错 (无双扣/漏扣)
```

---

## 11. P0 场景总览（含 L 规模扩展）

| 失败 ID | 维度 | P0 场景数 | 必跑 | 备注 |
|---------|------|----------|------|------|
| F01 | 调度层 | 2 | ✅ (S/M/L) | 限流 + OOM |
| F11 | 网络层 | 2 | ✅ (S/M/L) | 熔断降级 + 反复抖动 |
| F24 | 状态层 | 1 | ✅ (S/M/L) | 缓存击穿 |
| F31 | 资源层 | 1 | ✅ (S/M/L) | OOM |
| F33 | 资源层 | 1 | ✅ (S/M/L) | 连接池耗尽 |
| F41 | 数据层 | 1 | ✅ (S/M/L) | DB 主从切换 |
| F51 | 事件层 | 1 | ✅ (S/M/L) | 消息积压 |
| F61 | 依赖层 | 1 | ✅ (S/M/L) | 第三方宕机 |
| F71 | 流量层 | 1 | ✅ (S/M/L) | 突发流量 |
| **F81** | **跨地域** | 1 | **✅ (L 规模)** | **机房级故障** |
| **F82** | **跨地域** | 2 | **✅ (L 规模)** | **跨地域一致性 + 业务对账** |
| **F83** | **跨地域** | 1 | **✅ (L 规模)** | **异地数据同步延迟** |
| **F84** | **跨地域** | 1 | **✅ (L 规模)** | **机房切换回滚** |
| **F85** | **跨地域** | 1 | **✅ (L 规模)** | **跨地域延迟** |
| **总计 (S/M)** | — | **11** | — | S/M 规模必跑 |
| **总计 (L)** | — | **16** | — | L 规模必跑 (含跨地域 5 + 业务对账 1) |
