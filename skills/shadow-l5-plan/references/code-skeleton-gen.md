# L5 Plan 代码骨架生成（Code Skeleton Generation）

## 为什么需要代码骨架

L5-plan 写了 Harness 计划（含类签名、方法签名、字段类型、测试断言），但**计划 ≠ 可写代码**。L5-impl 阶段还要：

1. 创建文件
2. 写 import 语句
3. 写类/方法签名（如果 Harness 计划只描述了接口）
4. 写 docstring
5. 写测试文件骨架
6. 写测试断言占位符

**代码骨架生成 = 从 Harness 计划自动生成可写代码的起点**，L5-impl 不从零开始。

## 现状

L5-plan 输出 `harness-plan.md`（人类可读），L5-impl 读这个写代码。

问题：
- Harness 计划的人写法和 L5-impl 读法不统一 → 容易漏
- L5-impl 要在 Plan 和 Code 之间反复对照
- 重复样板代码（每个文件都要 import + 签名 + docstring）

## 骨架生成的位置

```
L5-plan 写 harness-plan.md
  ↓ (现在)
  harness-plan.md（人类可读的计划）
  ↓ (需要新增)
  harness-plan.md + 自动生成 code skeleton
  ↓
L5-impl 在 skeleton 基础上填充实现
```

## 骨架生成流程

### Step 1: 解析 Harness 计划

读 `harness-plan.md`，提取：

```yaml
files:
  - path: backend/domain/aggregates/annotation.py
    type: backend.aggregate
    methods:
      - name: create
        signature: "def create(task_id: UUID, annotator_id: UUID) -> Annotation"
        tests:
          - "test_creates_with_valid_inputs"
          - "test_rejects_invalid_task_id"
      - name: submit
        signature: "def submit(self) -> None"
        tests:
          - "test_submits_when_all_labels_complete"
          - "test_raises_when_incomplete"
        events:
          - "AnnotationSubmitted"
    @implements: [annotation-R12, annotation-R15]
    @intent: "标注员创建并提交标注"
```

### Step 2: 生成后端 Python 骨架

**Aggregate 骨架**：

```python
"""
File: backend/domain/aggregates/annotation.py
@implements: annotation-R12, annotation-R15
@intent: 标注员创建并提交标注
@aggregate: Annotation
@rules: [annotation-R12, annotation-R15]
@flow_refs: [B02-N07, B02-N08]
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import List, Optional
from uuid import UUID, uuid4
from datetime import datetime

from backend.domain.events import AnnotationCreated, AnnotationSubmitted
from backend.domain.value_objects import Label, BBox
from backend.domain.errors import InvalidStateError, ValidationError


@dataclass
class Annotation:
    """
    标注聚合根
    
    业务规则：
    - 创建后状态为 EMPTY
    - 添加完所有 label 后可提交
    - 提交后状态为 SUBMITTED，发布 AnnotationSubmitted 事件
    """
    id: UUID = field(default_factory=uuid4)
    task_id: UUID
    annotator_id: UUID
    status: str = "EMPTY"
    labels: List[Label] = field(default_factory=list)
    bboxes: List[BBox] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.now)
    submitted_at: Optional[datetime] = None
    
    def create(self, labels: List[Label], bboxes: List[BBox]) -> None:
        """
        R12: 创建有效标注
        
        验证：
        - labels 非空
        - bboxes 非空
        - 每个 bbox 必须有关联 label
        
        副作用：
        - 状态 EMPTY（默认）
        """
        if not labels:
            raise ValidationError("labels cannot be empty")
        if not bboxes:
            raise ValidationError("bboxes cannot be empty")
        if not all(b.label_id in [l.id for l in labels] for b in bboxes):
            raise ValidationError("all bboxes must reference a label")
        
        self.labels = labels
        self.bboxes = bboxes
        # 状态保持 EMPTY
    
    def submit(self) -> None:
        """
        R15: 提交标注
        
        验证：
        - 状态必须为 IN_PROGRESS
        - 必须有至少一个 label
        
        状态变更：IN_PROGRESS → SUBMITTED
        副作用：发布 AnnotationSubmitted 事件
        """
        if self.status != "IN_PROGRESS":
            raise InvalidStateError(f"cannot submit in status {self.status}")
        if not self.labels:
            raise ValidationError("cannot submit without labels")
        
        self.status = "SUBMITTED"
        self.submitted_at = datetime.now()
        
        # TODO: 发布事件 (L5-impl 阶段实现)
        # self._events.append(AnnotationSubmitted(
        #     annotation_id=self.id,
        #     task_id=self.task_id,
        #     submitted_at=self.submitted_at
        # ))
```

**测试骨架**：

```python
"""
File: tests/unit/test_annotation_aggregate.py
@implements: annotation-R12, annotation-R15
"""

import pytest
from uuid import uuid4

from backend.domain.aggregates.annotation import Annotation
from backend.domain.value_objects import Label, BBox
from backend.domain.errors import ValidationError, InvalidStateError


class TestAnnotationCreate:
    """R12: 创建标注"""
    
    def test_creates_with_valid_inputs(self):
        """测试：有效输入下成功创建"""
        # TODO: L5-impl 填实现
        ...
    
    def test_rejects_invalid_task_id(self):
        """测试：无效 task_id 被拒绝"""
        # TODO: L5-impl 填实现
        ...
    
    def test_rejects_empty_labels(self):
        """测试：空 labels 被拒绝"""
        # TODO: L5-impl 填实现
        ...


class TestAnnotationSubmit:
    """R15: 提交标注"""
    
    def test_submits_when_in_progress(self):
        """测试：IN_PROGRESS 状态下可提交"""
        # TODO: L5-impl 填实现
        ...
    
    def test_rejects_when_empty(self):
        """测试：EMPTY 状态下不能提交"""
        # TODO: L5-impl 填实现
        ...
```

