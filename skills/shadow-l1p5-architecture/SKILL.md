---
name: shadow-l1p5-architecture
alias: Shadow·L1.5-Arch
methodology: ADD — Attribute-Driven Design + SDD — Security-Driven Design + PDD — Performance-Driven Design
description: |
  Shadow L1.5 架构设计 + L1.5 门禁检查（ADD 思维：质量属性驱动决策 + SDD 安全设计 + PDD 性能设计）。
  产出 architecture.md（质量属性 + 限界上下文 + 上下文映射 + 技术栈 + 分层架构 + 规则传导矩阵 + API 端点清单 + 安全设计 + 性能设计 + 文件清单 + 质量规划）
  + aggregate-landscape.md（聚合全景：聚合清单 + 聚合间关系 + 一致性边界 + 跨业务线聚合关系）
  + event-contract.md（EDD 独立契约：事件定义 + 载荷结构 + 传递方式 + 订阅关系）。
  内含 L1.5 门禁：检查 architecture.md 存在，规则映射完整，产出 l1p5.{slug}.passed 标记。
  原 shadow-l1p5-filelist、shadow-l1p5-quality 和 shadow-l1p5-gate 已合入本 skill。
  API 端点清单定义前后端数据契约，是 L5 Harness 计划引用的架构边界。
  事件契约定义 EDD 事件驱动设计的独立产出，是 L5 事件实现的引用源。
  聚合全景是架构师掌握全局的入口，L5 Harness 计划引用此清单进行聚合设计。
  触发：架构、ADD、质量属性、技术栈、分层、聚合、aggregate、安全、SDD、性能、PDD、事件契约、event-contract、L1.5 门禁。
version: "5.0.0"
---

# Shadow·ADD+SDD+PDD — 架构驱动 + 安全设计 + 性能设计

## 角色

ADD+SDD+PDD 的核心理念：**质量属性（性能、可用性、安全性、可修改性）+ 安全策略 + 性能基准驱动架构决策，不止是功能驱动。**

消费 L1 产出（research/spec/flow/wire/business-landscape/intent），产出：
- `architecture.md`：技术架构决策 + API 契约 + 安全设计 + 性能设计 + 文件清单 + 质量规划
- `aggregate-landscape.md`：聚合全景（架构师掌握全局的入口）
- `event-contract.md`：EDD 事件契约（独立产出，L5 事件实现的引用源）

**API 端点清单是前后端之间的架构边界**——定义数据契约（请求/响应结构、错误码、流程节点映射），Harness 计划的后端和前端指令都引用此清单。

**事件契约是 EDD 的独立产出物**——定义每个领域事件的载荷结构、传递方式（进程内/跨上下文/跨进程）、订阅关系、重试策略。L1 Research 中的事件分类决策在此处细化为可执行契约。

**安全设计（SDD）独立引导**——不是 ADD 质量属性的附属品，而是有独立的设计输出：威胁建模、认证授权方案、数据保护策略、安全基线。

**性能设计（PDD）独立引导**——不是 ADD 质量属性的附属品，而是有独立的设计输出：性能基准、瓶颈分析、缓存策略、并发模型。

**聚合全景是 L5 Harness 计划的前置输入**——Harness 计划的聚合设计（聚合根/边界/一致性）必须与聚合全景一致。

**L1 Wire 是前端架构契约源**——如果存在 `wire.svg`，L1.5 必须从 SVG 的 `data-page/data-route/data-action/data-target/data-state` 和 metadata/desc 中抽取页面、组件、路由、状态管理和 API 触发边界。不能只把 wire 当“参考图”。

## ADD 思维链

```
功能需求 → 质量属性场景 → 架构模式 → 战术策略 → 架构草图
                     ↑
               约束和技术栈
```

## 怎么做

### 1. 质量属性场景

问自己：这个系统最在意的非功能属性是什么？

| 属性 | 典型问题 |
|------|---------|
| 性能 | 响应时间要求多少？95% 请求应在多少毫秒内？ |
| 可用性 | 能否接受宕机？SLA 要求多少？ |
| 安全性 | 谁可以访问？防什么攻击？ |
| 可修改性 | 业务规则变更需要改多少代码？ |

每个场景写成：**刺激源 → 刺激 → 环境 → 响应 → 响应度量**

