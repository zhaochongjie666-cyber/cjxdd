# T04: 电商下单流程模板

## 适用场景

- B2C 电商下单：购物车 → 下单 → 支付 → 发货 → 确认收货
- 库存扣减、支付集成、订单状态机
- 支付回调、超时取消、退款

## 泳道设计（W3H）

| 泳道 | Who | What | Why | How |
|------|-----|------|-----|-----|
| B01 买家操作 | Buyer | 购物车管理、地址填写 | 买家需要选择商品并确认收货信息 | HTTP API + 前端表单 |
| B02 订单管理 | Buyer, Seller, System | 订单全生命周期管理 | 订单是交易的核心载体，状态必须准确 | 状态机 + 事件驱动 |
| B03 支付 | System, External | 支付创建、回调、退款 | 资金流转必须可靠、幂等、可追溯 | 第三方支付 SDK + Webhook |
| B04 库存 | System | 库存预占/扣减/释放 | 防超卖是电商的生命线 | 分布式锁 + 预占机制 |
| B05 通知与物流 | System | 状态通知、物流对接 | 用户需要实时了解订单状态 | 异步通知 + 物流 API |

## 入口分析（W3H）

| 入口 | Who | What | Why | How |
|------|-----|------|-----|-----|
| 用户下单 | Buyer | 发起购买流程 | 用户决定购买商品 | `POST /api/orders` |
| 支付回调 | 支付网关 | 确认支付结果 | 资金状态变更必须通知下游 | `POST /api/payments/callback` |
| 超时取消 | Cron | 清理超时未支付订单 | 防止恶意占库存 | `cron '*/5 * * * *'` |
| 卖家发货 | Seller | 履约发货 | 买家付款后卖家需履约 | `POST /api/orders/:id/ship` |
| 买家退款 | Buyer | 发起逆向流程 | 商品问题需要退款机制 | `POST /api/orders/:id/refund` |

## Mermaid 图

