---
name: shadow-l5-plan
alias: Shadow·L5-Plan
methodology: Harness — 精密执行计划：AI coder 只看这一份文档就能机械执行
description: |
  Shadow L5 Harness 计划生成器。消费 L1+L1.5+L2 的全部上游产物，产出一份 AI coder 可直接消费的精密执行计划。
  Harness 计划完全替代了独立的契约层和测试层：每个文件包含完整的类签名、逐方法实现指令、测试断言。
  AI coder 看到 Harness 计划后不需要任何上游文档就能写出正确代码。
  触发：Harness 计划、执行计划、L5 Plan、harness、coder 计划。
version: "1.0.0"
---

# Shadow·Harness — 精密执行计划

## 角色

把 L1+L1.5+L2 的全部设计决策**浓缩**成一份 AI coder 可机械执行的指令。

**核心原则**：coder 只看这一份文档，不需要任何上游文档，就能写出正确代码。

这意味着 Harness 计划必须是**自包含**的：
- 每个文件的类签名、方法签名、字段类型——全部内联
- 每个方法的校验条件、状态变更、事件发布——全部内联
- 每个方法的测试断言——全部内联
- 错误码、错误消息——全部内联
- 依赖服务的接口签名——全部内联

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

**通用交互模式参考**（非标注平台项目的 E2E 模式）：

列表操作（拖拽排序、批量操作）：
```typescript
import { test, expect } from '@playwright/test'

test('user drags card between columns', async ({ page }) => {
  await page.goto('/boards/b1')
  const todoColumn = page.locator('[data-state="column-todo"]')
  const doneColumn = page.locator('[data-state="column-done"]')
  const card = todoColumn.locator('[data-action="drag-card"]').first()
  await card.dragTo(doneColumn)
  await expect(doneColumn.locator('[data-action="drag-card"]')).toHaveCount(1)
})

test('user filters list and selects items', async ({ page }) => {
  await page.goto('/items')
  await page.selectOption('[data-action="filter-status"]', 'active')
  await page.click('[data-action="select-all"]')
  await page.click('[data-action="bulk-delete"]')
  await expect(page.locator('[data-state="empty"]')).toBeVisible()
})
```

逐文件检查：
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

一份自包含的执行计划，按 Batch 分组，每个文件包含：
1. 上下文（一句话）
2. 规则映射（RXX + BXX-NYY）
3. 聚合定义（后端）
4. 类/函数完整签名
5. 逐方法实现指令（校验 + 状态 + 事件 + 错误）
6. 测试断言（具体代码级断言）
7. 验证命令

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

## 简单项目示例：自动驾驶数据平台

### 文件清单

| Batch | 文件 | 聚合/类型 | 规则 |
|-------|------|----------|------|
| Batch 1 | backend/domain/aggregates/collection.py | Collection 聚合根 | collection-R01~R05 |
| Batch 1 | backend/domain/aggregates/annotation.py | Annotation 聚合根 | annotation-R01~R06 |
| Batch 1 | backend/domain/aggregates/simulation.py | Simulation 聚合根 | simulation-R01~R04 |
| Batch 1 | backend/domain/events.py | 领域事件 | all cross-context |

### 逐文件指令示例（Batch 1: 领域模型）

#### 文件: backend/domain/aggregates/annotation.py

**上下文**: Annotation 聚合根，管理标注的创建、值添加、提交、状态流转（EMPTY → IN_PROGRESS → SUBMITTED → APPROVED / REJECTED）。

**规则**: annotation-R02 (B02-N07), annotation-R03 (B02-N08), annotation-R06 (B02-N11)

**聚合定义**:
- 聚合根: Annotation（唯一入口）
- 聚合边界: 包含 Annotation（根）, AnnotationValue[]（值对象）。不包含 Task（通过 task_id 引用）, Review（独立聚合）
- 一致性: create/add_value 单事务原子。submit 状态变更 + 事件发布单事务

**类签名**:
```python
class Annotation:
    annotation_id: UUID
    task_id: UUID
    annotator_id: UUID
    type: AnnotationType        # BBOX_2D | BBOX_3D | SEMANTIC
    status: AnnotationStatus    # EMPTY → IN_PROGRESS → SUBMITTED → APPROVED / REJECTED
    values: list[AnnotationValue]
    created_at: datetime
    submitted_at: datetime | None
```

**方法**:

#### create(cls, task_id: UUID, annotator_id: UUID, type: AnnotationType) -> Annotation
- 校验: task_id 非 None
- 校验: type in (BBOX_2D, BBOX_3D, SEMANTIC)
- 状态: 初始状态 EMPTY
- 事件: 发布 AnnotationCreated(annotation_id, task_id, type)
- 错误: type 无效 → INVALID_TYPE
- 测试:
  ```python
  def test_create_annotation_with_2d_type():
      ann = Annotation.create(uuid4(), uuid4(), AnnotationType.BBOX_2D)
      assert ann.type == AnnotationType.BBOX_2D
      assert ann.status == AnnotationStatus.EMPTY

  def test_create_annotation_rejects_invalid_type():
      with pytest.raises(ValueError, match="INVALID_TYPE"):
          Annotation.create(uuid4(), uuid4(), "invalid")

  def test_create_annotation_generates_id():
      ann = Annotation.create(uuid4(), uuid4(), AnnotationType.BBOX_3D)
      assert ann.annotation_id is not None
  ```
  ✅ `穷举: 测试 3 / 校验 1 + 正常 2 ≥ 3`

#### submit(self) -> None
- 校验: self.status == IN_PROGRESS
- 校验: len(self.values) > 0
- 状态: IN_PROGRESS → SUBMITTED
- 事件: 发布 AnnotationSubmitted(annotation_id, task_id)
- 错误: status 非 IN_PROGRESS → INVALID_STATUS
- 错误: values 为空 → EMPTY_ANNOTATION
- 测试:
  ```python
  def test_submit_with_values_succeeds():
      ann = Annotation.create(uuid4(), uuid4(), AnnotationType.BBOX_2D)
      ann.add_value(AnnotationValue(label="car", bbox=[100, 200, 300, 400]))
      ann.submit()
      assert ann.status == AnnotationStatus.SUBMITTED
      assert ann.submitted_at is not None

  def test_submit_without_values_rejected():
      ann = Annotation.create(uuid4(), uuid4(), AnnotationType.BBOX_2D)
      with pytest.raises(ValueError, match="EMPTY_ANNOTATION"):
          ann.submit()

  def test_submit_when_already_submitted_rejected():
      ann = Annotation.create(uuid4(), uuid4(), AnnotationType.BBOX_2D)
      ann.add_value(AnnotationValue(label="car", bbox=[100, 200, 300, 400]))
      ann.submit()
      with pytest.raises(ValueError, match="INVALID_STATUS"):
          ann.submit()

  def test_submit_publishes_event():
      ann = Annotation.create(uuid4(), uuid4(), AnnotationType.BBOX_2D)
      ann.add_value(AnnotationValue(label="car", bbox=[100, 200, 300, 400]))
      events_before = len(ann.domain_events)
      ann.submit()
      assert len(ann.domain_events) == events_before + 1
      assert ann.domain_events[-1].event_type == "AnnotationSubmitted"
  ```
  ✅ `穷举: 测试 4 / 校验 2 + 正常 2 ≥ 4`

#### rework(self, new_values: list[AnnotationValue]) -> None
- 校验: self.status == REJECTED
- 状态: REJECTED → SUBMITTED
- 副作用: 替换 self.values 为 new_values
- 事件: 发布 AnnotationSubmitted(annotation_id, task_id)
- 错误: status 非 REJECTED → INVALID_STATUS
- 错误: new_values 为空 → EMPTY_ANNOTATION
- 测试:
  ```python
  def test_rework_succeeds():
      ann = Annotation.create(uuid4(), uuid4(), AnnotationType.BBOX_2D)
      ann.add_value(AnnotationValue(label="car", bbox=[100, 200, 300, 400]))
      ann.submit()
      ann.reject("标签不精确")
      ann.rework([AnnotationValue(label="vehicle", bbox=[100, 200, 300, 400])])
      assert ann.status == AnnotationStatus.SUBMITTED

  def test_rework_rejects_empty_values():
      ann = Annotation.create(uuid4(), uuid4(), AnnotationType.BBOX_2D)
      ann.add_value(AnnotationValue(label="car", bbox=[100, 200, 300, 400]))
      ann.submit()
      ann.reject("标签不精确")
      with pytest.raises(ValueError, match="EMPTY_ANNOTATION"):
          ann.rework([])

  def test_rework_rejects_wrong_status():
      ann = Annotation.create(uuid4(), uuid4(), AnnotationType.BBOX_2D)
      with pytest.raises(ValueError, match="INVALID_STATUS"):
          ann.rework([AnnotationValue(label="car", bbox=[100, 200, 300, 400])])

  def test_rework_publishes_event():
      ann = Annotation.create(uuid4(), uuid4(), AnnotationType.BBOX_2D)
      ann.add_value(AnnotationValue(label="car", bbox=[100, 200, 300, 400]))
      ann.submit()
      ann.reject("标签不精确")
      events_before = len(ann.domain_events)
      ann.rework([AnnotationValue(label="vehicle", bbox=[100, 200, 300, 400])])
      assert len(ann.domain_events) == events_before + 1
      assert ann.domain_events[-1].event_type == "AnnotationSubmitted"
  ```
  ✅ `穷举: 测试 4 / 校验 2 + 正常 2 ≥ 4`
