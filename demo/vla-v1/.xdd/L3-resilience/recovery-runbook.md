# Recovery Runbook — VLA 平台 (运维值班剧本)

> 生命周期角色: `design_baseline` 设计基线 (跨迭代复用, on-call 手边用)
> 消费来源: `.xdd/L3-resilience/failure-modes.md` (32 FMEA) + RPN Top 排序 + 合规/可用性优先级
> 受众: 业务线 oncall (P12 SRE / 业务线工程师) + L1/L2 值班
> 编排: 1min 诊断 (5 步命令) → 5min 止血 → 30min 恢复 → 1h 复盘
> 触发: PagerDuty / Slack 告警 / 监控 dashboard 异常 / 客户投诉

## 0. 通用工具与命令速查

### 0.1 集群访问

```bash
# 配置 kubectl
export KUBECONFIG=~/.kube/config-staging  # 或 prod

# 切换 namespace
kubens vla-prod  # 或 vla-staging

# 查看所有 pod
kubectl get pods -A | grep vla
```

### 0.2 常用诊断命令

```bash
# 看某 pod 状态
kubectl describe pod <pod-name> -n vla-prod
kubectl logs <pod-name> -n vla-prod --tail=200 --since=10m

# 看所有 namespace 健康
kubectl get pods -A --field-selector=status.phase!=Running

# 看 SLO 实时 (Prometheus)
curl -s "https://prom.vla.example.com/api/v1/query?query=up{job='vla-sim-svc'}" | jq

# 看业务对账 (Reconciler)
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT * FROM reconciliation_results WHERE run_at > now() - interval '1 day' ORDER BY drift_count DESC LIMIT 10;"
```

### 0.3 PagerDuty 升级路径

```
L1 on-call (5 min 响应) → L2 业务线 on-call (15 min) → L3 平台 SRE (30 min) → L4 EM/CTO (60 min, P0 HALT)
```

### 0.4 通用恢复原则

1. **先止血, 后根因**: 5min 内先恢复业务, 根因排查放 30min 后
2. **记录操作**: 所有破坏性操作前 `kubectl create -f backup.yaml` 备份
3. **通知优先**: 大操作前 Slack #vla-oncall 公告
4. **避免连锁**: 单点修复, 不批量改
5. **保留证据**: 失败 pod 不立即删, 先 `kubectl logs > /tmp/evidence-$(date +%s).log`

---

## RB-01: SimJob 卡 Running 不出结果

**症状**: SimJob 状态 running 超过 1h, episode_count 不增长, 用户 P1UI 看到进度条卡住.

**告警**:
- `vla_sim_worker_heartbeat_age_seconds > 300` (5min 无心跳)
- `vla_sim_episode_total_increase_rate == 0` (10min 无新 episode)
- 客户投诉: "我的 SimJob 跑了 2h 还在 0/50"

**1min 诊断 (5 步命令)**:
```bash
# 1. 看 SimJob 状态
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT sim_job_id, status, attempts.attempt_no, attempts.status, attempts.started_at, EXTRACT(EPOCH FROM (now() - attempts.started_at)) AS age_s
   FROM sim_jobs JOIN attempts ON sim_jobs.sim_job_id = attempts.sim_job_id
   WHERE sim_jobs.status='running' AND attempts.status='running'
   ORDER BY attempts.started_at LIMIT 5;"

# 2. 看 worker pod
kubectl get pods -n vla-prod -l app=sim-worker -o wide
kubectl logs -n vla-prod -l app=sim-worker --tail=100 --since=10m

# 3. 看 heartbeat
curl -s "https://prom.vla.example.com/api/v1/query?query=vla_sim_worker_heartbeat_age_seconds" | jq '.data.result[].value'

# 4. 看 GPU 利用率
nvidia-smi  # 在 worker pod 内: kubectl exec -it <pod> -- nvidia-smi

# 5. 看 episode 生成速率
curl -s "https://prom.vla.example.com/api/v1/query?query=rate(vla_sim_episode_generated_total[5m])" | jq
```

**5min 止血**:
```bash
# 看 attempt 是否卡死
ATTEMPT_ID=$(psql -h postgres-primary.vla.local -U vla_admin -d vla -t -c \
  "SELECT attempt_id FROM attempts WHERE sim_job_id='SIM-XXX' AND status='running' LIMIT 1;")

# 强制重启 worker (触发 watchdog 5min 超时 + attempt_id+1)
kubectl delete pod -n vla-prod -l app=sim-worker,sim_job_id=SIM-XXX

# 验证: 新 pod 拉起
kubectl get pods -n vla-prod -l sim_job_id=SIM-XXX
```

**30min 恢复**:
```bash
# 1. 等新 pod 启动 + Isaac Sim 加载 (5min, R3.1 已知)
sleep 300
kubectl logs -n vla-prod -l app=sim-worker,sim_job_id=SIM-XXX --tail=50

# 2. 验证 episode 重新生成
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT COUNT(*) FROM sim_episodes WHERE sim_job_id='SIM-XXX';"

# 3. 如果 attempt 2 仍卡 → 切 MuJoCo fallback
# 修改 task_spec.scene_config.engine = "mujoco"
UPDATE sim_jobs SET scene_config = jsonb_set(scene_config, '{engine}', '"mujoco"') WHERE sim_job_id='SIM-XXX';

# 4. 重试 attempt
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "UPDATE attempts SET status='failed', ended_at=now(), error_code='MANUAL_RESTART' WHERE attempt_id='$ATTEMPT_ID';"
# K8s 自动 attempt_id+1
```

**1h 复盘**:
- 收集证据: pod logs + Isaac Sim 崩溃日志 + GPU dmesg
- 根因分类: Isaac 段错误 / OOM / 资源死锁 / 配置错误
- 写复盘: `#vla-postmortem/2026-06-XX-sim-job-stuck.md`
- 加固: 升级 watchdog 阈值 / 加自动切引擎 / 改进 sim-worker 健康检查

