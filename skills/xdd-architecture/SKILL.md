---
name: xdd-architecture
description: |
  xdd 设计层 —— 结构锚。把业务规则（RXX）落到技术架构：质量属性驱动决策 + 安全 + 性能 + 运维视图 + API 端点契约 + 事件契约 + 聚合全景 + 流程图。
  四支柱：ADD（质量属性）+ SDD（安全）+ PDD（性能）+ ODD（运维视图 启动/关闭/状态机/排障）。
  吸收旧 xdd-arch + xdd-flow（流程图 colocation 到同业务线目录）。
  产出 .xdd/design/architecture/{bxx-slug}/architecture.md + flow.mermaid + docker-compose*.yml，全局 aggregate-landscape.md + event-contract.md。
  触发：架构、architecture、ADD、质量属性、技术栈、分层、API 端点、事件契约、event-contract、聚合、安全、SDD、性能、PDD、运维、ODD、流程图、flow、启动序列、关闭序列、状态机、排障、PoC、模块化、基础建设、base 层、foundation、共享内核、shared kernel、通用能力下沉、module-landscape。
---

# xdd-architecture — 结构锚

## 我锚定什么 / 上游 / 下游

**我锚定的是「系统怎么实现」** —— 把 spec 的业务规则映射到层/模块/API/事件/数据。API 端点清单是前后端契约，事件契约是服务间契约。这些是 plan 写 task、code 写实现的直接依据。

| | |
|---|---|
| **上游** | `xdd-brainstorm`(design.md) + `xdd-spec`(RXX 规则) |
| **我产出** | `{bxx-slug}/architecture.md` + `flow.mermaid` + `docker-compose*.yml`；全局 `aggregate-landscape.md` + `event-contract.md` |
| **下游消费者** | `xdd-plan`（端点/聚合/事件 → task）、`xdd-execute`（文件清单 + 端点契约）、`xdd-resilience`（ODD 失败模型是韧性种子） |
| **回溯锚** | 每个端点标 `@flow BXX-NYY` + `@rules RXX`，每个技术选型标 `@intent` |

## ADD 思维链

```
功能需求(RXX) → 质量属性场景 → 选架构模式 → 战术 → 架构草图
                     ↑              ↑
              约束 + 技术栈    references/architecture-patterns.md
```

**「选架构模式」这一步不是走形式** —— 查 `references/architecture-patterns.md` 的决策矩阵,按质量属性场景选模式,把选择写进技术栈决策并标 `@intent`。**禁止默认套 4 层分层**:4 层分层只是模式之一,不是默认答案。多模式组合是常态(如「分层单体 + 事件总线做异步」)。

## 三面手

| 面 | 任务 | 产出 |
|---|------|------|
| 设计 | 质量属性/安全/性能/限界上下文/技术栈/分层/规则传导/API/事件/文件清单/Docker | architecture.md + aggregate-landscape.md + event-contract.md + flow.mermaid |
| 实现 | **Tech PoC**：高风险组件写最小可运行代码验证能跑 | `poc/{component}.md` |
| 跟踪 | **架构审计**：execute 完成后反向验证代码符合设计 | `arch-audit-report.md` |

## 怎么做

### 1. 质量属性场景（ADD）

3-5 个关键场景，每个写：刺激源 → 刺激 → 环境 → 响应 → 响应度量。

| 属性 | 典型问题 |
|------|---------|
| 性能 | 95% 请求在多少 ms 内？ |
| 可用性 | 能否接受宕机？SLA？ |
| 安全性 | 谁可访问？防什么攻击？ |
| 可修改性 | 规则变更要改多少代码？ |

### 2. 安全设计（SDD）

1. **威胁建模**：STRIDE（Spoofing/Tampering/Repudiation/Info Disclosure/DoS/EoP）
2. **认证授权**：JWT/Session/OAuth2 + RBAC/ABAC + 数据隔离
3. **数据保护**：TLS 1.2+ 传输加密、存储加密、密钥管理、日志脱敏
4. **安全基线**：API 认证、输入校验、输出编码、限流、CORS、依赖扫描

### 3. 性能设计（PDD）

1. **性能基准**：P50/P99 响应、首屏、并发数、DB 查询时间
2. **瓶颈分析**：批量操作、大文件、并发写入
3. **缓存策略**：浏览器/CDN/应用/DB 四层 + 失效策略
4. **并发模型**：异步 + 连接池 + 事件总线 + 任务队列

### 4. 限界上下文

从 design.md 传导：每个上下文的职责 + 上下文关系（上下游 / 防腐层 / 共享内核）。

### 5. 技术栈 + 分层

每安排一个选型记原因(背景→选项→选了→为什么),标 `@intent`。

**结构由所选架构模式决定**,不是固定 4 层。先查 `references/architecture-patterns.md` 的决策矩阵按质量属性场景选模式,再定结构:
- 选了**分层模式** → `Presentation(UI+API) → Application → Domain → Infrastructure`(这是分层模式的标准结构,不是所有项目的默认)
- 选了**管道-过滤器** → Filter 链 + Pipe 数据契约
- 选了**事件总线/CQRS/事件溯源** → 读/写模型分离 + 事件存储 + 投影
- 选了**六边形** → 领域核心 + 端口(接口)+ 适配器(技术实现)
- 多模式组合常见,如实写出各模式的边界

