# 混沌场景编写指南 (Chaos Scenario Guide)

> L3 chaos-scenarios.md 模板的详细参考。每个 @chaos 场景的 Gherkin 写法、注入工具、断言模式、命名规范。

## 1. Gherkin 完整规范

### 1.1 必填标签

每个混沌场景必须有 4 个标签：

```gherkin
@chaos @P0 @failure-mode-F11 @severity-high @covers-annotation-R03 (B02-N08)
Feature: 网络分区下标注提交降级
  ...
```

| 标签 | 必填 | 格式 | 含义 |
|------|------|------|------|
| `@chaos` | ✅ | 固定 | 标记这是混沌场景（区别于 L2 BDD） |
| `@P0` / `@P1` | ✅ | 固定 | 优先级，决定 L6 必跑 / 选跑 |
| `@failure-mode-FXX` | ✅ | F + 2 位数字 | 关联 failure-modes.md 的 FXX |
| `@covers-RXX` | ✅ | R + 2 位数字 | 关联 L1 spec 规则 |
| `@covers-BXX-NYY` | ✅ | B 业务线 + 节点号 | 关联 L1 流程节点 |
| `@severity-...` | ❌ | high/medium/low | 选填，严重等级 |

### 1.2 Feature 结构

```gherkin
@chaos @P0 @failure-mode-FXX
Feature: <失败模式名称>兜底验证

  Background:
    Given <共享前置条件 1>
      And <共享前置条件 2>

  @chaos @P0 @failure-mode-FXX
  Scenario: <场景名称 1>
    ...

  @chaos @P1 @failure-mode-FXX
  Scenario: <场景名称 2>
    ...
```

**Background 原则**:
- 多个 Scenario 共享的前置条件提到 Background
- 每个 Scenario 自身只写差异化的部分
- 不重复 Background 已写过的

### 1.3 Scenario 三段式

**Given**（前置）:
- 服务已启动 (docker compose up -d --wait)
- 测试数据已准备（标注员 + 任务）
- 下游 API 健康（基线）

**When**（注入 + 触发）:
- 注入：具体命令（iptables / docker / kill / clock skew）
- 触发：用户操作 / API 调用

**Then**（断言）:
- 兜底机制生效（熔断 OPEN / 降级到本地 / 重试 N 次）
- 用户可见反馈（UI 提示 / 状态码 / 错误信息）
- 数据完整性（值与注入前一致）

---

## 2. 注入工具箱

### 2.1 网络层注入

| 失败 | 注入命令 | 影响范围 | 可逆 |
|------|---------|---------|------|
| 网络分区 | `iptables -A OUTPUT -p tcp --dport <port> -j DROP` | 容器到指定端口 | `iptables -D` |
| 延迟 | `tc qdisc add dev eth0 root netem delay <ms>` | 容器网络 | `tc qdisc del` |
| 丢包 | `tc qdisc add dev eth0 root netem loss <%>` | 容器网络 | `tc qdisc del` |
| DNS 失效 | 修改 `/etc/hosts` 或 `systemd-resolve` | 服务发现 | 还原配置 |
| TCP 半开 | `iptables -A INPUT -p tcp --tcp-flags SYN,ACK SYN -j DROP` | 入站连接 | `iptables -D` |

**示例**:
```bash
# 注入 30s 网络分区
iptables -A OUTPUT -p tcp --dport 8001 -j DROP
sleep 30
iptables -D OUTPUT -p tcp --dport 8001 -j DROP  # 撤销
```

### 2.2 进程层注入

| 失败 | 注入命令 | 影响范围 | 可逆 |
|------|---------|---------|------|
| 进程崩溃 | `kill -9 <pid>` / `docker kill <container>` | 单进程 | `docker start` |
| 进程冻结 | `kill -STOP <pid>` / `docker pause <container>` | 单进程 | `kill -CONT` / `docker unpause` |
| OOM | `docker update --memory 100m <container>` + 触发大对象 | 容器 | `docker update --memory 2g` |
| CPU 100% | `stress-ng --cpu 0 --timeout 60s` | 容器/主机 | `kill` |
| 磁盘满 | `dd if=/dev/zero of=/tmp/fill bs=1M count=9000` | 容器/主机 | `rm /tmp/fill` |

### 2.3 数据层注入