### Step 3: 生成前端 TypeScript 骨架

**Page 骨架**：

```typescript
/**
 * File: frontend/src/pages/AnnotatorWorkbench.tsx
 * @implements: annotation-R12, annotation-R15
 * @intent: 标注员在一个页面内完成完整标注工作流
 * @page: AnnotatorWorkbench
 * @route: /tasks/:taskId/annotate
 */

import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAnnotationStore } from '@/stores/annotationStore';
import { api } from '@/api/client';

// TODO: 引入 wire.svg 的 data-test selector
// 等待 L5-impl 实现

export const AnnotatorWorkbench: React.FC = () => {
  const { taskId } = useParams<{ taskId: string }>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // TODO: 接入 L2 binding 元数据
  // data-test="canvas-main" for 拖拽
  // data-test="submit-button" for 提交
  
  return (
    <div className="annotator-workbench">
      {/* TODO: 画布 + 工具栏 + 提交按钮 */}
    </div>
  );
};
```

### Step 4: 生成 E2E 骨架

```typescript
/**
 * File: e2e/annotation-workflow.spec.ts
 * @implements: annotation-R12, annotation-R15
 * @binding: e2e/annotation.feature.binding.yaml
 */

import { test, expect } from '@playwright/test';

test.describe('创建标注 @P0 @covers-R12 @covers-B02-N08', () => {
  test('标注员创建有效 2D 框标注', async ({ page }) => {
    // TODO: 实现 step 1
    // Given 标注员已登录
    // TODO: 实现 step 2
    // And 任务已打开，状态为 IN_PROGRESS
    // TODO: 实现 step 3
    // When 标注员在画面上拖拽创建矩形框
    // TODO: 实现 step 4
    // Then 创建标注记录
  });
});
```

## 骨架生成工具

### 命令行工具

```bash
# 从 harness-plan.md 生成 skeleton
python3 skills/shadow-l5-plan/scripts/skeleton-gen.py <harness-plan.md> --output backend/
python3 skills/shadow-l5-plan/scripts/skeleton-gen.py <harness-plan.md> --output frontend/
python3 skills/shadow-l5-plan/scripts/skeleton-gen.py <harness-plan.md> --output tests/
python3 skills/shadow-l5-plan/scripts/skeleton-gen.py <harness-plan.md> --output e2e/
```

### 模板引擎

骨架生成基于 Jinja2 模板（Python）或 EJS（Node），模板在 `templates/skeleton/`。

```
templates/skeleton/
  python_aggregate.py.j2
  python_value_object.py.j2
  python_service.py.j2
  python_repository.py.j2
  python_api_route.py.j2
  ts_page.tsx.j2
  ts_component.tsx.j2
  ts_store.ts.j2
  test_python.py.j2
  test_ts.spec.ts.j2
  e2e_ts.spec.ts.j2
```

## 骨架 vs 完整代码的区别

**骨架** ≠ **完整代码**：

| 维度 | 骨架 | 完整代码 |
|------|------|---------|
| 签名 | 完整 | 不变 |
| 文档 | docstring + 业务规则 | 不变 |
| import | 完整 | 不变 |
| 错误处理骨架 | raise NotImplementedError 占位 | 真实实现 |
| 业务逻辑 | 留 TODO 注释 | 完整实现 |
| 测试断言 | 留占位 | 真实断言 |
| 事件发布 | 留 TODO 注释 | 真实发布 |

**L5-impl = 在骨架基础上把 TODO 填上**。

## 骨架不替代 TDD

骨架是「结构 + 文档 + 占位」，**不是 TDD 起点**。

L5-impl 还是 TDD：
1. 看到测试骨架里的 TODO
2. 先写失败测试（RED）
3. 写实现（GREEN）
4. 重构（REFACTOR）

## 与 L3 的对接

L5-plan 的 Harness 计划引用 L3 的 failsafe-design.md：

```markdown
| 失败模式 ID | 兜底策略 | 实现位置 | 测试位置 |
|------------|---------|---------|---------|
| F01 调度风暴 | 限流 + 熔断 | backend/infrastructure/resilience/xxx_circuit.py | tests/chaos/test_xxx_f01.py |
```

骨架生成时，**自动为这些 failsafe 文件生成对应的代码骨架 + 测试骨架**。

## 工具脚本

`scripts/skeleton-gen.py` — 从 harness-plan.md 生成代码骨架

依赖：
- Python 3.8+
- PyYAML
- Jinja2
- click（CLI）

## 反模式

❌ **「从零写代码」**：用骨架节省样板代码时间
❌ **「骨架就是最终代码」**：骨架是起点，不是终点
❌ **「跳过文档部分」**：docstring 是反向追溯的载体，必须保留
❌ **「L5-impl 改骨架结构」**：骨架结构来自 Plan，Plan 改才能改结构
❌ **「骨架生成失败就放弃」**：失败要修 Plan，不是放弃骨架

## 与 Walker 三面手原则的关系

L5-plan 完整三面手：

| 面 | 内容 |
|---|------|
| **设计** | Harness 计划（harness-plan.md）|
| **实现** | 代码骨架自动生成（skeleton-gen.py）|
| **跟踪** | plan-impl-diff（见 architecture-audit 同级文件） |
