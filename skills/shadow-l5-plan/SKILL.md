---
name: shadow-l5-plan
alias: Shadow·L5-Plan
methodology: |
  Harness 计划生成器 — 把 L1+L1.5+L2+L3 决策压缩成 AI coder 可直接执行的精密执行计划。
description: |
  Shadow L5 Harness 计划生成器。消费 L1+L1.5+L2+L3 的全部上游产物，产出一份 AI coder 可直接消费的精密执行计划。
  Harness 计划完全替代了独立的契约层和测试层：每个文件包含完整的类签名、逐方法实现指令、测试断言。
  AI coder 看到 Harness 计划后不需要任何上游文档就能写出正确代码。
  三面手：设计（Harness 计划）+ 实现（自动生成代码骨架）+ 跟踪（Plan-Impl Diff 审计）。
  触发：Harness 计划、执行计划、L5 Plan、harness、coder 计划、代码骨架、Plan-Impl Diff。
version: "2.0.0"
---

# Shadow·Harness — 精密执行计划

## 角色

把 L1+L1.5+L2+L3 的全部设计决策**浓缩**成一份 AI coder 可机械执行的指令。

**核心原则**：coder 只看这一份文档，不需要任何上游文档，就能写出正确代码。

这意味着 Harness 计划必须是**自包含**的：
- 每个文件的类签名、方法签名、字段类型——全部内联
- 每个方法的校验条件、状态变更、事件发布——全部内联
- 每条 RXX 规则的兜底（L3 ?failsafe）——全部内联

## 三面手（设计 + 实现 + 跟踪）

L5-plan 不只写 Harness 计划，还要让 L5-impl 真能照着写、写完真能验证合规。

| 面 | 任务 | 产出 | 详细 |
|---|------|------|------|
| **设计**（核心） | 文件依赖图 + 全局约束 + 兜底约束 + 逐文件实现指令 + 单元/接口/E2E 指令 | harness-plan.md | 本 SKILL.md §1-7 |
| **实现** | **代码骨架生成（Skeleton Gen）**：从 harness-plan.md 自动生成可写代码的起点（import + 签名 + docstring + 测试骨架 + TODO 占位） | `backend/` / `frontend/` / `tests/` 骨架 | references/code-skeleton-gen.md |
| **跟踪** | **Plan-Impl Diff**：L5-impl 完成后自动对比 Plan vs Code（方法覆盖/签名/测试/事件/@implements/failsafe） | `plan-impl-diff-report.md` | references/plan-impl-diff-guide.md |

**闭环**：
- 骨架生成失败 → 回 Plan 修
- Plan-Impl Diff 严重问题 → 回 L5-impl 修代码
- 严重问题 → 阻断 L6 漫游

## Harness 计划消费的上游

| 上游 | 消费什么 |
|------|---------|
| L1 intent.md | 项目意图、成功标准、意图约束 |
| L1 research.md | 统一语言、事件清单、限界上下文、EDD 决策、技术选型 |
| L1 project.flow.mermaid | BXX-NYY 节点编号、流程分支、状态迁移、数据契约 |
| L1 spec.md | RXX 规则编号、前置条件、异常路径、API 预映射 |
| L1 wire.svg | 页面结构、交互区域、data-action/data-state（前端项目） |
| L1.5 architecture.md | 技术栈、分层架构、API 端点清单（请求/响应/错误码）、文件清单、质量属性 |
| L1.5 aggregate-landscape.md | 聚合清单、聚合间关系、一致性边界 |
| L1.5 event-contract.md | 事件定义、载荷结构、传递方式、订阅关系 |
| L2 e2e.md | 验收场景、覆盖矩阵 |
| L3 failure-modes.md | 失败模式目录（FMEA 3 维度 RPN：影响/频率/难发现度）|
| L3 failsafe-design.md | 兜底策略与实现位置（熔断/降级/补偿/重试/限流/背压/隔离/幂等/超时/健康检查）|
| L3 chaos-scenarios.md | 混沌测试场景（@chaos 标签 + 故障注入点 + 预期行为 + 通过标准）|

## 怎么做

### 1. 读全部上游