| 失败 | 注入命令 | 影响范围 | 可逆 |
|------|---------|---------|------|
| DB 慢查询 | `SELECT pg_sleep(30);` | 单连接 | kill connection |
| DB 死锁 | 业务侧制造循环依赖 | 应用 | kill transaction |
| 缓存清空 | `redis-cli FLUSHDB` | 缓存 | 重新预热 |
| 时钟漂移 | `date -s "+10 minutes"` (需 root 沙箱) | 容器 | `ntpdate` 同步 |

### 2.4 事件层注入

| 失败 | 注入命令 | 影响范围 | 可逆 |
|------|---------|---------|------|
| consumer 停止 | `docker stop consumer-1` | 单 consumer | `docker start` |
| 队列满 | 持续生产 + 不消费 | 队列 | 启动 consumer |
| 重复投递 | `rabbitmqctl publish` 重复 event | 单事件 | — |
| DLQ 满 | 配置 max-length + 持续生产 | DLQ | 清理 DLQ |

### 2.5 依赖层注入

| 失败 | 注入命令 | 影响范围 | 可逆 |
|------|---------|---------|------|
| 第三方 5xx | `mock -p 9999 'return 503'` | 单服务 | `kill mock` |
| 第三方慢 | mock + `asyncio.sleep(60)` | 单服务 | `kill mock` |
| 第三方超时 | `iptables` 阻断 + mock | 单服务 | 撤销 |

### 2.6 流量层注入

| 失败 | 注入命令 | 影响范围 | 可逆 |
|------|---------|---------|------|
| 突发流量 | `ab -c 1000 -n 5000 -t 5 http://api/` | HTTP | 等待结束 |
| 慢速连接 | `slowhttptest -c 1000 -H -g -o slow -i 10 -r 200 -t GET -u http://api/` | HTTP | `kill` |
| 大请求体 | `curl -X POST -d @1GB-file http://api/` | HTTP | — |

---

## 3. 断言模式

### 3.1 状态断言

```gherkin
Then 熔断器状态 = OPEN
  And 重试次数 = 3
  And 限流拒绝数 > 0
  And 健康检查返回 503
```

### 3.2 数据完整性断言

```gherkin
Then 草稿保存到 local_drafts 表
  And local_drafts.values = 注入前的 values
  And 恢复后, 草稿 sync 到 annotations 表
  And annotations.values = 注入前的 values
  And 零数据丢失
```

### 3.3 用户体验断言

```gherkin
Then UI 显示横幅: "已存为草稿, 网络恢复后自动提交"
  And 状态码 = 200 (业务降级但 HTTP 200)
  And 响应体包含 degraded: true
  And UI 不出现 "系统错误" 红色提示
```

### 3.4 性能断言

```gherkin
Then P99 延迟 < 1s (SLO)
  And CPU < 80%
  And 内存 < 90%
  And 连接池 wait_count = 0
```

### 3.5 恢复时间断言

```gherkin
Then 故障注入到熔断 OPEN: < 5s
  And 故障消除到熔断 CLOSED: < 30s
  And 草稿 sync 完成: < 60s
```

---

## 4. 完整场景模板

```gherkin
@chaos @P0 @failure-mode-F11 @severity-high @covers-annotation-R03 (B02-N08)
Feature: F11 网络分区下标注提交降级

  Background:
    Given 服务已启动 (docker compose up -d --wait)
      And annotation-api 健康
      And 标注员已登录 (session: annotator1, token: xxx)
      And 任务 TASK-001 已创建
      And 标注员开始标注 TASK-001 (status=IN_PROGRESS, values=[车, 行人])

  @chaos @P0 @failure-mode-F11
  Scenario: 下游 API 30s 网络分区, 标注自动降级且不丢数据
    When 注入: 模拟 annotation-api 网络分区 30s
      And (具体命令: iptables -A OUTPUT -p tcp --dport 8001 -j DROP)
      And 标注员点击 "提交标注"
    Then 5s 内熔断器 (annotation-api CB) 状态 = OPEN
      And 3 次重试后熔断器保持 OPEN
      And 标注自动降级到本地草稿 (status=DRAFT_LOCAL)
      And local_drafts 表新增 1 条记录
      And UI 横幅: "已存为草稿, 网络恢复后自动提交"
      And HTTP 响应 status=200, body={status:"draft_local", degraded:true}
    When 撤销: iptables -D OUTPUT -p tcp --dport 8001 -j DROP
    Then 30s 内熔断器自动转 HALF_OPEN
      And 探测请求成功 → CB 转 CLOSED
      And draft_syncer 自动 sync 草稿
      And annotations 表更新: status=SUBMITTED, values 不变
      And 审计日志: 降级触发 (timestamp) + 草稿保存 (timestamp) + 同步完成 (timestamp)
    Then 业务数据完整性: 100% (无丢失)

  @chaos @P1 @failure-mode-F11
  Scenario: 反复网络抖动, 熔断器不应频繁跳变
    When 注入: 模拟网络抖动 10 次
      And (具体命令: for i in $(seq 1 10); do tc qdisc add dev eth0 root netem loss 50% duration 100ms; sleep 1; done)
    Then 熔断器跳变次数 < 5
      And 重试合理 (不雪崩, 单请求重试 < 5)
      And 系统最终状态正确
      And 性能 P99 < 1s (抖动结束后)
```

