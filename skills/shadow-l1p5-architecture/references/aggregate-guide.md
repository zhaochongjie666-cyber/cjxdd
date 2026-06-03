# 聚合设计详细原则 + 一致性边界

## 聚合清单（按业务线分组）

```markdown
# 聚合全景

## B01 标注平台聚合

| 上下文 | 聚合根 | 包含实体 | 包含值对象 | 一致性边界 | 发布事件 |
|--------|--------|---------|-----------|-----------|---------|
| ProjectContext | Project | ProjectMember | ProjectConfig, ProjectStatus, AnnotationType | 项目配置变更原子完成 | ProjectCreated, ProjectConfigured, MemberAdded |
| AnnotationContext | Annotation | — | AnnotationValue, Span, BoundingBox, TimeSegment | 标注提交原子完成 | AnnotationCreated, AnnotationSubmitted |
| ReviewContext | Review | — | ReviewResult, ReviewComment | 审核操作原子完成 | ReviewRequested, ReviewApproved, ReviewRejected |
| TaskContext | TaskAssignment | — | TaskStatus, AssignmentStrategy, Deadline | 任务分配原子完成 | TasksGenerated, TaskAssigned, TaskReassigned |

## B02 用户管理聚合

| 上下文 | 聚合根 | 包含实体 | 包含值对象 | 一致性边界 | 发布事件 |
|--------|--------|---------|-----------|-----------|---------|
| IdentityContext | User | — | UserRole, Permission | 用户信息变更原子完成 | UserCreated, RoleAssigned |
```

## 聚合间关系图

```markdown
### 聚合间关系

#### B01 内部聚合关系

```
Project ──(projectId 引用)──→ Annotation
Project ──(projectId 引用)──→ TaskAssignment
Annotation ──(AnnotationSubmitted 事件)──→ Review
Review ──(ReviewRejected 事件)──→ Annotation (打回重做)
TaskAssignment ──(taskId 引用)──→ Annotation
```

#### 跨业务线聚合关系

```
B02.User ──(userId)──→ B01.Project.Member (用户作为项目成员)
B02.User ──(userId)──→ B01.TaskAssignment.annotatorId (用户作为标注员)
B02.User ──(userId)──→ B01.Review.reviewerId (用户作为质检员)
B01.Annotation ──(annotationId)──→ B03.ExportJob.source (标注数据作为导出源)
```
```

**聚合间关系类型**：
- **ID 引用**：聚合 A 通过 ID 引用聚合 B（如 Project 通过 userId 引用 User）
- **事件驱动**：聚合 A 发布事件，聚合 B 订阅（如 AnnotationSubmitted → ReviewRequested）
- **共享内核**：聚合 A 和聚合 B 共享领域模型（如共享 AssignmentStrategy 枚举）

## 聚合设计原则

```markdown
### 聚合设计原则

| 原则 | 说明 | 示例 |
|------|------|------|
| **聚合根是唯一入口** | 外部只能通过聚合根访问聚合内对象 | Annotation 是聚合根，外部不能直接修改 AnnotationValue |
| **边界要小** | 聚合内对象越少越好，减少事务范围 | Annotation 只包含 AnnotationValue[]，不包含 Task |
| **跨聚合引用用 ID** | 不嵌入外部聚合对象，只引用 ID | Annotation.taskId 引用 Task，不嵌入 Task 对象 |
| **单聚合事务** | 事务边界 = 聚合边界，跨聚合用事件驱动 | Annotation.submit() 是单事务，ReviewRequested 是异步事件 |
| **强一致在聚合内** | 聚合内操作原子完成；跨聚合最终一致 | Annotation.create() 强一致，AnnotationSubmitted→ReviewRequested 最终一致 |
| **事件是跨聚合协调工具** | 通过事件驱动跨聚合操作，不直接调用 | Review 不直接调用 Annotation，而是监听 AnnotationSubmitted 事件 |
```

## 一致性边界定义

```markdown
### 一致性边界

#### 强一致（单聚合事务）

| 聚合 | 操作 | 一致性要求 |
|------|------|-----------|
| Project | 创建项目 + 初始化配置 | 原子完成，要么全成功要么全失败 |
| Annotation | 创建标注 + 添加标注值 | 原子完成 |
| Annotation | 提交标注 + 状态变更 + 发布事件 | 原子完成 |
| Review | 审核通过/驳回 + 状态变更 + 发布事件 | 原子完成 |

#### 最终一致（跨聚合事件驱动）

| 上游事件 | 下游聚合 | 传递方式 | 延迟要求 |
|---------|---------|---------|---------|
| AnnotationSubmitted | Review | EventBus (进程内) | < 100ms |
| ReviewRejected | Annotation | EventBus (进程内) | < 100ms |
| ProjectConfigured | TaskAssignment | EventBus (进程内) | < 1s |
| ExportRequested | ExportJob | BackgroundTask | < 5min |
```

## 跨业务线聚合关系

```markdown
### 跨业务线聚合关系

| 上游聚合 | 下游聚合 | 关系类型 | 传递方式 |
|---------|---------|---------|---------|
| B02.User | B01.Project.Member | ID 引用 | 用户信息通过 userId 引用 |
| B01.Annotation | B03.ExportJob | ID 引用 + 事件驱动 | 标注数据通过 annotationId 引用，导出通过事件触发 |
| B01.Project | B03.ExportJob | ID 引用 | 项目通过 projectId 引用 |
```