### 6. 规则传导矩阵

一条条过 spec 的 RXX 规则，确定每条在哪个层/模块实现 + 对应文件类型。用户交互类规则必须同时映射到前端组件。

```markdown
| RXX | 后端层 | 文件 | 前端组件 |
|-----|--------|------|---------|
| R01 登录返回 JWT | Application | app/services/auth.py | pages/login.vue |
```

### 7. API 端点清单（前后端契约）—— 100% 完整

**不得省略端点**。这是前后端契约 + execute 覆盖率比照基准。每个端点定义：触发的流程节点（BXX-NYY）、覆盖规则（RXX）、请求结构、响应结构、错误码、权限。

汇总表（一行一个端点）：

```markdown
## API 端点清单
| 端点 | 方法 | BXX | RXX | 认证 | 限流 |
|------|------|-----|-----|------|------|
| `/api/v1/auth/login` | POST | B01 | R01 | - | 100/min |
| `/api/v1/urls` | POST | B02 | R05 | JWT | 200/min |
```

加端点详细契约（每个含 `@flow` / `@rules` / `@auth` / `@request` / `@response` / `@errors`）。

### 8. 事件契约（EDD，全局独立产出）

`.xdd/design/architecture/event-contract.md`：
- 事件清单汇总表（事件 ID、名、来源聚合、传递方式、订阅方、流程节点）
- 每个事件详细契约（载荷 + 约束 + 重试策略 + 传递方式）

### 9. 聚合全景（全局独立产出）

**聚合设计是 DDD 战术核心**。划分前必读 `references/ddd.md § 聚合划分决策法`（4 步法 + 「聚合尽量小」+ 跨聚合只引 ID）。核心原则:聚合根保护业务不变量;聚合尽量小;跨聚合只用 ID 引用 + 领域事件最终一致。

`.xdd/design/architecture/aggregate-landscape.md`：
- 聚合清单（按业务线）：聚合根、实体/值对象、一致性边界、发布事件、**子域类型**、**不变量**
- 聚合间关系（ID 引用 + 事件驱动，不持有对象引用）
- 一致性边界：强一致（单聚合事务）vs 最终一致（跨聚合事件）
- 跨上下文映射（context-map）：ACL/OHS/遵奉者等关系，详见 `references/ddd.md § 上下文映射`

### 10. 运维视图（ODD）

回答 5 问：系统怎么启动/关闭/恢复？状态怎么流转？异常怎么自愈？并发/资源/幂等/一致性怎么保证？运维怎么排障？

必含 6 块（并入 architecture.md）：
1. **启动序列**（初始化顺序、后台循环、readiness 何时开放）
2. **关闭序列**（SIGTERM→503→摘流→完成 in-flight→flush→exit）
3. **状态机**（Mermaid `stateDiagram-v2` + 状态含义 + 推进方 + 推进条件 + 终态 + 非法防御）
4. **核心时序图**（Mermaid `sequenceDiagram` 覆盖主链路）
5. **失败模型与恢复**（外部依赖挂/进程重启/重复回调/任务丢失/资源泄漏）
6. **排障锚点**（状态字段/runtime_ref/trace_id/日志位置/自动 vs 人工恢复）

**禁止抽象空话**："高性能高可用" ❌ → "P95 ≤ 500ms，SIGTERM 后 readiness 返回 503" ✅。

### 11. 流程图（flow，吸收自 xdd-flow）

`.xdd/design/architecture/{bxx-slug}/flow.mermaid` —— 通过组件分解体现非功能性设计：

1. **体现组件职责与边界**：前端/网关/服务/MQ/存储/AI 引擎分层
2. **暴露核心数据流向**：箭头标协议（HTTP/gRPC）或核心 Payload
3. **凸显非功能战术**：高并发（限流）、异步（转码/AI）、高可用（缓存/副本）用专门节点体现
4. **与 spec 字段对齐**：路由分支/数据状态与 `rules.md` 名词一致

**节点编号 NYY（流程节点序号）**：flow.mermaid 的节点用人读组件名（`Client`/`Handler`，可读优先）。**NYY 编号**（`B01-N01`）用于端点契约的 `@flow BXX-NYY` 追溯标注——给端点触发的流程步骤编序，序号在该业务线内全局唯一、递增。NYY 只活在端点 `@flow` 标注里（机器追溯），不强制写进 flow.mermaid 节点显示名。

**分两层画（多业务线时）**：flow.mermaid 明确分 **base 层**（通用/支撑上下文下沉的基础建设，foundation）+ **业务层**（核心子域），依赖箭头只从业务指向基础（单向，见 §13）。让"哪些是基础建设、依赖方向"可视化。

### 12. Docker Compose 部署