---

## 5. P0 vs P1 场景划分

| 等级 | 含义 | L6 必跑 | 数量建议 |
|------|------|---------|---------|
| P0 | 核心路径 / 数据安全 / 故障不可恢复 | ✅ 必跑 | 每个失败模式 1-2 个 |
| P1 | 分支 / 边界 / 体验优化 | ❌ 选跑 | 视情况 |

**P0 场景应覆盖**:
- 业务核心链路
- 涉及金钱/数据安全的规则
- 故障期间可能数据丢失的路径
- 严重等级"高"的失败模式

**P1 场景应覆盖**:
- 反复抖动 / 边界 case
- 性能边缘 / 资源紧张
- 用户体验降级提示

---

## 6. 上下游引用规范

### 6.1 引用 L1

```gherkin
@covers-annotation-R03 (B02-N08)
```

- 规则 ID: `{biz_slug}-RXX`
- 节点 ID: `BXX-NYY`
- 写在标签里，不写在 Scenario 内容里

### 6.2 引用 L3 失败模式

```gherkin
@failure-mode-F11
```

- 失败 ID: `FXX`（2 位数字）
- 必须能在 `failure-modes.md` 找到对应行
- 一个 FXX 可对应多个 @chaos 场景

### 6.3 引用 L3 兜底

```gherkin
@covers-FS11
```

- 兜底 ID: `FSXX`（与 FXX 对应）
- 选填, 标注此场景主要验证哪个兜底

---

## 7. 反模式（不要写）

### 7.1 ❌ 注入方式模糊

```gherkin
# BAD
When 模拟网络失败
Then 系统应该优雅降级
```

**问题**:
- "模拟" = 没说怎么模拟
- "网络失败" = 没说多长
- "优雅降级" = 没说具体行为

### 7.2 ❌ 断言模糊

```gherkin
# BAD
Then 系统应该正常工作
And 数据应该一致
```

**问题**:
- "正常" = 没说哪个维度
- "一致" = 没说和什么对比

### 7.3 ❌ 无背景

```gherkin
# BAD
Scenario: 标注提交失败
  When 提交标注
  Then 应该重试
```

**问题**:
- 服务没启动前提
- 不知道是哪个用户 / 任务
- "应该重试" = 没说几次

### 7.4 ❌ 步骤太多

```gherkin
# BAD
Scenario: 复杂流程
  Given ...
    And ...
    And ...
  When ...
    And ...
    And ...
    And ...
    And ...  # 超过 5 步
```

**问题**: 一个 Scenario 应该聚焦一个失败模式。复杂流程拆 Scenario Outline + Examples。

---

## 8. 命名规范

| 元素 | 命名 | 示例 |
|------|------|------|
| Feature | `<失败模式>兜底验证` | `网络分区下标注提交降级` |
| Scenario | `<触发条件> + <期望行为>` | `下游 API 30s 网络分区, 标注自动降级且不丢数据` |
| 标签 | `@chaos @P0 @failure-mode-FXX @severity-X` | 见上文 |
| 变量 | `<小写下划线>` | `<port>`, `<duration_seconds>` |

---

## 9. 场景统计建议

按规模区分场景数量：

| 规模 | 失败模式数 | 场景数 (P0) | 场景数 (P1) | 总数 |
|------|----------|------------|------------|------|
| S | 5-10 | 5-8 | 0-3 | 5-10 |
| M | 10-20 | 8-15 | 5-10 | 13-25 |
| L | 20+ | 15-25 | 10-20 | 25-45 |

**L6 必跑覆盖**: P0 场景 ≥ 80% PASS。

---

## 2.7 跨地域/多活注入 (L 规模扩展)

> **本节仅在 L 规模 (`l3_extended_mode=true`) 时使用。**

