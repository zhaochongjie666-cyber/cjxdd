# Harness Plan 模板 (v5 — 入口 + 索引)

```markdown
---
@iter: N                       # 这个 plan 是 iter-N 的 (必填, 跟 current-iteration 对齐)
@generated-at: {ISO ts}        # 生成时间
@upstream-iter: N-1            # 上游 (spec/arch/event) 是 iter-N-1 时的快照 (必填, 首次 iter=0/1 时写 "init")
@replaces-plan: {旧 plan 路径}  # 替代了 iter-N-1 的哪个 plan (首次 iter=0/1 时写 "无 (初始)")
@upstream-changed-since-iter-N-1:
  - spec.md R03 (心跳失败阈值 3→5)            # 反向: iter-N-1 code 写 ">=3" 现在要改 ">=5" (⛔)
  - spec.md R10 (新规则: SSH 节点注册)        # 正向: iter-N-1 没这条, 新加 (✅)
  - arch.md POST /api/v1/nodes (URL 改 /v1/nodes/register)  # 反向: iter-N-1 code 调旧 URL (⛔)
@delta: 见 .shadow/iterations/iter-{N-1}/pipeline/status.md "## 变更记录" 段
---

# Harness Plan: {业务线名称}

## 上下文
{项目是什么，你正在实现什么模块，一句话}

## 技术栈
- 后端: {语言} + {框架} + {ORM}
- 前端: {语言} + {框架} + {组件库}（如适用）
- 基础设施: {DB} + {缓存} + {队列}
- 测试: {测试框架}

## 依赖服务（本次不实现但需要调用）
{列出依赖的接口签名，每个一行}

## 上游引用矩阵 (v5 必含)
6 张表, 让 coder 翻 plan 第一眼就知道每条规则/端点/失败模式对应上游哪段. 详见 SKILL.md §"上游引用矩阵".

### 规则 → spec.md 段映射
| Harness plan 引用 | 上游文件 | 段 / 行 | 用途 |
|------------------|---------|--------|------|
| R01 {名称} | spec.md | §R01 {段名} (line X-Y) | 校验 / 异常 / 业务背景 |

### 端点 → architecture.md 段映射
| Harness plan 端点 | 上游文件 | 段 | 用途 |
|------------------|---------|----|----|

### 事件 → event-contract.md 段映射
| Harness plan 事件 | 上游文件 | 段 | 用途 |
|------------------|---------|----|----|

### 失败模式 → failure-modes.md 段映射
| Harness plan FMEA | 上游文件 | 段 | 用途 |
|------------------|---------|----|----|

### 页面 → wire.svg 段映射 (前端项目)
| Harness plan 页面 | 上游文件 | 段 | 用途 |
|------------------|---------|----|----|

### 验收场景 → e2e.feature 段映射
| Harness plan 场景 | 上游文件 | 段 | 用途 |
|------------------|---------|----|----|

## 文件清单

### Batch 1: 领域模型
| 文件 | 聚合/类型 | 规则 | 上游引用 (v5 必含) |
|------|----------|------|------------------|
| {path} | {聚合名} | {RXX} | spec.md §R03, aggregate-landscape.md §B01 |

### Batch 2: 领域服务 + 仓储接口
...

### Batch 3: 应用服务
...

### Batch 4: 基础设施
...

### Batch 5: 接口层
...

### Batch 6: 前端 API + Store（如适用）
...

### Batch 7: 前端页面 + 组件（如适用）
...

### Batch 8: E2E 测试（如项目包含前端）
| 文件 | 覆盖场景 | 上游引用 (v5) |
|------|---------|--------------|
| e2e/{scenario}.spec.ts | L2 uat-script.md 中的 P0 UAT 剧本 | uat-script.md §P0-scenario, e2e.feature:scenario-R03 |

## 全局约束

[按需: 多租户隔离 / 认证授权 / 统一错误格式 / 事件发布 / 分页 / 事务边界]

## 兜底约束 (L3 韧性层)

| 失败模式 ID | 兜底策略 | 实现位置 | 触发条件 | 恢复路径 | 上游引用 (v5) |
|------------|---------|---------|---------|---------|--------------|
| F12 | 熔断 + 降级 | infra/http/circuit_breaker.py | 下游 P99 > 5s | 探测恢复 | failure-modes.md §F12, failsafe-design.md §F12 |

## 逐文件实现指令

---

### 文件: {path}

**上游引用 (v5 必填)**: 
- spec.md §R03-R05 (line X-Y) — {为什么: 业务背景 / 异常路径}
- arch.md §API.POST /annotations (line X) — {为什么: 端点 schema}
- event-contract.md §AnnotationSubmitted (line X) — {为什么: 载荷字段}
- wire.svg page-annotator-workbench (前端) — {为什么: 页面布局}
- failure-modes.md §F12 (RPN=27) (兜底) — {为什么: 失败原因}
- e2e.feature:scenario-R03-submit — {为什么: Gherkin 步骤}
- aggregate-landscape.md §B01-annotation (聚合) — {为什么: 聚合边界}

**@upstream 跳读指引 (v5)**: 实现前 Read 上述 7 个上游段, 5-10 分钟. 不知道上游就硬写 = §13 一致性审计脱节.

**上下文**: {一句话业务含义}

**规则**: {RXX 列表} ({BXX-NYY 列表})

**聚合定义**（后端领域模型）:
- 聚合根: {名称}
- 聚合边界: 包含 {列表}，不包含 {列表}
- 一致性: {强一致操作}，{最终一致操作}
- 上游引用: aggregate-landscape.md §{BXX} — {边界依据}

**类签名**:
{完整类定义}

**方法**:

#### {method_name}({params}) -> {return_type}
- 上游: spec.md §R03 (RXX 业务背景) / arch.md §API.X (端点 schema) / event-contract.md §EventName (载荷)
- 校验: {具体条件} (从 spec.md §R03 异常路径 + plan @upstream 派生)
- 状态: {状态变更}
- 事件: {发布的事件, 引用 event-contract.md §EventName, 载荷内联}
- 错误: {错误码 + 消息} (与 arch.md 端点错误码一致)
- 测试: 
  ```{lang}
  def test_{name}_{scenario}():
      # Arrange
      ...
      # Act
      ...
      # Assert
      ...
  ```
  ✅ `穷举: 测试 N / 校验 M + 正常 P ≥ N` (从 e2e.feature Gherkin 步骤派生, 不止 plan)

---

{重复每个文件}
```

## v5 必含段清单 (审计时 check)

- [ ] **上游引用矩阵**: 6 张表 (规则/端点/事件/失败模式/页面/验收场景)
- [ ] **文件清单每行** 末尾有"上游引用"列
- [ ] **每个文件指令** 顶部有 "**上游引用 (v5 必填)**" 段
- [ ] **每个方法** 顶部有 "上游:" 一行, 列出该方法的 spec/arch/event 引用
- [ ] **测试断言** 注明 "从 e2e.feature Gherkin 步骤派生", 供 coder 知道溯源

## v5 哲学

**Plan 是入口 + 索引, 上游是 detail**. coder:
- 翻 plan 第一眼 → 看上游引用矩阵, 知道上游存在
- 写代码前 5 分钟 → 跳 plan 顶矩阵 + 每文件指令的 @upstream, 全部 Read 一遍
- 写代码时 → 技术细节查 plan 内联, 业务背景按 @upstream 跳上游
- 写完代码 → 文件头加 @upstream 引用 (供 §13 审计追溯)

