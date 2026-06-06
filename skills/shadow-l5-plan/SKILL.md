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

### 3. 逐文件展开实现指令

对每个文件，从上游文档中提取并内联所有 coder 需要的信息：

#### 3.1 后端文件

```markdown
### 文件: backend/domain/aggregates/annotation.py

**上下文**: 标注聚合根，管理标注的创建、值添加、提交、状态流转。

**规则**: annotation-R02 (B02-N07), annotation-R03 (B02-N08)

**聚合定义**:
- 聚合根: Annotation（唯一入口）
- 聚合边界: 包含 Annotation (根), AnnotationValue[] (值对象)。不包含 Task (通过 taskId 引用), User (通过 annotatorId 引用)
- 一致性: create/add_value 单事务原子。submit 状态变更 + 事件发布单事务

**类签名**:
class Annotation:
    annotation_id: UUID
    task_id: UUID
    annotator_id: UUID
    status: AnnotationStatus  # EMPTY → IN_PROGRESS → SUBMITTED → APPROVED / REWORK
    values: list[AnnotationValue]
    created_at: datetime
    submitted_at: datetime | None

**枚举/常量**:
class AnnotationStatus(str, Enum):
    EMPTY = "EMPTY"
    IN_PROGRESS = "IN_PROGRESS"
    SUBMITTED = "SUBMITTED"
    APPROVED = "APPROVED"
    REWORK = "REWORK"

**值对象**:
@dataclass(frozen=True)
class AnnotationValue:
    label_id: UUID
    value_type: str  # "SPAN" / "BBOX" / "TIME_SEGMENT"
    data: dict

**方法**:

#### create(cls, task_id: UUID, annotator_id: UUID) -> Annotation
- 校验: task_id 非 None, annotator_id 非 None
- 初始状态: EMPTY
- 事件: 无
- 错误: 无
- 测试:
  ```python
  def test_create_annotation():
      a = Annotation.create(task_id=uuid4(), annotator_id=uuid4())
      assert a.status == AnnotationStatus.EMPTY
      assert len(a.values) == 0
  ```

#### add_value(self, value: AnnotationValue, project_labels: list[UUID]) -> None
- 校验: self.status in [EMPTY, IN_PROGRESS]（SUBMITTED 后不可修改）→ 否则 raise AnnotationAlreadySubmitted
- 校验: value.label_id in project_labels → 否则 raise InvalidLabelError
- 添加到 self.values
- 如果 status == EMPTY → 变更为 IN_PROGRESS
- 测试:
  ```python
  def test_add_value_changes_empty_to_in_progress():
      a = Annotation.create(uuid4(), uuid4())
      a.add_value(AnnotationValue(label_id=LABEL_ID, ...), project_labels=[LABEL_ID])
      assert a.status == AnnotationStatus.IN_PROGRESS

  def test_add_value_after_submit_raises():
      a = create_submitted_annotation()
      with pytest.raises(AnnotationAlreadySubmitted):
          a.add_value(AnnotationValue(...), project_labels=[LABEL_ID])
  ```

#### submit(self) -> tuple[AnnotationSubmitted, ReviewRequested]
- 校验: self.status == IN_PROGRESS → 否则 raise InvalidStatusTransition
- 校验: len(self.values) > 0 → 否则 raise EmptyAnnotationNotAllowed
- 状态: IN_PROGRESS → SUBMITTED
- self.submitted_at = datetime.utcnow()
- 事件: 发布 AnnotationSubmitted(annotation_id, task_id, annotator_id, submitted_at) + ReviewRequested(task_id, annotation_id)
  - 测试:
  ```python
  def test_submit_publishes_events():
      a = create_in_progress_annotation()
      events = a.submit()
      assert len(events) == 2
      assert isinstance(events[0], AnnotationSubmitted)
      assert isinstance(events[1], ReviewRequested)
      assert a.status == AnnotationStatus.SUBMITTED

  def test_submit_wrong_status_raises():
      a = Annotation.create(uuid4(), uuid4())
      with pytest.raises(InvalidStatusTransition):
          a.submit()

  def test_submit_empty_raises():
      a = create_in_progress_annotation()
      a.values = []
      with pytest.raises(EmptyAnnotationNotAllowed):
          a.submit()
  ```
  ✅ `穷举: 测试 3 / 校验 2 + 正常 1 = 3`
```