按优先顺序读取：
1. L1.5 architecture.md — 技术栈 + 文件清单 + API 端点清单
2. L1.5 aggregate-landscape.md — 聚合定义
3. L1.5 event-contract.md — 事件契约
4. L1 spec.md — 业务规则
5. L1 project.flow.mermaid — 流程节点
6. L1 wire.svg — 前端页面（如适用）
7. L1 research.md — 统一语言、事件清单
8. L1 intent.md — 项目意图
9. L2 e2e.md — 验收场景
10. L2 uat-script.md — UAT 验收剧本（前端项目必读，用于生成 Batch 8 E2E 测试）

### 2. 推导文件依赖图

从 architecture.md 文件清单推导依赖关系，按层排列：

| Batch | 典型文件类型 | 依赖 |
|-------|-------------|------|
| Batch 1 | 领域模型（聚合根、值对象、领域事件）、枚举 | 无 |
| Batch 2 | 领域服务、仓储接口 | Batch 1 |
| Batch 3 | 应用服务、事件处理器 | Batch 1-2 |
| Batch 4 | 基础设施（仓储实现、外部服务适配器） | Batch 1-3 |
| Batch 5 | 接口层（路由、控制器、中间件） | Batch 1-4 |
| Batch 6 | 前端 API 客户端、Store | Batch 5 |
| Batch 7 | 前端页面、组件 | Batch 6 |
| Batch 8 | E2E 测试（Playwright .spec.ts） | Batch 5-7 |

### 2.5 全局约束（跨文件实现约束）

在逐文件指令之前，先列出**横切关注点**的实现约束。这些约束影响多个文件，不适合放在单个文件的指令中，但 coder 必须在所有文件中遵守。

**什么时候需要**：项目存在多租户隔离、统一认证/错误格式、跨聚合事件、统一分页、审计日志、事务边界等横切关注点时，必须包含全局约束段。

**约束收集**：从 L1.5 architecture.md 安全设计/性能设计/文件清单、event-contract.md、spec.md 异常处理表推导。

**全局约束段的格式**（写在文件清单之后、Batch 1 之前）：

```markdown
## 全局约束

### 多租户隔离
- 所有仓储查询加 `tenant_id` WHERE 条件
- `tenant_id` 从 JWT 提取，禁止从请求体接受
- 跨租户访问 → 403 + 审计日志

### 认证与授权
- 所有写操作挂 RBAC 中间件，角色从 JWT 解析
- 未认证 → 401，权限不足 → 403

### 统一错误格式
- `{ code: UPPER_SNAKE_CASE, message: string, details?: any }`
- code 与 spec.md ERROR_CODE 一致

### 事件发布
- 聚合状态变更后发布领域事件，载荷与 event-contract.md 一致
- 进程内：聚合方法返回事件列表，应用服务统一发布

### 分页
- `?page=1&per_page=20`，返回 `{ items, total, page, per_page }`

### 事务边界
- 单聚合内强一致（单事务），跨聚合最终一致（事件驱动）
```

**原则**：全局约束只写"跨文件的行为约定"，具体实现由 Batch 4/5 的文件指令覆盖。

### 2.6 兜底约束（L3 韧性层传导）

L3 ?`failsafe-design.md` 定义的所有兜底策略必须在 Harness 计划中被显式实现。**这是 L3 ?→ L5 的硬约束**。

如果 L3 ?存在，Harness 计划必须在"全局约束"段后追加"兜底约束"子段。如果 L3 ?缺失（极小项目豁免），跳过本节。

**兜底约束段的格式**：

```markdown
### 兜底约束（L3 韧性层）

| 失败模式 ID | 兜底策略 | 实现位置 | 触发条件 | 恢复路径 | L3 ?引用 |
|------------|---------|---------|---------|---------|---------|
| F01 (调度层-调度风暴) | 限流 + 优先级队列 | `infra/scheduler/quota.py` + `domain/queues/priority.py` | 并发任务 > 1000 | 自动消化 + 告警 | failure-catalog.md §F01 |
| F12 (网络层-分区) | 熔断 + 降级 | `infra/http/circuit_breaker.py` | 下游 P99 > 5s | 探测恢复后自动重连 | failsafe-design.md §F12 |
| F23 (事件层-积压) | 背压 + 限流 | `infra/queue/backpressure.py` | DLQ > 1000 | 手工补单 + 告警 | chaos-scenarios.md §T23 |
```

