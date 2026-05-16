# T09: 状态机驱动模板

## 适用场景

- 任何状态驱动的业务：订单状态、设备生命周期、工单流转
- 复杂状态转换图、守卫条件、副作用
- 可复用的状态机引擎

## 泳道设计（W3H）

| 泳道 | Who | What | Why | How |
|------|-----|------|-----|-----|
| B01 触发入口 | User, System | 接收状态变更请求 | 外部需要触发状态变迁 | HTTP API / Event |
| B02 状态引擎 | System | 校验转换合法性、执行转换 | 状态变迁必须符合规则 | 状态机 + 规则表 |
| B03 副作用 | System | 通知、日志、联动 | 状态变更后需触发后续动作 | 事件驱动 |

## 入口分析（W3H）

| 入口 | Who | What | Why | How |
|------|-----|------|-----|-----|
| 用户触发转换 | User | 请求状态变更 | 用户操作驱动状态流转 | `POST /api/{entity}/:id/transition` |
| 系统触发转换 | System(Event) | 事件驱动状态变更 | 异步事件触发状态变迁 | Event subscriber |
| 定时触发转换 | Cron | 超时自动转换 | 防止状态无限期停留 | `cron` |

## Mermaid 图

```mermaid
flowchart TD
    ENTRY_USER["👤 用户请求状态变更<br/>trigger: user<br/>entry: POST /api/{entity}/:id/transition<br/>role: User"]
    ENTRY_EVENT["📡 事件触发状态变更(异步驱动)<br/>trigger: event<br/>entry: subscribe entity.*<br/>role: System"]
    ENTRY_TIMEOUT["⏰ 超时自动转换(防无限停留)<br/>trigger: cron<br/>entry: cron '*/10 * * * *'<br/>role: System"]

    subgraph B01["👤 B01 触发入口"]
        %% Why: 统一入口，所有状态变更请求都经过同一管道
        direction TB
        B01-N01["解析转换请求(提取目标状态)<br/>read: entity, target_status<br/>role: System"]
        B01-N02["加载当前实体状态<br/>read: entity.status<br/>lock: entity.id<br/>role: System"]
    end

    subgraph B02["⚙️ B02 状态引擎"]
        %% Why: 状态变迁必须符合预定义规则，不能随意跳转
        direction TB
        B02-N01["查询状态转换规则表(合法性)<br/>read: state_transition_rule<br/>condition: from → to exists<br/>role: System"]
        B02-N02{"转换是否合法(规则校验)<br/>condition: transition rule exists"}
        B02-N03["评估守卫条件(业务校验)<br/>condition: guard_rule.expression eval → true<br/>read: guard_rule, entity<br/>role: System"]
        B02-N04{"守卫条件是否满足<br/>condition: guard passed"}
        B02-N05["执行状态转换(原子操作)<br/>update: entity.status<br/>状态: from → to<br/>role: System"]
        B02-N06["记录状态变更日志(可追溯)<br/>write: state_change_log<br/>role: System"]
        B02-N07["超时状态检测(防停留过久)<br/>condition: entity.status_duration > timeout<br/>role: System"]
        B02-N08["执行超时转换(强制推进)<br/>update: entity.status<br/>状态: current → timeout_target<br/>role: System"]
    end

    subgraph B03["🔔 B03 副作用"]
        %% Why: 状态变更后需通知相关方、触发联动
        direction TB
        B03-N01["发布状态变更事件(通知下游)<br/>event: entity.status_changed<br/>payload: {entityId, from, to}<br/>role: System"]
        B03-N02["执行转换后动作(联动)<br/>read: transition_action<br/>role: System"]
        B03-N03["发送通知(告知相关方)<br/>external: email, push<br/>fallback: retry×2 → log<br/>role: System"]
    end

    ENTRY_USER --> B01-N01
    ENTRY_EVENT --> B01-N01
    B01-N01 --> B01-N02
    B01-N02 --> B02-N01

    B02-N01 --> B02-N02
    B02-N02 -->|否| ERR_INVALID["resultNode: 非法状态转换"]
    B02-N02 -->|是| B02-N03
    B02-N03 --> B02-N04
    B02-N04 -->|否| ERR_GUARD["resultNode: 条件不满足"]
    B02-N04 -->|是| B02-N05
    B02-N05 --> B02-N06
    B02-N06 -.->|"event: entity.state_changed(通知下游)"| B03-N01
    B02-N06 -.->|"event: entity.state_changed(执行联动)"| B03-N02

    ENTRY_TIMEOUT --> B02-N07
    B02-N07 -->|是| B02-N08
    B02-N08 --> B02-N06

    B03-N01 --> B03-N03
    B03-N02 --> B03-N03

    RESULT_TRANSITIONED["resultNode: 状态转换成功"]

    B02-N05 --> RESULT_TRANSITIONED

    classDef triggerUser fill:#3D2C00,stroke:#FBBF24,color:#FEF3C7,stroke-width:2px
    classDef triggerCron fill:#1A2A3A,stroke:#60A5FA,color:#DBEAFE,stroke-width:2px
    classDef triggerEvent fill:#1A3A2D,stroke:#34D399,color:#D1FAE5,stroke-width:2px,stroke-dasharray: 5 5
    classDef process fill:#172033,stroke:#5AA9E6,color:#E5EDF7,stroke-width:2px
    classDef decision fill:#1A3A2D,stroke:#2E7D32,color:#E8F5E9,stroke-width:2px
    classDef error fill:#4A1D24,stroke:#FB7185,color:#FFE4E6,stroke-width:2px
    classDef resultNode fill:#173E2D,stroke:#34D399,color:#D1FAE5,stroke-width:2px

    class ENTRY_USER triggerUser
    class ENTRY_TIMEOUT triggerCron
    class ENTRY_EVENT triggerEvent
    class B01-N01,B01-N02,B02-N01,B02-N03,B02-N05,B02-N06,B02-N07,B02-N08,B03-N01,B03-N02,B03-N03 process
    class B02-N02,B02-N04 decision
    class ERR_INVALID,ERR_GUARD error
    class RESULT_TRANSITIONED resultNode
```

## 异常路径清单

| 触发点 | 错误码 | Why | 恢复方式 |
|--------|--------|-----|---------|
| B02-N02 | 400 | 非法状态转换 | 返回错误提示 |
| B02-N04 | 400 | 守卫条件不满足 | 返回具体原因 |
| B01-N02 | 404 | 实体不存在 | 返回 404 |
| B01-N02 | 409 | 并发冲突（乐观锁） | 提示刷新重试 |
| B03-N03 | 502 | 通知发送失败 | retry×2 → log |
| B02-N07 | 200 | 超时未处理 | 强制推进状态 |

## 常见变异

| 变异点 | 默认方案 | 替代方案 |
|--------|---------|---------|
| 状态规则 | DB 规则表 | 代码内状态机（XState / Spring Statemachine） |
| 守卫条件 | 表达式求值 | 策略模式（每个转换一个校验类） |
| 并发控制 | 悲观锁 | 乐观锁（version 字段） |
| 历史追溯 | 变更日志表 | 事件溯源（Event Sourcing） |
| 多实体 | 单一状态机 | 分层状态机（父子状态） |
| 副作用 | 同步执行 | 异步队列（解耦） |
