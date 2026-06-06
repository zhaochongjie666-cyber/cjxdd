# {slug} 恢复剧本 (Recovery Runbook)

> 对应 L1 业务线: {biz_dir}
> 受众: 运维值班 / 故障响应工程师 / SRE
> 上游: failure-modes.md + failsafe-design.md
> 原则: 不写"联系运维"这种空话, 每步有具体命令

---

## 0. 通用信息

| 字段 | 内容 |
|------|------|
| 业务线 | {slug} |
| 服务名 | {service_name} |
| 关键依赖 | {dependencies} |
| 关键监控 | {monitoring_urls} |
| 值班联系方式 | {oncall_rotation} |
| 升级路径 | {escalation_path} |
| 最后演练日期 | {last_drilled_at} |

---

## 1. 故障症状索引

| 症状 ID | 症状描述 | 立即可观察 | 立即动作 § | 根因诊断 § | 恢复步骤 § |
|--------|---------|-----------|-----------|-----------|-----------|
| S01 | 系统响应慢 | P99 > 5s | § 2.1 | § 3.1 | § 4.1 |
| S02 | 提交标注失败 | 5xx 错误率 > 10% | § 2.2 | § 3.2 | § 4.2 |
| S03 | Nomad 任务堆积 | 队列长度 > 1000 | § 2.3 | § 3.3 | § 4.3 |
| S04 | DB 连接耗尽 | wait_count > 0 | § 2.4 | § 3.4 | § 4.4 |
| S05 | Redis 队列积压 | DLQ > 1000 | § 2.5 | § 3.5 | § 4.5 |
| S06 | 第三方 API 不可用 | 5xx 率 > 50% | § 2.6 | § 3.6 | § 4.6 |
| S07 | OOM 持续发生 | container OOM killed | § 2.7 | § 3.7 | § 4.7 |
| ... | ... | ... | ... | ... | ... |

---

## 2. 立即动作 (First 5 Minutes)

> 故障发生后 5 分钟内的标准动作, 目标是"止血" — 不一定是根因解决。

### 2.1 S01: 系统响应慢

**立即动作**:

```bash
# 1. 看监控大盘
open https://grafana.example.com/d/{service_name}

# 2. 快速健康检查
curl -s http://api:8000/api/health | jq

# 3. 看 CPU/内存
ssh backend 'top -bn1 | head -20'
ssh backend 'free -h'

# 4. 看 DB 慢查询
psql -c "SELECT pid, query, state, now() - query_start AS duration 
         FROM pg_stat_activity 
         WHERE state != 'idle' 
         ORDER BY duration DESC 
         LIMIT 10"

# 5. 看 Redis 状态
redis-cli INFO stats | grep -E "instantaneous|connected"
```

**判断方向**:
- CPU 高 → 见 § 3.1.1
- 内存高 → 见 § 3.1.2
- DB 慢 → 见 § 3.1.3
- 都不高 → 可能是外部依赖 → § 3.1.4

### 2.2 S02: 提交标注失败

**立即动作**:

```bash
# 1. 看错误日志
ssh backend 'tail -f /var/log/backend/error.log' &
# 等 30s, Ctrl+C

# 2. 看熔断器状态
curl -s http://api:8000/api/circuit-breakers | jq
# 期望: {"annotation-api": "CLOSED", ...}
# 异常: "OPEN" 表示下游 API 不可用

# 3. 测下游 API 直连
curl -s -w "\n%{http_code}\n" http://annotation-api:8001/health

# 4. 看本地草稿数量
psql -c "SELECT COUNT(*) FROM local_drafts WHERE created_at > NOW() - INTERVAL '1 hour'"
# 大量草稿 = 降级生效
```

**判断方向**:
- 熔断器 OPEN → § 3.2.1 (下游 API 问题)
- 草稿持续增长 → § 3.2.2 (sync 卡住)
- 都不是 → § 3.2.3 (其他原因)

### 2.3 S03: Nomad 任务堆积

**立即动作**:

```bash
# 1. 看 Nomad 队列
nomad job status data-collector
# 关注: Status = running, 但 Deployed = false

# 2. 看 alloc 排队
nomad job status data-collector | grep -E "Pending|Running"
# 大量 Pending = 堆积

# 3. 看 Nomad client 健康
nomad node status
# 关注: Status = ready / down

# 4. 看资源使用
nomad node status -verbose | grep -E "alloc|reserved"
```