不需要多，3-5 个关键场景就够。

### 2. 安全设计（SDD — Security-Driven Design）

安全不是 ADD 的附属品，而是有独立的威胁建模和设计输出。

#### 2.1 威胁建模

用 STRIDE 方法分析主要威胁：

| 威胁类型 | 问自己 | 应对 |
|---------|--------|------|
| Spoofing | 谁可以冒充用户？ | 认证方案（JWT/OAuth2） |
| Tampering | 数据可以被篡改吗？ | 传输加密 + 签名验证 |
| Repudiation | 操作可以被否认吗？ | 审计日志 |
| Info Disclosure | 数据会泄露吗？ | 权限控制 + 加密存储 |
| Denial of Service | 服务会被打垮吗？ | 限流 + 熔断 |
| Elevation of Privilege | 普通用户能变成管理员吗？ | RBAC + 最小权限 |

#### 2.2 认证授权方案

```markdown
### 认证授权设计

**认证**：JWT / Session / OAuth2
- Token 生命周期
- Refresh 机制
- 多设备登录策略

**授权**：RBAC / ABAC
| 角色 | 权限范围 | 限制 |
|------|---------|------|
| Admin | 全部 | — |
| Annotator | 只能操作自己分配的任务 | 不能查看他人标注 |
| Reviewer | 只能审核分配给自己的任务 | 不能修改标注 |

**数据隔离**：标注员只能看到自己分配的任务数据（行级安全）
```

#### 2.3 数据保护策略

- 传输加密：TLS 1.2+
- 存储加密：敏感字段加密（如密码 bcrypt）
- 密钥管理：环境变量 / Vault
- 日志脱敏：不记录敏感数据

#### 2.4 安全基线

```markdown
### 安全检查清单
- [ ] 所有 API 端点需要认证（除公开端点外）
- [ ] 输入校验（SQL 注入、XSS、路径遍历）
- [ ] 输出编码（防 XSS）
- [ ] 限流（防暴力破解）
- [ ] CORS 配置
- [ ] 依赖漏洞扫描
```

### 3. 性能设计（PDD — Performance-Driven Design）

性能不是 ADD 的附属品，而是有独立的基准和优化策略。

#### 3.1 性能基准

| 指标 | 目标值 | 度量方式 |
|------|--------|---------|
| API 响应时间 P50 | < 100ms | APM 监控 |
| API 响应时间 P99 | < 500ms | APM 监控 |
| 页面首屏加载 | < 2s | Lighthouse |
| 并发用户数 | 100 | 压测 |
| 数据库查询 | < 50ms | 慢查询日志 |

#### 3.2 瓶颈分析

```markdown
### 瓶颈预估

| 操作 | 预期瓶颈 | 应对策略 |
|------|---------|---------|
| 批量导入数据 | DB 写入瓶颈 | 批量插入 + 异步队列 |
| 大图片标注 | 前端渲染瓶颈 | 图片压缩 + 懒加载 + Canvas 分片 |
| 审核查询 | DB 查询瓶颈 | 索引优化 + 分页 |
| 并发提交标注 | 事务竞争 | 单聚合事务 + 异步事件 |
```

#### 3.3 缓存策略

| 缓存层 | 缓存内容 | 失效策略 |
|--------|---------|---------|
| 浏览器 | 静态资源 | Hash 文件名 |
| CDN | 图片/文件 | 版本号 |
| 应用层 | 项目配置、标签模板 | 写入时失效 |
| DB | 查询缓存 | TTL |

#### 3.4 并发模型

```markdown
### 并发策略
- Web 服务器：异步（asyncio/uvicorn）
- 数据库连接池：最小 5，最大 20
- 事件处理：EventBus 异步（不阻塞主线程）
- 后台任务：任务队列（Celery/ARQ）
```

### 4. 限界上下文（从 research.md 传导）

- 列出每个上下文的职责
- 上下文间的关系（上下游/防腐层/共享内核）
- 可选：画 context-map.mermaid 关系图

### 5. 技术栈 + 分层

- 选型各层用什么（框架/DB/消息队列...）
- 每安排一个技术选型，记录原因（背景→选项→选了什么→为什么）
- 分层：Presentation（UI + API）→ Application → Domain → Infrastructure
- **如果 L1 Wire 存在或项目需要前端，必须包含前端技术栈决策和前端分层设计**

