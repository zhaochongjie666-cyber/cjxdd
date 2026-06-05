# API 端点详细契约模板和示例

## 端点汇总表模板

```markdown
## 5. API 端点清单

### 7.1 端点汇总表

| 端点 | 方法 | 流程节点 | 规则 | 角色 | 请求 | 响应 | 错误码 |
|------|------|---------|------|------|------|------|--------|
| /api/projects | POST | B01-N01 | R01 | Admin | CreateProjectReq | ProjectRes | 400/409 |
| /api/projects/:id | GET | B01-N01 | R01 | All | - | ProjectRes | 404 |
| /api/tasks/:taskId | GET | B02-N06 | annotation-R01 | Annotator | - | TaskRes | 403/404 |
| /api/annotations | POST | B02-N07 | annotation-R02 | Annotator | CreateAnnotationReq | AnnotationRes | 400/403/404 |
| /api/annotations/:id/submit | POST | B02-N08 | annotation-R03 | Annotator | {} | SubmitRes | 400/404 |
| /api/reviews/:id/approve | POST | B02-N09 | annotation-R04 | Reviewer | {} | ReviewRes | 403/404 |
```

## 端点详细契约示例

### POST /api/annotations

- **@flow**: B02-N07 (AnnotationCreated)
- **@rules**: annotation-R02
- **@auth**: Annotator 角色（任务必须分配给当前用户）
- **@request**:
  ```json
  {
    "task_id": "uuid (必填)",
    "values": [
      {
        "label_id": "uuid (必填)",
        "type": "BBOX_2D | BBOX_3D | SEMANTIC",
        "bbox_2d": { "x": 100, "y": 200, "width": 50, "height": 80 },
        "bbox_3d": { "center": [1.0, 2.0, 3.0], "size": [1.0, 1.0, 1.0] }
      }
    ]
  }
  ```
- **@response**:
  ```json
  {
    "id": "uuid",
    "task_id": "uuid",
    "status": "IN_PROGRESS",
    "values": [...],
    "created_at": "ISO8601"
  }
  ```
- **@errors**:
  - 400 INVALID_LABEL — 标签不在项目标签模板中
  - 400 BBOX_OUT_OF_RANGE — 标注框坐标超出画面范围
  - 400 INVALID_BOUNDING_BOX — 标注框坐标无效
  - 403 TASK_NOT_ASSIGNED_TO_YOU — 任务未分配给当前用户
  - 404 TASK_NOT_FOUND — 任务不存在

### POST /api/annotations/:id/submit

- **@flow**: B02-N08 (AnnotationSubmitted)
- **@rules**: annotation-R03
- **@auth**: Annotator 角色（标注必须属于当前用户）
- **@request**: `{}`
- **@response**:
  ```json
  {
    "success": true,
    "annotation_id": "uuid",
    "next_task_id": "uuid | null"
  }
  ```
- **@errors**:
  - 400 EMPTY_ANNOTATION — 标注为空不可提交
  - 404 ANNOTATION_NOT_FOUND — 标注不存在

## API 契约设计要点

- **端点命名**：RESTful 风格，资源名词 + HTTP 方法表达操作意图
- **流程节点映射**：每个端点必须标注对应的 BXX-NYY，让 Harness 计划能追溯
- **规则覆盖**：每个端点必须标注 @rules，确保业务规则有 API 入口
- **错误码统一**：业务错误码（如 TASK_NOT_ASSIGNED_TO_YOU）全局唯一，HTTP 状态码对应业务语义
- **前后端共享**：此契约是后端路由和前端 API 客户端的共同引用源

## API 端点行为场景（Gherkin 格式）

JSON 契约描述端点的**静态结构**（请求体/响应体/错误码），Gherkin 场景描述端点的**动态行为**——请求经过什么处理、产生什么 DB 变化、发布什么事件、返回什么响应。

**建议**：每个端点至少写 1 个正常 Scenario + N 个异常 Scenario（N = @errors 列表长度）。

### 示例：POST /api/annotations 行为场景

```gherkin
@api-contract @covers-annotation-R02 @covers-B02-N07
Feature: POST /api/annotations — 创建标注

  Background:
    Given 标注员 annotator1 已认证（JWT valid）
      And 任务 T-001 存在，status=IN_PROGRESS，分配给 annotator1
      And 项目标签模板包含标签 L-001 "car"

  Scenario: 正常创建 2D 框标注
    When POST /api/annotations
      """json
      { "task_id": "T-001", "values": [{ "label_id": "L-001", "type": "BBOX_2D", "bbox_2d": {"x":100,"y":200,"w":50,"h":80} }] }
      """
    Then HTTP 201
      And 响应体 { "status": "IN_PROGRESS", "values": [{ "label_id": "L-001" }] }
      And DB annotation 表新增 1 行，status=IN_PROGRESS
      And 发布事件 AnnotationCreated { annotation_id: "<new>", task_id: "T-001" }

  Scenario: 标签不在项目模板中
    When POST /api/annotations
      """json
      { "task_id": "T-001", "values": [{ "label_id": "unknown", "type": "BBOX_2D" }] }
      """
    Then HTTP 400, code=INVALID_LABEL
      And DB annotation 表无新增
      And 无事件发布

  Scenario: 任务未分配给当前用户
    When POST /api/annotations（任务 T-002 分配给 annotator2）
    Then HTTP 403, code=TASK_NOT_ASSIGNED_TO_YOU
```

**Then 断言四要素**（每个 API 场景必须覆盖）：
1. HTTP 状态码 + 业务错误码
2. 响应体关键字段
3. DB 数据变化（新增/更新/无变化）
4. 事件发布（发布什么 / 明确不发布）

Gherkin 完整语法和更多后端数据流模式见 `skills/shadow-l2-e2e/references/gherkin-guide.md` "后端数据流场景"段。