**预防**:
- FMEA F23 SimJob 卡 running (RPN 24 P1)
- 兜底: #9 背压 (watchdog 5min) + #4 补偿 (attempt+1) + #12 业务幂等 (episode 边界)

---

## RB-02: TrainingJob NaN 频繁

**症状**: TrainingJob 训练中, loss 突变为 NaN, GPU 利用率仍高但 loss 不下降.

**告警**:
- `vla_training_loss_nan_total > 0` (NaN 计数 > 0)
- `vla_training_grad_norm > 1e6` (梯度爆炸)
- W&B dashboard 显示 loss 跳变

**1min 诊断 (5 步命令)**:
```bash
# 1. 看 TrainingJob 状态
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT training_job_id, status, last_checkpoint_id, last_metric_value, attempts.attempt_no
   FROM training_jobs JOIN attempts ON training_jobs.training_job_id = attempts.training_job_id
   WHERE training_jobs.status='running' AND attempts.status='running'
   ORDER BY attempts.started_at DESC LIMIT 5;"

# 2. 看 NaN 计数
curl -s "https://prom.vla.example.com/api/v1/query?query=vla_training_loss_nan_total" | jq

# 3. 看 W&B 实时
# 打开 https://wandb.ai/vla-org/TJ-XXX (从 training_job 详情链接)

# 4. 看 checkpoint 历史
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT checkpoint_id, step, loss, is_best, created_at FROM checkpoints
   WHERE training_job_id='TJ-XXX' ORDER BY step DESC LIMIT 10;"

# 5. 看 GPU 显存
kubectl exec -it <training-worker-pod> -- nvidia-smi
```

**5min 止血**:
```bash
# 1. 立即停训 (FMEA F24 NaN 兜底: 熔断 + 保存 last_good)
# 找到 last_good_checkpoint (loss 不为 NaN 的最近一个)
LAST_GOOD=$(psql -h postgres-primary.vla.local -U vla_admin -d vla -t -c \
  "SELECT checkpoint_id FROM checkpoints
   WHERE training_job_id='TJ-XXX' AND loss IS NOT NULL
   ORDER BY step DESC LIMIT 1;")

# 2. 停止训练 (SIGTERM → 优雅保存)
kubectl exec -it <training-worker-pod> -- kill -SIGTERM $(pgrep -f "train_worker.py")

# 3. 等待 30s, 验证进程退出
sleep 30
kubectl get pods -n vla-prod -l app=train-worker,training_job_id=TJ-XXX

# 4. 标记 attempt 失败
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "UPDATE attempts SET status='failed', ended_at=now(), error_code='NAN_DETECTED' WHERE attempt_id='$ATTEMPT_ID';"
```

**30min 恢复**:
```bash
# 1. 分析 NaN 根因 (从 wandb 下载 loss 曲线)
# python scripts/download_wandb.py --job TJ-XXX --metrics loss,grad_norm

# 2. 常见根因 + 处理:
#    a) learning_rate 太高 → 降低 50%: 更新 hyperparams.lr
#    b) batch_size 太大 → 减半: hyperparams.batch_size /= 2
#    c) 数据污染 (含 NaN 样本) → 跑 data validation: python scripts/validate_dataset.py --dataset v3
#    d) gradient clipping 未启用 → 启用: hyperparams.grad_clip = 1.0

# 3. 修改 training_jobs 表 + 提交 attempt 2
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "UPDATE training_jobs SET hyperparams = jsonb_set(hyperparams, '{lr}', '0.00005')
   WHERE training_job_id='TJ-XXX';"

# 4. 触发 attempt 2 (从 last_good resume)
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "UPDATE training_jobs SET resume_from_checkpoint_id='$LAST_GOOD' WHERE training_job_id='TJ-XXX';"
# K8s 自动 attempt_id+1
```

**1h 复盘**:
- 写复盘: `#vla-postmortem/2026-06-XX-training-nan.md`
- 根因: 90% 是数据污染 / 10% 是 LR 太高
- 加固: 启用自动 NaN 检测 + 强制从 last_good resume (FMEA F24 兜底)

**预防**:
- FMEA F24 Training NaN (RPN 16 P1)
- 兜底: #2 熔断 (NaN 立即停) + #3 降级 (QLoRA) + #1 重试 (从 last_good)
- 长效: 跑训练前 data validation

---

## RB-03: Kafka consumer lag 飙升

**症状**: 业务事件发布后, 下游 consumer (B02 datalake-ingester / B04 eval queue) 延迟 > 1min.

**告警**:
- `kafka_consumer_lag_max > 10000` (lag > 10K)
- `vla_kafka_throughput` 下降
- 业务侧: dataset 入库延迟, eval job 排队

**1min 诊断 (5 步命令)**:
```bash
# 1. 看 consumer group 状态
docker exec kafka-1 kafka-consumer-groups.sh \
  --bootstrap-server kafka-1:9092 \
  --describe --all-groups

# 2. 看 broker 状态
docker exec kafka-1 kafka-broker-api-versions.sh --bootstrap-server kafka-1:9092
docker ps | grep kafka  # 看有几个 broker 在线

# 3. 看 partition 状态
docker exec kafka-1 kafka-topics.sh --bootstrap-server kafka-1:9092 --describe --topic sim_job_events

# 4. 看 consumer 进程
kubectl get pods -n vla-prod -l app=datalake-ingester
kubectl logs -n vla-prod -l app=datalake-ingester --tail=100

# 5. 看 producer CB 状态
curl -s "https://prom.vla.example.com/api/v1/query?query=vla_kafka_producer_circuit_breaker_state" | jq
```

**5min 止血**:
```bash
# 情况 A: 1 个 broker down
# 验证: ISR 仍可用, 不需要操作, 30s 内 leader 切换

# 情况 B: consumer 慢
# 1. 扩 consumer 实例 (HPA 自动)
kubectl scale deployment datalake-ingester -n vla-prod --replicas=10

# 2. 验证 lag 下降
sleep 60
docker exec kafka-1 kafka-consumer-groups.sh \
  --bootstrap-server kafka-1:9092 \
  --describe --group datalake-ingester

# 情况 C: producer 故障 (CB OPEN)
# 1. 检查 broker 健康
docker ps | grep kafka  # 几个在线
# 2. 重启 down 的 broker
docker start kafka-1
# 3. 验证 30s 内 producer CB HALF_OPEN → CLOSED
```

