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

**API 端点清单是前后端之间的架构边界**——定义数据契约，Harness 计划的后端和前端指令都引用此清单。

**事件契约是 EDD 的独立产出物**——定义每个领域事件的载荷结构、传递方式、订阅关系、重试策略。

**安全设计（SDD）独立引导**——威胁建模、认证授权方案、数据保护策略、安全基线。

**性能设计（PDD）独立引导**——性能基准、瓶颈分析、缓存策略、并发模型。

**聚合全景是 L5 Harness 计划的前置输入**——Harness 计划的聚合设计必须与聚合全景一致。

**L1 Wire 是前端架构契约源**——如果存在 `wire.svg`，必须从 SVG 的 `data-page/data-route/data-action/data-target/data-state` 和 metadata/desc 中抽取页面、组件、路由、状态管理和 API 触发边界。

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

每个场景写成：**刺激源 → 刺激 → 环境 → 响应 → 响应度量**。3-5 个关键场景就够。

### 2. 安全设计（SDD — Security-Driven Design）

安全有独立的威胁建模和设计输出，不是 ADD 的附属品。

核心步骤：
1. **威胁建模**：用 STRIDE 分析主要威胁（Spoofing/Tampering/Repudiation/Info Disclosure/DoS/Elevation of Privilege）
2. **认证授权方案**：JWT/Session/OAuth2 认证 + RBAC/ABAC 授权 + 数据隔离
3. **数据保护策略**：传输加密（TLS 1.2+）、存储加密、密钥管理、日志脱敏
4. **安全基线**：API 认证、输入校验、输出编码、限流、CORS、依赖扫描

安全设计和性能设计详细指南见 references/security-performance-guide.md

### 3. 性能设计（PDD — Performance-Driven Design）

性能有独立的基准和优化策略，不是 ADD 的附属品。

核心步骤：
1. **性能基准**：定义 API 响应时间（P50/P99）、首屏加载、并发用户数、DB 查询时间
2. **瓶颈分析**：预估批量操作、大文件处理、并发写入等瓶颈及应对
3. **缓存策略**：浏览器/CDN/应用层/DB 四层缓存及失效策略
4. **并发模型**：Web 服务器异步 + 连接池 + EventBus 异步 + 后台任务队列

安全设计和性能设计详细指南见 references/security-performance-guide.md

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

如果 `.shadow/L1-business/wire.svg` 存在，必须新增 `UI/UX 实现契约` 章节，包含：

- **页面/视图清单**：每个 `data-page` 映射到页面文件、路由、主要组件、状态、规则、流程节点
- **交互清单**：每个 `data-action` 映射到 API/路由/状态影响、规则、节点、Harness 文件
- **状态清单**：每个 `data-state` 映射到触发条件、UI 反馈、测试要求

传导要求：
- 每个 `data-page` 必须映射到页面文件、路由和 Harness 计划
- 每个 `data-action` 必须映射到 API 端点、路由跳转、状态管理或本地 store action
- 每个 `data-state` 必须映射到前端 state 字段、渲染分支和测试断言
- 每个 `data-target` 指向 API 时，必须在 API 端点清单中有对应契约
- 若 SVG 有交互但 L1.5 没有对应设计，L1.5 不得通过

### 6. 规则传导矩阵

一条条过 spec 规则，确定：
- 每条规则在哪个层/模块实现
- 对应的文件类型（aggregate/value-object/service/repository + 前端 page/component/store）
- 用户交互类规则必须同时映射到前端组件
- L1 Wire 中每个 `data-action` 必须映射到前端和 API 端点
- 每条规则必须映射到至少一个 API 端点

### 7. API 端点清单（前后端数据契约）

**这是前后端之间的架构边界**。每个端点定义：
- 触发的流程节点（BXX-NYY 编号）、覆盖的 spec 规则（RXX 编号）
- 请求结构（字段、类型、必填性）、响应结构、错误码、权限要求

产出 **端点汇总表** + **端点详细契约**（每个端点含 @flow、@rules、@auth、@request、@response、@errors）。

API 契约设计要点：RESTful 命名、流程节点映射、规则覆盖、错误码统一、前后端共享。

API 端点详细契约模板和示例见 references/api-contract-guide.md

### 8. 事件契约（EDD 独立产出）

**产出**：`.shadow/L1.5-architecture/event-contract.md`

EDD 事件驱动设计的独立产出物，L5 Harness 和 L5 Impl 引用此契约。

核心要素：
- **事件清单汇总表**：事件 ID、事件名、来源聚合、传递方式、订阅方、流程节点
- **每个事件的详细契约**：@flow、@rules、@intent、来源聚合、传递方式、订阅方、重试策略、载荷、载荷约束
- **传递方式来自 L1 Research EDD 决策**：进程内/跨上下文/跨进程/外部系统

事件契约详细格式和示例见 references/event-contract-guide.md

### 9. 文件清单 + 质量规划

在同一个文档里：
- 列出按 DDD 战术模式组织的**后端**文件清单
- 如果项目包含前端，列出前端文件清单（pages/components/stores/api/routes）
- 列出质量要点（错误处理/输入校验/日志/安全/性能/启动）

前端文件清单每个页面/组件注明：对应的 L1 Wire 区域、覆盖的 spec 规则、调用的 API 端点。

### 10. 聚合全景

**产出**：`.shadow/L1.5-architecture/aggregate-landscape.md`

架构师掌握全局的入口，Harness 计划的聚合设计必须与此清单一致。