### 5.5 从 wire.svg 抽取 UI/UX 实现契约

如果 `.shadow/L1-business/wire.svg` 存在，必须新增 `UI/UX 实现契约` 章节，至少包含：

```markdown
## UI/UX 实现契约（来自 L1 wire.svg）

### 页面/视图清单
| SVG ID | 页面 | 路由/入口 | 主要组件 | 状态 | 规则 | 流程节点 |
|--------|------|-----------|----------|------|------|----------|
| page-annotator | AnnotatorPage | /tasks/:id/annotate | AnnotationCanvas, ToolPanel | normal/loading/empty/error | annotation-R01,annotation-R02 | B02-N06 |

### 交互清单
| SVG ID | data-action | data-target | UI 语义 | API/路由/状态影响 | 规则 | 节点 | Harness 文件 |
|--------|-------------|-------------|---------|------------------|------|------|---------|
| action-submit-annotation | submit-annotation | api.POST./api/annotations/:id/submit | primary | 调用 API，成功后跳转下一任务 | annotation-R03 | B02-N08 | frontend/pages/AnnotatorPage.tsx |

### 状态清单
| 页面/组件 | data-state | 触发条件 | UI 反馈 | 测试要求 |
|-----------|------------|----------|---------|----------|
| TaskListPage | loading | 首次加载/刷新 | skeleton/spinner | 渲染 loading |
| TaskListPage | empty | 查询结果为空 | 空状态 + 创建入口 | 渲染 empty CTA |
| TaskListPage | error | API 失败 | 错误提示 + 重试 | 点击重试再次调用 API |
```

传导要求：
- 每个 `data-page` 必须映射到页面文件、路由和 Harness 计划
- 每个 `data-action` 必须映射到 API 端点、路由跳转、弹窗/抽屉状态或本地 store action
- 每个 `data-state` 必须映射到前端 state 字段、渲染分支和 Harness 计划测试断言
- 每个 `data-target` 指向 API 时，必须在 API 端点清单中有对应契约
- 若 SVG 有交互但 L1.5 没有对应页面/组件/API/store 设计，L1.5 不得通过

### 6. 规则传导矩阵

一条条过 spec 规则，确定：
- 每条规则在哪个层/模块实现
- 对应的文件类型（aggregate/value-object/service/repository + **前端 page/component/store**）
- **用户交互类规则必须同时映射到前端组件**
- **L1 Wire 中每个 `data-action` 必须映射到前端 page/component/store、API 端点或路由跳转**
- **每条规则必须映射到至少一个 API 端点（后端暴露能力）**

### 7. API 端点清单（前后端数据契约）

**这是前后端之间的架构边界**。每个端点定义：
- 触发的流程节点（从 project.flow.mermaid 的 BXX-NYY 编号）
- 覆盖的 spec 规则（从 spec.md 的 RXX 编号）
- 请求结构（字段、类型、必填性）
- 响应结构（字段、类型）
- 错误码（HTTP 状态码 + 业务错误码）
- 权限要求（哪个角色可调用）

#### API 端点清单模板

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

### 7.2 端点详细契约

#### POST /api/annotations

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

#### POST /api/annotations/:id/submit

- **@flow**: B02-N08 (AnnotationSubmitted)
- **@rules**: annotation-R03
- **@auth**: Annotator 角色（标注必须属于当前用户）
- **@request**: `{}`
- **@response**:
  ```json
  {
    "success": true,
    "annotation_id": "uuid",
    "next_task_id": "uuid | null"  // 自动分配的下一个任务
  }
  ```
- **@errors**:
  - 400 EMPTY_ANNOTATION — 标注为空不可提交
  - 404 ANNOTATION_NOT_FOUND — 标注不存在