**30min 恢复**:
```bash
# 1. 长期措施: 扩 partition
docker exec kafka-1 kafka-topics.sh --bootstrap-server kafka-1:9092 \
  --alter --topic sim_job_events --partitions 24

# 2. 长期措施: 加 consumer 实例
kubectl scale deployment datalake-ingester -n vla-prod --replicas=15

# 3. 业务对账 (Reconciler 模式 11): Kafka offset vs DB
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT * FROM reconciliation_results
   WHERE check_type='kafka_offset_vs_db' AND drift_count > 0
   ORDER BY run_at DESC LIMIT 10;"

# 4. 手动补传 lag 期间的事件 (如果有)
python scripts/replay_kafka_events.py --from-offset $LAG_OFFSET --topic sim_job_events
```

**1h 复盘**:
- 根因: 突发流量 / broker 故障 / consumer bug
- 写复盘: `#vla-postmortem/2026-06-XX-kafka-lag.md`
- 加固: 扩 partition 到 24 (R5.3 缓解) / HPA 提前扩容 / 改进 consumer 性能

**预防**:
- FMEA F15 Kafka broker 宕 (RPN 12 P0)
- 兜底: #2 熔断 (producer 60s) + #3 降级 (本地 RocksDB) + #4 补偿 (异步重传) + #11 业务对账

---

## RB-04: PG 主从切换 (Primary Failover)

**症状**: PG primary 不可用, 应用 API 大量 5xx, patroni 触发自动切换.

**告警**:
- PagerDuty P0: "PostgreSQL primary down"
- `pg_stat_activity` 连接数从 200 骤降到 0
- 业务 API 错误率 > 50%

**1min 诊断 (5 步命令)**:
```bash
# 1. 看 patroni 状态
docker exec postgres-primary patronictl list  # 或 kubectl exec

# 2. 看哪个 PG 在跑
kubectl get pods -n vla-prod -l app=postgres

# 3. 看 PGBouncer 状态
docker exec pgbouncer psql -p 6432 -U pgbouncer pgbouncer -c "SHOW POOLS;"

# 4. 看应用层 API 错误
curl -s "https://prom.vla.example.com/api/v1/query?query=rate(vla_api_5xx_total[1m])" | jq

# 5. 看 RLS 是否仍生效
psql -h postgres-new-primary.vla.local -U vla_admin -d vla -c \
  "SELECT schemaname, tablename, rowsecurity FROM pg_tables WHERE schemaname='public' AND rowsecurity=true;"
```

**5min 止血**:
```bash
# 1. 验证 patroni 自动切换完成
docker exec postgres-new-primary patronictl list
# 期望: New primary in "Leader" role, 30s 内完成

# 2. 应用层自动重连 (PGBouncer 透明)
# 验证: 应用 API 5xx 率下降
sleep 30
curl -s "https://prom.vla.example.com/api/v1/query?query=rate(vla_api_5xx_total[1m])" | jq

# 3. 业务侧降级: 限流降到 50%
kubectl patch configmap kong-config -n vla-prod -p '{"data":{"rate-limit-per-role":"50"}}'

# 4. 通知客户: 业务降级 (非中断)
# Slack: "PG 切换中, 业务 API 降级到 50% 限流, 30s 内恢复"
```

**30min 恢复**:
```bash
# 1. 老 primary 修复后, 重新加回集群
# 假设物理机重启, docker start postgres-primary
docker start postgres-primary
# 验证 patroni 重新加入
docker exec postgres-primary patronictl list

# 2. 验证 RLS 仍生效 (应用层 session var 恢复)
# 重要: 应用层在重连时必须重新 SET app.project_id
# 审计: 验证 cross_tenant 访问 = 0
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT COUNT(*) FROM audit_logs WHERE cross_tenant=true AND created_at > now() - interval '1 hour';"

# 3. 业务对账 (FMEA F07 + F14 兜底)
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT * FROM reconciliation_results
   WHERE run_at > now() - interval '1 hour' AND drift_count > 0;"

# 4. 恢复 Kong 限流到 100 QPS
kubectl patch configmap kong-config -n vla-prod -p '{"data":{"rate-limit-per-role":"100"}}'
```

**1h 复盘**:
- 根因: primary OOM / 磁盘满 / 网络分区 / hardware 故障
- 写复盘: `#vla-postmortem/2026-06-XX-pg-failover.md`
- 加固: 改进 health check / 加快 patroni 切换时间 / 多 AZ 部署 primary

**预防**:
- FMEA F07 PG 池耗尽 (RPN 30 P0) + F14 RLS 失效 (RPN 10 P0)
- 兜底: #7 隔离 (PGBouncer) + #5 限流 (Kong) + #9 背压 (503 Retry-After) + #6 隔离 (RLS 强制)

---

## RB-05: MinIO 节点 down / 磁盘满

**症状**: SimJob 写 episode 视频失败, B02 写真实数据失败, 业务 API 慢.

**告警**:
- `vla_minio_request_duration_seconds > 1s`
- `minio_5xx_rate > 1%`
- 业务侧: SimJob 状态 stuck, 客户投诉上传失败

**1min 诊断 (5 步命令)**:
```bash
# 1. 看 MinIO 节点
docker ps | grep minio
mc admin info vla-minio  # 假设已配 mc 客户端

# 2. 看磁盘使用
mc du vla-minio/vla-bucket
df -h /mnt/minio-data  # MinIO 数据盘

# 3. 看 EC 健康
mc admin heal status vla-minio

# 4. 看业务影响
curl -s "https://prom.vla.example.com/api/v1/query?query=rate(vla_minio_5xx_total[5m])" | jq

# 5. 看 fallback 是否触发 (本地 SSD)
kubectl exec -it <sim-worker> -- ls -la /tmp/vla_minio_buffer/ | wc -l
```