```mermaid
flowchart TD
    ENTRY_ORDER["👤 买家点击「去结算」<br/>trigger: user<br/>entry: POST /api/orders<br/>role: Buyer"]
    ENTRY_PAYCALLBACK["🔗 支付网关异步通知<br/>trigger: webhook<br/>entry: POST /api/payments/callback<br/>role: External"]
    ENTRY_TIMEOUT["⏰ 超时订单扫描(释放资源)<br/>trigger: cron<br/>entry: cron '*/5 * * * *'<br/>role: System"]
    ENTRY_SHIP["👤 卖家发货(履约)<br/>trigger: user<br/>entry: POST /api/orders/:id/ship<br/>role: Seller"]
    ENTRY_REFUND["👤 买家申请退款(逆向)<br/>trigger: user<br/>entry: POST /api/orders/:id/refund<br/>role: Buyer"]

    subgraph B01["👤 B01 买家操作"]
        %% Why: 买家需要确认购买意图和收货信息
        direction TB
        B01-N01["获取购物车选中商品<br/>GET /api/cart/items<br/>read: cart_item<br/>role: Buyer"]
        B01-N02{"购物车是否为空(防空单)<br/>condition: cart.selected_count > 0"}
        B01-N03["获取收货地址<br/>GET /api/addresses<br/>read: address<br/>role: Buyer"]
        B01-N04{"地址是否完整(确保可配送)<br/>condition: name & phone & detail non-empty"}
    end

    subgraph B02["📦 B02 订单管理"]
        %% Why: 订单是交易核心载体，状态必须准确
        direction TB
        B02-N01["创建订单(锁定交易意图)<br/>POST /api/orders<br/>write: order<br/>状态: → S01_PENDING_PAY<br/>role: Buyer"]
        B02-N02["计算订单金额(确保价格准确)<br/>read: product.price, coupon<br/>role: System"]
        B02-N03{"金额是否有效(防零金额欺诈)<br/>condition: total > 0 & coupon valid"}
        B02-N04["保存订单到 DB(持久化交易)<br/>write: order, order_item<br/>lock: order.order_no<br/>role: System"]
        B02-N05["清空已下单的购物车项(避免重复下单)<br/>DELETE /api/cart/items<br/>delete: cart_item<br/>role: System"]
        B02-N06["超时自动取消(释放资源防恶意占库存)<br/>状态: S01→S06_CANCELLED<br/>update: order.status<br/>role: System"]
        B02-N07["支付成功更新订单(确认资金到账)<br/>状态: S01→S02_PAID<br/>update: order.status<br/>role: System"]
        B02-N08["发货更新订单(履约)<br/>状态: S02→S03_SHIPPED<br/>update: order.status, tracking_no<br/>role: Seller"]
        B02-N09["确认收货(完成交易闭环)<br/>状态: S03→S04_COMPLETED<br/>update: order.status<br/>role: Buyer"]
        B02-N10["申请退款(逆向流程)<br/>状态: S02/S03→S05_REFUNDING<br/>write: refund<br/>role: Buyer"]
        B02-N11["退款完成(资金回退)<br/>状态: S05→S06_CANCELLED<br/>update: order.status<br/>role: System"]
    end

    subgraph B03["💳 B03 支付"]
        %% Why: 资金流转必须可靠、幂等、可追溯
        direction TB
        B03-N01["创建支付单(记录资金意图)<br/>POST /api/payments<br/>write: payment<br/>role: System"]
        B03-N02["调用第三方支付(桥接外部资金渠道)<br/>external: alipay/wechat<br/>fallback: retry×2 → 返回支付失败"]
        B03-N03{"校验回调签名(防伪造回调)<br/>condition: signature valid & amount match"}
        B03-N04["更新支付单状态(确认资金到账)<br/>update: payment.status<br/>role: System"]
        B03-N05{"支付是否重复通知(防重复处理)<br/>condition: payment.status ≠ PAID<br/>role: System"}
        B03-N06["处理退款(资金回退)<br/>external: alipay/wechat<br/>fallback: retry×3 → 人工处理队列"]
    end

    subgraph B04["📊 B04 库存"]
        %% Why: 防超卖是电商生命线
        direction TB
        B04-N01["预占库存(锁定可用量防超卖)<br/>update: inventory.locked_count<br/>lock: inventory.sku<br/>role: System"]
        B04-N02{"库存是否充足(可售性校验)<br/>condition: available_count >= order.quantity"}
        B04-N03["扣减库存(确认消耗)<br/>update: inventory.count, inventory.locked_count<br/>lock: inventory.sku<br/>role: System"]
        B04-N04["释放库存(取消/退款回补可用量)<br/>update: inventory.locked_count<br/>lock: inventory.sku<br/>role: System"]
    end

    subgraph B05["🔔 B05 通知与物流"]
        %% Why: 用户需实时了解订单状态，物流是履约的最后一步
        direction TB
        B05-N01["发送订单状态变更通知(通知用户)<br/>external: sms, push<br/>fallback: retry×2 → log<br/>role: System"]
        B05-N02["对接物流系统(追踪配送)<br/>external: logistics_api<br/>fallback: retry×3 → manual queue<br/>role: System"]
    end

    ENTRY_ORDER --> B01-N01
    B01-N01 --> B01-N02
    B01-N02 -->|否| RESULT_EMPTY["resultNode: 购物车为空"]
    B01-N02 -->|是| B01-N03
    B01-N03 --> B01-N04
    B01-N04 -->|否| ERR_ADDR["resultNode: 提示补全地址"]
    B01-N04 -->|是| B02-N01

    B02-N01 --> B02-N02
    B02-N02 --> B02-N03
    B02-N03 -->|"否: 金额异常/券失效"| ERR_PRICE["resultNode: 提示金额异常"]
    B02-N03 -->|是| B02-N04
    B02-N04 --> B04-N01
    B04-N01 --> B04-N02
    B04-N02 -->|"否: stock < quantity"| ERR_STOCK["resultNode: 库存不足"]
    B04-N02 -->|"是: 预占成功"| B02-N05
    B02-N05 --> B03-N01
    B03-N01 --> B03-N02
    B03-N02 --> RESULT_PAY["resultNode: 返回支付页面"]

    ENTRY_PAYCALLBACK --> B03-N03
    B03-N03 -->|"否: 签名无效"| ERR_CALLBACK["resultNode: 忽略非法回调"]
    B03-N03 -->|是| B03-N05
    B03-N05 -->|"是: 已处理"| RESULT_DUPLICATE["resultNode: 幂等返回成功"]
    B03-N05 -->|"否: 首次通知"| B03-N04
    B03-N04 -.->|"event: payment.completed(通知订单和库存)"| B02-N07
    B03-N04 -.->|"event: payment.completed(扣减库存)"| B04-N03

    ENTRY_TIMEOUT --> B02-N06
    B02-N06 -.->|"event: order.cancelled(释放库存)"| B04-N04
    B02-N06 -.->|"event: order.cancelled(通知用户)"| B05-N01

    B02-N07 -.->|"event: order.paid(通知用户)"| B05-N01
    B04-N03 -.->|"event: inventory.deducted(通知用户)"| B05-N01

    ENTRY_SHIP --> B02-N08
    B02-N08 --> B05-N02
    B02-N08 -.->|"event: order.shipped(通知用户)"| B05-N01

    B02-N09 -.->|"event: order.completed(通知用户)"| B05-N01

    ENTRY_REFUND --> B02-N10
    B02-N10 --> B03-N06
    B03-N06 -.->|"event: refund.completed(退款到账)"| B02-N11
    B02-N11 -.->|"event: order.refunded(释放库存)"| B04-N04
    B02-N11 -.->|"event: order.refunded(通知用户)"| B05-N01

    classDef triggerUser fill:#3D2C00,stroke:#FBBF24,color:#FEF3C7,stroke-width:2px
    classDef triggerCron fill:#1A2A3A,stroke:#60A5FA,color:#DBEAFE,stroke-width:2px
    classDef triggerWebhook fill:#2A1850,stroke:#A78BFA,color:#F4F0FF,stroke-width:2px
    classDef process fill:#172033,stroke:#5AA9E6,color:#E5EDF7,stroke-width:2px
    classDef decision fill:#1A3A2D,stroke:#2E7D32,color:#E8F5E9,stroke-width:2px
    classDef error fill:#4A1D24,stroke:#FB7185,color:#FFE4E6,stroke-width:2px
    classDef resultNode fill:#173E2D,stroke:#34D399,color:#D1FAE5,stroke-width:2px

    class ENTRY_ORDER,ENTRY_SHIP,ENTRY_REFUND triggerUser
    class ENTRY_TIMEOUT triggerCron
    class ENTRY_PAYCALLBACK triggerWebhook
    class B01-N01,B01-N03,B02-N01,B02-N02,B02-N04,B02-N05,B02-N06,B02-N07,B02-N08,B02-N09,B02-N10,B02-N11,B03-N01,B03-N02,B03-N04,B03-N06,B04-N01,B04-N03,B04-N04,B05-N01,B05-N02 process
    class B01-N02,B01-N04,B02-N03,B03-N03,B03-N05,B04-N02 decision
    class ERR_CALLBACK error
    class RESULT_EMPTY,ERR_ADDR,ERR_PRICE,ERR_STOCK,RESULT_PAY,RESULT_DUPLICATE resultNode
```

