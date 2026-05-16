# T15: 事件驱动/消息队列模板

## 适用场景

- 异步解耦、事件溯源、CQRS
- 消息生产/消费、重试、死信队列
- 多消费者广播/竞争消费

## 泳道设计（W3H）

| 泳道 | Who | What | Why | How |
|------|-----|------|-----|-----|
| B01 事件生产 | Service | 发布领域事件 | 服务间需要异步通信 | Message Queue |
| B02 事件消费 | Service | 订阅并处理事件 | 消费者需要响应事件 | Message Consumer |
| B03 死信处理 | System | 重试失败消息、人工介入 | 消息不能丢失 | Dead Letter Queue |

## 入口分析（W3H）

| 入口 | Who | What | Why | How |
|------|-----|------|-----|-----|
| 业务事件 | Service | 发布领域事件 | 业务状态变更需通知下游 | event publish |
| 定时重试 | Cron | 重试失败消息 | 暂时性故障需自动恢复 | `cron '*/1 * * * *'` |
| 死信处理 | Admin | 人工处理死信 | 自动重试耗尽后需人工介入 | `POST /api/dlq/:id/replay` |

## Mermaid 图

```mermaid
flowchart TD
    ENTRY_EVENT["📡 业务服务发布事件(状态变更通知)<br/>trigger: event<br/>entry: publish domain.event<br/>role: Service"]
    ENTRY_RETRY["⏰ 定时重试失败消息(自动恢复)<br/>trigger: cron<br/>entry: cron '*/1 * * * *'<br/>role: System"]
    ENTRY_DLQ["👑 管理员处理死信(人工介入)<br/>trigger: admin<br/>entry: POST /api/dlq/:id/replay<br/>role: Admin"]

    subgraph B01["📡 B01 事件生产"]
        %% Why: 服务间需要异步解耦通信
        direction TB
        B01-N01["构建事件载荷(标准化)<br/>write: event{type, payload, metadata}<br/>role: Service"]
        B01-N02{"事件是否符合 Schema(防脏消息)<br/>condition: event matches schema"}
        B01-N03["持久化事件日志(可追溯/溯源)<br/>write: event_store<br/>role: System"]
        B01-N04["发布到消息队列(分发)<br/>external: message_queue<br/>fallback: 本地队列暂存 + retry<br/>role: System"]
        B01-N05["记录发布指标(监控)<br/>write: event_metrics<br/>role: System"]
    end

    subgraph B02["👤 B02 事件消费"]
        %% Why: 消费者需要可靠地处理事件
        direction TB
        B02-N01["拉取/接收消息<br/>external: message_queue<br/>role: Consumer"]
        B02-N02{"消息是否重复(幂等校验)<br/>condition: event.id not in processed_set"}
        B02-N03["执行业务处理逻辑<br/>role: Consumer"]
        B02-N04{"处理是否成功<br/>condition: no exception"}
        B02-N05["确认消息(ACK)<br/>update: consumer_offset<br/>role: Consumer"]
        B02-N06["记录幂等标记(防重复处理)<br/>write: processed_event<br/>cache: processed_set<br/>role: System"]
        B02-N07["重试消息(退避策略)<br/>update: event.retry_count++<br/>role: System"]
        B02-N08{"重试次数是否超限<br/>condition: retry_count < max_retries"}
        B02-N09["转入死信队列(最终兜底)<br/>write: dead_letter<br/>role: System"]
    end

    subgraph B03["☠️ B03 死信处理"]
        %% Why: 自动重试耗尽后消息不能丢失，需人工介入
        direction TB
        B03-N01["查询死信列表<br/>GET /api/dlq<br/>read: dead_letter<br/>role: Admin"]
        B03-N02["分析失败原因(根因定位)<br/>read: dead_letter.error, stacktrace<br/>role: Admin"]
        B03-N03{"是否可重放<br/>condition: error is transient or fixed"}
        B03-N04["重新投递消息(修复后重放)<br/>update: dead_letter.status → replayed<br/>role: Admin"]
        B03-N05["标记为已处理(人工确认)<br/>update: dead_letter.status → resolved<br/>role: Admin"]
        B03-N06["发送死信告警(通知运维)<br/>external: alert<br/>fallback: log<br/>role: System"]
    end

    ENTRY_EVENT --> B01-N01
    B01-N01 --> B01-N02
    B01-N02 -->|否| ERR_SCHEMA["resultNode: 事件格式错误，丢弃"]
    B01-N02 -->|是| B01-N03
    B01-N03 --> B01-N04
    B01-N04 --> B01-N05
    B01-N04 -.->|"event delivered"| B02-N01

    B02-N01 --> B02-N02
    B02-N02 -->|"是: 重复"| B02-N05
    B02-N02 -->|"否: 新消息"| B02-N03
    B02-N03 --> B02-N04
    B02-N04 -->|是| B02-N06
    B02-N06 --> B02-N05
    B02-N04 -->|否| B02-N07
    B02-N07 --> B02-N08
    B02-N08 -->|是| B02-N01
    B02-N08 -->|否| B02-N09
    B02-N09 -.->|"event: dead_letter.created(告警)"| B03-N06

    ENTRY_RETRY --> B02-N01

    ENTRY_DLQ --> B03-N01
    B03-N01 --> B03-N02
    B03-N02 --> B03-N03
    B03-N03 -->|是| B03-N04
    B03-N03 -->|否| B03-N05

    RESULT_PRODUCED["resultNode: 事件已发布"]
    RESULT_CONSUMED["resultNode: 事件已消费"]
    RESULT_REPLAYED["resultNode: 死信已重放"]

    B01-N05 --> RESULT_PRODUCED
    B02-N05 --> RESULT_CONSUMED
    B03-N04 --> RESULT_REPLAYED

    classDef triggerEvent fill:#1A3A2D,stroke:#34D399,color:#D1FAE5,stroke-width:2px,stroke-dasharray: 5 5
    classDef triggerCron fill:#1A2A3A,stroke:#60A5FA,color:#DBEAFE,stroke-width:2px
    classDef triggerAdmin fill:#3B1028,stroke:#F472B6,color:#FCE7F3,stroke-width:2px
    classDef process fill:#172033,stroke:#5AA9E6,color:#E5EDF7,stroke-width:2px
    classDef decision fill:#1A3A2D,stroke:#2E7D32,color:#E8F5E9,stroke-width:2px
    classDef error fill:#4A1D24,stroke:#FB7185,color:#FFE4E6,stroke-width:2px
    classDef resultNode fill:#173E2D,stroke:#34D399,color:#D1FAE5,stroke-width:2px

    class ENTRY_EVENT triggerEvent
    class ENTRY_RETRY triggerCron
    class ENTRY_DLQ triggerAdmin
    class B01-N01,B01-N03,B01-N04,B01-N05,B02-N01,B02-N03,B02-N05,B02-N06,B02-N07,B02-N09,B03-N01,B03-N02,B03-N04,B03-N05,B03-N06 process
    class B01-N02,B02-N02,B02-N04,B02-N08,B03-N03 decision
    class ERR_SCHEMA error
    class RESULT_PRODUCED,RESULT_CONSUMED,RESULT_REPLAYED resultNode
```