**5min 止血**:
```bash
# 情况 A: 1 节点 down (EC 4 节点, 可容忍 1)
# 验证: 业务无影响, EC 自动修复, 不需操作
# mc admin heal status: 进行中, 等完成

# 情况 B: 2 节点 down (EC 降级, 部分请求 5xx)
# 1. 启动 down 节点
docker start minio-1
# 2. 业务降级: 走本地 SSD
# (自动触发, 看 /tmp/vla_minio_buffer/ 是否有数据)

# 情况 C: 磁盘满
# 1. 立即清理: 删除 30 天前的临时文件
mc rm --recursive --force --older-than 30d vla-minio/vla-temp
# 2. 紧急扩容 (LVM 扩 100GB)
lvextend -L +100G /dev/mapper/minio-data
resize2fs /dev/mapper/minio-data
```

**30min 恢复**:
```bash
# 1. 验证 EC 修复完成
mc admin heal status vla-minio
# 期望: 所有对象健康, 0 待修复

# 2. 重传 buffered episodes
python scripts/replay_minio_buffer.py --bucket vla-bucket --buffer-dir /tmp/vla_minio_buffer
# 业务对账: sim_episodes.status='stored' 应等于 sim_jobs.num_episodes

# 3. 长期: 触发冷热分层 (R1.4 风险触发)
# 30 天前数据转 OSS-IA 冷存储
python scripts/cold_storage_migration.py --older-than 30d --target oss-ia

# 4. 1h 内 oncall 评估: 是否需要扩 MinIO 容量 / 加节点
```

**1h 复盘**:
- 根因: 磁盘满 / 节点硬件故障 / 误操作
- 写复盘: `#vla-postmortem/2026-06-XX-minio-outage.md`
- 加固: 提前 30 天告警 (used > 70%) / 自动化清理 / 冷热分层 SOP

**预防**:
- FMEA F17 MinIO 限流 (RPN 18 P2) + F03 磁盘满 (RPN 12 P2)
- 兜底: #3 降级 (本地 SSD) + #9 背压 (worker 限速) + #4 补偿 (job retry) + #10 缓存降级 + #11 业务对账

---

## RB-06: Isaac Sim 频繁崩溃

**症状**: SimJob 跑 100 episode, 崩溃 5+ 次, attempt 反复重试, 业务进度慢.

**告警**:
- `vla_sim_worker_crash_total` 突增
- SimJob `attempts` 表 failed 多
- 客户投诉: "我的 SimJob 跑 3h 还在 30/100"

**1min 诊断 (5 步命令)**:
```bash
# 1. 看崩溃率 (近 1h)
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT error_code, COUNT(*) FROM attempts
   WHERE started_at > now() - interval '1 hour' AND status='failed'
   GROUP BY error_code ORDER BY COUNT(*) DESC;"

# 2. 看 Isaac Sim 日志
kubectl logs -n vla-prod -l app=sim-worker --tail=500 | grep -E "(Segmentation|Error|crash|exit)"

# 3. 看 GPU 状态
kubectl exec -it <sim-worker> -- nvidia-smi
kubectl exec -it <sim-worker> -- dmesg | tail -50

# 4. 看 Isaac 进程退出码
kubectl exec -it <sim-worker> -- ls /var/log/vla/isaac_crash_*.log | tail -5

# 5. 看物理参数
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT scene_config, physics_config FROM sim_jobs WHERE status='running' LIMIT 3;"
```

**5min 止血**:
```bash
# 情况 A: Isaac 段错误频繁 (5+ 次/h)
# 1. 切 MuJoCo fallback (FMEA F19 兜底)
# 修改所有 running SimJob 的 scene_config.engine = "mujoco"
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "UPDATE sim_jobs SET scene_config = jsonb_set(scene_config, '{engine}', '\"mujoco\"')
   WHERE status='running' AND scene_config->>'engine' = 'isaac';"

# 2. 验证: 新 attempt 用 MuJoCo
sleep 60  # 等下次重试
kubectl logs -n vla-prod -l app=sim-worker --tail=50 | grep "engine"

# 情况 B: Isaac 启动失败 (启动 5min 超时)
# 1. 改 warm pool 镜像
kubectl set image deployment/sim-worker sim-worker=vla/sim-worker:isaac-v5.1 -n vla-prod
# 2. 验证: 滚动重启
kubectl rollout status deployment/sim-worker -n vla-prod
```

**30min 恢复**:
```bash
# 1. 长期: 切回 Isaac (修复后)
# 评估: Isaac 版本 / NVIDIA 驱动 / scene 复杂度

# 2. 业务对账: 跨引擎 episode 完整性
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT engine, COUNT(*) FROM sim_episodes
   WHERE sim_job_id IN (SELECT sim_job_id FROM sim_jobs WHERE created_at > now() - interval '1 day')
   GROUP BY engine;"

# 3. 1h 内 oncall 决定: 暂时全切 MuJoCo vs 修复 Isaac
# 4. 通知客户: "Isaac 故障, 临时切 MuJoCo, 不影响数据"
```

**1h 复盘**:
- 根因: Isaac 段错误 / NVIDIA 驱动 / scene 太复杂 / asset 损坏
- 写复盘: `#vla-postmortem/2026-06-XX-isaac-crash.md`
- 加固: 改进 Isaac 配置 (R3.1 缓解) / 加自动切引擎 / 缩短 attempt 间隔

**预防**:
- FMEA F19 Isaac 段错误 (RPN 24 P1) + F20 MuJoCo 异常 (RPN 12 P2)
- 兜底: #4 补偿 (3 attempt) + #3 降级 (切 MuJoCo) + #11 业务对账 (episode_count)

---

## RB-07: EvalJob 评测结果波动

**症状**: 同模型同评测 3 次, success rate std > 5%, 客户投诉"评测不准确".

**告警**:
- `eval_report_std > 5%` (Reconciler 检测)
- 客户投诉
- 跨次跑分对比异常