```

#### API 契约设计要点

- **端点命名**：RESTful 风格，资源名词 + HTTP 方法表达操作意图
- **流程节点映射**：每个端点必须标注对应的 BXX-NYY，让 Harness 计划能追溯
- **规则覆盖**：每个端点必须标注 @rules，确保业务规则有 API 入口
- **错误码统一**：业务错误码（如 TASK_NOT_ASSIGNED_TO_YOU）全局唯一，HTTP 状态码对应业务语义
- **前后端共享**：此契约是后端路由和前端 API 客户端的共同引用源

### 8. 事件契约（EDD 独立产出）

**产出**：`.shadow/L1.5-architecture/event-contract.md`

这是 EDD 事件驱动设计的独立产出物，不是隐式散射在 research.md 中的片段。L5 Harness 计划和 L5 Impl 引用此契约定义事件类和事件处理代码。

#### 8.1 事件契约格式

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

#### 8.2 事件契约设计要点

- **每个事件一个契约**：不合并、不省略
- **@intent 必填**：每个事件标注为什么需要这个事件
- **传递方式来自 research.md EDD 决策**：进程内/跨上下文/跨进程/外部系统
- **订阅方明确列出**：让 Harness 计划知道需要写哪些 EventHandler
- **重试策略区分场景**：进程内同步 vs 跨进程异步
- **载荷约束写清楚**：Harness 计划事件类定义和 L5 实现的校验依据
- **后期可升级**：标注"预留 Kafka 接口"，Harness 计划代码接口抽象保证可替换

#### 8.3 事件清单汇总表

```markdown
## 事件清单汇总

| 事件 ID | 事件名 | 来源聚合 | 传递方式 | 订阅方 | 对应流程节点 |
|---------|--------|---------|---------|--------|-------------|
| E01 | AnnotationCreated | Annotation | 进程内 EventBus | AnnotationTaskService | B02-N07 |
| E02 | AnnotationSubmitted | Annotation | 进程内 EventBus | ReviewService, AnnotationTaskService | B02-N08 |
| E03 | ReviewPassed | Review | 进程内 EventBus | AnnotationTaskService | B02-N09 |
| E04 | ReviewRejected | Review | 进程内 EventBus | Annotation (状态回退), NotificationService | B02-N10 |
```

### 9. 文件清单 + 质量规划

在同一个文档里：
- 列出按 DDD 战术模式组织的**后端**文件清单
- **如果项目包含前端，列出前端文件清单（pages/components/stores/api/routes）**
- 列出质量要点（错误处理/输入校验/日志/安全/性能/启动）

#### 前端文件清单要求

当架构文档包含前端时，必须列出：
```
frontend/
├── src/
│   ├── pages/          — 页面组件（与 L1 Wire 区域一一对应）
│   ├── components/     — 可复用组件（标注编辑器、标签面板等）
│   ├── stores/         — 状态管理（Zustand/Redux store）
│   ├── api/            — API 客户端（引用 §5 API 端点清单）
│   └── routes/         — 路由配置
├── tests/              — 前端测试
├── package.json
└── vite.config.ts
```

每个前端页面/组件在文件清单中注明：
- 对应的 L1 Wire 区域
- 覆盖的 spec 规则
- **调用的 API 端点（引用 §5 API 端点清单）**

### 10. 聚合全景（新增）

**产出**：`.shadow/L1.5-architecture/aggregate-landscape.md`

这是架构师掌握全局的入口，Harness 计划的聚合设计必须与此清单一致。

#### 10.1 聚合清单（按业务线分组）

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

#### 10.2 聚合间关系图

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

#### 10.3 聚合设计原则

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

#### 10.4 一致性边界定义

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

#### 10.5 跨业务线聚合关系

```markdown
### 跨业务线聚合关系

| 上游聚合 | 下游聚合 | 关系类型 | 传递方式 |
|---------|---------|---------|---------|
| B02.User | B01.Project.Member | ID 引用 | 用户信息通过 userId 引用 |
| B01.Annotation | B03.ExportJob | ID 引用 + 事件驱动 | 标注数据通过 annotationId 引用，导出通过事件触发 |
| B01.Project | B03.ExportJob | ID 引用 | 项目通过 projectId 引用 |
```
```

### 11. Docker Compose 部署架构

**约束：生产环境和测试环境都必须使用 Docker Compose 封装。**

Docker Compose 不是可选项，是 Shadow 方法的强制部署标准。架构设计时必须产出 Docker Compose 配置，确保开发和部署环境一致、可复现。

#### 11.1 生产环境 compose（docker-compose.yml）