### 2.4 S04: DB 连接耗尽

**立即动作**:

```bash
# 1. 看当前连接
psql -c "SELECT COUNT(*), state FROM pg_stat_activity GROUP BY state"

# 2. 看长事务
psql -c "SELECT pid, query, now() - xact_start AS xact_duration 
         FROM pg_stat_activity 
         WHERE xact_start IS NOT NULL 
         ORDER BY xact_duration DESC 
         LIMIT 5"

# 3. 杀掉长事务 (慎用!)
# psql -c "SELECT pg_terminate_backend(12345)"

# 4. 看慢查询
psql -c "SELECT pid, query, now() - query_start AS duration 
         FROM pg_stat_activity 
         WHERE state = 'active' AND query_start < NOW() - INTERVAL '30 seconds' 
         ORDER BY duration DESC"
```

### 2.5 S05: Redis 队列积压

**立即动作**:

```bash
# 1. 看各队列长度
redis-cli XLEN events:annotation-created
redis-cli XLEN events:collection-uploaded
# ... 所有事件流

# 2. 看 DLQ 长度
redis-cli XLEN events:dlq

# 3. 看 consumer 健康
docker ps --format "{{.Names}}: {{.Status}}" | grep consumer

# 4. 看 consumer lag
redis-cli XINFO GROUPS events:annotation-created
# 关注: pending > 1000 = 积压
```

### 2.6 S06: 第三方 API 不可用

**立即动作**:

```bash
# 1. 直连测第三方
curl -s -w "\n%{http_code}\n" -H "Authorization: Bearer ${API_KEY}" \
  https://api.third-party.com/v1/health

# 2. 看熔断器状态
curl -s http://api:8000/api/circuit-breakers | jq '.third_party'

# 3. 看降级率
curl -s http://api:8000/metrics | grep "degraded_total"

# 4. 看第三方状态页
open https://status.third-party.com
```

### 2.7 S07: OOM 持续发生

**立即动作**:

```bash
# 1. 看 OOM 日志
ssh backend 'dmesg | grep -i oom' | tail -20

# 2. 看 container 状态
docker ps -a --format "{{.Names}}: {{.Status}}" | grep backend

# 3. 看内存使用
ssh backend 'docker stats --no-stream'

# 4. 看是否有大对象
ssh backend 'pidof python3 | xargs -I {} cat /proc/{}/smaps 2>/dev/null | sort -k2 -n -r | head -20'
```

---

## 3. 根因诊断树

### 3.1 S01 慢响应根因

```
S01 慢响应
├── 3.1.1 CPU 高
│   ├── 看进程: `top -bn1 | head -10`
│   ├── 单进程 CPU 高 → 看 stack: `py-spy dump --pid <pid>`
│   └── 系统 CPU 高 → 看 QPS: 是否突发流量
├── 3.1.2 内存高
│   ├── 看 OOM: `dmesg | grep oom`
│   ├── 持续增长 → 内存泄漏, 见 § 4.7
│   └── 瞬时高 → 流量峰值, 见 § 3.1.4
├── 3.1.3 DB 慢
│   ├── 长事务: § 2.4 步骤 2
│   ├── 慢查询: § 2.4 步骤 4
│   ├── 锁等待: `SELECT * FROM pg_locks WHERE NOT GRANTED`
│   └── 主从延迟: `SELECT now() - pg_last_xact_replay_timestamp()`
└── 3.1.4 外部依赖
    ├── 第三方 API 慢: § 2.6
    ├── 跨服务调用: 分布式 tracing
    └── DNS 慢: `time nslookup api.internal`
```

### 3.2 S02 标注提交失败根因

```
S02 提交失败
├── 3.2.1 下游 API 不可用
│   ├── 熔断器 OPEN (§ 2.2 步骤 2)
│   ├── 草稿持续增长 (§ 2.2 步骤 4) → 数据进入降级路径
│   └── 修复: 见 § 4.2
├── 3.2.2 草稿 sync 卡住
│   ├── sync 进程没运行: `docker ps | grep sync`
│   ├── sync 出错: 看日志
│   └── 修复: § 4.2.2
└── 3.2.3 其他
    ├── 业务校验失败: 看错误码
    ├── 权限问题: 检查 JWT
    └── 未知错误: 看 trace
```

