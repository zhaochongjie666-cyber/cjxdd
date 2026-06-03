# 跨业务线连接与交叉场景指南

> 本指南定义业务线间的连接协议和典型交叉场景处理方式。
> 参考 [多业务线 L1 设计规范](multi-bizline.md)。

## 目录

- [3. 跨线连接协议](#3-跨线连接协议)
  - [3.1 核心原则](#31-核心原则)
  - [3.2 接口节点类型](#32-接口节点类型)
  - [3.3 连接标签规范](#33-连接标签规范)
  - [3.4 跨线连接示例（总图中）](#34-跨线连接示例总图中)
  - [3.5 跨线连接检查清单](#35-跨线连接检查清单)
- [5. 业务交叉场景处理](#5-业务交叉场景处理)
  - [5.1 通用场景分类](#51-通用场景分类)
  - [5.2 数据流程典型交叉场景](#52-数据流程典型交叉场景)
  - [5.3 事件扇出示例](#53-事件扇出示例)
  - [5.4 跨线连接在 spec.md 中的体现](#54-跨线连接在-specmd-中的体现)

## 3. 跨线连接协议

### 3.1 核心原则

> **业务线之间禁止直接连接内部节点。** 所有跨线通信必须通过标准化的接口节点中转。

### 3.2 接口节点类型

| 类型 | 适用场景 | Mermaid 节点形状 | 连接标签 |
|------|---------|----------------|---------|
| API Gateway | 同步 HTTP/gRPC 调用 | `GATEWAY[["API Gateway"]]` | `HTTP /method` |
| Event Bus | 异步事件驱动 | `EVT{{"Event Bus"}}` | `event: name` |
| Shared Service | 共享基础设施 | `SHARED[("Shared: Redis/DB")]` | `READ/WRITE key` |
| Webhook | 外部系统回调 | `HOOK[/"Webhook"/]` | `POST /callback` |

### 3.3 连接标签规范

```
同步调用：  源 -->|HTTP POST /api/v1/orders| 目标
异步事件：  源 -->|event: order.created| EVT
事件消费：  EVT -->|订阅 order.created| 目标
数据访问：  源 -->|READ user:123| SHARED
```

### 3.4 跨线连接示例（总图中）

```mermaid
flowchart TD
  subgraph biz_order["📦 订单处理"]
    O1[接收订单] --> O2[库存检查]
    O2 --> O3{库存充足?}
    O3 -->|是| O4[创建支付]
    O3 -->|否| O5[标记缺货]

    O4 --> OUTBOUND((→ biz-payment))
    O4 --> EVT{{"Event Bus"}}
    EVT -->|event: order.created| NOTIFY((→ biz-notify))

    O5 --> WARN[缺货预警]

    O4 --> R1((支付待处理))
  end

  classDef bizOrder fill:#1B3A2D,stroke:#34D399,color:#D1FAE5,stroke-width:2px
  classDef outbound fill:#4A2A16,stroke:#FB923C,color:#FFEDD5,stroke-width:2px,stroke-dasharray: 5 5
  classDef eventBus fill:#1A1A3E,stroke:#7C3AED,color:#EDE9FE,stroke-width:2px
  classDef warnNode fill:#4A1D24,stroke:#FB7185,color:#FFE4E6,stroke-width:2px
  classDef resultNode fill:#173E2D,stroke:#34D399,color:#D1FAE5,stroke-width:2px

  class O1,O2,O3,O4,O5 bizOrder
  class OUTBOUND,NOTIFY outbound
  class EVT eventBus
  class WARN warnNode
  class R1 resultNode
```

### 3.5 跨线连接检查清单

生成跨线连接后，逐项检查：

| # | 检查项 | 通过标准 |
|---|--------|---------|
| 1 | 接口节点存在 | 每条跨线连接都经过 API Gateway / Event Bus / Shared Service |
| 2 | 连接标签完整 | 每条跨线边都有 `|HTTP /path|` 或 `|event: name|` 标签 |
| 3 | 方向明确 | 箭头方向与调用方向一致（请求方 → 接口 → 消费方） |
| 4 | 无循环依赖 | 业务线之间不存在 A→B→A 的循环调用 |
| 5 | 事件命名 | 事件名格式 `domain.action`（如 `order.created`） |
| 6 | 出/入标识 | 总图中用 `outbound` 样式标注流向他线的节点 |

## 5. 业务交叉场景处理

### 5.1 通用场景分类

| 场景 | 特征 | 处理方式 |
|------|------|---------|
| **单向调用** | A 调用 B，B 不调用 A | A 的 subgraph 中放 outbound 节点 → Event Bus → B |
| **双向交互** | A 和 B 互相调用 | 主流程中双向标注，各子流程各放 outbound |
| **事件广播** | A 发布事件，B/C/D 订阅 | A → Event Bus，Event Bus → B/C/D（扇出） |
| **聚合服务** | A+B+C 的数据聚合到 D | A/B/C 各自 → Event Bus，D 从 Event Bus 聚合 |
| **共享依赖** | A/B/C 都访问同一 DB | 各自 → Shared Service 节点（不直接连 DB） |

### 5.2 数据流程典型交叉场景

#### 场景 A：数据管道标准链路

```
biz-collect → biz-transform → biz-store → biz-serve
```

```mermaid
flowchart LR
  subgraph COLLECT["📥 biz-collect"]
    C1[API 拉取] --> C2[日志采集]
  end
  subgraph TRANSFORM["🔄 biz-transform"]
    T1[清洗去重] --> T2[字段映射]
  end
  subgraph STORE["💾 biz-store"]
    S1[ODS 层] --> S2[DWD 层] --> S3[ADS 层]
  end
  subgraph SERVE["📊 biz-serve"]
    SV1[API 查询]
    SV2[报表展示]
  end

  COLLECT -->|event: data.collected| TRANSFORM
  TRANSFORM -->|event: data.ready| STORE
  STORE -->|READ table| SERVE

  classDef bizCollect fill:#2D4A3E,stroke:#34D399,color:#D1FAE5,stroke-width:2px
  classDef bizTransform fill:#4A3D16,stroke:#FBBF24,color:#FEF3C7,stroke-width:2px
  classDef bizStore fill:#1A3A5C,stroke:#60A5FA,color:#DBEAFE,stroke-width:2px
  classDef bizServe fill:#2D1A3E,stroke:#E879F9,color:#FAE8FF,stroke-width:2px

  class COLLECT bizCollect
  class TRANSFORM bizTransform
  class STORE bizStore
  class SERVE bizServe
```

#### 场景 B：数据质量校验嵌入管道

```
biz-transform → biz-quality → (通过) biz-store
                           → (失败) biz-monitor
```

```mermaid
flowchart LR
  T[数据转换] --> Q(("📄 biz-quality.flow.mermaid"))
  Q -->|通过| S[写入存储]
  Q -->|失败| M[告警通知]

  click Q "./biz-quality.flow.mermaid" "查看质量校验流程"

  classDef transformNode fill:#4A3D16,stroke:#FBBF24,color:#FEF3C7,stroke-width:2px
  classDef subflowNode fill:#1A1A3E,stroke:#7C3AED,color:#EDE9FE,stroke-width:2px,stroke-dasharray: 5 5
  classDef passNode fill:#1B3A2D,stroke:#34D399,color:#D1FAE5,stroke-width:2px
  classDef failNode fill:#4A1D24,stroke:#FB7185,color:#FFE4E6,stroke-width:2px

  class T transformNode
  class Q subflowNode
  class S passNode
  class M failNode
```

#### 场景 C：DAG 编排驱动多管道

```
biz-orchest ──调度──▶ biz-collect
                   ──调度──▶ biz-transform
                   ──调度──▶ biz-store
```

```mermaid
flowchart TD
  subgraph ORCHEST["🎯 biz-orchest"]
    DAG[DAG 定义] --> SCH{调度器}
    SCH -->|T+1| J1[Job: 采集]
    SCH -->|依赖 J1| J2[Job: 转换]
    SCH -->|依赖 J2| J3[Job: 存储]
  end

  J1 --> JC1(("📄 biz-collect.flow.mermaid"))
  J2 --> JC2(("📄 biz-transform.flow.mermaid"))
  J3 --> JC3(("📄 biz-store.flow.mermaid"))

  classDef bizOrchest fill:#2D1A4E,stroke:#A78BFA,color:#F4F0FF,stroke-width:2px
  classDef subflowNode fill:#1A1A3E,stroke:#7C3AED,color:#EDE9FE,stroke-width:2px,stroke-dasharray: 5 5

  class ORCHEST bizOrchest
  class JC1,JC2,JC3 subflowNode
```

#### 场景 D：数据血缘追踪（跨多业务线）

```
biz-collect ──血缘──▶ biz-transform ──血缘──▶ biz-store
     │                     │                     │
     └───────── biz-monitor（统一追踪）────────────┘
```

```mermaid
flowchart LR
  C[biz-collect] -->|血缘: table_A| T[biz-transform]
  T -->|血缘: table_B| S[biz-store]
  C -.->|上报| M[biz-monitor]
  T -.->|上报| M
  S -.->|上报| M

  classDef bizCollect fill:#2D4A3E,stroke:#34D399,color:#D1FAE5,stroke-width:2px
  classDef bizTransform fill:#4A3D16,stroke:#FBBF24,color:#FEF3C7,stroke-width:2px
  classDef bizStore fill:#1A3A5C,stroke:#60A5FA,color:#DBEAFE,stroke-width:2px
  classDef bizMonitor fill:#4A2A16,stroke:#FB923C,color:#FFEDD5,stroke-width:2px

  class C bizCollect
  class T bizTransform
  class S bizStore
  class M bizMonitor
```

#### 场景 E：CDC 实时同步

```
源 DB ──CDC──▶ biz-collect ──kafka──▶ biz-transform ──upsert──▶ biz-store
```

```mermaid
flowchart LR
  SRC[("源数据库")] --> CDC["CDC 捕获"]
  CDC --> K{{"Kafka Topic"}}
  K --> T["实时转换"]
  T --> UPS["Upsert 写入"]
  UPS --> DST[("目标数仓")]

  click CDC "./biz-collect.flow.mermaid" "采集流程"
  click T "./biz-transform.flow.mermaid" "转换流程"
  click UPS "./biz-store.flow.mermaid" "存储流程"

  classDef dbNode fill:#183A4A,stroke:#67E8F9,color:#ECFEFF,stroke-width:2px
  classDef kafkaNode fill:#4A2A16,stroke:#FB923C,color:#FFEDD5,stroke-width:2px
  classDef subflowNode fill:#1A1A3E,stroke:#7C3AED,color:#EDE9FE,stroke-width:2px,stroke-dasharray: 5 5

  class SRC,DST dbNode
  class K kafkaNode
```

### 5.3 事件扇出示例

```mermaid
flowchart LR
  O1[订单创建] --> EVT{{"Event Bus"}}
  EVT -->|event: order.created| P1[支付处理]
  EVT -->|event: order.created| N1[发送确认邮件]
  EVT -->|event: order.created| A1[更新分析报表]

  classDef outbound fill:#4A2A16,stroke:#FB923C,color:#FFEDD5,stroke-width:2px
  classDef eventBus fill:#1A1A3E,stroke:#7C3AED,color:#EDE9FE,stroke-width:2px

  class O1 outbound
  class EVT eventBus
```

### 5.4 跨线连接在 spec.md 中的体现

当存在跨线连接时，spec.md 必须增加 `## 跨业务线依赖` 章节：

```markdown
## 跨业务线依赖

| 依赖方向 | 事件/接口 | 协议 | 超时 | 降级策略 |
|---------|----------|------|------|---------|
| biz-order → biz-payment | HTTP POST /payments | HTTP/JSON | 5s | 标记待支付，异步重试 |
| biz-order → biz-notify | event: order.created | Event | 最终一致 | 补偿任务重发 |
| biz-payment → biz-order | event: payment.completed | Event | 最终一致 | 对账任务补偿 |
```