```yaml
version: "3.8"

services:
  # 后端服务
  backend:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: ${PROJECT_NAME:-app}-backend
    env_file:
      - .env
    environment:
      - DB_HOST=db
      - REDIS_HOST=redis
    ports:
      - "${BACKEND_PORT:-3002}:3002"
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3002/api/health"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s
    networks:
      - app-net
    restart: unless-stopped

  # 前端服务（如有前端）
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: ${PROJECT_NAME:-app}-frontend
    ports:
      - "${FRONTEND_PORT:-80}:80"
    depends_on:
      - backend
    networks:
      - app-net
    restart: unless-stopped

  # 数据库
  db:
    image: postgres:16-alpine
    container_name: ${PROJECT_NAME:-app}-db
    env_file:
      - .env
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-postgres}"]
      interval: 5s
      timeout: 3s
      retries: 5
    networks:
      - app-net
    restart: unless-stopped

  # 缓存（如需要）
  redis:
    image: redis:7-alpine
    container_name: ${PROJECT_NAME:-app}-redis
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    networks:
      - app-net
    restart: unless-stopped

volumes:
  pgdata:

networks:
  app-net:
    driver: bridge
```

**设计要点**：
- 每个服务必须有 `healthcheck`（L6 依赖它判断就绪）
- `depends_on` 必须配合 `condition: service_healthy`（不是默认的 started）
- 敏感信息通过 `env_file` 注入，不硬编码
- 服务间通过内部 network 通信，不暴露不必要的端口
- 数据卷持久化（pgdata），容器重建不丢数据
- 命名带 `${PROJECT_NAME}` 前缀，避免多项目冲突
- `restart: unless-stopped` 保证崩溃后自动恢复

#### 11.2 测试环境 compose（docker-compose.test.yml）

```yaml
version: "3.8"

services:
  # 后端测试
  backend-test:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: ${PROJECT_NAME:-app}-backend-test
    env_file:
      - .env.test
    environment:
      - DB_HOST=db-test
      - DB_NAME=${TEST_DB_NAME:-app_test}
      - REDIS_HOST=redis-test
    depends_on:
      db-test:
        condition: service_healthy
      redis-test:
        condition: service_started
    command: ["npm", "run", "test"]
    profiles:
      - test
    networks:
      - test-net

  # 测试数据库
  db-test:
    image: postgres:16-alpine
    container_name: ${PROJECT_NAME:-app}-db-test
    environment:
      POSTGRES_USER: ${TEST_DB_USER:-test}
      POSTGRES_PASSWORD: ${TEST_DB_PASSWORD:-test}
      POSTGRES_DB: ${TEST_DB_NAME:-app_test}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${TEST_DB_USER:-test}"]
      interval: 3s
      timeout: 2s
      retries: 5
    profiles:
      - test
    networks:
      - test-net

  # 测试缓存
  redis-test:
    image: redis:7-alpine
    container_name: ${PROJECT_NAME:-app}-redis-test
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 3s
      timeout: 2s
      retries: 5
    profiles:
      - test
    networks:
      - test-net

  # Playwright E2E（如有前端 — 针对 docker compose 运行中的 dev 服务）
  playwright-e2e:
    image: mcr.microsoft.com/playwright:v1.52.0-jammy
    container_name: ${PROJECT_NAME:-app}-pw-e2e
    working_dir: /e2e
    volumes:
      - ./e2e:/e2e
      - /tmp/playwright-report:/e2e/playwright-report
    environment:
      - BASE_URL=http://frontend:80
      - API_URL=http://backend:3002
    depends_on:
      backend:
        condition: service_healthy
      frontend:
        condition: service_started
    command: ["npx", "playwright", "test", "--reporter=list"]
    profiles:
      - e2e
    networks:
      - test-net

networks:
  test-net:
    driver: bridge
```

**设计要点**：
- 使用 `profiles: [test]` 隔离测试环境，生产启动时自动排除
- 测试数据库使用独立名称（`app_test`），不影响开发数据
- `command` 直接设为测试命令（`npm run test`），一行命令跑完
- `.env.test` 提供测试专用配置（弱密码、短超时、mock 外部服务）
- 测试数据库不挂载持久化卷（每次测试从干净的 schema 开始）

#### 11.3 运行方式

