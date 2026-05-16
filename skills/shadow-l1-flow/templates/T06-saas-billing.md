# T06: SaaS 订阅计费模板

## 适用场景

- SaaS 订阅制：免费试用 → 付费订阅 → 升降级 → 续费 → 到期
- 多套餐、用量计费、账单生成
- 订阅状态机、到期提醒、自动扣费

## 泳道设计（W3H）

| 泳道 | Who | What | Why | How |
|------|-----|------|-----|-----|
| B01 订阅管理 | User | 选套餐、升降级、取消 | 用户需要灵活管理订阅 | HTTP API |
| B02 计费引擎 | System | 账单计算、扣费、发票 | 确保收费准确按时 | 定时任务 + 支付 SDK |
| B03 权限控制 | System | 功能开关、用量限制 | 订阅等级决定可用功能 | 中间件 + 拦截器 |
| B04 通知 | System | 到期提醒、扣费通知 | 用户需及时了解订阅状态 | 异步通知 |

## 入口分析（W3H）

| 入口 | Who | What | Why | How |
|------|-----|------|-----|-----|
| 用户订阅 | User | 选择套餐并订阅 | 用户需要使用付费功能 | `POST /api/subscriptions` |
| 用户变更 | User | 升级/降级套餐 | 需求变化需调整套餐 | `PUT /api/subscriptions/:id/plan` |
| 用户取消 | User | 取消订阅 | 不再需要付费功能 | `POST /api/subscriptions/:id/cancel` |
| 自动续费 | Cron | 到期自动扣费 | 确保服务不中断 | `cron '0 0 * * *'` |
| 到期提醒 | Cron | 提前通知用户 | 给用户续费或备份数据的时间 | `cron '0 9 * * *'` |

## Mermaid 图

