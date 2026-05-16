# {slug} 架构总览

> 对应 L1 业务线: {biz_dir}
> 生成时间: {timestamp}

---

## 1. L1 Rule Transmission Matrix

| 规则 ID | 规则摘要 | 架构责任 | 承接文件类型 | 下游传导 |
|---------|---------|---------|-------------|---------|
| {slug}-R01 | [一句话描述 spec 规则] | [哪一层负责实现：Domain/Application/Infrastructure/Presentation] | [文件类型：.py/.ts/.vue 等] | harness-plan.md Batch N |
| {slug}-R02 | ... | ... | ... | ... |

_每条 spec 规则必须在此矩阵中有一行。规则 ID 来自 spec.md，格式为 `{slug}-R01`。_

## 2. 项目类型分析

### 2.1 能力特征矩阵

| 能力 | 类型 | 说明 |
|------|------|------|
| HTTP API | ✅/❌ | RESTful / GraphQL / gRPC |
| UI | ✅/❌ | Web / Mobile / Desktop |
| 数据库 | ✅/❌ | SQL / NoSQL |
| 外部服务 | ✅/❌ | 第三方集成 |
| 鉴权 | ✅/❌ | JWT / OAuth / Session |
| 异步任务 | ✅/❌ | Queue / Webhook |

### 2.2 架构风格

- [ ] 单体架构
- [ ] 微服务架构
- [ ] 分层架构
- [ ] 事件驱动架构

## 3. 技术栈决策

### 3.1 前端

- **框架**: React / Vue / Angular / Svelte / 其他
- **状态管理**: Redux / Vuex / Context / 其他
- **UI 库**: Tailwind / Material UI / Ant Design / 其他
- **构建工具**: Vite / Webpack / Rollup

### 3.2 后端

- **语言**: Python / Node.js / Go / Java / Rust / 其他
- **框架**: FastAPI / Express / Gin / Spring / 其他
- **API 风格**: REST / GraphQL / gRPC

### 3.3 数据层

- **数据库**: PostgreSQL / MySQL / MongoDB / Redis / 其他
- **ORM**: SQLAlchemy / Prisma / GORM / 其他
- **缓存**: Redis / Memcached / 其他

### 3.4 基础设施

- **部署**: Docker / Kubernetes / Serverless
- **CI/CD**: GitHub Actions / GitLab CI / Jenkins
- **监控**: Prometheus / Grafana / ELK

## 4. 分层架构设计

```
┌─────────────────────────────────────┐
│  Presentation Layer (UI/API)        │
├─────────────────────────────────────┤
│  Application Layer (Use Cases)      │
├─────────────────────────────────────┤
│  Domain Layer (Business Logic)      │
├─────────────────────────────────────┤
│  Infrastructure Layer (DB/External) │
└─────────────────────────────────────┘
```

### 4.1 层间依赖方向

- Presentation → Application → Domain → Infrastructure
- 禁止反向依赖
- 依赖倒置：Domain 定义接口，Infrastructure 实现

### 4.2 各层职责

| 层级 | 职责 | 文件位置示例 |
|------|------|-------------|
| Presentation | UI 渲染、API 路由 | `src/routes/` |
| Application | 用例编排、DTO 转换 | `src/services/` |
| Domain | 业务规则、实体定义 | `src/domain/` |
| Infrastructure | 数据库、外部服务 | `src/repositories/` |

## 5. L1 交接吸收（架构）

- 模块边界承接：[L1 指定的模块边界如何落成架构层模块]
- 文件职责承接：[L1 指定的文件职责如何落到目录/文件类型]
- 接口/集成边界承接：[L1 指定的接口、事件、异步边界如何落成技术方案]
- 外部依赖与约束承接：[L1 指定的第三方依赖、鉴权、限流、部署约束如何承接]

## 6. UI/UX 实现契约（来自 L1 wire.svg）

> 如果项目无前端（纯后端/API），本节标记为"不适用"并跳过。

### 6.1 页面/视图清单

| SVG ID | 页面 | 路由/入口 | 主要组件 | 状态 | 规则 | 流程节点 |
|--------|------|-----------|----------|------|------|----------|
| page-{slug} | [页面名称，如"看板视图"] | [/route/path] | [核心组件名，如 KanbanBoard] | normal / loading / empty / error | {slug}-R01, {slug}-R02 | BXX-NYY |
| ... | ... | ... | ... | ... | ... | ... |

### 6.2 交互清单

| SVG ID | data-action | data-target | UI 语义 | API/路由/状态影响 | 规则 | 节点 |
|--------|-------------|-------------|---------|------------------|------|------|
| action-{verb}-{noun} | [如 drag-card / click-submit / filter-status] | [如 column-in-progress / dialog-confirm / api.POST./api/cards] | [用户操作语义] | [触发哪个 API 调用或状态变更] | {slug}-RXX | BXX-NYY |
| ... | ... | ... | ... | ... | ... | ... |

### 6.3 状态清单

| 页面/组件 | data-state | 触发条件 | UI 反馈 | 测试要求 |
|-----------|------------|----------|---------|----------|
| [页面或组件名] | loading | [API 请求发出] | [骨架屏/spinner] | [断言 loading 元素可见] |
| [页面或组件名] | empty | [查询返回空列表] | [空状态插图+引导文案] | [断言 empty 元素可见] |
| [页面或组件名] | error | [API 返回错误] | [错误信息+重试按钮] | [断言 error 元素和重试按钮可见] |

## 7. L1 溯源

- **L1 Spec**: `.shadow/L1-business/{biz_dir}/spec.md`
- **L1 Flow**: `.shadow/L1-business/project.flow.mermaid`
- **L1 Wire**: `.shadow/L1-business/{biz_dir}/wire.svg`

## 8. 文档导航

- **下游 L5 Plan**: `shadow-l5-plan` — 生成 Harness 计划
- **（测试断言内联在 Harness 计划中，由 L5 Plan 产出）**
- **下游 L5**: `shadow-l5-impl` — TDD 实现

## 9. 关键决策记录

| 决策项 | 选项 A | 选项 B | 选择 | 理由 |
|--------|--------|--------|------|------|
| TODO | TODO | TODO | TODO | TODO |

## 10. 风险与限制

- TODO

---

**自检清单**:
- [ ] 总行数 > 40
- [ ] L1 Rule Transmission Matrix 完整
- [ ] 所有 L1 规则 ID 已映射
- [ ] `给 L1.5 的输入` 已逐项吸收
- [ ] L1 溯源章节正确
- [ ] 技术栈决策明确
- [ ] 分层架构有依赖方向标注
- [ ] UI/UX 实现契约已吸收 wire.svg 的页面、交互、状态和实现传导目标