**1min 诊断 (5 步命令)**:
```bash
# 1. 看最近 10 次同模型评测
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT eval_job_id, benchmark, success_rate, std_dev, completed_at
   FROM eval_reports
   WHERE model_version_id='MV-XXX' AND benchmark='LIBERO-90'
   ORDER BY completed_at DESC LIMIT 10;"

# 2. 看 trial 详情
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT trial_no, success, duration_s, seed FROM eval_tasks
   WHERE eval_job_id='EJ-XXX' ORDER BY trial_no;"

# 3. 看评测 worker 日志
kubectl logs -n vla-prod -l app=eval-worker,eval_job_id=EJ-XXX --tail=200

# 4. 看推理服务延迟
curl -s "https://prom.vla.example.com/api/v1/query?query=vla_eval_inference_latency_ms{quantile='0.99'}" | jq

# 5. 看环境差异 (GPU/驱动/库版本)
kubectl exec -it <eval-worker> -- nv-smi 2>/dev/null || kubectl exec -it <eval-worker> -- nvidia-smi
kubectl exec -it <eval-worker> -- python -c "import torch; print(torch.__version__, torch.cuda.is_available())"
```

**5min 止血**:
```bash
# 1. 强制 5 trial (FMEA F25 兜底: 业务对账 + 业务幂等)
# 修改 eval_jobs.num_trials = 5 (从默认 3)
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "UPDATE eval_jobs SET num_trials = 5 WHERE eval_job_id='EJ-XXX';"

# 2. 触发自动多跑 (eval worker 检测 std > 5%)
kubectl exec -it <eval-worker> -- kill -SIGUSR1 $(pgrep -f "eval_worker.py")
# 期望: 触发 2 个额外 trial, 然后取 5 trial 中位数

# 3. 验证: std 下降
sleep 300
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT std_dev FROM eval_reports WHERE eval_job_id='EJ-XXX';"
```

**30min 恢复**:
```bash
# 1. 长期: 固定种子, 减少波动
# 改 eval_jobs.fixed_seed = true
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "UPDATE eval_jobs SET fixed_seed = true WHERE eval_job_id='EJ-XXX';"

# 2. 长期: 增加 trial 数 (5 → 10)
# 评估: 10 trial 足够稳定

# 3. 业务对账 (FMEA F25 兜底): LIBERO vs 真实环境 ranking
python scripts/cross_benchmark_ranking.py --model MV-XXX

# 4. 1h 内 oncall 评估: 报告是否需要重发客户
```

**1h 复盘**:
- 根因: 评测种子 / 模型随机性 / 环境差异 / 推理服务抖动
- 写复盘: `#vla-postmortem/2026-06-XX-eval-volatility.md`
- 加固: 固定种子 + 增加 trial + 跨 benchmark 校验

**预防**:
- FMEA F25 评测波动 (RPN 36 P1) — **RPN Top 1**
- 兜底: #12 业务幂等 (3 trial 中位数强制) + #11 业务对账 (跨 benchmark 校验) + #4 补偿 (超阈值自动重跑)

---

## RB-08: API Key 泄露 / 越权访问

**症状**: 异常 IP 访问, 跨租户访问, 客户报告"我的数据被其他人看到了".

**告警**:
- PagerDuty P0: "API Key 异常使用, 跨租户 + 限流触发"
- `audit_logs{cross_tenant=true}` 出现
- 客户投诉

**1min 诊断 (5 步命令)**:
```bash
# 1. 看越权访问日志
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT * FROM audit_logs
   WHERE cross_tenant=true AND created_at > now() - interval '1 hour'
   ORDER BY created_at DESC LIMIT 20;"

# 2. 看异常 IP
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT client_ip, user_agent, COUNT(*)
   FROM audit_logs
   WHERE created_at > now() - interval '1 hour' AND api_key_id='API-XXX'
   GROUP BY client_ip, user_agent ORDER BY COUNT(*) DESC;"

# 3. 看 API Key 状态
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT * FROM api_keys WHERE key_id='API-XXX';"

# 4. 看 Kong 限流触发
curl -s "https://prom.vla.example.com/api/v1/query?query=vla_kong_rate_limit_triggered_total" | jq

# 5. 看 RLS 是否仍强制
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT * FROM rls_policies WHERE tablename IN ('sim_jobs', 'training_jobs', 'collection_sessions');"
```

**5min 止血**:
```bash
# 1. 立即 revoke 泄露的 API Key
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "UPDATE api_keys SET status='revoked', revoked_at=now(), revoke_reason='LEAK_DETECTED' WHERE key_id='API-XXX';"

# 2. Kong 配置更新: api_key API-XXX 失效
kubectl patch configmap kong-api-keys -n vla-prod -p "{\"data\":{\"API-XXX\":\"revoked\"}}"
# 重新加载 Kong
kubectl rollout restart deployment kong -n vla-prod

# 3. 验证: 老 Key 任何调用都 401
curl -H "X-API-Key: API-XXX" https://api.vla.example.com/v1/sim/jobs
# 期望: 401 VLA-X-0011

# 4. 通知客户: 邮件 + Slack DM
# 模板: "您的 API Key API-XXX 检测到异常, 已吊销, 请重新申请"
```

**30min 恢复**:
```bash
# 1. 客户申请新 Key (走 OAuth + MFA 强认证)
# 2. 安全工程师 review: 攻击影响范围
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT action, target, COUNT(*) FROM audit_logs
   WHERE api_key_id='API-XXX' AND created_at > <LEAK_TIME>
   GROUP BY action, target ORDER BY COUNT(*) DESC;"

# 3. 法务 review: 是否需要报备 (GDPR/中国数据安全法)
# 4. 加固: IP 白名单 / 强制 MFA / 90 天滚动

# 5. 业务对账 (FMEA F28 + F29 兜底)
# 验证: cross_tenant 访问计数 = 0 (revoke 后)
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT COUNT(*) FROM audit_logs
   WHERE cross_tenant=true AND created_at > <REVOKE_TIME>;"
```

**1h 复盘**:
- 根因: Key 误推 git / 客户端硬编码 / 钓鱼
- 写复盘: `#vla-postmortem/2026-06-XX-api-key-leak.md`
- 加固: 强制环境变量 / pre-commit 扫描 / 渗透测试 (季度)