### 2.7.1 机房级故障

| 失败 | 注入命令 | 影响范围 | 可逆 |
|------|---------|---------|------|
| 整机房断电 | `docker network disconnect host-network backend-primary` | 单机房 | `docker network connect` |
| 整机房冷却故障 | 物理机房真实事件, 测试用机房温度告警模拟 | 单机房 | N/A |
| 异地专线中断 | `iptables -A OUTPUT -d <other_datacenter_ip> -j DROP` | 跨地域通信 | `iptables -D` |
| 跨地域 DNS 污染 | 修改本地 `/etc/resolv.conf` 指向不存在 IP | 跨地域路由 | 还原配置 |

**示例 (整机房断电)**:
```bash
# 注入: 整机房断电
docker network disconnect host-network backend-primary-1
docker network disconnect host-network backend-primary-2
# 等 30s

# 撤销
docker network connect host-network backend-primary-1
docker network connect host-network backend-primary-2
```

### 2.7.2 跨地域延迟

| 失败 | 注入命令 | 影响 | 可逆 |
|------|---------|------|------|
| 跨地域网络延迟 | `tc qdisc add dev eth0 root netem delay 200ms` | 跨地域调用 | `tc qdisc del` |
| 跨地域网络丢包 | `tc qdisc add dev eth0 root netem loss 5%` | 跨地域同步 | `tc qdisc del` |
| 跨地域专线中断 | `iptables -A OUTPUT -d <other_dc_ip> -j DROP` | 跨地域 | `iptables -D` |

### 2.7.3 跨地域一致性违反

| 失败 | 注入命令 | 影响 | 可逆 |
|------|---------|------|------|
| 双机房同 key 写入 | 业务侧双写 (mock) | 资金/订单 | 自动 saga 修复 |
| 跨地域同步延迟 > 60s | 见 2.7.2 | 读旧值 | 自动恢复 |
| 异地数据丢失 | 手动删除异地副本 (危险, 仅 chaos) | 数据丢失 | 从备份恢复 |

---

## 2.8 业务对账注入 (L 规模扩展)

> **本节仅在 L 规模 (`l3_extended_mode=true`) 时使用。** 业务对账的"注入"是**模拟数据不一致**, 通过 mock 数据源或直接 SQL 修改。

### 2.8.1 制造跨系统数据不一致

| 不一致类型 | 注入方式 | 验证对账 |
|-----------|---------|---------|
| 订单-支付不一致 | 直接 SQL: `UPDATE orders SET status='PAID' WHERE order_id='ORD-001'` (但 alipay API 返回 UNPAID) | 跑批后应发现 + 自动修复 |
| 订单-库存不一致 | 直接 SQL: `UPDATE inventory SET quantity=quantity-1 WHERE sku_id='SKU-001'` (但订单无对应扣减) | 跑批后应发现 + 报警 |
| 用户余额-流水不一致 | 直接 SQL: 余额加 1 但流水无记录 | 跑批后应发现 + 重放 |
| 跨地域同 order_id 双支付 | 业务侧 mock 两次支付请求 | 业务幂等 (FS12) 拒绝第二次 |

**示例 (制造订单-支付不一致)**:
```bash
# 1. 准备: 创建一个订单
curl -X POST http://api:8000/api/orders \
  -d '{"order_id": "ORD-001", "amount": 100.00}'

# 2. 正常支付 (写 orders.status = PAID, alipay status = PAID)
curl -X POST http://api:8000/api/payments \
  -d '{"order_id": "ORD-001", "payment_id": "PAY-001"}'

# 3. 注入不一致: 手动把 orders.status 改回 PENDING (但 alipay 还显示 PAID)
psql -c "UPDATE orders SET status='PENDING', paid_at=NULL WHERE order_id='ORD-001'"

# 4. 触发跑批
python -m domain.reconciliation.order_payment.run

# 5. 验证对账: 1 条 inconsistencies 记录, 自动修复 (saga 补偿)
psql -c "SELECT * FROM reconciliation_log WHERE created_at > NOW() - INTERVAL '1 hour'"
```

### 2.8.2 业务对账 mock 工具

| 工具 | 用途 |
|------|------|
| `tests/chaos/fixtures/order_inconsistency.yaml` | 预置 5 类典型不一致数据 |
| `tests/chaos/reconciliation_runner.py` | 手动触发跑批 (跳过 cron) |
| `tests/chaos/assertions/repair_success.py` | 断言对账修复成功 |