---

## 4. 恢复步骤 (Recovery Procedures)

### 4.1 S01 恢复步骤

#### 4.1.1 流量峰值引起

```bash
# 1. 确认流量来源
# 看 nginx access log: awk '{print $1}' /var/log/nginx/access.log | sort | uniq -c | sort -rn | head

# 2. 临时限流
# 在网关层加 rate limit: 100 QPS/IP

# 3. 启用降级
curl -X POST http://api:8000/admin/degradation/enable -d '{"mode": "CORE_ONLY"}'

# 4. 监控恢复
# 等 P99 < 1s 后继续
```

#### 4.1.2 DB 慢查询引起

```bash
# 1. 找到慢查询
psql -c "SELECT pid, query FROM pg_stat_activity WHERE state = 'active' ORDER BY query_start LIMIT 5"

# 2. 评估: 杀还是等
# 业务影响大 → 杀: SELECT pg_terminate_backend(<pid>)

# 3. 加索引 (如果缺失)
psql -c "CREATE INDEX CONCURRENTLY idx_xxx ON table (column)"

# 4. 重启应用 (如果需要清缓存)
docker restart backend-1 backend-2
```

### 4.2 S02 恢复步骤

#### 4.2.1 下游 API 恢复

```bash
# 1. 确认下游 API 恢复
curl -s http://annotation-api:8001/health
# 期望: {"status": "ok"}

# 2. 手动触发熔断器重置 (可选)
curl -X POST http://api:8000/admin/circuit-breaker/reset -d '{"name": "annotation-api"}'

# 3. 等 30s 让自动探测恢复
# 或手动触发:
curl -X POST http://api:8000/admin/circuit-breaker/half-open -d '{"name": "annotation-api"}'

# 4. 触发草稿同步
curl -X POST http://api:8000/admin/sync-drafts

# 5. 验证
psql -c "SELECT COUNT(*) FROM local_drafts"  # 应 < 100
psql -c "SELECT COUNT(*) FROM annotations WHERE status = 'SUBMITTED' AND created_at > NOW() - INTERVAL '1 hour'"  # 应增长
```

#### 4.2.2 草稿 sync 卡住

```bash
# 1. 看 sync 进程
docker ps | grep sync
docker logs sync-draft 2>&1 | tail -50

# 2. 重启 sync
docker restart sync-draft

# 3. 验证
curl -s http://api:8000/api/sync/status | jq
# 期望: {"status": "running", "last_sync_at": "..."}

# 4. 手动触发 (如果还没动)
curl -X POST http://api:8000/admin/sync-drafts?force=true
```

### 4.3 S03 Nomad 任务堆积恢复

```bash
# 1. 看 Nomad cluster 健康
nomad server members
nomad node status

# 2. 如果是 client 节点 down
nomad node drain <node-id> -enable -force
# 触发任务 reschedule 到健康节点

# 3. 如果是调度器本身问题
# 重启 Nomad server (谨慎!)
systemctl restart nomad
# 或
docker restart nomad-server-1 nomad-server-2 nomad-server-3

# 4. 验证
nomad job status data-collector
# 期望: 所有 alloc Running
```

### 4.4 S04 DB 连接耗尽恢复

```bash
# 1. 找到长连接
psql -c "SELECT pid, usename, application_name, state, now() - state_change AS idle 
         FROM pg_stat_activity 
         WHERE state IN ('idle in transaction', 'idle') 
         ORDER BY idle DESC LIMIT 10"

# 2. 杀 idle 事务
psql -c "SELECT pg_terminate_backend(pid) 
         FROM pg_stat_activity 
         WHERE state = 'idle in transaction' 
         AND now() - state_change > INTERVAL '5 minutes'"

# 3. 调整 max_connections (临时)
# 修改 postgresql.conf: max_connections = 200
# 重启 PostgreSQL (生产慎用, 建议用 pgbouncer)

# 4. 长期方案: 引入 pgbouncer 连接池
# 见: https://www.pgbouncer.org/
```

### 4.5 S05 Redis 队列恢复

```bash
# 1. 启动更多 consumer
docker compose up -d --scale consumer=5

# 2. 等待消化
watch -n 10 'redis-cli XLEN events:annotation-created'
# 期望: 数字持续下降

# 3. 如果 DLQ 有数据, 重投
python scripts/replay_dlq.py --queue events:dlq --target events:annotation-created

# 4. 验证
redis-cli XINFO GROUPS events:annotation-created
# 期望: pending < 100
```

