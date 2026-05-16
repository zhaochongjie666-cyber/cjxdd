# T01: CRUD 资源管理模板

## 适用场景

- 后台管理系统（用户管理、商品管理、配置管理）
- 标准 CRUD：列表 / 详情 / 新建 / 编辑 / 删除
- 分页、搜索、排序
- 操作审计

## 泳道设计（W3H）

| 泳道 | Who | What | Why | How |
|------|-----|------|-----|-----|
| B01 用户与权限 | Any authenticated | 身份校验、角色鉴权 | 确保只有合法用户操作合法资源 | JWT 鉴权 + RBAC |
| B02 资源管理 | Admin, Editor | CRUD 核心操作 | 资源是业务的核心数据，必须正确持久化 | HTTP API + DB |
| B03 校验与冲突 | System | 字段校验、存在性检查、约束检查 | 写入操作必须校验，防止脏数据和级联丢失 | 校验规则 + DB 约束 |
| B04 通知与审计 | System | 操作日志、变更通知 | 所有变更必须可追溯 | 异步写入 + WebSocket |

## 入口分析（W3H）

| 入口 | Who | What | Why | How |
|------|-----|------|-----|-----|
| 用户操作 | Any authenticated | 资源增删改查 | 用户需要管理业务数据 | `* /api/resources` |

CRUD 场景通常只有一个入口（API Gateway 分发），不同操作通过 HTTP Method 区分。

## Mermaid 图

