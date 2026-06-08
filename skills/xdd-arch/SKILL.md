---
name: xdd-arch
alias: xdd·L1.5-Arch
methodology: ADD — Attribute-Driven Design + SDD — Security-Driven Design + PDD — Performance-Driven Design
description: |
  xdd L1.5 架构设计 + L1.5 门禁检查 (ADD 思维: 质量属性 + SDD 安全 + PDD 性能 驱动决策)。
  产出 architecture.md (质量属性 + 限界上下文 + 上下文映射 + 技术栈 + 分层架构 + 规则传导矩阵 + API 端点清单 + 安全设计 + 性能设计 + 文件清单 + 质量规划)
  + aggregate-landscape.md (聚合全景)
  + event-contract.md (EDD 独立契约)。
  xdd 6 Phase 阶段 2 之一: Arch 在 BDD 之前, Plan 之前.
  scale ≥ M 时强制, strict-mode=true 时全规模强制.
  触发: 架构、ADD、质量属性、技术栈、分层、聚合、安全、SDD、性能、PDD、事件契约、event-contract、L1.5 门禁、PoC、技术验证、架构审计。
version: "6.0.0"
---

# xdd·ADD+SDD+PDD — 架构驱动 + 安全设计 + 性能设计

## 角色

ADD+SDD+PDD 核心理念：**质量属性（性能、可用性、安全性、可修改性）+ 安全策略 + 性能基准驱动架构决策**。

消费 L1 产出（research/spec/flow/wire/business-landscape/intent），产出：

- `architecture.md`：技术架构决策 + API 契约 + 安全设计 + 性能设计 + 文件清单 + 质量规划
- `aggregate-landscape.md`：聚合全景
- `event-contract.md`：EDD 事件契约

**API 端点清单是前后端之间的架构边界**。
**事件契约是 EDD 的独立产出物**。
**聚合全景是 L5 Harness 计划的前置输入**。
**安全设计（SDD）独立引导**。
**性能设计（PDD）独立引导**。

## ADD 思维链

```
功能需求 → 质量属性场景 → 架构模式 → 战术策略 → 架构草图
                     ↑
               约束和技术栈
```

## 三面手（设计 + 实现 + 跟踪）

| 面 | 任务 | 产出 |
|---|------|------|
| 设计 | 质量属性 / 安全 / 性能 / 限界上下文 / 技术栈 / 分层 / 规则传导 / API / 事件 / 文件清单 / Docker Compose | architecture.md + aggregate-landscape.md + event-contract.md |
| 实现 | **技术验证（Tech PoC）**：高风险组件写最小可运行代码验证能跑 | `poc/{component}.md` 报告 |
| 跟踪 | **架构审计（Architecture Audit）**：L5-impl 完成后反向验证代码是否符合 L1.5 设计 | `arch-audit-report.md` |

**闭环**：
- PoC 发现的限制/坑 → 触发 L3 失败模式发散
- 架构审计发现违规 → 回 L5-impl 修复
- 严重违规 → 阻断 L6 漫游

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

**Gherkin 格式示例**：

```gherkin
  @quality-attribute @performance
  Scenario: 100 并发用户同时提交标注
    Given 100 个标注员同时在线
      And 每人有一个 IN_PROGRESS 状态的标注
    When 100 个标注员同时点击"提交"
    Then 95% 的提交在 500ms 内返回成功
      And 无数据丢失或冲突
      And 5% 超时的提交返回可重试错误码
```

### 2. 安全设计（SDD）

核心步骤：
1. **威胁建模**：用 STRIDE 分析主要威胁
2. **认证授权方案**：JWT/Session/OAuth2 认证 + RBAC/ABAC 授权 + 数据隔离
3. **数据保护策略**：传输加密（TLS 1.2+）、存储加密、密钥管理、日志脱敏
4. **安全基线**：API 认证、输入校验、输出编码、限流、CORS、依赖扫描

### 3. 性能设计（PDD）

核心步骤：
1. **性能基准**：API 响应时间（P50/P99）、首屏加载、并发用户数、DB 查询时间
2. **瓶颈分析**：预估批量操作、大文件处理、并发写入等瓶颈
3. **缓存策略**：浏览器/CDN/应用层/DB 四层缓存及失效策略
4. **并发模型**：Web 服务器异步 + 连接池 + EventBus 异步 + 后台任务队列

### 4. 限界上下文（从 research.md 传导）

- 列出每个上下文的职责
- 上下文间的关系（上下游/防腐层/共享内核）

### 5. 技术栈 + 分层

- 选型各层用什么（框架/DB/消息队列...）
- 每安排一个技术选型，记录原因（背景→选项→选了什么→为什么）
- 分层：Presentation（UI + API）→ Application → Domain → Infrastructure

### 6. 规则传导矩阵

一条条过 spec 规则，确定：

- 每条规则在哪个层/模块实现
- 对应的文件类型
- 用户交互类规则必须同时映射到前端组件

### 7. API 端点清单（前后端数据契约）

