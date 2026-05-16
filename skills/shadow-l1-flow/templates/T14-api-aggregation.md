# T14: API 聚合/BFF 模板

## 适用场景

- 多后端服务聚合为统一 API
- BFF（Backend for Frontend）适配不同客户端
- 请求编排、缓存、降级

## 泳道设计（W3H）

| 泳道 | Who | What | Why | How |
|------|-----|------|-----|-----|
| B01 请求入口 | Client | 接收客户端请求 | 客户端需要统一入口 | HTTP API / GraphQL |
| B02 聚合编排 | System | 拆分/并行/聚合后端调用 | 减少客户端请求次数，屏蔽后端复杂度 | 并行 HTTP + 聚合 |
| B03 缓存与降级 | System | 缓存热点数据、降级非核心 | 提升响应速度，保证核心可用 | Redis + fallback |

## 入口分析（W3H）

| 入口 | Who | What | Why | How |
|------|-----|------|-----|-----|
| 客户端请求 | Client | 访问聚合 API | 客户端需要数据 | `GET /api/aggregated/*` |
| 缓存预热 | Cron | 预加载热点数据 | 减少首次请求延迟 | `cron '*/10 * * * *'` |

## Mermaid 图

```mermaid
flowchart TD
    ENTRY_CLIENT["👤 客户端请求聚合 API<br/>trigger: user<br/>entry: GET /api/aggregated/:resource<br/>role: Client"]
    ENTRY_WARMUP["⏰ 缓存预热(减少首次延迟)<br/>trigger: cron<br/>entry: cron '*/10 * * * *'<br/>role: System"]

    subgraph B01["🌐 B01 请求入口"]
        %% Why: 客户端需要一个统一入口，屏蔽后端复杂度
        direction TB
        B01-N01["解析聚合请求(识别需要哪些后端)<br/>read: route_config<br/>role: System"]
        B01-N02{"请求是否合法(参数校验)<br/>condition: params valid & authenticated"}
        B01-N03["解析聚合编排计划(确定调用链)<br/>read: orchestration_config<br/>role: System"]
    end

    subgraph B02["⚙️ B02 聚合编排"]
        %% Why: 减少客户端请求次数，并行调用提升性能
        direction TB
        B02-N01["检查缓存(命中则跳过调用)<br/>cache: response_cache<br/>role: System"]
        B02-N02{"是否命中缓存<br/>condition: cache exists & not expired"}
        B02-N03["并行调用后端服务(提升性能)<br/>external: service_a, service_b, service_c<br/>fallback: 降级处理<br/>role: System"]
        B02-N04{"所有服务是否成功<br/>condition: all services responded 2xx"}
        B02-N05["聚合响应数据(合并结果)<br/>role: System"]
        B02-N06["部分失败降级(返回可用数据)<br/>role: System"]
        B02-N07["写入缓存(后续请求复用)<br/>cache: response_cache<br/>write: cache_entry<br/>role: System"]
        B02-N08["数据裁剪(按客户端类型过滤字段)<br/>role: System"]
    end

    subgraph B03["💾 B03 缓存与降级"]
        %% Why: 提升响应速度，保证核心可用
        direction TB
        B03-N01["加载热点数据到缓存<br/>cache: response_cache<br/>role: System"]
        B03-N02{"服务是否可降级<br/>condition: service.degradable = true"}
        B03-N03["返回兜底数据(降级)<br/>cache: stale_cache<br/>role: System"]
        B03-N04["熔断不可用服务(保护系统)<br/>update: circuit_breaker_state<br/>role: System"]
    end

    ENTRY_CLIENT --> B01-N01
    B01-N01 --> B01-N02
    B01-N02 -->|否| ERR_PARAMS["resultNode: 参数错误"]
    B01-N02 -->|是| B01-N03
    B01-N03 --> B02-N01

    B02-N01 --> B02-N02
    B02-N02 -->|是| RESULT_CACHE["resultNode: 返回缓存数据"]
    B02-N02 -->|否| B02-N03
    B02-N03 --> B02-N04
    B02-N04 -->|是| B02-N05
    B02-N04 -->|否| B02-N06
    B02-N05 --> B02-N07
    B02-N06 --> B02-N07
    B02-N07 --> B02-N08
    B02-N08 --> RESULT_AGG["resultNode: 返回聚合数据"]

    B02-N03 -.->|"event: service.failed(触发降级)"| B03-N02
    B03-N02 -->|是| B03-N03
    B03-N02 -->|否| B03-N04

    ENTRY_WARMUP --> B03-N01

    classDef triggerUser fill:#3D2C00,stroke:#FBBF24,color:#FEF3C7,stroke-width:2px
    classDef triggerCron fill:#1A2A3A,stroke:#60A5FA,color:#DBEAFE,stroke-width:2px
    classDef process fill:#172033,stroke:#5AA9E6,color:#E5EDF7,stroke-width:2px
    classDef decision fill:#1A3A2D,stroke:#2E7D32,color:#E8F5E9,stroke-width:2px
    classDef error fill:#4A1D24,stroke:#FB7185,color:#FFE4E6,stroke-width:2px
    classDef resultNode fill:#173E2D,stroke:#34D399,color:#D1FAE5,stroke-width:2px

    class ENTRY_CLIENT triggerUser
    class ENTRY_WARMUP triggerCron
    class B01-N01,B01-N03,B02-N01,B02-N03,B02-N05,B02-N06,B02-N07,B02-N08,B03-N01,B03-N03,B03-N04 process
    class B01-N02,B02-N02,B02-N04,B03-N02 decision
    class ERR_PARAMS error
    class RESULT_CACHE,RESULT_AGG resultNode
```

## 异常路径清单

| 触发点 | 错误码 | Why | 恢复方式 |
|--------|--------|-----|---------|
| B01-N02 | 400 | 请求参数不合法 | 返回参数错误 |
| B01-N02 | 401 | 未认证 | 返回 401 |
| B02-N03 | 502 | 后端服务调用失败 | 降级处理 |
| B02-N04 | 206 | 部分服务失败 | 返回可用数据 |
| B03-N02 | 200 | 服务可降级 | 返回兜底数据 |
| B03-N04 | 503 | 熔断触发 | 返回降级响应 |

## 常见变异

| 变异点 | 默认方案 | 替代方案 |
|--------|---------|---------|
| 聚合方式 | REST API | GraphQL（客户端自定义查询） |
| 调用方式 | HTTP | gRPC（高性能） |
| 缓存策略 | TTL 过期 | stale-while-revalidate |
| 降级策略 | 返回兜底数据 | 返回核心数据 + 标记部分不可用 |
| 认证 | 统一 JWT | 请求头透传 + 各服务独立认证 |
| 协议适配 | 统一 JSON | 按客户端类型适配（Web/Mobile/IoT） |