```mermaid
flowchart TD
    ENTRY_API["👤 用户访问资源 API<br/>trigger: user<br/>entry: * /api/resources<br/>role: Any authenticated"]

    subgraph B01["👤 B01 用户与权限"]
        %% Why: 确保只有合法用户操作合法资源
        direction TB
        B01-N01["解析 JWT Token<br/>read: session<br/>role: Any authenticated"]
        B01-N02{"角色是否有资源操作权限(鉴权)<br/>condition: role in [Admin, Editor]"}
        B01-N03["返回 403(无权限)<br/>提示: 无资源操作权限"]
    end

    subgraph B02["📦 B02 资源管理"]
        %% Why: 资源是核心业务数据，CRUD 操作必须正确持久化
        direction TB
        B02-N01{"判断操作类型(路由)<br/>condition: HTTP method"}
        B02-N02["查询资源列表<br/>GET /api/resources<br/>read: resource<br/>role: Admin, Editor"]
        B02-N03["查询资源详情<br/>GET /api/resources/:id<br/>read: resource<br/>role: Admin, Editor"]
        B02-N04["创建资源<br/>POST /api/resources<br/>write: resource<br/>role: Admin, Editor"]
        B02-N06["更新资源<br/>PUT /api/resources/:id<br/>update: resource<br/>role: Admin, Editor"]
        B02-N08["删除资源<br/>DELETE /api/resources/:id<br/>delete: resource<br/>role: Admin"]
    end

    subgraph B03["🔒 B03 校验与冲突"]
        %% Why: 写入操作必须校验，防止脏数据和级联丢失
        direction TB
        B03-N01{"校验资源字段(防脏数据)<br/>condition: name non-empty & unique<br/>read: resource"}
        B03-N02{"资源是否存在(防幽灵操作)<br/>condition: resource.id exists"}
        B03-N03{"校验删除约束(防级联丢失)<br/>condition: no dependent records<br/>read: related_resources"}
        B03-N04["返回 404(资源不存在)<br/>提示: 资源不存在"]
        B03-N05["返回 409(冲突)<br/>提示: 资源名称已存在 / 存在关联数据"]
    end

    subgraph B04["🔔 B04 通知与审计"]
        %% Why: 所有变更必须可追溯，协作者需要感知变更
        direction TB
        B04-N01["记录操作审计日志(满足合规追溯)<br/>write: audit_log<br/>role: System"]
        B04-N02["发送资源变更通知(通知协作者)<br/>external: websocket<br/>fallback: skip notification"]
    end

    ENTRY_API --> B01-N01
    B01-N01 --> B01-N02
    B01-N02 -->|否| B01-N03
    B01-N02 -->|是| B02-N01

    B02-N01 -->|"GET (list)"| B02-N02
    B02-N01 -->|"GET (detail)"| B02-N03
    B02-N01 -->|"POST"| B02-N04
    B02-N01 -->|"PUT"| B02-N06
    B02-N01 -->|"DELETE"| B02-N08

    B02-N04 --> B03-N01
    B03-N01 -->|"否: 校验失败"| B03-N05
    B02-N06 --> B03-N02
    B03-N02 -->|否| B03-N04
    B02-N08 --> B03-N03
    B03-N03 -->|"否: 存在关联"| B03-N05

    B02-N04 -.->|"event: resource.created(审计)"| B04-N01
    B02-N06 -.->|"event: resource.updated(审计)"| B04-N01
    B02-N08 -.->|"event: resource.deleted(审计)"| B04-N01

    B04-N01 --> B04-N02

    B02-N02 --> RESULT["resultNode: 资源列表(分页)"]
    B02-N03 --> RESULT2["resultNode: 资源详情"]
    B02-N04 --> RESULT3["resultNode: 创建成功 + 资源ID"]
    B02-N06 --> RESULT4["resultNode: 更新成功"]
    B02-N08 --> RESULT5["resultNode: 删除成功"]
    B04-N02 --> RESULT6["resultNode: WebSocket 推送变更"]
    B01-N03 --> ERR_RESULT["resultNode: 403 错误页"]
    B03-N04 --> ERR_RESULT2["resultNode: 404 错误页"]
    B03-N05 --> ERR_RESULT3["resultNode: 409 冲突提示"]

    classDef triggerUser fill:#3D2C00,stroke:#FBBF24,color:#FEF3C7,stroke-width:2px
    classDef process fill:#172033,stroke:#5AA9E6,color:#E5EDF7,stroke-width:2px
    classDef decision fill:#1A3A2D,stroke:#2E7D32,color:#E8F5E9,stroke-width:2px
    classDef error fill:#4A1D24,stroke:#FB7185,color:#FFE4E6,stroke-width:2px
    classDef resultNode fill:#173E2D,stroke:#34D399,color:#D1FAE5,stroke-width:2px

    class ENTRY_API triggerUser
    class B01-N01,B02-N02,B02-N03,B02-N04,B02-N06,B02-N08,B04-N01,B04-N02 process
    class B01-N02,B02-N01,B03-N01,B03-N02,B03-N03 decision
    class B01-N03,B03-N04,B03-N05 error
    class RESULT,RESULT2,RESULT3,RESULT4,RESULT5,RESULT6 resultNode
    class ERR_RESULT,ERR_RESULT2,ERR_RESULT3 error
```

## 异常路径清单

| 触发点 | 错误码 | Why | 恢复方式 |
|--------|--------|-----|---------|
| B01-N02 | 403 | 角色无权操作该资源 | 联系管理员 |
| B03-N01 | 409 | 名称重复导致数据冲突 | 修改名称 |
| B03-N01 | 400 | 字段为空导致脏数据 | 填写名称 |
| B03-N02 | 404 | 操作不存在的资源是幽灵操作 | 返回列表页 |
| B03-N03 | 409 | 级联删除会导致关联数据丢失 | 先清理关联 |

## 常见变异

| 变异点 | 默认方案 | 替代方案 | Why |
|--------|---------|---------|-----|
| 删除策略 | 硬删除 | 软删除（deleted_at） | 需要数据恢复能力 |
| 分页方式 | offset 分页 | 游标分页 | 数据量大时 offset 性能差 |
| 权限粒度 | 角色级 | 行级（只看自己的） | 多租户隔离需求 |
| 并发控制 | 无 | 乐观锁 | 防止并发覆盖 |
| 排序 | 默认排序 | 多字段排序 | 用户自定义视图 |
| 搜索 | 精确匹配 | 全文搜索 | 需要模糊查询能力 |