核心要素：
- **聚合清单**（按业务线分组）：聚合根、包含实体/值对象、一致性边界、发布事件
- **聚合间关系图**：ID 引用 + 事件驱动
- **聚合设计原则**：聚合根唯一入口、边界要小、跨聚合引用用 ID、单聚合事务、强一致在聚合内、事件是跨聚合协调工具
- **一致性边界**：强一致（单聚合事务）vs 最终一致（跨聚合事件驱动）
- **跨业务线聚合关系**

聚合设计详细原则见 references/aggregate-guide.md

### 11. Docker Compose 部署架构

**约束：生产环境和测试环境都必须使用 Docker Compose 封装。**

核心要求：
- `docker-compose.yml`：生产配置（healthcheck、持久卷、restart 策略、service network）
- `docker-compose.test.yml`：测试配置（test profile、独立 DB、无持久卷）
- 如有前端，测试配置必须包含 Playwright E2E 服务（`profiles: [e2e]`）
- 每个服务必有 healthcheck，`depends_on` 必须用 `condition: service_healthy`
- 敏感信息通过 `.env` 注入，命名带 `${PROJECT_NAME}` 前缀

Docker Compose 详细配置见 references/docker-compose-guide.md

## 产出

**必须一次派发**：L1.5 agent 必须一次接收所有 slug（B01/B02/...），同时产出 per-slug 和 project-level 文件。禁止按 slug 分多次派发，否则后续派发会覆盖 project-level 文件（`event-contract.md`、`aggregate-landscape.md`）。

### 技术架构

`.shadow/L1.5-architecture/BXX-{slug}/architecture.md`

一份文档，包含：
- 质量属性场景（3-5 个）
- 安全设计（SDD）：威胁建模 + 认证授权 + 数据保护 + 安全基线
- 性能设计（PDD）：性能基准 + 瓶颈分析 + 缓存策略 + 并发模型
- 限界上下文 + 上下文关系图
- 技术栈决策
- 分层架构
- 规则传导矩阵
- API 端点清单（前后端数据契约）
- 文件清单（后端 + 前端）
- 质量要点
- Docker Compose 部署架构（服务拓扑 + 配置决策）

### Docker Compose 配置

- `.shadow/L1.5-architecture/BXX-{slug}/docker-compose.yml` — 生产环境
- `.shadow/L1.5-architecture/BXX-{slug}/docker-compose.test.yml` — 测试环境

### 事件契约（EDD 独立产出）

`.shadow/L1.5-architecture/event-contract.md`

- 事件清单汇总表
- 每个事件的详细契约
- 传递方式（来自 L1 Research EDD 决策）

### 聚合全景

`.shadow/L1.5-architecture/aggregate-landscape.md`

- 聚合清单（按业务线分组）
- 聚合间关系图（ID 引用 + 事件驱动）
- 聚合设计原则
- 一致性边界定义（强一致 vs 最终一致）
- 跨业务线聚合关系

路径规范见 references/path-standards.md

## 约束

- 限界上下文必须与 research.md 一致
- 每条 spec 规则必须在档案中有文件映射
- 每条 spec 规则必须有至少一个 API 端点入口
- 技术栈决策必须记录原因
- 每个 API 端点必须标注流程节点（@flow）和规则（@rules）
- API 端点清单是 Harness 计划后端/前端指令的共同引用源
- 聚合全景必须与 L1 research.md 的限界上下文一致
- 聚合全景必须与 L1 business-landscape.md 的业务线清单一致
- Harness 计划的聚合设计必须与聚合全景一致
- 跨聚合关系必须标注类型（ID 引用 / 事件驱动 / 共享内核）
- 一致性边界必须明确标注（强一致 / 最终一致）
- 事件契约必须独立产出（event-contract.md），不隐式散射
- Docker Compose 强制使用：生产和测试环境都必须 Docker Compose 封装
- docker-compose.yml 必须包含：healthcheck、named volume、service network、restart 策略
- docker-compose.test.yml 必须使用：`profiles: [test]`、独立 DB、无持久卷
- 如有前端，docker-compose.test.yml 必须包含 Playwright E2E（`profiles: [e2e]`）
- 每个事件契约必须包含：@flow、@rules、@intent、载荷、载荷约束、传递方式、订阅方
- 安全设计（SDD）必须独立产出：威胁建模 + 认证授权 + 数据保护 + 安全基线
- 性能设计（PDD）必须独立产出：性能基准 + 瓶颈分析 + 缓存策略 + 并发模型
- 每个技术选型必须标注 @intent

## 简单项目示例：自动驾驶数据平台

### 聚合全景（aggregate-landscape.md 关键段落）

| 聚合名 | 聚合根 | 包含 | 不包含 | 一致性 |
|--------|--------|------|--------|--------|
| Collection | Collection（根） | Waypoint[]（值对象） | Annotation（通过 collection_id 引用） | 创建/打点/结束/上传单事务 |
| Annotation | Annotation（根） | AnnotationValue[]（值对象） | Collection（通过 task_id 引用）, Review（独立聚合） | 创建/提交单事务 |
| Review | Review（根） | — | Annotation（通过 annotation_id 引用） | 通过/驳回单事务 |
| Simulation | Simulation（根） | Issue[]（实体） | Collection/Annotation（通过 scene_id 引用） | 播放/标记/导出单事务 |

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

语义 Gate 报告模板见 references/l1p5-semantic-gate-report-template.md

通过后创建 `{迭代门禁目录}/l1p5.{slug}.passed`（门禁目录为 `.shadow/iterations/{当前迭代}/gate/`）。
