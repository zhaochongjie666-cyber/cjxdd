# Harness 计划示例 — 自动驾驶数据平台

> 项目：自动驾驶数据平台（采集打点 B01 + 标注 B02 + 仿真播放 B03）

---

## 1. 文件清单

| Batch | 文件 | 聚合/类型 | 规则映射 |
|-------|------|-----------|---------|
| 1 | `backend/domain/aggregates/collection.py` | Collection (聚合根) | collection-R01~R04 |
| 1 | `backend/domain/aggregates/annotation.py` | Annotation (聚合根) | annotation-R01~R06 |
| 1 | `backend/domain/aggregates/simulation.py` | Simulation (聚合根) | simulation-R01~R03 |
| 1 | `backend/domain/events.py` | 领域事件定义 | — |
| 2 | `backend/domain/services/annotation_service.py` | 领域服务 | annotation-R05 |
| 2 | `backend/domain/repositories/annotation_repo.py` | 仓储接口 | — |
| 3 | `backend/application/annotation_app_service.py` | 应用服务 | — |
| 4 | `backend/infrastructure/repo/sql_annotation_repo.py` | 仓储实现 | — |
| 5 | `backend/interfaces/routes/annotations.py` | API 路由 | — |
| 6 | `frontend/src/api/annotationApi.ts` | API 客户端 | — |
| 7 | `frontend/src/pages/AnnotatorWorkbench.tsx` | 页面 | annotation-R01~R03 |
| 8 | `e2e/annotation-workflow.spec.ts` | E2E 测试 | P0 UAT |

---

## 2. 全局约束

### 事件发布
- 聚合状态变更后返回领域事件列表，应用服务统一发布
- 传递方式: 进程内 EventBus（同步调用订阅者）
- 载荷结构与 `event-contract.md` 一致

### 分页
- 查询参数: `?page=1&per_page=20`
- 响应格式: `{ items: list, total: int, page: int, per_page: int }`
- `per_page` 上限 100，超过截断

### 事务边界
- 单聚合内强一致（单事务提交）
- 跨聚合最终一致（事件驱动，应用服务发布后不等待）

### 统一错误格式
- `{ code: UPPER_SNAKE_CASE, message: str, details?: any }`
- HTTP 状态码: 校验失败 400，不存在 404，冲突 409

---

## 3. 逐文件指令示例 (Batch 1)

### 文件: backend/domain/aggregates/annotation.py

**上下文**: 标注聚合根，管理标注的创建、值添加、提交、返工状态流转。

**规则**: annotation-R02 (B02-N07), annotation-R03 (B02-N08), annotation-R06 (B02-N11)

**聚合定义**:
- 聚合根: Annotation（唯一入口）
- 聚合边界: Annotation (根) + AnnotationValue[] (值对象)。不包含 Task（通过 task_id 引用）、User（通过 annotator_id 引用）
- 一致性: create / add_value 单事务原子。submit 状态变更 + 事件发布单事务

**枚举/常量**:

```python
class AnnotationStatus(str, Enum):
    EMPTY = "EMPTY"
    IN_PROGRESS = "IN_PROGRESS"
    SUBMITTED = "SUBMITTED"
    APPROVED = "APPROVED"
    REWORK = "REWORK"
```

**值对象**:

```python
@dataclass(frozen=True)
class AnnotationValue:
    label_id: UUID
    value_type: str  # "SPAN" / "BBOX" / "TIME_SEGMENT"
    data: dict
```

**类签名**:

```python
class Annotation:
    annotation_id: UUID
    task_id: UUID
    annotator_id: UUID
    type: str  # "SPAN" / "BBOX" / "TIME_SEGMENT"
    status: AnnotationStatus
    values: list[AnnotationValue]
    created_at: datetime
    submitted_at: datetime | None
```

**方法**:

---

#### `create(cls, task_id: UUID, annotator_id: UUID, type: str) -> Annotation`

- 校验: task_id 非 None → 否则 raise ValueError("task_id required")
- 校验: annotator_id 非 None → 否则 raise ValueError("annotator_id required")
- 校验: type in ("SPAN", "BBOX", "TIME_SEGMENT") → 否则 raise ValueError("invalid type")
- 初始状态: EMPTY
- 事件: 无
- 错误: ValueError

测试:

```python
def test_create_annotation_success():
    tid, aid = uuid4(), uuid4()
    a = Annotation.create(task_id=tid, annotator_id=aid, type="SPAN")
    assert a.status == AnnotationStatus.EMPTY
    assert a.task_id == tid
    assert a.values == []

def test_create_annotation_missing_task_id():
    with pytest.raises(ValueError, match="task_id required"):
        Annotation.create(task_id=None, annotator_id=uuid4(), type="SPAN")

def test_create_annotation_invalid_type():
    with pytest.raises(ValueError, match="invalid type"):
        Annotation.create(task_id=uuid4(), annotator_id=uuid4(), type="POLYGON")
```

