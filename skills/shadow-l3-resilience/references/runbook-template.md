# 恢复剧本编写指南 (Runbook Template Guide)

> L3 recovery-runbook.md 模板的详细参考。运维值班用的剧本怎么写 — 立即动作、根因诊断、恢复步骤都要有具体命令。

## 1. Runbook 的目的

**受众**: 运维值班、SRE、故障响应工程师（非开发）

**目标**: 故障发生后, 5 分钟内能"止血", 30 分钟内能定位根因, 1 小时内恢复服务。

**反模式**:
- ❌ "联系运维"（谁？哪个邮箱？）
- ❌ "查看日志"（哪个路径？用什么命令？）
- ❌ "重启服务"（哪几个？顺序？）
- ❌ "联系开发"（没有电话就是空话）

## 2. Runbook 三段式

### 2.1 立即动作 (First 5 Minutes)

**目标**: 故障发生后 5 分钟内的标准动作, 止血 + 初步诊断。

**必含内容**:
- 监控大盘 URL
- 关键命令（健康检查 / 看资源 / 看日志）
- 常见症状的快速判断
- 紧急回滚命令

### 2.2 根因诊断树 (Root Cause Analysis)

**目标**: 系统化定位根因, 而不是乱猜。

**必含内容**:
- 决策树（症状 → 可能原因 → 进一步诊断）
- 每个诊断步骤的具体命令
- 区分"是"和"否"的下一步

### 2.3 恢复步骤 (Recovery Procedures)

**目标**: 根因确认后, 按步骤恢复服务。

**必含内容**:
- 完整恢复命令（逐步）
- 验证步骤（每步后看什么）
- 回滚路径（如果恢复失败）
- 数据修复（如需要）

## 3. 故障症状索引

每个 runbook 开头要有"症状 → 立即动作 → 诊断 → 恢复"的索引表, 让值班人员快速定位。

```markdown
| 症状 ID | 症状 | 立即可观察 | §立即动作 | §根因 | §恢复 |
|--------|------|-----------|----------|------|------|
| S01 | 系统响应慢 | P99 > 5s | § 2.1 | § 3.1 | § 4.1 |
| S02 | 提交标注失败 | 5xx > 10% | § 2.2 | § 3.2 | § 4.2 |
| ... | ... | ... | ... | ... | ... |
```

## 4. 立即动作的写法

### 4.1 模板

```markdown
### 2.X SXX: <症状名称>

**立即动作**:

```bash
# 1. <第一步 - 通常是看监控>
<具体命令>

# 2. <第二步 - 健康检查>
<具体命令>

# 3. <第三步 - 看资源>
<具体命令>

# 4. <第四步 - 看依赖>
<具体命令>

# 5. <第五步 - 看业务>
<具体命令>
```

**判断方向**:
- <场景 A> → 见 § 3.X.1
- <场景 B> → 见 § 3.X.2
- <都不是> → 见 § 3.X.3
```

### 4.2 立即动作的命令原则

**原则 1: 命令可一键复制**

```bash
# GOOD
psql -c "SELECT pid, query, now() - query_start AS duration FROM pg_stat_activity WHERE state != 'idle' ORDER BY duration DESC LIMIT 10"

# BAD
登录到数据库, 查看长查询
```

**原则 2: 包含判断标准**

```bash
# GOOD
psql -c "SELECT COUNT(*) FROM pg_stat_activity" 
# 期望: < 100
# 异常: > 200 = 连接数过高

# BAD
psql -c "SELECT COUNT(*) FROM pg_stat_activity"
```

**原则 3: 包含后续动作**

```bash
# GOOD
docker ps --format "{{.Names}}: {{.Status}}" | grep backend
# 如果有 Exited (137) → OOM killed, 见 § 3.7
# 如果有 Restarting → 健康检查失败, 见 § 3.5
# 如果都健康 → 业务逻辑问题, 见 § 3.X
```

## 5. 根因诊断树的写法

### 5.1 树形结构

```markdown
### 3.X SXX 根因

```
SXX <症状>
├── 3.X.1 <可能原因 1>
│   ├── 看 X: `<命令>`
│   ├── 单值高 → <子原因>
│   └── 系统性高 → <子原因>
├── 3.X.2 <可能原因 2>
│   ├── 看 Y: `<命令>`
│   └── ...
└── 3.X.3 <其他>
    ├── 看 Z: `<命令>`
    └── ...
```
```

### 5.2 决策原则

**原则 1: 决策点要二选一**

```markdown
# GOOD
├── 3.1.1 CPU 高
│   ├── 看进程: `top -bn1 | head -10`
│   ├── 单进程 CPU 高 → 见 § 4.1.1
│   └── 系统 CPU 高 → 见 § 4.1.2

# BAD
├── 3.1.1 CPU 高
│   ├── 排查...
```

**原则 2: 每个分支有具体命令**