每个端点定义：
- 触发的流程节点（BXX-NYY 编号）
- 覆盖的 spec 规则（RXX 编号）
- 请求结构（字段、类型、必填性）
- 响应结构
- 错误码
- 权限要求

**端点汇总表** + **端点详细契约**（每个端点含 @flow / @rules / @auth / @request / @response / @errors）。

### 8. 事件契约（EDD 独立产出）

**产出**：`.xdd/L1.5-architecture/event-contract.md`

核心要素：
- **事件清单汇总表**：事件 ID、事件名、来源聚合、传递方式、订阅方、流程节点
- **每个事件的详细契约**：@flow / @rules / @intent / 来源聚合 / 传递方式 / 订阅方 / 重试策略 / 载荷 / 载荷约束
- **传递方式来自 L1 Research EDD 决策**：进程内/跨上下文/跨进程/外部系统

### 9. 文件清单 + 质量规划

在同一个文档里：
- 列出按 DDD 战术模式组织的**后端**文件清单
- 列出前端文件清单（pages/components/stores/api/routes）
- 列出质量要点（错误处理/输入校验/日志/安全/性能/启动）

### 10. 聚合全景

**产出**：`.xdd/L1.5-architecture/aggregate-landscape.md`

核心要素：
- **聚合清单**（按业务线分组）：聚合根、包含实体/值对象、一致性边界、发布事件
- **聚合间关系图**：ID 引用 + 事件驱动
- **聚合设计原则**：聚合根唯一入口、边界要小、跨聚合引用用 ID
- **一致性边界**：强一致（单聚合事务）vs 最终一致（跨聚合事件驱动）
- **跨业务线聚合关系**

### 11. Docker Compose 部署架构

**约束：生产环境和测试环境都必须使用 Docker Compose 封装。**

核心要求：
- `docker-compose.yml`：生产配置（healthcheck、持久卷、restart 策略、service network）
- `docker-compose.test.yml`：测试配置（test profile、独立 DB、无持久卷）
- 每个服务必有 healthcheck，`depends_on` 必须用 `condition: service_healthy`
- 敏感信息通过 `.env` 注入

## 产出

> **生命周期角色**：`design_baseline` 设计基线。`architecture.md` / `event-contract.md` / `aggregate-landscape.md` / `docker-compose.yml` / `docker-compose.test.yml` 5 件套均跨迭代复用,改后必触发 L3 / L5 / L6 重跑。

**必须一次派发**：L1.5 agent 必须一次接收所有 slug（B01/B02/...），同时产出 per-slug 和 project-level 文件。

### 技术架构

`.xdd/L1.5-architecture/BXX-{slug}/architecture.md`

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
- Docker Compose 部署架构

### 事件契约（EDD 独立产出）

`.xdd/L1.5-architecture/event-contract.md`

- 事件清单汇总表
- 每个事件的详细契约
- 传递方式（来自 L1 Research EDD 决策）

### 聚合全景

`.xdd/L1.5-architecture/aggregate-landscape.md`

- 聚合清单（按业务线分组）
- 聚合间关系图（ID 引用 + 事件驱动）
- 聚合设计原则
- 一致性边界定义（强一致 vs 最终一致）
- 跨业务线聚合关系

## 约束

- 限界上下文必须与 research.md 一致
- 每条 spec 规则必须在档案中有文件映射
- 每条 spec 规则必须有至少一个 API 端点入口
- 技术栈决策必须记录原因
- 每个 API 端点必须标注流程节点（@flow）和规则（@rules）
- API 端点清单是 Harness 计划后端/前端指令的共同引用源
- 聚合全景必须与 L1 research.md 的限界上下文一致
- 聚合全景必须与 L1 business-landscape.md 的业务线清单一致
- 跨聚合关系必须标注类型（ID 引用 / 事件驱动 / 共享内核）
- 一致性边界必须明确标注（强一致 / 最终一致）
- 事件契约必须独立产出（event-contract.md），不隐式散射
- Docker Compose 强制使用：生产和测试环境都必须 Docker Compose 封装
- 安全设计（SDD）必须独立产出：威胁建模 + 认证授权 + 数据保护 + 安全基线
- 性能设计（PDD）必须独立产出：性能基准 + 瓶颈分析 + 缓存策略 + 并发模型
- 每个技术选型必须标注 @intent

## L1.5 门禁检查

### 门禁检查项

1. architecture.md 存在
2. 所有 spec 规则在结构中有文件映射
3. docker-compose.yml 存在（生产环境配置）
4. docker-compose.test.yml 存在（测试环境配置）

### Docker Compose 专项检查

| 检查项 | 要求 |
|--------|------|
| docker-compose.yml | 存在 |
| docker-compose.test.yml | 存在 |
| healthcheck | 每个服务必有 |
| depends_on.condition | service_healthy |
| named volume | 持久化服务有 volume |
| 独立 network | 生产/测试各有独立 network |
| test profile | 测试服务使用 `profiles: [test]` |
| 无硬编码 secret | 敏感信息通过 .env 注入 |
| restart policy | 生产服务必配 restart: unless-stopped |
| container naming | 带 `${PROJECT_NAME}` 前缀 |