**预防**:
- FMEA F27 API Key 泄露 (RPN 20 P0) + F28 越权 (RPN 10 P0) + F29 审计清 (RPN 20 P0)
- 兜底: #5 限流 (Kong) + #7 隔离 (立即 revoke + 90 天轮换) + #11 业务对账 (cross-tenant 审计)

---

## RB-09: 审计日志被清 / 7 年保留破坏

**症状**: audit_logs 表行数突降 / hash 链校验失败 / 异地备份丢失.

**告警**:
- `audit_logs_count` 突降 > 10%
- `audit_log_chain_hash_mismatch` 告警
- 异地备份 OSS-IA 任务失败

**1min 诊断 (5 步命令)**:
```bash
# 1. 看 audit_logs 行数趋势
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT date_trunc('hour', created_at), COUNT(*)
   FROM audit_logs
   WHERE created_at > now() - interval '1 day'
   GROUP BY 1 ORDER BY 1;"

# 2. 看 hash 链
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT * FROM audit_chain_verification
   ORDER BY verified_at DESC LIMIT 5;"

# 3. 看异地备份状态
aws s3 ls s3://vla-audit-backup-oss-ia/$(date +%Y/%m/%d)/ 2>/dev/null
# 或
ossutil ls oss://vla-audit-backup/$(date +%Y/%m/%d)/

# 4. 看谁有 DELETE 权限
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT grantee, privilege_type FROM information_schema.table_privileges
   WHERE table_name='audit_logs' AND privilege_type='DELETE';"

# 5. 看 RLS 状态
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT relname, relrowsecurity, relforcerowsecurity
   FROM pg_class WHERE relname='audit_logs';"
```

**5min 止血**:
```bash
# 1. 立即禁止任何 DELETE 权限
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "REVOKE DELETE ON audit_logs FROM PUBLIC, vla_app, vla_admin;"

# 2. 创建 trigger: 禁止 DELETE
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "CREATE OR REPLACE FUNCTION prevent_audit_delete() RETURNS trigger AS \$\$
   BEGIN RAISE EXCEPTION 'audit_logs is append-only, DELETE forbidden';
   END; \$\$ LANGUAGE plpgsql;
   CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_logs
   FOR EACH ROW EXECUTE FUNCTION prevent_audit_delete();"

# 3. 验证: 任何 DELETE 都被拒
psql -h postgres-primary.vla.local -U vla_admin -d vla -c "DELETE FROM audit_logs LIMIT 1;"
# 期望: ERROR: audit_logs is append-only, DELETE forbidden

# 4. 通知: 1h 内 oncall + 法务 + 合规审计员
```

**30min 恢复**:
```bash
# 1. 从异地备份恢复
aws s3 cp s3://vla-audit-backup-oss-ia/<LATEST_BACKUP>/audit_logs.csv /tmp/
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "\\COPY audit_logs FROM '/tmp/audit_logs.csv' CSV HEADER;"

# 2. 重建 hash 链
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT rebuild_audit_chain();"

# 3. 验证
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT * FROM audit_chain_verification ORDER BY verified_at DESC LIMIT 1;"
# 期望: chain_valid=true

# 4. 法务 + 合规审计: 1h 内 review, 是否刑事报案
```

**1h 复盘**:
- 根因: 内部恶意操作 / 备份恢复时误删 / 攻击者提权
- 写复盘: `#vla-postmortem/2026-06-XX-audit-tamper.md`
- 加固: trigger 永久禁止 DELETE / 异地备份频率 → 1h / 链式 hash 实时校验

**预防**:
- FMEA F29 审计日志被清 (RPN 20 P0)
- 兜底: #7 隔离 (audit 写只追加, 不允许 DELETE) + #10 缓存降级 (独立冷存储) + #11 业务对账 (链式 hash 校验)

---

## RB-10: 单 region outage / 跨地域切换

**症状**: cn-east-1 整体宕 (电力 / 网络 / 火山), 用户调 API 全 5xx.

**告警**:
- PagerDuty P0: "cn-east-1 region outage, 自动切 cn-south-1"
- `multi_region_health{region="cn-east-1"}` 全 AZ down
- DNS 健康检查失败

**1min 诊断 (5 步命令)**:
```bash
# 1. 看 region 健康
curl -s "https://prom.vla.example.com/api/v1/query?query=multi_region_health" | jq

# 2. 看 DNS
dig vla.example.com +short

# 3. 看 cn-east-1 服务
kubectl get pods -n vla-prod-east --field-selector=status.phase!=Running

# 4. 看 PG primary
docker exec postgres-primary-east patronictl list

# 5. 看 Kafka 主从
docker exec kafka-1-east kafka-broker-api-versions.sh --bootstrap-server kafka-1-east:9092 2>&1 | head -5
```

**5min 止血**:
```bash
# 1. 立即 DNS 切到备 region
# 注意: R6.2 合规, 不能自动切境外, 必须人工确认境内备 region
# oncall 1 min 内确认: 切 cn-south-1 (境内) 还是境外 (不允许)
aws route53 change-resource-record-sets --hosted-zone-id Z1VLA --change-batch '{
  "Changes": [{
    "Action": "UPSERT",
    "ResourceRecordSet": {
      "Name": "vla.example.com",
      "Type": "A",
      "TTL": 60,
      "ResourceRecords": [{"Value": "<cn-south-1-IP>"}]
    }
  }]
}'

# 2. 备 region 服务启动
# K8s 节点预热 (一般已 standby, 自动接管)
kubectl get pods -n vla-prod-south

# 3. PG 提升: replica → primary
docker exec postgres-replica-south patronictl failover

# 4. Kafka 切主
docker exec kafka-1-south kafka-leader-election.sh --bootstrap-server kafka-1-south:9092 --election-type PREFERRED --topic <topic>
```