#### 3.2 前端文件

```markdown
### 文件: frontend/src/pages/AnnotatorWorkbench.tsx

**上下文**: 标注员工作台页面，完成"查看任务→标注→提交→跳转下一任务"工作流。

**规则**: annotation-R01, annotation-R02, annotation-R03

**Wire 引用**: wire.svg page-annotator-workbench, action-submit-annotation

**路由**: /tasks/:taskId/annotate

**权限**: Annotator 角色

**API 调用**:
- GET /api/tasks/:taskId → TaskResponse
- POST /api/annotations → AnnotationResponse
- PUT /api/annotations/:id → AnnotationResponse
- POST /api/annotations/:id/submit → SubmitResponse

**响应类型**（从 L1.5 Architecture §5 提取）:
```typescript
interface TaskResponse { id: string; status: string; dataItem: { type: string; content: string } }
interface AnnotationResponse { id: string; status: string; values: AnnotationValue[] }
interface SubmitResponse { success: boolean; next_task_id: string | null }
```

**State**:
- task: TaskResponse | null
- annotationDraft: AnnotationValue[]
- isSaving: boolean
- error: { code: string; message: string } | null

**行为**:
- 组件挂载时: 调用 GET /api/tasks/:taskId，设置 task state
- 添加标注: push 到 annotationDraft
- 点击提交: ① POST /api/annotations 创建 → ② POST /api/annotations/:id/submit 提交 → ③ 成功则跳转 /tasks/{next_task_id}/annotate
- 提交按钮: annotationDraft.length === 0 时 disabled
- API 错误: 设置 error state，显示错误信息 + 重试按钮
- 加载中: task === null 时显示 loading spinner

**测试**:
```typescript
it("disables submit when annotation is empty", () => {
  render(<AnnotatorWorkbench taskId="t1" />)
  expect(screen.getByRole("button", { name: /提交/ })).toBeDisabled()
})

it("submits and navigates to next task", async () => {
  vi.mocked(api.createAnnotation).mockResolvedValue({ id: "a1", status: "IN_PROGRESS", values: [] })
  vi.mocked(api.submitAnnotation).mockResolvedValue({ success: true, next_task_id: "t2" })
  render(<AnnotatorWorkbench taskId="t1" />)
  // 添加一个标注值
  fireEvent.click(screen.getByText("car"))
  fireEvent.click(screen.getByRole("button", { name: /提交/ }))
  await waitFor(() => {
    expect(api.submitAnnotation).toHaveBeenCalledWith("a1")
  })
})
```
```

#### 3.3 E2E 测试文件（项目包含前端时）

E2E 测试从 L2 `uat-script.md` 的 P0 UAT 剧本翻译而来，覆盖真实浏览器操作路径。L6 依赖这些文件执行 Phase 5 验证。

```markdown
### 文件: e2e/annotation-workflow.spec.ts

**上下文**: P0 验收 — 标注员从登录到提交标注的完整流程

**来源**: L2 uat-script.md P0 场景 "标注员完成标注提交"

**测试**:
```typescript
import { test, expect } from '@playwright/test'

test('annotator completes annotation workflow', async ({ page }) => {
  // Step 1: 登录
  await page.goto('/login')
  await page.fill('[data-action="input-username"]', 'annotator1')
  await page.fill('[data-action="input-password"]', 'password123')
  await page.click('[data-action="login"]')
  await expect(page).toHaveURL(/\/tasks/)

  // Step 2: 打开任务
  await page.click('[data-node="B02-N06"][data-action="open-task"]')
  await expect(page.locator('.task-detail')).toBeVisible()

  // Step 3: 创建标注
  await page.click('[data-action="add-annotation"]')
  await page.click('text=car')

  // Step 4: 提交
  await page.click('[data-action="submit-annotation"]')
  await expect(page.locator('.success-message')).toBeVisible()
})
```
✅ `穷举: 测试 1 / 覆盖 uat-script P0 场景 1`
```

**约束**：
- 仅生成 P0 场景的 E2E 测试（P1 场景由 L6 agent 手工用 playwright-cli 补充验证）
- 使用 `data-action` 选择器定位元素（与 wire.svg 标注一致）
- 每个测试对应 uat-script.md 中的一个 P0 剧本
- 测试文件放在 `e2e/` 目录下