**原则**：
- 兜底约束的每行必须能在 L3 ?`failsafe-design.md` 找到对应实现位置
- 失败模式 ID (FXX) 与 L3 ?`failure-catalog.md` 严格对应
- 兜底策略的"实现位置"必须落到 Batch 4/5 的具体文件路径
- 触发条件用具体阈值（不是"高负载"这种模糊词）
- 恢复路径区分"自动"和"手工"


### 3. 逐文件展开实现指令(详细见 `references/batch-detail.md`)

> **本 SKILL.md 严格 < 500 行**(框架硬规则,见 `CLAUDE.md:70/102/143/189`)。
> 完整 387 行"逐文件展开"段(Batch 3.1 后端 / 3.2 前端 / 3.3 E2E / 3.4 韧性 / 3.5 失败注入 + 降级 / 3.6 业务对账(L 规模) / 3.7 业务幂等(L 规模) / 3.8 跨地域失败注入(L 规模))
> 已下沉到 `references/batch-detail.md`。Walker 在 L5 写文件时按需 `Read` 该 reference 即可。

### 品味引导：精密但不冗余

### 品味引导：精密但不冗余

**Harness 计划是 coder 的工作手册，不是设计文档。** 区别：

```
设计文档（L1/L1.5 写的）:
  "标注员可对任务创建标注"
  （coder：什么标注？怎么创建？约束？错误？→ 全部靠猜）

Harness 计划（本层写的）:
  create(cls, task_id: UUID, annotator_id: UUID) -> Annotation
  - 校验: task_id 非 None
  - 初始状态: EMPTY
  （coder：直接写代码，不需要猜）
```

**判断标准**：coder 看到每个方法指令后，能在 30 秒内开始写代码。超过 30 秒 → 指令不够精确。

## 产出

`.shadow/L5-plan/{slug}/harness-plan.md`

**生命周期角色**(`design_baseline` 设计基线,**模糊地带**):文件本身的"全局约束段 / 兜底约束段 / Batch 顺序"段是设计基线,跨迭代有效(下个需求来时回查"全局约束"和"批次划分");"逐文件实现指令段"实现完后过期,但依附文件保留作审计基线。详见 `.shadow/shadow-schema.json:lifecycle_artifacts` → `harness-plan`。

一份自包含的执行计划，结构如下：

1. **文件清单**（按 Batch 分组，每个文件标注聚合/类型和规则映射）
2. **全局约束**（跨文件实现约束：多租户、认证、错误格式、事件发布、分页、事务边界等）
3. **逐文件指令**（每个文件包含）：
   - 上下文（一句话）
   - 规则映射（RXX + BXX-NYY）
   - 聚合定义（后端）
   - 类/函数完整签名
   - 逐方法实现指令（校验 + 状态 + 事件 + 错误）
   - 测试断言（具体代码级断言）
   - 验证命令

## 约束

- **自包含**：coder 不需要读任何上游文档
- **可判定**：每个校验条件都是具体的 `if` 表达式，不是模糊描述
- **可验证**：每个方法都有测试断言，coder 先写测试再写实现
- **每个方法覆盖所有 spec 规则**：RXX 规则编号内联在方法指令中
- **每个事件与 event-contract.md 一致**：事件名和载荷结构内联
- **每个聚合与 aggregate-landscape.md 一致**：聚合边界和一致性边界内联
- **前端行为与 wire.svg 一致**：data-action/data-state 映射内联
- **按 Batch 分组**：依赖序排列，Batch 内可并行
- **文件清单与 architecture.md 文件清单一致**：不多不少
- **穷举测试断言**：每个方法的测试断言数 ≥ 校验条件数 + 正常路径数。末尾标注计数行 `✅ 穷举: 测试 N / 校验 M + 正常 P ≥ N`

## 品味约束

- 每个方法的指令 ≤ 20 行（超过 → 拆方法）
- **穷举测试断言**：测试断言数 ≥ 校验条件数 + 正常路径数。每个方法末尾标注 `✅ 穷举: 测试 N / 校验 M + 正常 P ≥ N`
- 无业务冗余：不复制 spec 的业务叙述原文（如"标注员可对任务创建标注"），只内联 coder 需要的技术指令（如 `create(cls, task_id: UUID, annotator_id: UUID) -> Annotation`）。自包含不等于复制粘贴——技术细节必须内联，业务背景一句话带过

## 完整示例

自动驾驶数据平台的 Harness 计划完整示例（文件清单 + 全局约束 + 逐文件指令）见 [references/harness-example.md](references/harness-example.md)。