**30min 恢复**:
```bash
# 1. 业务侧降级: 备 region 限流 50% (单 region 容量减半)
kubectl patch configmap kong-config -n vla-prod-south -p '{"data":{"rate-limit-per-role":"50"}}'

# 2. 业务对账 (Reconciler 模式 11): 跨 region 复制差异
psql -h postgres-primary-south.vla.local -U vla_admin -d vla -c \
  "SELECT * FROM reconciliation_results
   WHERE check_type='cross_region_replication' AND drift_count > 0;"

# 3. 1h 内: 老 region 修复
# 通知 IDC: cn-east-1 电力 / 网络恢复时间
# 决定: 老 region 重新加回集群 (作为新 replica) 还是主备切换

# 4. 业务侧: 用户 P5/P7/P11 调 API 自动路由到备 region, 5 min 内恢复 200
```

**1h 复盘**:
- 根因: 电力 / 网络 / 火山 / 地震 (机房级)
- 写复盘: `#vla-postmortem/2026-06-XX-region-outage.md`
- 加固: 多 AZ / 多 region / 自动化 DNS 切换 (合规允许时) / 跨 region 业务对账

**预防**:
- FMEA F30 单 region outage (RPN 15 P0) + F31 跨 region 复制延迟 (RPN 18 P1) + F32 数据出境合规 (RPN 5 P0)
- 兜底: #3 降级 (DNS 切备) + #5 限流 (备 region 50%) + #11 业务对账 (跨 region)

---

## RB-11: 越权访问 (RBAC 失效 / X-R04 触发)

**症状**: 内部用户 / 攻击者尝试跨 project 访问, RLS 防线被绕过.

**告警**:
- PagerDuty P0: "RLS 失效, 内部越权"
- `audit_logs{cross_tenant=true}` 出现
- 渗透测试命中

**1min 诊断 (5 步命令)**:
```bash
# 1. 看越权日志
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT * FROM audit_logs
   WHERE cross_tenant=true AND created_at > now() - interval '1 hour'
   ORDER BY created_at DESC LIMIT 20;"

# 2. 看 RLS 策略
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT schemaname, tablename, policyname, roles, cmd
   FROM pg_policies WHERE schemaname='public';"

# 3. 看 BYPASSRLS 角色
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT rolname, rolbypassrls FROM pg_roles WHERE rolbypassrls=true;"

# 4. 看应用 session var 设置
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT pid, usename, application_name, client_addr, query
   FROM pg_stat_activity WHERE state='active';"

# 5. 看越权 SQL 是否成功
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SET app.project_id='proj_A'; SELECT COUNT(*) FROM sim_jobs WHERE project_id='proj_B';"
# 期望: 0 行 (RLS 拒绝)
```

**5min 止血**:
```bash
# 1. 立即吊销越权用户
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "REVOKE ALL ON ALL TABLES IN SCHEMA public FROM vla_app;"

# 2. 重设 RLS 强制
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "ALTER TABLE sim_jobs FORCE ROW LEVEL SECURITY;
   ALTER TABLE training_jobs FORCE ROW LEVEL SECURITY;
   ALTER TABLE collection_sessions FORCE ROW LEVEL SECURITY;
   ALTER TABLE eval_jobs FORCE ROW LEVEL SECURITY;"

# 3. 验证: BYPASSRLS 角色 = 0
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT rolname, rolbypassrls FROM pg_roles WHERE rolbypassrls=true;"
# 期望: 仅 postgres (DBA 紧急用, 业务角色不能 BYPASSRLS)

# 4. 通知: oncall + 安全工程师 + 法务
```

**30min 恢复**:
```bash
# 1. 安全 review: 越权影响范围
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT actor, action, target, COUNT(*)
   FROM audit_logs
   WHERE cross_tenant=true AND created_at > <INCIDENT_TIME>
   GROUP BY actor, action, target ORDER BY COUNT(*) DESC;"

# 2. 法务评估: 是否刑事报案 / 客户通知 / 监管报备
# 3. 1h 内: 修复 RLS / 收紧 RBAC / 越权扫描频率 月 → 周
# 4. 自动化越权扫描 (现有: 每月) 加严
python scripts/rls_audit_scan.py --frequency weekly
```

**1h 复盘**:
- 根因: RBAC 漏洞 / BYPASSRLS 误授权 / 应用层漏 set session var
- 写复盘: `#vla-postmortem/2026-06-XX-rls-bypass.md`
- 加固: 自动化 RLS 扫描 (周) / 越权尝试立即告警 / 业务角色永久不能 BYPASSRLS

**预防**:
- FMEA F14 RLS 失效 (RPN 10 P0) + F28 越权 (RPN 10 P0)
- 兜底: #7 隔离 (PG 强制 RLS) + #11 业务对账 (每日越权审计) + 紧急 hotfix

---

## RB-12: TrainingJob 节点驱逐 (Spot 抢占)

**症状**: TrainingJob 训练中, K8s 节点被驱逐 (spot 抢占), worker 突然消失.

**告警**:
- `kube_node_spec_unschedulable=true`
- `node_lifecycle_controller_terminated_total` 突增
- spot interruption notice (30s 倒计时)

**1min 诊断 (5 步命令)**:
```bash
# 1. 看 spot 通知
kubectl get events -n vla-prod --field-selector reason=SpotInterruption

# 2. 看节点状态
kubectl get nodes -o wide | grep -v Ready
kubectl describe node <node-name> | grep -A 5 "Conditions:"

# 3. 看 training worker
kubectl get pods -n vla-prod -l app=train-worker -o wide
kubectl logs -n vla-prod -l app=train-worker --tail=50 --previous

# 4. 看 checkpoint
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT checkpoint_id, step, loss, is_best, created_at
   FROM checkpoints WHERE training_job_id='TJ-XXX' ORDER BY step DESC LIMIT 5;"

# 5. 看 attempts
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT attempt_no, status, started_at, ended_at, error_code
   FROM attempts WHERE training_job_id='TJ-XXX' ORDER BY attempt_no DESC LIMIT 3;"
```

