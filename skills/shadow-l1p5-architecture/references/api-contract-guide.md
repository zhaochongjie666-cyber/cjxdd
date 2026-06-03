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