```bash
# 生产环境启动
docker compose up -d

# 查看服务状态
docker compose ps

# 查看日志
docker compose logs -f backend

# 后端测试（针对运行中的 dev 服务）
docker compose exec -T backend npm run test:e2e

# 前端 E2E — Playwright（如有前端，针对 dev 服务）
docker compose --profile e2e run --rm playwright-e2e

# 后端单元测试（独立测试容器）
docker compose --profile test up --abort-on-container-exit

# 数据清理
docker compose --profile test down -v
```

#### 11.4 Docker Compose 架构决策要点

| 决策点 | 强制要求 | 说明 |
|--------|---------|------|
| compose 文件 | `docker-compose.yml` + `docker-compose.test.yml` | 生产和测试分离 |
| 健康检查 | 每个服务必配 healthcheck | L6 依赖它判断就绪 |
| 环境变量 | 通过 .env / .env.test 注入 | 不硬编码敏感信息 |
| 网络隔离 | 生产/测试用独立 network | 环境间互不干扰 |
| 数据持久化 | named volume | 容器重建不丢数据 |
| 服务命名 | `${PROJECT_NAME}` 前缀 | 避免多项目端口/卷冲突 |
| 测试 profile | `profiles: [test]` | 生产启动不拉起测试容器 |
| E2E profile | `profiles: [e2e]`（如有前端） | Playwright 容器仅 E2E 时拉起 |
| 依赖等待 | `condition: service_healthy` | 等依赖就绪再启动本服务 |
| 前端 E2E | Playwright CLI（`profiles: [e2e]`） | 针对 docker compose 运行中的 dev 服务测试 |

#### 11.5 架构文档中的 Docker Compose 产出

架构文档 must 包含：
1. `.shadow/L1.5-architecture/BXX-{slug}/docker-compose.yml` — 生产配置
2. `.shadow/L1.5-architecture/BXX-{slug}/docker-compose.test.yml` — 测试配置
3. 在 architecture.md 的"技术栈"一节中记录 Docker Compose 架构决策（含 @intent）
4. 在 architecture.md 中描述服务拓扑图（服务间依赖关系）

L6 Deploy 直接引用这些 compose 文件执行部署验证，不再自行判断启动方式。

## 产出

**必须一次派发**：L1.5 agent 必须一次接收所有 slug（B01/B02/...），同时产出 per-slug 和 project-level 文件。禁止按 slug 分多次派发，否则后续派发会覆盖 project-level 文件（`event-contract.md`、`aggregate-landscape.md`）。

### 技术架构

`.shadow/L1.5-architecture/BXX-{slug}/architecture.md`

一份文档，包含：
- 质量属性场景（3-5 个）
- **安全设计（SDD）：威胁建模 + 认证授权 + 数据保护 + 安全基线**
- **性能设计（PDD）：性能基准 + 瓶颈分析 + 缓存策略 + 并发模型**
- 限界上下文 + 上下文关系图
- 技术栈决策
- 分层架构
- 规则传导矩阵
- **API 端点清单（前后端数据契约）**
- 文件清单（后端 + 前端）
- 质量要点
- **Docker Compose 部署架构（服务拓扑 + 配置决策）**

### Docker Compose 配置

- `.shadow/L1.5-architecture/BXX-{slug}/docker-compose.yml` — 生产环境（healthcheck、持久卷、restart 策略）
- `.shadow/L1.5-architecture/BXX-{slug}/docker-compose.test.yml` — 测试环境（test profile + e2e profile[Playwright]，独立 DB，无持久化）

### 事件契约（EDD 独立产出）

`.shadow/L1.5-architecture/event-contract.md`

一份文档，包含：
- **事件清单汇总表**（事件 ID、来源聚合、传递方式、订阅方）
- **每个事件的详细契约**（@flow、@rules、@intent、载荷、载荷约束、重试策略）
- **传递方式**（来自 L1 Research EDD 决策：进程内/跨上下文/跨进程/外部系统）

### 聚合全景

`.shadow/L1.5-architecture/aggregate-landscape.md`

一份文档，包含：
- **聚合清单（按业务线分组）**
- **聚合间关系图（ID 引用 + 事件驱动）**
- **聚合设计原则**
- **一致性边界定义（强一致 vs 最终一致）**
- **跨业务线聚合关系**

## 约束