**通用交互模式**: 参见 `references/e2e-patterns.md`（拖拽排序、批量操作等模式）

#### 3.4 韧性测试文件（L3 韧性层传导）

L3 ?`chaos-scenarios.md` 定义的混沌场景必须被翻译为 Harness 计划中的韧性测试文件。**L3 ?→ L5 的失败注入点必须在 L5 实现层有对应的测试**。

韧性测试从 L3 ?`chaos-scenarios.md` 的 `@chaos` 场景翻译而来，覆盖可控失败注入路径。L6 依赖这些文件执行 Phase 5.7 灾难演练。

```markdown
### 文件: tests/chaos/annotation_failure_modes.spec.py

**上下文**: P0 韧性验收 — 标注聚合在各种系统级失败下的兜底行为
**来源**: L3 chaos-scenarios.md @chaos 场景 "F12 标注提交时网络分区"
**失败模式**: F12 (网络层-分区)
**兜底策略**: 熔断 (5s 触发) + 降级 (本地缓存草稿) + 重试 (指数退避 3 次)

**测试**:
```python
import pytest
from unittest.mock import patch
from chaos.faults import NetworkPartition, ResourceExhaustion

@pytest.mark.chaos
@pytest.mark.failure_mode("F12")
async def test_annotation_submit_under_network_partition():
    \"\"\"F12: 网络分区下, 标注提交应触发熔断 + 本地降级 + 自动重试\"\"\"
    # 注入: 模拟下游 API 连续 3 次超时
    with NetworkPartition(partition_service="annotation-api", duration_seconds=30):
        annotation = await create_annotation(...)
        result = await submit_annotation(annotation.id)
        
        # 断言: 兜底行为
        assert result.status == "DRAFT_LOCAL"  # 降级到本地草稿
        assert result.retry_count == 3         # 自动重试 3 次
        assert result.circuit_state == "OPEN"  # 熔断器已打开
        
        # 断言: 数据完整性
        local_draft = await load_local_draft(annotation.id)
        assert local_draft.values == annotation.values  # 数据未丢

    # 断言: 故障消除后, 自动重连
    await wait_for_circuit_close(timeout=35)
    sync_result = await sync_local_drafts()
    assert sync_result.success_count >= 1
```

**通用混沌注入工具**: 参见 `references/chaos-injection-patterns.md`（网络分区/OOM/时钟漂移/限流/降级 注入器）
```

**约束**：
- 仅生成 L3 ?`chaos-scenarios.md` 中 @chaos 标签的 P0 场景（P1 由 L6 手工补）
- 每个测试必须用 `@pytest.mark.chaos` 和 `@pytest.mark.failure_mode("FXX")` 双标签
- 测试文件放在 `tests/chaos/` 目录
- 必须用真实故障注入（不 mock 整个失败路径）

#### 3.5 失败注入点 + 降级路径（每个业务文件的子段）

**L3 传导要求**：如果 L3 ?`failsafe-design.md` 列出了本文件相关的兜底策略，则该文件指令必须包含"失败注入点"和"降级路径"两个子段。

**后端文件追加子段**：

```markdown
#### 失败注入点（L3 传导）
- F12 (网络分区): 注入点 = `http_client.post()`, mock 5s 超时
- F23 (事件积压): 注入点 = `event_bus.publish()`, mock 队列已满
- 注入工具: `tests/chaos/faults.py::NetworkPartition` + `EventQueueFull`

#### 降级路径（L3 传导）
- 失败 F12 → 降级到本地草稿存储 (`infra/local_draft.py`), status = DRAFT_LOCAL
- 失败 F23 → 降级到同步重试 (`infra/event_sync.py`), 指数退避 1s/2s/4s
- 自动恢复: 故障消除后, 触发 `sync_local_drafts()` 把降级数据回写到主存储
- 数据完整性: 降级期间不允许用户操作丢失, 必须有完整审计日志
```

**前端文件追加子段**：

```markdown
#### 失败注入点（L3 传导）
- F12 (API 超时): 注入点 = `api.submitAnnotation()`, mock fetch reject
- F25 (DB 慢查询): 注入点 = `api.loadTask()`, mock 3s 延迟

#### 降级路径（L3 传导）
- 失败 F12 → UI 显示"已存为草稿, 网络恢复后自动提交" 横幅 + 草稿列表
- 失败 F25 → UI 显示骨架屏 + 10s 后重试按钮
- 用户操作: 草稿可手动重新提交, 不丢失
```