### 4.6 S06 第三方 API 恢复

```bash
# 1. 确认第三方恢复
curl -s -w "%{http_code}\n" -o /dev/null -H "Authorization: Bearer ${API_KEY}" \
  https://api.third-party.com/v1/health
# 期望: 200

# 2. 强制熔断器转 HALF_OPEN
curl -X POST http://api:8000/admin/circuit-breaker/half-open -d '{"name": "third-party"}'

# 3. 探测
sleep 5
curl -s http://api:8000/api/circuit-breakers | jq '.third_party'
# 期望: HALF_OPEN 或 CLOSED

# 4. 验证
curl -s -X POST http://api:8000/api/geo/encode -d '{"address": "test"}' | jq
# 期望: 真实数据, 不是 degraded mock
```

### 4.7 S07 OOM 恢复

```bash
# 1. 看 OOM 详情
ssh backend 'dmesg | grep -i oom | tail -20'
# 看是哪个进程被杀

# 2. 临时增加内存
docker update --memory 2g backend-1
docker restart backend-1

# 3. 找内存泄漏
ssh backend 'py-spy dump --pid $(pidof python3)' | head -50
# 找最大对象

# 4. 紧急回滚 (如需要)
docker compose rollback backend
# 或
kubectl rollout undo deployment/backend

# 5. 长期: 修代码, 引入对象池
```

---

## 5. 演练记录

| 日期 | 演练内容 | 演练人 | 问题 | 修复 |
|------|---------|--------|------|------|
| {date} | F01 调度风暴 | {name} | {issues} | {fixes} |
| {date} | F11 网络分区 | {name} | {issues} | {fixes} |
| ... | ... | ... | ... | ... |

---

## 6. 上下游溯源

- **上游**: failure-modes.md (FXX) + failsafe-design.md (FSXX)
- **下游**:
  - L6 Phase 5.7 灾难演练引用本 runbook
  - 值班手册直接引用
  - 故障复盘会引用

---

## 自检清单

- [ ] 每个故障症状有"立即动作"段 (5 分钟内可执行)
- [ ] 每个症状有"根因诊断树" (至少 2 层)
- [ ] 每个根因有"恢复步骤" (具体命令)
- [ ] 不写"联系运维"这种空话
- [ ] 区分"自动恢复"和"人工介入"
- [ ] 包含回滚路径
- [ ] 演练记录定期更新
- [ ] 上下游溯源完整

---

## 0.1 规模扩展 (l3_extended_mode)

> **本节仅在 L 规模 (`l3_extended_mode=true`) 时使用。** 业务对账、跨地域、Owner/SLO 关联等扩展内容生效。

新增症状：

| 症状 ID | 描述 | 规模 |
|--------|------|------|
| S08 | 业务对账发现数据不一致 | L |
| S09 | 机房级故障, 业务中断 | L |
| S10 | 跨地域一致性违反 (双扣/漏扣) | L |
| S11 | 业务幂等违反 (重复支付/订单) | L |
| S12 | 异地数据同步延迟 | L |

新增 Owner / SLO 关联字段（每个症状补全）:

| 症状 | Owner | SLO 类别 | 回滚时长 |
|------|-------|---------|---------|
| S08 | #payment-oncall / #finance | 资金 | 5min |
| S09 | #infra-oncall | 可用性 | 5min |
| S10 | #payment-oncall | 资金 / 合规 | 5min |
| S11 | #backend-oncall | 资金 | 1h |
| S12 | #infra-oncall | 性能 | 1h |

---

## 4.8 S08: 业务对账发现数据不一致恢复步骤 (L 规模)

### 4.8.1 自动修复成功

```bash
# 1. 查看跑批日志
docker logs reconciliation-order-payment 2>&1 | tail -50

# 2. 确认 inconsistencies 列表
psql -c "SELECT * FROM reconciliation_log 
         WHERE created_at > NOW() - INTERVAL '1 hour' 
         AND status = 'auto_repaired' 
         ORDER BY created_at DESC LIMIT 20"

# 3. 验证业务状态
psql -c "SELECT order_id, status, paid_at FROM orders 
         WHERE order_id IN ('ORD-001', 'ORD-002', ...)"
# 期望: 状态与对账修复后一致

# 4. 通知相关 oncall
echo "[S08] 业务对账自动修复完成, 涉及 1 条订单" | slack "#payment-oncall"
```