```mermaid
flowchart TD
    ENTRY_SUBSCRIBE["👤 用户选择套餐订阅<br/>trigger: user<br/>entry: POST /api/subscriptions<br/>role: User"]
    ENTRY_CHANGE["👤 用户变更套餐(升降级)<br/>trigger: user<br/>entry: PUT /api/subscriptions/:id/plan<br/>role: User"]
    ENTRY_CANCEL["👤 用户取消订阅<br/>trigger: user<br/>entry: POST /api/subscriptions/:id/cancel<br/>role: User"]
    ENTRY_RENEW["⏰ 自动续费扫描(确保服务连续)<br/>trigger: cron<br/>entry: cron '0 0 * * *'<br/>role: System"]
    ENTRY_REMIND["⏰ 到期提醒(给用户决策时间)<br/>trigger: cron<br/>entry: cron '0 9 * * *'<br/>role: System"]

    subgraph B01["👤 B01 订阅管理"]
        %% Why: 用户需要灵活管理订阅，控制成本
        direction TB
        B01-N01["查询可用套餐<br/>GET /api/plans<br/>read: plan<br/>role: User"]
        B01-N02{"当前是否有订阅(防重复)<br/>condition: user.active_subscription exists"}
        B01-N03["创建订阅<br/>write: subscription<br/>状态: → S01_TRIAL/S02_ACTIVE<br/>role: User"]
        B01-N04["计算差价(升降级)<br/>read: plan, subscription<br/>role: System"]
        B01-N05{"差价是否为正(升级需补差)<br/>condition: price_diff > 0"}
        B01-N06["立即扣费补差价<br/>external: payment<br/>fallback: 阻止变更<br/>role: System"]
        B01-N07["更新订阅套餐<br/>update: subscription.plan_id<br/>role: System"]
        B01-N08["标记取消(到期后生效)<br/>update: subscription.cancel_at_period_end=true<br/>role: User"]
    end

    subgraph B02["⚙️ B02 计费引擎"]
        %% Why: 确保收费准确按时，账单清晰
        direction TB
        B02-N01["生成账单(按周期计费)<br/>write: invoice<br/>role: System"]
        B02-N02{"是否有有效支付方式<br/>condition: user.payment_method exists"}
        B02-N03["自动扣费<br/>external: payment<br/>fallback: retry×3 → 标记欠费<br/>role: System"]
        B02-N04["更新订阅状态(续费成功)<br/>状态: S02_ACTIVE<br/>update: subscription.current_period_end<br/>role: System"]
        B02-N05["标记欠费(扣费失败)<br/>状态: S02→S04_PAST_DUE<br/>update: subscription.status<br/>role: System"]
        B02-N06["宽限期到期(彻底停服)<br/>状态: S04→S05_CANCELLED<br/>update: subscription.status<br/>role: System"]
        B02-N07["计算用量费用(超额部分)<br/>read: usage, plan.limits<br/>role: System"]
    end

    subgraph B03["🔒 B03 权限控制"]
        %% Why: 订阅等级决定可用功能，每次请求都须拦截校验
        direction TB
        B03-N01["拦截请求，查询用户订阅等级<br/>read: subscription, plan<br/>cache: user_plan<br/>role: System"]
        B03-N02{"功能是否在套餐内<br/>condition: feature in plan.features"}
        B03-N03{"用量是否超限<br/>condition: usage <= plan.limit"}
        B03-N04["放行请求<br/>role: System"]
        B03-N05["拒绝访问(引导升级)<br/>返回 403: 需升级套餐<br/>role: System"]
        B03-N06["标记超额用量(按量计费)<br/>write: usage_record<br/>role: System"]
    end

    subgraph B04["🔔 B04 通知"]
        %% Why: 用户需及时了解订阅和账单状态
        direction TB
        B04-N01["发送订阅变更通知<br/>external: email<br/>fallback: retry×2 → log<br/>role: System"]
        B04-N02["发送扣费通知<br/>external: email<br/>fallback: log<br/>role: System"]
        B04-N03["发送到期提醒(续费或备份)<br/>external: email<br/>fallback: log<br/>role: System"]
        B04-N04["发送欠费警告(催缴)<br/>external: email, sms<br/>fallback: retry×2 → log<br/>role: System"]
    end

    ENTRY_SUBSCRIBE --> B01-N01
    B01-N01 --> B01-N02
    B01-N02 -->|"是: 已有订阅"| ERR_DUPLICATE["resultNode: 已有活跃订阅"]
    B01-N02 -->|"否: 新订阅"| B01-N03
    B01-N03 -.->|"event: subscription.created(通知)"| B04-N01

    ENTRY_CHANGE --> B01-N04
    B01-N04 --> B01-N05
    B01-N05 -->|"是: 升级"| B01-N06
    B01-N05 -->|"否: 降级"| B01-N07
    B01-N06 --> B01-N07
    B01-N07 -.->|"event: subscription.changed(通知)"| B04-N01

    ENTRY_CANCEL --> B01-N08
    B01-N08 -.->|"event: subscription.cancel_scheduled(通知)"| B04-N01

    ENTRY_RENEW --> B02-N01
    B02-N01 --> B02-N07
    B02-N07 --> B02-N02
    B02-N02 -->|否| B02-N05
    B02-N02 -->|是| B02-N03
    B02-N03 -->|成功| B02-N04
    B02-N03 -->|失败| B02-N05
    B02-N04 -.->|"event: subscription.renewed(通知)"| B04-N02
    B02-N05 -.->|"event: subscription.past_due(催缴)"| B04-N04

    ENTRY_REMIND --> B04-N03

    B03-N01 --> B03-N02
    B03-N02 -->|否| B03-N05
    B03-N02 -->|是| B03-N03
    B03-N03 -->|是| B03-N04
    B03-N03 -->|否| B03-N06

    RESULT_SUBSCRIBED["resultNode: 订阅成功"]
    RESULT_CHANGED["resultNode: 套餐已变更"]
    RESULT_CANCELLED["resultNode: 将在周期结束后取消"]

    B01-N03 --> RESULT_SUBSCRIBED
    B01-N07 --> RESULT_CHANGED
    B01-N08 --> RESULT_CANCELLED

    classDef triggerUser fill:#3D2C00,stroke:#FBBF24,color:#FEF3C7,stroke-width:2px
    classDef triggerCron fill:#1A2A3A,stroke:#60A5FA,color:#DBEAFE,stroke-width:2px
    classDef process fill:#172033,stroke:#5AA9E6,color:#E5EDF7,stroke-width:2px
    classDef decision fill:#1A3A2D,stroke:#2E7D32,color:#E8F5E9,stroke-width:2px
    classDef error fill:#4A1D24,stroke:#FB7185,color:#FFE4E6,stroke-width:2px
    classDef resultNode fill:#173E2D,stroke:#34D399,color:#D1FAE5,stroke-width:2px

    class ENTRY_SUBSCRIBE,ENTRY_CHANGE,ENTRY_CANCEL triggerUser
    class ENTRY_RENEW,ENTRY_REMIND triggerCron
    class B01-N01,B01-N03,B01-N04,B01-N06,B01-N07,B01-N08,B02-N01,B02-N03,B02-N04,B02-N05,B02-N06,B02-N07,B03-N01,B03-N04,B03-N05,B03-N06,B04-N01,B04-N02,B04-N03,B04-N04 process
    class B01-N02,B01-N05,B02-N02,B03-N02,B03-N03 decision
    class ERR_DUPLICATE error
    class RESULT_SUBSCRIBED,RESULT_CHANGED,RESULT_CANCELLED resultNode
```

## 状态机

```
S01_TRIAL → S02_ACTIVE → S03_CANCEL_PENDING → S05_CANCELLED
                ↓                ↑
           S04_PAST_DUE ────────┘(扣费失败→宽限期→续费成功)
                ↓
           S05_CANCELLED(宽限期到期)
```

## 异常路径清单

| 触发点 | 错误码 | Why | 恢复方式 |
|--------|--------|-----|---------|
| B01-N02 | 409 | 已有活跃订阅 | 返回提示 |
| B01-N06 | 502 | 补差价扣费失败 | 阻止变更 |
| B02-N02 | 400 | 无有效支付方式 | 标记欠费 |
| B02-N03 | 502 | 自动扣费失败 | retry×3 → 标记欠费 |
| B03-N02 | 403 | 功能不在套餐内 | 返回引导升级 |
| B03-N03 | 403 | 用量超限 | 标记超额计费 |
| B04-N01 | 502 | 邮件发送失败 | retry×2 → log |
| B04-N04 | 502 | 欠费催缴发送失败 | retry×2 → log |

## 常见变异

| 变异点 | 默认方案 | 替代方案 |
|--------|---------|---------|
| 计费周期 | 月付 | 年付/季付/按量 |
| 试用 | 免费试用 N 天 | 无试用 / 需绑卡试用 |
| 降级生效 | 立即生效 | 当前周期结束后生效 |
| 取消策略 | 期末取消 | 立即取消 + 按比例退款 |
| 用量计费 | 无 | 超额按量收费（API 调用/存储） |
| 多席位 | 无 | 按席位计费 |