✅ `穷举: 测试 3 / 校验 3 + 正常 0 ≥ 3`

---

#### `add_value(self, value: AnnotationValue, project_labels: list[UUID]) -> None`

- 校验: self.status in (EMPTY, IN_PROGRESS) → 否则 raise AnnotationAlreadySubmitted
- 校验: value.label_id in project_labels → 否则 raise InvalidLabelError
- 添加 value 到 self.values
- 如果 status == EMPTY → 变更为 IN_PROGRESS
- 事件: 无
- 错误: AnnotationAlreadySubmitted, InvalidLabelError

测试:

```python
def test_add_value_changes_empty_to_in_progress():
    a = Annotation.create(uuid4(), uuid4(), "SPAN")
    lid = uuid4()
    a.add_value(AnnotationValue(label_id=lid, value_type="SPAN", data={}), project_labels=[lid])
    assert a.status == AnnotationStatus.IN_PROGRESS
    assert len(a.values) == 1

def test_add_value_after_submit_raises():
    a = _create_submitted_annotation()
    with pytest.raises(AnnotationAlreadySubmitted):
        a.add_value(AnnotationValue(label_id=uuid4(), value_type="SPAN", data={}), project_labels=[uuid4()])
```

✅ `穷举: 测试 2 / 校验 2 + 正常 0 ≥ 2`

---

#### `submit(self) -> list[AnnotationSubmitted | ReviewRequested]`

- 校验: self.status == IN_PROGRESS → 否则 raise InvalidStatusTransition
- 校验: len(self.values) > 0 → 否则 raise EmptyAnnotationNotAllowed
- 校验: self.type in ("SPAN", "BBOX", "TIME_SEGMENT") → 否则 raise ValueError（防御性）
- 状态: IN_PROGRESS → SUBMITTED
- self.submitted_at = datetime.utcnow()
- 事件: 返回 [AnnotationSubmitted(annotation_id, task_id, annotator_id, submitted_at), ReviewRequested(task_id, annotation_id)]
- 错误: InvalidStatusTransition, EmptyAnnotationNotAllowed

测试:

```python
def test_submit_success_publishes_two_events():
    a = _create_in_progress_annotation()
    events = a.submit()
    assert a.status == AnnotationStatus.SUBMITTED
    assert a.submitted_at is not None
    assert len(events) == 2
    assert isinstance(events[0], AnnotationSubmitted)
    assert isinstance(events[1], ReviewRequested)

def test_submit_from_empty_status_raises():
    a = Annotation.create(uuid4(), uuid4(), "SPAN")
    with pytest.raises(InvalidStatusTransition):
        a.submit()

def test_submit_with_no_values_raises():
    a = _create_in_progress_annotation()
    a.values = []
    with pytest.raises(EmptyAnnotationNotAllowed):
        a.submit()

def test_submit_idempotent_second_call_raises():
    a = _create_in_progress_annotation()
    a.submit()
    with pytest.raises(InvalidStatusTransition):
        a.submit()
```

✅ `穷举: 测试 4 / 校验 3 + 正常 1 ≥ 4`

---

#### `rework(self, new_values: list[AnnotationValue]) -> list[AnnotationReworked]`

- 校验: self.status == REWORK → 否则 raise InvalidStatusTransition("rework only from REWORK")
- 校验: len(new_values) > 0 → 否则 raise EmptyAnnotationNotAllowed
- 校验: 所有 v.value_type == self.type → 否则 raise ValueError("value type mismatch")
- 清空 self.values，追加 new_values
- 状态: REWORK → IN_PROGRESS
- self.submitted_at = None
- 事件: 返回 [AnnotationReworked(annotation_id, task_id, annotator_id)]
- 错误: InvalidStatusTransition, EmptyAnnotationNotAllowed, ValueError

测试:

```python
def test_rework_success():
    a = _create_rework_annotation()
    new = [AnnotationValue(label_id=uuid4(), value_type="SPAN", data={"x": 1})]
    events = a.rework(new)
    assert a.status == AnnotationStatus.IN_PROGRESS
    assert a.values == new
    assert a.submitted_at is None
    assert len(events) == 1
    assert isinstance(events[0], AnnotationReworked)

def test_rework_from_wrong_status_raises():
    a = Annotation.create(uuid4(), uuid4(), "SPAN")
    with pytest.raises(InvalidStatusTransition):
        a.rework([AnnotationValue(label_id=uuid4(), value_type="SPAN", data={})])

def test_rework_empty_values_raises():
    a = _create_rework_annotation()
    with pytest.raises(EmptyAnnotationNotAllowed):
        a.rework([])

def test_rework_type_mismatch_raises():
    a = _create_rework_annotation()
    bad = [AnnotationValue(label_id=uuid4(), value_type="BBOX", data={})]
    with pytest.raises(ValueError, match="value type mismatch"):
        a.rework(bad)
```

✅ `穷举: 测试 4 / 校验 3 + 正常 1 ≥ 4`