### 4.8.2 自动修复失败 (升级)

```bash
# 1. 查看失败明细
psql -c "SELECT * FROM reconciliation_log 
         WHERE created_at > NOW() - INTERVAL '1 hour' 
         AND status = 'unresolved' 
         ORDER BY created_at DESC LIMIT 20"

# 2. 查看具体失败原因
psql -c "SELECT id, order_id, error_message, suggested_fix 
         FROM reconciliation_log 
         WHERE id = 12345"

# 3. 手工对账
# - 比较 orders DB 和 alipay API 真实数据
# - 确认业务真实状态 (订单是否支付, 金额是否一致)
# - 修复: 直接 UPDATE DB 或调用 saga 补偿 API

# 4. 升级: PagerDuty "#payment-oncall" P1
curl -X POST https://events.pagerduty.com/v2/enqueue \
  -H "Content-Type: application/json" \
  -d '{
    "routing_key": "...",
    "event_action": "trigger",
    "payload": {
      "summary": "S08 业务对账发现订单-支付不一致, 需人工介入",
      "severity": "critical",
      "source": "reconciliation-order-payment",
      "custom_details": {"order_id": "ORD-001", "delta": "-100.00"}
    }
  }'

# 5. 通知 #finance (资金类必通知)
echo "[S08] 资金不一致, 需财务核对" | slack "#finance"
```

### 4.8.3 资金不一致 (S08 严重分支)

```bash
# 资金不一致: 0 容差, 必须 5min 内人工介入

# 1. 立即冻结相关账户
psql -c "UPDATE users SET balance_frozen = true 
         WHERE user_id IN (
           SELECT user_id FROM orders WHERE order_id = 'ORD-001'
         )"

# 2. 升级到 #finance P1 (PagerDuty)
# (同 4.8.2 步骤 4)

# 3. 财务人工核对 (后续步骤):
#    - 查银行流水
#    - 查 alipay 账单
#    - 查用户支付凭证
#    - 决定补扣 / 退款
#    - 修复 DB + 修复 audit log

# 4. 资金修复后解冻账户
psql -c "UPDATE users SET balance_frozen = false WHERE user_id = ..."
```

---

## 4.9 S09: 机房级故障恢复步骤 (L 规模)

### 4.9.1 DNS 自动切机房 (5min 内)

```bash
# 1. 确认机房状态 (核对健康检查)
curl -s http://primary-health:8000/api/health
# 期望: 503 或超时
curl -s http://secondary-health:8000/api/health
# 期望: 200 OK

# 2. 触发 DNS 切机房 (10% → 50% → 100% 灰度)
curl -X POST http://dns-controller:8000/admin/failover \
  -d '{"from": "primary", "to": "secondary", "step": 10}'
sleep 60
curl -X POST http://dns-controller:8000/admin/failover \
  -d '{"from": "primary", "to": "secondary", "step": 50}'
sleep 60
curl -X POST http://dns-controller:8000/admin/failover \
  -d '{"from": "primary", "to": "secondary", "step": 100}'

# 3. 验证切机房后业务恢复
curl -s http://api:8000/api/health
# 期望: 200 OK (流量已切到 secondary)

# 4. 检查写排队
psql -c "SELECT COUNT(*) FROM write_queue WHERE created_at > NOW() - INTERVAL '10 minutes'"
# 期望: 写操作已排队, primary 恢复后回放

# 5. primary 恢复后切回 (灰度)
# (同 4.9.1 步骤 2, 但 from/to 颠倒)
```

### 4.9.2 DNS 切机房后 P99 上升 (自动回滚)

```bash
# 1. 检查 P99 状态
curl -s http://prometheus:9090/api/v1/query?query=histogram_quantile(0.99,rate(http_request_duration_seconds_bucket[5m]))
# 期望: P99 > 200ms (S09 触发)

# 2. 自动回滚 (FS84): DNS 切回 primary
curl -X POST http://dns-controller:8000/admin/failover \
  -d '{"from": "secondary", "to": "primary", "step": 100}'

# 3. 升级: PagerDuty "#infra-oncall" P2
# (DNS 切机房多次失败, 需人工介入)
```