#### 3.6 业务对账测试 (L 规模 L3 传导)

**L 规模时 (scale.l3_extended_mode=true) 必填**, S/M 规模可省。

```markdown
### 文件: domain/reconciliation/order_payment.py

**上下文**: 订单-支付业务对账, 跨机房最终一致性兜底
**规则**: order-R08, payment-R12
**L3 引用**: L3 FS11-b (订单-支付对账) + FS82 (跨地域一致性)

#### 业务对账测试点 (L3 传导, L 规模)
- FS11-b 订单-支付对账: tests/chaos/reconciliation/test_order_payment.py
- 测试方法: 直接 SQL 制造不一致 → 触发跑批 → 断言自动修复
- 5 类对账类型必测: 订单-支付 / 订单-库存 / 订单-物流 / 用户余额 / 营销优惠

#### 业务对账恢复路径
- 跑批 cron: `0 2 * * *` (每日凌晨 2 点)
- 对账容差: 资金类 0 元, 物流类 1h, 优惠类 0.01 元
- 自动修复: 资金类启用 (saga 补偿), 其他可选
- 升级路径: PagerDuty #payment-oncall (P1)
- 实现位置: domain/reconciliation/{type}.py
```

#### 3.7 业务幂等测试 (L 规模 L3 传导)

**L 规模时必填**, S/M 规模可省。

```markdown
### 文件: domain/payment/payment_service.py

**上下文**: 支付业务幂等, 3 层防护 (技术幂等 + 业务唯一键 + 状态机)
**规则**: payment-R12
**L3 引用**: L3 FS12-a (支付幂等) + FS82 (跨地域一致性)

#### 业务幂等测试点 (L3 传导, L 规模)
- FS12-a 支付幂等: tests/chaos/idempotency/test_payment_idempotent.py
- 测试方法: 并发 10 次同 payment_id → 断言只成功 1 次
- 3 层防护都测: Redis key (L1) + DB UNIQUE (L2) + 状态机 (L3)

#### 业务幂等恢复路径
- 业务唯一键: payment_id (客户端生成) DB UNIQUE
- 状态机: PENDING → PAID → REFUNDED (终态不可转换)
- 装饰器: @business_idempotent(key_fn, state_machine)
- 实现位置: domain/idempotency/business_idempotent.py
```

#### 3.8 跨地域失败注入点 (L 规模 L3 传导)

**L 规模时必填**, 跨地域部署项目才需要。

```markdown
### 文件: backend/infra/multi_region/dns_failover.py

**上下文**: 跨地域 DNS 切换 + 流量调度
**规则**: cross-region-R01, cross-region-R02
**L3 引用**: L3 FS81 (机房级故障) + FS82 (跨地域一致性)

#### 跨地域失败注入点 (L3 传导, L 规模)
- FS81 机房级故障: 注入 docker network disconnect 模拟整机房断电
- FS82 跨地域一致性: 注入跨地域同步延迟 > 60s
- FS83 异地数据同步延迟: 注入 tc qdisc netem delay 200ms
- FS84 机房切换回滚: 灰度切流 10%/50%/100% P99 监测
- FS85 跨地域延迟: DNS 就近解析

#### 跨地域恢复路径
- DNS 切换: TTL=60s, 灰度切流 10% → 50% → 100%
- 业务对账: 每 24h 跑批, 跨地域 inconsistencies 告警
- 强制读主: replica_lag > 5s 时
- 升级: PagerDuty #infra-oncall
```

**逐文件检查更新**（在原有 6 项检查后追加 2 项）：
- **失败注入点**是否覆盖 L3 ?`failsafe-design.md` 中本文件相关的兜底策略
- **降级路径**是否定义了"故障中"和"恢复后"两阶段行为

**原 6 项检查（保留）**：

- 每个方法是否覆盖了 spec.md 中对应的 RXX 规则
- 每个校验条件是否与 flow.mermaid 中的决策节点一致
- 每个事件是否与 event-contract.md 一致
- 每个聚合是否与 aggregate-landscape.md 一致
- 每个 API 调用是否与 architecture.md API 端点清单一致
- 每个前端行为是否与 wire.svg 一致
- 每个测试断言是否覆盖了方法的所有校验路径

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