- 限界上下文必须与 research.md 一致
- 每条 spec 规则必须在档案中有文件映射
- 每条 spec 规则必须有至少一个 API 端点入口
- 技术栈决策必须记录原因
- **每个 API 端点必须标注流程节点（@flow）和规则（@rules）**
- **API 端点清单是 Harness 计划后端/前端指令的共同引用源**
- **聚合全景必须与 L1 research.md 的限界上下文一致**
- **聚合全景必须与 L1 business-landscape.md 的业务线清单一致**
- **Harness 计划的聚合设计必须与聚合全景一致**
- **跨聚合关系必须标注类型（ID 引用 / 事件驱动 / 共享内核）**
- **一致性边界必须明确标注（强一致 / 最终一致）**
- **事件契约必须独立产出**（event-contract.md），不隐式散射
- **Docker Compose 强制使用**：生产环境（docker-compose.yml）和测试环境（docker-compose.test.yml）都必须使用 Docker Compose 封装
- **docker-compose.yml 必须包含**：healthcheck、named volume、service network、restart 策略
- **docker-compose.test.yml 必须使用**：`profiles: [test]`、独立 DB、无持久卷、`abort-on-container-exit`
- **如果项目包含前端，docker-compose.test.yml 必须包含 Playwright E2E 服务**（`profiles: [e2e]`），针对 docker compose 运行中的 dev 服务测试
- **每个事件契约必须包含**：@flow、@rules、@intent、载荷、载荷约束、传递方式、订阅方
- **安全设计（SDD）必须独立产出**：威胁建模 + 认证授权 + 数据保护 + 安全基线
- **性能设计（PDD）必须独立产出**：性能基准 + 瓶颈分析 + 缓存策略 + 并发模型
- **每个技术选型必须标注 @intent**（为什么选这个而不是那个）

## 简单项目示例：自动驾驶数据平台

### 聚合全景（aggregate-landscape.md 关键段落）

```markdown
| 聚合名 | 聚合根 | 包含 | 不包含 | 一致性 |
|--------|--------|------|--------|--------|
| Collection | Collection（根） | Collection（根）, Waypoint[]（值对象） | Annotation（通过 collection_id 引用） | 创建/打点/结束/上传单事务 |
| Annotation | Annotation（根） | Annotation（根）, AnnotationValue[]（值对象） | Collection（通过 task_id 引用）, Review（独立聚合） | 创建/提交单事务；质检结果独立事务 |
| Review | Review（根） | Review（根） | Annotation（通过 annotation_id 引用） | 通过/驳回单事务 |
| Simulation | Simulation（根） | Simulation（根）, Issue[]（实体） | Collection/Annotation（通过 scene_id 引用） | 播放/标记/导出单事务 |
```

### API 端点清单（architecture.md 关键段落）

| 端点 | 方法 | 路径 | 规则 | 节点 |
|------|------|------|------|------|
| 创建采集任务 | POST | /api/collections | collection-R01 | B01-N01 |
| 开始采集 | PATCH | /api/collections/:id/start | collection-R02 | B01-N02 |
| 记录打点 | POST | /api/collections/:id/waypoints | collection-R03 | B01-N03 |
| 结束采集 | PATCH | /api/collections/:id/finish | collection-R04 | B01-N04 |
| 上传数据 | POST | /api/collections/:id/upload | collection-R05 | B01-N05 |
| 打开标注任务 | GET | /api/tasks/:taskId | annotation-R01 | B02-N06 |
| 创建标注 | POST | /api/annotations | annotation-R02 | B02-N07 |
| 提交质检 | POST | /api/annotations/:id/submit | annotation-R03 | B02-N08 |
| 质检通过 | POST | /api/reviews/:id/approve | annotation-R04 | B02-N09 |
| 质检驳回 | POST | /api/reviews/:id/reject | annotation-R05 | B02-N10 |
| 修改返工 | PUT | /api/annotations/:id | annotation-R06 | B02-N11 |
| 选择场景 | GET | /api/simulations/scenes | simulation-R01 | B03-N12 |
| 播放回放 | POST | /api/simulations/:id/play | simulation-R02 | B03-N13 |
| 标记问题 | POST | /api/simulations/:id/issues | simulation-R03 | B03-N14 |
| 导出报告 | POST | /api/simulations/:id/export | simulation-R04 | B03-N15 |

