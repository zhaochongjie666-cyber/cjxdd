# L1.5 架构审计（Architecture Audit）指南

## 为什么需要架构审计

L1.5 写了 architecture.md，但**写了的架构 ≠ 实际实现的架构**。常见漂移：

1. **聚合边界被打破**：业务代码跨越聚合根直接修改
2. **API 契约不一致**：实现改了 endpoint / 字段但没更新 architecture.md
3. **技术栈漂移**：实际引入了 architecture.md 没列的库
4. **事件契约不一致**：事件 payload 变了但 event-contract.md 没更新
5. **文件结构漂移**：file-list.md 写的目录结构和实际不一致

**架构审计 = 在 L5-impl 完成后，反向验证代码实现是否真的符合 L1.5 设计**。

## 审计时机

| 时机 | 目的 | 范围 |
|------|------|------|
| L5-impl 完成每个 Batch | 早发现早修复 | 当前 Batch 的文件 |
| L5-impl 完成全部 | 全局审计 | 全部代码 |
| L6 漫游前 | 漫游前回归 | 关键路径 |
| 重大变更后 | 重新确认架构完整性 | 变更影响范围 |

## 审计 5 大维度

### 1. 聚合边界（Aggregate Boundary）

**检查**：代码中是否严格按聚合边界读写？

```bash
# 反向搜索：跨聚合直接修改
grep -rn "Repository<" backend/domain/aggregates/ | grep -v "self.aggregate"
# 期望：所有 Repository 调用都在自己的聚合内
```

**常见违规**：
- Aggregate A 的方法里直接调用 Aggregate B 的 Repository
- Service 层绕过聚合根直接操作 DB
- 跨聚合事务用分布式锁而不是 saga/event

**报告项**：
```yaml
- check: aggregate_boundary
  aggregate: Order
  violation: OrderService 直接修改了 Inventory 表
  location: backend/domain/services/order_service.py:42
  severity: high
  fix: 改为发布 OrderPlaced 事件，InventoryService 监听
```

### 2. API 契约一致性（API Contract Consistency）

**检查**：实现的 API endpoint、请求/响应结构、错误码是否与 architecture.md §7 一致？

```bash
# 提取 architecture.md 中的 endpoint 列表
grep -E "^\| (POST|GET|PUT|PATCH|DELETE)" .shadow/L1.5-architecture/{slug}/architecture.md
# 提取代码中的 route 注册
grep -rn "@router\." backend/app/api/routes/
```

**报告项**：
```yaml
- check: api_contract
  expected: "POST /api/collections (collection-R01)"
  actual: "POST /api/collections/{id}/start"
  severity: high
  fix: 对齐 architecture.md 端点路径
```

### 3. 技术栈合规（Tech Stack Compliance）

**检查**：实际依赖是否在 architecture.md §3 列表内？

```bash
# 提取 architecture.md 中允许的依赖
grep -A 5 "技术栈" .shadow/L1.5-architecture/{slug}/architecture.md
# 提取代码中实际依赖
cat backend/requirements.txt
# 或
cat backend/pyproject.toml
```

**报告项**：
```yaml
- check: tech_stack
  allowed: [fastapi, sqlalchemy, postgresql, redis]
  actual: [fastapi, sqlalchemy, postgresql, redis, motor, beanie]
  unauthorized: [motor, beanie]
  severity: medium
  fix: 要么补 architecture.md 的技术决策，要么改回 SQLAlchemy
```

### 4. 事件契约一致性（Event Contract Consistency）

**检查**：发布的事件 payload 与 event-contract.md 是否一致？

```bash
# 提取 event-contract.md 中的事件定义
grep -A 10 "event:" .shadow/L1.5-architecture/event-contract.md
# 提取代码中实际发布的事件
grep -rn "publish_event\|emit\b" backend/ | head -20
```

**报告项**：
```yaml
- check: event_contract
  event: AnnotationCreated
  expected_payload: {annotation_id, task_id, status, created_at}
  actual_payload: {id, taskId, status, createdAt}
  severity: high
  fix: 对齐 event-contract.md 的 payload schema
```

### 5. 文件结构合规（File Structure Compliance）

**检查**：实际目录结构与 file-list.md / file-mapping.md 是否一致？

```bash
# 提取 file-list.md 的目录结构
grep -E "^###\|^####" .shadow/L1.5-architecture/{slug}/file-list.md
# 实际目录
find backend/ -type d | head -20
```

**报告项**：
```yaml
- check: file_structure
  expected: backend/domain/aggregates/order.py
  actual: backend/domain/models/order.py
  severity: low
  fix: 改名 / 更新 file-list.md
```

## 审计报告模板

```markdown
# L1.5 架构审计报告

> Slug: {slug}
> 审计时间: {timestamp}
> 审计范围: {代码 commit / 全部代码}

---

## 汇总

| 维度 | 通过 | 警告 | 严重 |
|------|------|------|------|
| 聚合边界 | {p} | {w} | {c} |
| API 契约 | {p} | {w} | {c} |
| 技术栈合规 | {p} | {w} | {c} |
| 事件契约 | {p} | {w} | {c} |
| 文件结构 | {p} | {w} | {c} |
| **合计** | **{p}** | **{w}** | **{c}** |

---

## 严重问题（必须修）

1. {问题 1} → {修复 1}
2. {问题 2} → {修复 2}

## 警告（建议修）

1. {问题 1} → {修复 1}

## 通过项

- {通过的检查项}

## 审计工具

- 手动审计: 本文档提供的 grep 命令
- 自动审计脚本: `scripts/arch-audit.sh <slug>`（可选）

## 修复建议

- **严重**: 阻断 L6 漫游，必须修
- **警告**: 不阻断 L6，但建议在下个迭代修
- **通过**: 不动

## 审计签名

- 审计人: {agent / person}
- 时间: {timestamp}
- 结果: PASS / CONDITIONAL / FAIL
```

## 自动审计脚本（可选）

`scripts/arch-audit.sh <slug>` 实现：

```bash
#!/usr/bin/env bash
# 1. 聚合边界：grep 跨聚合调用
# 2. API 契约：grep @router + 对照 endpoint 清单
# 3. 技术栈：cat requirements.txt + 对照技术栈段
# 4. 事件契约：grep publish_event + 对照 event-contract.md
# 5. 文件结构：find 实际目录 + 对照 file-list.md
```

## 反模式

❌ **「架构写完就完了」**：架构不审计 = 纸面架构
❌ **「代码跑通就过」**：跑通不代表符合架构
❌ **「架构审计只在 L6 做一次」**：早发现早修复，每 Batch 都该审
❌ **「审计发现的问题下个迭代再修」**：严重问题必须当下修
❌ **「架构跟随实现」**：架构是约束，不是「事后文档」

## 与其他层的关系

```
L1.5 architecture 设计
  ↓
L5-impl 实现
  ↓ (每 Batch 后审计)
L1.5 architecture audit
  ↓ (严重问题)
回 L5-impl 修复
  ↓
L6 deploy 漫游
```

## 门禁

架构审计 FAIL → 阻断 L6 漫游。

## 工具

- 手动：本文档提供的 grep 模板
- 脚本：可写 `scripts/arch-audit.sh`，集成进 L1.5 gate
- IDE 插件：可加 lint 规则检查跨聚合调用