## 状态机

```
S01_PENDING_PAY → S02_PAID → S03_SHIPPED → S04_COMPLETED
       ↓               ↓
S06_CANCELLED    S05_REFUNDING → S06_CANCELLED

S01 → S06: 超时 30 分钟未支付（cron 扫描）
Why: 释放资源，防止恶意占库存
```

## W3H 逐节点速查

| 节点 | Who | What | Why | How |
|------|-----|------|-----|-----|
| B01-N02 | Buyer | 检查购物车 | 防空单提交 | condition: count > 0 |
| B01-N04 | Buyer | 检查地址 | 确保可配送 | condition: 必填字段 |
| B02-N03 | System | 校验金额 | 防零金额欺诈 | condition: total > 0 |
| B04-N01 | System | 预占库存 | 防超卖 | lock + update locked_count |
| B04-N02 | System | 检查库存 | 可售性校验 | condition: available >= qty |
| B03-N03 | External | 校验签名 | 防伪造回调 | signature + amount match |
| B03-N05 | System | 去重检查 | 防重复处理 | payment.status ≠ PAID |
| B02-N06 | System(Cron) | 超时取消 | 释放资源 | update status + 释放库存 |
| B04-N04 | System | 释放库存 | 回补可用量 | update locked_count |
| B03-N06 | System | 退款 | 资金回退 | external SDK + retry |

## 入口与触发矩阵

| 入口节点 | 触发类型 | 进入节点 | 幂等策略 | Why |
|---------|---------|---------|---------|-----|
| ENTRY_ORDER | USER | B01-N01 | 防重复提交 | 用户购买意图 |
| ENTRY_PAYCALLBACK | WEBHOOK | B03-N03 | paymentId 去重 | 资金确认 |
| ENTRY_TIMEOUT | CRON | B02-N06 | orderId + 状态 | 释放资源 |
| ENTRY_SHIP | USER | B02-N08 | orderId 幂等 | 卖家履约 |
| ENTRY_REFUND | USER | B02-N10 | orderId + 退款单 | 逆向流程 |

## 异常路径清单

| 触发点 | 错误码 | Why | 恢复方式 |
|--------|--------|-----|---------|
| B01-N02 | 400 | 购物车为空 | 返回购物车页 |
| B01-N04 | 400 | 地址不完整无法配送 | 提示补全 |
| B02-N03 | 400 | 金额异常可能为欺诈 | 提示重新选择 |
| B04-N02 | 409 | 库存不足超卖风险 | 提示库存不足 |
| B03-N02 | 502 | 支付网关不可用 | 重试 2 次 |
| B03-N03 | 400 | 签名无效可能是伪造 | 忽略 + 日志 |
| B03-N05 | 200 | 重复通知 | 幂等返回 |
| B03-N06 | 502 | 退款接口超时 | 重试 3 次 → 人工队列 |

## 关键设计决策

| 决策点 | 方案 | Why |
|--------|------|-----|
| 库存扣减时机 | 下单预占 + 支付扣减 | 平衡防超卖与用户体验 |
| 超时取消 | cron 扫表 | 简单可靠 |
| 幂等 | paymentId 去重 | 防重复支付 |
| 分布式锁 | SKU 维度锁 | 粒度合适，防超卖 |
| 退款 | 异步 + 人工兜底 | 第三方退款有延迟 |

## 常见变异

| 变异点 | 默认方案 | 替代方案 |
|--------|---------|---------|
| 库存扣减 | 下单预占 + 支付扣减 | 下单直接扣减（简化，但未支付占库存） |
| 超时取消 | cron 扫表 | Redis 延迟消息 / RocketMQ 延迟队列 |
| 支付方式 | 支付宝/微信 | 加余额支付、积分抵扣 |
| 优惠计算 | 服务端计算 | 前端预览 + 服务端二次校验 |
| 物流对接 | 异步回调 | 卖家手动填单号 |
| 拼团/秒杀 | 无 | 新增 B06 活动域，库存改为活动库存 |
