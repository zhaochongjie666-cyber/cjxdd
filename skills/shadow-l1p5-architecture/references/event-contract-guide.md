# 事件契约详细格式和示例

## 事件契约格式

```markdown
# 事件契约

## E01: AnnotationCreated

- **@flow**: B02-N07
- **@rules**: annotation-R02
- **@intent**: 标注员创建标注时通知下游系统（如任务进度统计）
- **来源聚合**: Annotation
- **传递方式**: 进程内 EventBus（从 research.md EDD 决策传导）
- **订阅方**: TaskProgressTracker（更新任务完成进度）
- **重试策略**: 无（进程内，同步调用）
- **载荷**:
  ```json
  {
    "event_id": "UUID (事件唯一标识)",
    "event_type": "AnnotationCreated",
    "occurred_at": "ISO8601",
    "annotation_id": "UUID",
    "task_id": "UUID",
    "annotator_id": "UUID",
    "project_id": "UUID",
    "values_count": "int"
  }
  ```
- **载荷约束**:
  - event_id 全局唯一
  - annotation_id 必须对应已存在的 Annotation 聚合
  - occurred_at <= 当前时间（不允许未来事件）

## E02: AnnotationSubmitted

- **@flow**: B02-N08
- **@rules**: annotation-R03
- **@intent**: 标注提交后触发质检流程，实现质量闭环
- **来源聚合**: Annotation
- **传递方式**: 进程内 EventBus（同步）→ 后期可升级 Kafka（预留接口）
- **订阅方**:
  1. ReviewService（创建审核任务）
  2. TaskProgressTracker（更新任务完成进度）
  3. NotificationService（通知质检员）
- **重试策略**:
  - 进程内：同步调用，失败直接抛异常（事务回滚）
  - 跨进程（预留）：指数退避，最多 3 次，死信队列
- **载荷**:
  ```json
  {
    "event_id": "UUID",
    "event_type": "AnnotationSubmitted",
    "occurred_at": "ISO8601",
    "annotation_id": "UUID",
    "task_id": "UUID",
    "annotator_id": "UUID",
    "project_id": "UUID",
    "values_count": "int",
    "status": "SUBMITTED"
  }
  ```
- **载荷约束**:
  - status 必须为 SUBMITTED（不允许 DRAFT 事件）
  - annotation_id 必须对应 status=SUBMITTED 的标注
```

## 事件清单汇总表

```markdown
## 事件清单汇总

| 事件 ID | 事件名 | 来源聚合 | 传递方式 | 订阅方 | 对应流程节点 |
|---------|--------|---------|---------|--------|-------------|
| E01 | AnnotationCreated | Annotation | 进程内 EventBus | AnnotationTaskService | B02-N07 |
| E02 | AnnotationSubmitted | Annotation | 进程内 EventBus | ReviewService, AnnotationTaskService | B02-N08 |
| E03 | ReviewPassed | Review | 进程内 EventBus | AnnotationTaskService | B02-N09 |
| E04 | ReviewRejected | Review | 进程内 EventBus | Annotation (状态回退), NotificationService | B02-N10 |
```

## 事件契约设计要点

- **每个事件一个契约**：不合并、不省略
- **@intent 必填**：每个事件标注为什么需要这个事件
- **传递方式来自 research.md EDD 决策**：进程内/跨上下文/跨进程/外部系统
- **订阅方明确列出**：让 Harness 计划知道需要写哪些 EventHandler
- **重试策略区分场景**：进程内同步 vs 跨进程异步
- **载荷约束写清楚**：Harness 计划事件类定义和 L5 实现的校验依据
- **后期可升级**：标注"预留 Kafka 接口"，Harness 计划代码接口抽象保证可替换

## 事件流转场景（Gherkin 格式）

单个事件契约描述**载荷结构和订阅方**，事件流转场景描述**跨聚合的端到端数据流**——事件从哪里产生、经过什么传递、被谁消费、产生什么效果。

**建议**：每条跨聚合数据流至少写 1 个端到端 Scenario，标注事务边界。

### 示例：标注提交 → 质检创建（跨聚合事件流）

```gherkin
@event-flow @cross-aggregate
Feature: 标注提交后质检流程的跨聚合数据流

  Scenario: 标注提交 → 质检创建 → 通知发送
    Given Annotation A-001 存在，status=IN_PROGRESS, annotator=annotator1
      And Review 聚合无 A-001 相关记录

    When Annotation.submit() 被调用
    Then Annotation A-001 status=SUBMITTED
      And 发布 AnnotationSubmitted { annotation_id: A-001 }
      And 发布 ReviewRequested { task_id: T-001, annotation_id: A-001 }

    When ReviewService 消费 ReviewRequested
    Then 创建 Review R-001，status=PENDING, annotation_id=A-001
      And NotificationService 发送通知给质检员
```

### 示例：事务边界标注

```gherkin
@transaction-boundary
Feature: 标注提交的事务边界

  Scenario: Annotation 强一致 + Review 最终一致
    When Annotation.submit() 成功
    Then Annotation 事务内（强一致）:
      | 操作                       | 一致性  |
      | status → SUBMITTED          | 强一致  |
      | 发布 AnnotationSubmitted    | 强一致  |
    And Review 创建在独立事务中（最终一致）:
      | 操作                       | 一致性    |
      | Review 记录插入              | 最终一致  |
    But Annotation 事务不等待 Review 创建完成
```

Gherkin 完整语法和更多后端数据流模式见 `skills/shadow-l2-e2e/references/gherkin-guide.md` "后端数据流场景"段。