**5min 止血**:
```bash
# 1. spot 抢占 30s 倒计时 → graceful shutdown 已自动触发
# (FMEA F06 兜底: 30s 内保存 last_good_checkpoint)
# 验证: checkpoint 已保存
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT checkpoint_id, step FROM checkpoints
   WHERE training_job_id='TJ-XXX' ORDER BY step DESC LIMIT 1;"

# 2. 强制 attempt 失败 (PDB 允许 1 个同时中断)
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "UPDATE attempts SET status='failed', ended_at=now(), error_code='NODE_EVICTED'
   WHERE attempt_id='$ATTEMPT_ID';"

# 3. K8s 自动 attempt+1 (新节点, 5 min 内)
sleep 300
kubectl get pods -n vla-prod -l app=train-worker,training_job_id=TJ-XXX
```

**30min 恢复**:
```bash
# 1. 验证 attempt 2 从 last_good resume
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT training_jobs.resume_from_checkpoint_id, attempts.attempt_no
   FROM training_jobs JOIN attempts ON training_jobs.training_job_id = attempts.training_job_id
   WHERE training_jobs.training_job_id='TJ-XXX'
   ORDER BY attempts.attempt_no DESC LIMIT 1;"

# 2. 业务侧: 训练不丢进度 (已训练 step 保留)
# 3. 1h 内 oncall 决定: 改 on-demand 节点 (非 spot) 避免频繁驱逐

# 4. 业务对账 (FMEA F06 兜底): checkpoint 索引无漂移
psql -h postgres-primary.vla.local -U vla_admin -d vla -c \
  "SELECT * FROM reconciliation_results
   WHERE check_type='training_checkpoint_chain' AND drift_count > 0;"
```

**1h 复盘**:
- 根因: spot 抢占 / node NotReady / 资源不足驱逐
- 写复盘: `#vla-postmortem/2026-06-XX-node-eviction.md`
- 加固: 长训练用 on-demand / PDB 提前 5min 触发 graceful / spot 仅用于短任务 (B01)

**预防**:
- FMEA F06 K8s 节点驱逐 (RPN 24 P1)
- 兜底: #7 隔离 (PDB 限制) + #4 补偿 (30s graceful + attempt+1) + #8 幂等

---

## 附: Runbook 索引 (快速跳转)

| RB | 故障 | 优先级 | 1min 诊断关键 | 5min 止血核心 |
|----|------|--------|-------------|-------------|
| RB-01 | SimJob 卡 Running | P0 | heartbeat + episode_count | kill pod + attempt+1 |
| RB-02 | Training NaN | P0 | NaN 计数 + W&B | SIGTERM + last_good resume |
| RB-03 | Kafka lag 飙升 | P0 | consumer group + broker | 扩 consumer / 重启 broker |
| RB-04 | PG 主从切换 | P0 | patroni 状态 | 验证自动切换 + 限流 50% |
| RB-05 | MinIO down / 满 | P1 | node + 磁盘 | 启节点 / 清盘 / 走本地 SSD |
| RB-06 | Isaac Sim 崩 | P0 | 崩溃率 + 物理参数 | 切 MuJoCo |
| RB-07 | EvalJob 波动 | P1 | std + trial 详情 | 强制 5 trial |
| RB-08 | API Key 泄露 | P0 | 越权日志 + 异常 IP | revoke + 90 天轮换 |
| RB-09 | 审计日志被清 | P0 | 行数 + hash 链 | 禁止 DELETE + 异地恢复 |
| RB-10 | Region outage | P0 | region 健康 + DNS | DNS 切备 + 限流 50% |
| RB-11 | RBAC 失效 | P0 | RLS 策略 + BYPASSRLS | 强制 RLS + 吊销角色 |
| RB-12 | 节点驱逐 | P1 | spot 通知 + graceful | 保存 last_good + attempt+1 |

**总覆盖**: 12 Runbook (≥ 10 硬性要求), 覆盖 32 FMEA 中 RPN Top 12 + 合规/可用性关键.

**预防 → 检测 → 响应 闭环**:
- 每个 RB 都引用 FMEA id, 形成"失败模式 → 兜底 → 监测 → 应急" 闭环
- 1h 复盘后写 `.xdd/iterations/iter-N/postmortem/YYYY-MM-DD-{slug}.md` 归档
- 加固项走 FMEA 修订 + chaos-scenarios 增量

## Alertmanager 集成 (Task 85)

每个 Runbook 触发的告警走 Prometheus Alertmanager 路由:

| 严重度 | 路由 | 通知渠道 | 升级 |
|--------|------|---------|------|
| **P0 (RPN ≥ 24)** | `p0-critical` | PagerDuty + 飞书 + 短信 | 5min 未响应 → SRE 主管 |
| **P1 (RPN 15-23)** | `p1-high` | 飞书 + 邮件 | 30min 未响应 → 二次 @ |
| **P2 (RPN 8-14)** | `p2-med` | 飞书群 | 1h 工作时段响应 |

**Alert 标签 (统一)**:
- `biz_line: B01 | B02 | B03 | B04 | X`
- `fmea_id: F05` (关联失败模式)
- `runbook_id: RB-05` (一键跳到对应 RB 段)
- `severity: p0 | p1 | p2`
- `rpn: 24`

**Alertmanager 配置片段** (部署到 `infra/k8s/alertmanager-config.yaml`):
```yaml
route:
  receiver: 'default'
  group_by: ['alertname', 'fmea_id', 'runbook_id']
  routes:
    - match_re:
        severity: 'p0'
      receiver: 'pagerduty-p0'
      continue: false
    - match_re:
        severity: 'p1'
      receiver: 'feishu-p1'
      continue: false
    - match_re:
        severity: 'p2'
      receiver: 'feishu-p2'
      continue: false
```

**Runbook 集成步骤**:
1. Alertmanager 收到 alert → 按标签匹配 receiver
2. 通知内嵌 `runbook_id: RB-XX` 链接 → 飞书卡片一键跳到本 runbook
3. SRE 值班按 RB 流程 5min 内 ack + 30min 内止血
4. 1h 内复盘 + 写 postmortem + 加固项进 FMEA 下一轮