```markdown
# GOOD
├── 3.1.2 内存高
│   ├── 看 OOM: `dmesg | grep oom`
│   ├── 有 OOM → 见 § 4.7
│   └── 无 OOM → 看是否有大对象: `py-spy dump --pid <pid>`

# BAD
├── 3.1.2 内存高
│   ├── 排查内存问题
```

## 6. 恢复步骤的写法

### 6.1 模板

```markdown
### 4.X SXX 恢复步骤

#### 4.X.1 <子场景 1>

**场景**: <什么情况下用这个恢复步骤>

```bash
# 1. <确认上游已恢复>
<命令>

# 2. <执行恢复操作>
<命令>

# 3. <验证>
<命令>
# 期望: <具体值>

# 4. <回滚（如果失败）>
<命令>
```
```

### 6.2 恢复步骤的注意事项

**原则 1: 区分自动 / 半自动 / 手动**

```markdown
# GOOD
## 恢复路径

- **自动**: 流量回落后, 积压任务自动消化（< 5min）
- **半自动**: 监控告警后人工确认 Nomad 队列状态
- **手动**: 长期无法恢复 → 切换到备用数据中心
```

**原则 2: 包含验证**

```bash
# GOOD
docker restart backend-1
sleep 5
curl -s http://api:8000/api/health
# 期望: {"status": "ok"}

# BAD
docker restart backend-1
```

**原则 3: 包含回滚**

```bash
# GOOD
# 如果上面恢复失败, 回滚:
docker compose rollback backend
# 或
git revert <commit>
docker compose up -d
```

**原则 4: 包含数据修复**

```bash
# GOOD
# 修复草稿同步问题:
python scripts/replay_drafts.py --from 2024-01-01 --to 2024-01-02
# 验证: 草稿数为 0
psql -c "SELECT COUNT(*) FROM local_drafts WHERE created_at > '2024-01-01'"
```

## 7. 演练记录

每个 runbook 都应包含历史演练记录, 帮助新值班人员了解常见问题:

```markdown
## 5. 演练记录

| 日期 | 演练内容 | 演练人 | 问题 | 修复 |
|------|---------|--------|------|------|
| 2024-01-15 | F01 调度风暴 | 张三 | runbook 中重启 Nomad 步骤不全 | 补充完整命令 |
| 2024-02-20 | F11 网络分区 | 李四 | 草稿 sync 卡住, runbook 没说 | 新增 § 4.2.2 |
| ... | ... | ... | ... | ... |
```

## 8. 命名规范

| 元素 | 命名 | 示例 |
|------|------|------|
| 症状 ID | SXX (2 位数字) | S01, S02 |
| 立即动作段 | § 2.X | § 2.1 |
| 根因段 | § 3.X | § 3.1 |
| 恢复段 | § 4.X | § 4.1 |
| 子段 | § 4.X.Y | § 4.1.1 |

## 9. Runbook 自检清单

完成后逐项检查：

- [ ] 每个故障症状有"立即动作"段, 5 分钟内可执行
- [ ] 立即动作包含 5-10 个具体命令
- [ ] 每个命令有"期望值"或"判断标准"
- [ ] 根因诊断树至少 2 层分支
- [ ] 每个根因有"恢复步骤"段
- [ ] 恢复步骤区分"自动 / 半自动 / 手动"
- [ ] 每个恢复步骤有"验证"和"回滚"
- [ ] 不写"联系运维"这种空话
- [ ] 包含演练记录段
- [ ] 上下游溯源完整

## 10. 反模式

### 10.1 ❌ 命令模糊

```markdown
# BAD
1. 查看系统状态
2. 重启服务
3. 联系开发

# GOOD
1. ps aux | grep python | head -5
2. docker restart backend-1 backend-2
3. PagerDuty 升级: P1 → on-call 工程师 (电话: +86-xxx)
```

### 10.2 ❌ 没有判断标准

```markdown
# BAD
psql -c "SELECT COUNT(*) FROM connections"
# 如果太多, 见 § 4

# GOOD
psql -c "SELECT COUNT(*) FROM connections"
# 期望: < 100
# 异常: > 200 = 连接数过高, 见 § 4
```

### 10.3 ❌ 没有回滚

```markdown
# BAD
1. 删除旧数据: rm /var/log/old/*
2. 重启服务

# GOOD
1. 备份: tar czf /backup/logs-$(date +%F).tar.gz /var/log/old
2. 删除: rm /var/log/old/*
3. 重启: docker restart backend-1
4. 验证: curl -s http://api:8000/health
# 如果失败, 回滚: tar xzf /backup/logs-*.tar.gz -C /; docker restart backend-1
```

### 10.4 ❌ 没有时间预期

```markdown
# BAD
1. 等待系统恢复

# GOOD
1. 等待熔断器探测 (timeout=30s)
2. 30s 后检查: curl -s http://api:8000/api/circuit-breakers
3. 如果仍 OPEN, 手动触发: curl -X POST /admin/circuit-breaker/half-open
```

## 11. 完整 runbook 示例

参考模板 `templates/recovery-runbook.md` 中的完整示例。