生产 + 测试环境都 Docker Compose 封装：
- `docker-compose.yml`（healthcheck、持久卷、restart、独立 network）
- `docker-compose.test.yml`（test profile、独立 DB、无持久卷）
- 每服务必有 healthcheck，`depends_on` 用 `condition: service_healthy`
- 敏感信息走 `.env`

### 13. 模块化设计（通用能力下沉为基础建设）

架构不只是"按业务线切上下文"，还要**把通用能力抽成基础模块（base/foundation），业务模块复用它**，别让每条业务线各造一遍认证/存储/通知/审计。模块粒度 = **DDD 限界上下文级**。

**怎么划分 + 怎么复用 → 查 `references/modular-design.md`（实操手册）**，这里给入口：

**划分 5 步**（每能力过一遍）：
1. 列能力候选（从 design.md + RXX）
2. 问 3 判定：是项目差异化竞争力？→ 业务模块；行业有现成方案？→ 基础模块(用现成)；多业务线都要？→ 基础模块(下沉)
3. 定边界：一模块一类能力，高内聚（改内部不牵动别人）
4. 定接口契约：基础只暴露接口(端口)，业务依赖接口不依赖实现
5. 落 module-landscape.md

**复用 3 机制**（按场景选）：
- 业务"用"基础能力（拿用户/存文件）→ **直接调用**接口
- 解耦基础实现（测试/换方案）→ **依赖注入**接口
- 基础要"感知"业务事件（审计/通知触发）→ **事件订阅**（业务发事件，基础订阅，基础不 import 业务）

**铁律**：业务→基础**单向**。基础 import 业务 = 反向依赖 = 架构腐烂起点。基础要感知业务只能走事件订阅。

**产出**：`.xdd/design/architecture/module-landscape.md`（全局，与 `aggregate-landscape.md` / `event-contract.md` 并列）——
- 基础上下文清单（base/foundation：职责 + 对外接口/端口 + 实现方案 + 子域类型）
- 业务上下文清单（core：核心子域 + 依赖哪些基础模块）
- 依赖矩阵（业务上下文 × 基础上下文，✓=依赖；**反向依赖必须为空**）

## 业务线 colocation（v8.0.0 保留）

`architecture/{bxx-slug}/` 一站式放整个业务线的架构产物，不跨目录跳查：

```
.xdd/design/architecture/
├── aggregate-landscape.md       # 全局聚合全景
├── event-contract.md            # 全局事件契约
├── module-landscape.md          # 全局模块全景（base 基础建设 + 业务上下文 + 依赖矩阵，见 §13）
└── {bxx-slug}/
    ├── architecture.md          # 含 §运维视图
    ├── flow.mermaid             # 流程图
    ├── docker-compose.yml
    ├── docker-compose.test.yml
    └── resilience/              # xdd-resilience 产出（见该 skill）
```

## 产出（architecture.md 一份文档含）

质量属性场景 + 安全设计(SDD) + 性能设计(PDD) + 限界上下文 + 技术栈决策 + 分层架构 + 规则传导矩阵 + API 端点清单 + 文件清单（后端+前端）+ 质量要点 + 运维视图(ODD) + Docker Compose 架构。

**全局独立产出**（非 colocation，跨业务线）：`aggregate-landscape.md`（聚合全景）+ `event-contract.md`（事件契约）+ `module-landscape.md`（模块全景：base 基础建设 + 业务上下文 + 依赖矩阵，见 §13）。

## 自检（无平台 hook）

```
□ 质量属性场景 3-5 个，每个有响应度量？
□ 架构模式选择有 @intent（背景→选项→选了→为什么），非默认套分层？（查 references/architecture-patterns.md 决策矩阵）
□ SDD 四步齐（威胁建模/认证授权/数据保护/基线）？
□ PDD 四步齐（基准/瓶颈/缓存/并发）？
□ 每条 RXX 规则在传导矩阵有映射？
□ 每条 RXX 至少一个 API 端点入口？
□ API 端点清单完整，每个标 @flow + @rules？
□ 事件契约独立产出，不隐式散射？
□ 聚合全景跟 spec _landscape.md 业务线清单一致？
□ 聚合划分遵循「聚合尽量小 + 跨聚合只引 ID」？（查 references/ddd.md § 聚合划分决策法）
□ 每个聚合根有明确的业务不变量？没有贫血模型（只有 getter/setter）？
□ context-map 画了跨上下文关系（ACL/OHS/遵奉者等）？
□ 运维视图 6 块齐，状态机/时序图能渲染？
□ docker-compose.yml + .test.yml 都有，每服务有 healthcheck？
□ flow.mermaid 能渲染（用 xdd-mermaid-check 验）？
□ 组件名/状态名跟 spec rules.md 一致，未知标"待确认"？
□ 识别了基础建设上下文（通用/支撑子域下沉为 base），业务上下文没各造一遍认证/存储/通知？
□ 依赖方向单向（业务→基础），无反向依赖？flow.mermaid 画了 base 层？module-landscape.md 依赖矩阵反向为空？
□ 复用机制选对（直接调用/依赖注入/事件订阅，按场景，查 references/modular-design.md 常见错误清单）？
```