## 异常路径清单

| 触发点 | 错误码 | Why | 恢复方式 |
|--------|--------|-----|---------|
| B01-N02 | 400 | 事件不符合 Schema | 丢弃 + 日志 |
| B01-N04 | 502 | 消息队列不可用 | 本地队列暂存 + retry |
| B02-N02 | 200 | 重复消息（幂等） | ACK 跳过 |
| B02-N04 | 500 | 消费处理异常 | 重试（退避） |
| B02-N08 | 200 | 重试次数耗尽 | 转入死信队列 |
| B03-N06 | 502 | 死信告警发送失败 | log |

## 常见变异

| 变异点 | 默认方案 | 替代方案 |
|--------|---------|---------|
| 消息队列 | Kafka / RabbitMQ | Redis Stream / SQS / Pulsar |
| 消费模式 | 竞争消费（单消费者处理） | 广播消费（所有消费者都收到） |
| 消息顺序 | 无序 | 有序（分区键 / FIFO 队列） |
| 幂等策略 | 消费端去重表 | 生产端幂等键 + 消费端去重 |
| 事件溯源 | 无 | Event Store + 投影重建 |
| CQRS | 无 | 读写分离 + 事件驱动同步 |
| 重试策略 | 固定间隔 | 指数退避 / 延迟队列 |