### 技术栈

| 层 | 技术 | @intent |
|----|------|---------|
| 后端 | Python FastAPI + SQLAlchemy + PostgreSQL | 多用户+事务性数据，需关系型 DB |
| 前端 | React + Ant Design + Zustand | 标注编辑器需 Canvas/WebGL |
| 对象存储 | MinIO | 采集视频+点云数据存储 |
| 消息队列 | Redis Streams | 跨上下文事件（DataAvailable） |
| 测试 | pytest + vitest + Playwright | 全栈覆盖 |

### 文件清单

| Batch | 文件 | 聚合/类型 | 规则 |
|-------|------|----------|------|
| Batch 1 | backend/domain/aggregates/collection.py | Collection 聚合根 | collection-R01~R05 |
| Batch 1 | backend/domain/aggregates/annotation.py | Annotation 聚合根 | annotation-R01~R06 |
| Batch 1 | backend/domain/aggregates/simulation.py | Simulation 聚合根 | simulation-R01~R04 |
| Batch 1 | backend/domain/events.py | 领域事件 | all cross-context |
| Batch 2 | backend/domain/services/collection_service.py | 采集领域服务 | collection-R01~R05 |
| Batch 2 | backend/domain/services/annotation_service.py | 标注领域服务 | annotation-R01~R06 |
| Batch 3 | backend/app/api/routes/collections.py | 采集 API | collection-R01~R05 |
| Batch 3 | backend/app/api/routes/annotations.py | 标注 API | annotation-R01~R06 |
| Batch 3 | backend/app/api/routes/simulations.py | 仿真 API | simulation-R01~R04 |
| Batch 4 | backend/infrastructure/repositories/ | 仓储实现 | all |
| Batch 5 | frontend/src/api/client.ts | API 客户端 | all |
| Batch 5 | frontend/src/stores/ | Zustand Store | all |
| Batch 6 | frontend/src/pages/CollectionMapPage.tsx | 采集地图页 | collection-R01~R05 |
| Batch 6 | frontend/src/pages/AnnotatorPage.tsx | 标注编辑器 | annotation-R01~R06 |
| Batch 6 | frontend/src/pages/SimulationPlayer.tsx | 仿真播放器 | simulation-R01~R04 |
| Batch 7 | frontend/src/pages/ReviewPage.tsx | 质检页面 | annotation-R04~R05 |
| Batch 7 | frontend/src/pages/SimulationReportPage.tsx | 仿真报告页 | simulation-R04 |
| Batch 8 | e2e/collection-workflow.spec.ts | 采集 E2E | collection P0 UAT |
| Batch 8 | e2e/annotation-workflow.spec.ts | 标注 E2E | annotation P0 UAT |

## L1.5 门禁检查

### 层内自检（本 agent 完成后）

执行下方的 L1.5 门禁检查。检查 architecture.md 完整性、Docker Compose 合规性、API 端点覆盖和聚合全景一致性。

### 门禁检查项

1. architecture.md 存在
2. 所有 spec 规则在结构中有文件映射
3. docker-compose.yml 存在（生产环境配置，含 healthcheck/network/volume）
4. docker-compose.test.yml 存在（测试环境配置，含 profiles/独立DB）

### Docker Compose 专项检查

| 检查项 | 要求 |
|--------|------|
| docker-compose.yml | 存在 |
| docker-compose.test.yml | 存在 |
| healthcheck | 每个服务必有 |
| depends_on.condition | service_healthy（非 started） |
| named volume | 持久化服务有 volume |
| 独立 network | 生产/测试各有独立 network |
| test profile | 测试服务使用 `profiles: [test]` |
| 无硬编码 secret | 敏感信息通过 .env 注入 |
| restart policy | 生产服务必配 restart: unless-stopped |
| container naming | 带 `${PROJECT_NAME}` 前缀 |

### 门禁脚本

快速检查：`bash skills/shadow-l1p5-architecture/scripts/gate-check-l1p5.sh <slug>`
语义检查：`bash skills/shadow-l1p5-architecture/scripts/check-semantic-gate-l1p5.sh <slug>`

通过后创建 `{迭代门禁目录}/l1p5.{slug}.passed`（门禁目录为 `.shadow/iterations/{当前迭代}/gate/`）。
