# 节点即契约 — Flow Mermaid 编写约定

> 核心原则：Flow 图是 AI 的执行契约，不是给人看的示意图。每个节点、每条边都必须精确到 AI 能机械翻译成代码，不需要"猜"。

## 目录

- [0. 思维框架：Who / What / Why / How](#0-思维框架who-what-why-how)
- [1. 节点结构（W3H 约定）](#1-节点结构w3h-约定)
- [2. 多入口触发约定](#2-多入口触发约定)
- [3. 决策节点](#3-决策节点)
- [4. 边协议（W3H）](#4-边协议w3h)
- [5. 异常处理约定](#5-异常处理约定)
- [6. 泳道组织约定](#6-泳道组织约定)
- [7. 完整性检查清单（W3H）](#7-完整性检查清单w3h)
- [8. 速查：节点类型与配色](#8-速查节点类型与配色)

## 0. 思维框架：Who / What / Why / How

所有架构设计的底层思维。不限于 Flow 图，不限于某个层。每设计一个元素，必须能回答这四个问题：

| 维度 | 问题 | 回答什么 | AI 翻译 |
|------|------|---------|---------|
| **Who** | 谁触发？谁有权？ | 主体、角色、权限边界 | 鉴权中间件、角色守卫、调用方识别 |
| **What** | 做什么事？ | 业务动作、领域事件 | 函数名、类名、事件名 |
| **Why** | 为什么做？ | 业务目的、存在的理由 | 校验规则、错误文案、测试断言、注释 |
| **How** | 怎么做？ | 技术实现、数据操作 | HTTP 方法、SQL、SDK 调用、状态迁移 |

### 为什么 Why 是最容易被忽略、又最关键的

- 没有 Who → AI 不写鉴权
- 没有 What → AI 函数名模糊
- 没有 How → AI 不知道技术方案
- **没有 Why → AI 写了代码但不知道为什么，遇到边界情况就出错**

Why 的实际作用：

```
节点: "校验订单金额"
  没有 Why: AI 写 if (amount <= 0) throw Error()  — 校验了，但错误文案是 "Invalid input"
  有了 Why: "防零金额/负金额欺诈" — AI 写 throw OrderFraudException("订单金额异常，请重新提交")

节点: "超时自动取消"
  没有 Why: AI 写 setTimeout(cancelOrder, 30min)  — 取消了，但不释放库存
  有了 Why: "释放资源避免恶意占库存" — AI 写 cancel + releaseInventory + notifyUser
```

### W3H 在不同层级的应用

| 层级 | Who | What | Why | How |
|------|-----|------|-----|-----|
| **泳道** | 谁负责这个领域？ | 这个领域管什么？ | 这个领域为什么存在？ | 领域内聚合怎么组织？ |
| **节点** | 谁触发？谁有权？ | 做什么动作？ | 为什么需要这个动作？ | 怎么实现？读写什么？ |
| **边** | 谁发起调用？ | 传递什么信息？ | 为什么需要这条连接？ | 同步/异步？载荷？ |
| **入口** | 触发类型？ | 进入哪个流程？ | 什么条件下触发？ | 技术入口是什么？ |

## 1. 节点结构（W3H 约定）

每个节点是一个微契约，按 W3H 组织：

```
BXX-NYY["What: 动词+宾语(Why: 业务目的)<br/>How: HTTP方法 路径 / 数据操作<br/>Who: role: 角色"]
```

### 四行约定

| 行 | W3H 维度 | 内容 | 作用 |
|----|---------|------|------|
| 第1行 | **What + Why** | 动词+宾语 + 业务目的 | 函数名 + 校验/错误/测试的依据 |
| 第2行 | **How** | 接口契约 / 状态迁移 | 路由、HTTP 方法、技术实现 |
| 第3行 | **How** | 数据契约 | 涉及的聚合/表/外部服务 |
| 第4行 | **Who** | 角色约束 | 鉴权逻辑 |

**简化规则**：当节点语义明确时，第2-4行可合并为 2 行（如 `read: session` + `role: User`），Why 在"不言自明"的节点上可省略。判断标准：**省略的行必须在上下文（泳道 Why 注释、前驱节点）中可推导，否则不可省略。**

### 第1行：What + Why

格式：`动词+宾语`，Why 以括号内短句补充。

```
校验订单金额(防零金额欺诈)
扣减库存(防止超卖)
超时自动取消(释放资源避免恶意占库存)
记录审计日志(满足合规追溯要求)
发送支付回调通知(通知下游系统状态变更)
```

Why 不是每个节点都必须写。判断标准：
- **业务语义明确、Why 不言自明** → 可省略（如"创建订单"、"查询列表"）
- **涉及校验/限制/降级/外部依赖** → 必须写 Why（如"校验金额"、"释放库存"、"超时取消"）
- **省略后 AI 可能漏掉关联操作** → 必须写 Why

### 第2行：How（接口契约）

| 场景 | 标注方式 |
|------|---------|
| 用户交互节点 | `POST /api/resources` / `GET /api/resources/:id` |
| 内部业务节点 | `状态: S01→S02`（状态迁移） |
| 决策节点 | 不写 HTTP，写判定条件 |

### 第3行：How（数据契约）

| 关键字 | 含义 | AI 翻译 |
|--------|------|---------|
| `read: user, role` | 读取数据 | `SELECT` / `findById` / `get` |
| `write: order` | 写入/创建数据 | `INSERT` / `create` / `save` |
| `update: order.status` | 更新字段 | `UPDATE` / `setStatus` |
| `delete: session` | 删除数据 | `DELETE` / `remove` |
| `external: email, sms` | 外部服务调用 | HTTP client / SDK call |
| `cache: user_session` | 缓存操作 | Redis get/set |
| `lock: inventory` | 分布式锁 | Redis lock / DB lock |
| `idempotent: order_no` | 幂等键 | 重复请求返回已有结果 |

### 幂等标注规则

所有 `write` 节点必须标注幂等策略（AI 不说就不做幂等）：

```
B02-N04["保存订单<br/>write: order<br/>idempotent: order.request_id<br/>role: System"]
```

| 场景 | 标注方式 | 说明 |
|------|---------|------|
| 创建型写入 | `idempotent: {business_key}` | 用业务唯一键去重 |
| 更新型写入 | `idempotent: {id} + {version}` | 乐观锁或 CAS |
| 天然幂等 | `idempotent: natural` | 如覆盖写、set 操作 |
| 非幂等 | `idempotent: none` | 显式标注，提醒 AI 加防护 |

### 第4行：Who（角色约束）

- 格式：`role: 角色名`
- 多角色：`role: Admin, Manager`
- 公开：`role: Public`
- 系统内部：`role: System`

### 完整示例

```
B02-N03["校验订单金额(防零金额欺诈)<br/>condition: total > 0 & coupon valid<br/>read: order, coupon<br/>role: System"]

B04-N01["预占库存(防止超卖)<br/>update: inventory.locked_count<br/>lock: inventory.sku<br/>role: System"]

B02-N06["超时自动取消(释放资源避免恶意占库存)<br/>状态: S01→S06_CANCELLED<br/>update: order.status<br/>role: System"]

B01-N01["创建订单<br/>POST /api/orders<br/>write: order<br/>role: Buyer"]
```

## 2. 多入口触发约定

### 为什么需要显式标注入口

AI 看到一个节点，W3H 都要能回答：
- **Who**: 谁触发的？→ 决定鉴权方式
- **What**: 触发什么流程？→ 决定业务范围
- **Why**: 什么条件下触发？→ 决定触发逻辑
- **How**: 怎么触发的？→ 决定技术实现（HTTP handler / cron / event subscriber / webhook）

只有一个 START 节点 = AI 只知道主入口，其他触发点全是盲区。

### 六种触发类型

| 触发类型 | 标记 | 代码翻译 | 示例 |
|---------|------|---------|------|
| **USER** | `trigger: user` | HTTP handler / 页面组件 | 用户点击按钮、提交表单 |
| **CRON** | `trigger: cron` | 定时任务 / scheduler | 超时自动取消、每日对账 |
| **WEBHOOK** | `trigger: webhook` | Webhook endpoint | 支付回调、Git push 回调 |
| **EVENT** | `trigger: event` | 事件订阅 / message consumer | 监听 domain.event |
| **ADMIN** | `trigger: admin` | 管理后台 HTTP handler | 管理员手动触发 |
| **SYSTEM** | `trigger: system` | 启动钩子 / 初始化 | 服务启动、数据迁移 |

### 入口节点命名约定（W3H）

```
ENTRY_XX["What: 触发描述<br/>Who: trigger: 类型<br/>How: entry: 技术实现方式"]
```

Why 在入口节点的体现是**触发条件**——什么情况下这个入口会被激活。

示例：

```
ENTRY_ORDER["👤 用户下单<br/>trigger: user<br/>entry: POST /api/orders<br/>role: Buyer"]

ENTRY_TIMEOUT["⏰ 超时订单扫描<br/>trigger: cron<br/>entry: cron '*/5 * * * *'<br/>role: System"]

ENTRY_PAYCALLBACK["🔗 支付回调<br/>trigger: webhook<br/>entry: POST /api/payments/callback<br/>role: External"]
```

### 入口节点配色

```mermaid
classDef triggerUser fill:#3D2C00,stroke:#FBBF24,color:#FEF3C7,stroke-width:2px
classDef triggerCron fill:#1A2A3A,stroke:#60A5FA,color:#DBEAFE,stroke-width:2px
classDef triggerWebhook fill:#2A1850,stroke:#A78BFA,color:#F4F0FF,stroke-width:2px
classDef triggerEvent fill:#1A3A2D,stroke:#34D399,color:#D1FAE5,stroke-width:2px,stroke-dasharray: 5 5
classDef triggerAdmin fill:#3B1028,stroke:#F472B6,color:#FCE7F3,stroke-width:2px
classDef triggerSystem fill:#1F2937,stroke:#6B7280,color:#F3F4F6,stroke-width:2px
```

### 入口分布

一个完整的 Flow 图通常有 1 个主入口 + N 个辅助入口：

```
主入口：   ENTRY_ORDER["用户下单"]      → happy path
辅助入口： ENTRY_TIMEOUT["超时扫描"]     → 异常处理
辅助入口： ENTRY_PAYCALLBACK["支付回调"] → 外部集成
辅助入口： ENTRY_REFUND["用户退款"]     → 逆向流程
```

### 入口检查清单

| 检查项 | 通过标准 |
|--------|---------|
| 每个节点都能追溯到某个入口？ | 没有悬空节点（无入边的非入口节点） |
| 每个入口标注了 Who？ | trigger: user/cron/webhook/event/admin/system |
| 每个入口标注了 How？ | entry: HTTP 方法 / cron 表达式 / 事件名 |
| AI 看到入口能写出代码入口函数？ | trigger → 函数类型，entry → 函数签名 |

## 3. 决策节点

决策节点必须写**可判定的条件表达式**（Why + How）：

```
B02-N03{"库存是否充足(防止超卖)<br/>condition: inventory.count >= order.quantity"}
```

不允许只写"是否通过"：

```
B02-N03{"校验是否通过"}  ← 错误：AI 不知道判定什么
B02-N03{"校验金额是否有效(防零金额欺诈)<br/>condition: total > 0 & coupon valid"}  ← 正确
```

### 决策条件精确性规则

condition 必须满足以下**全部条件**：

| 规则 | 说明 | 错误示例 | 正确示例 |
|------|------|---------|---------|
| **可判定** | AI 能直接翻译为 if 表达式 | `quality & compliance check` | `title.length >= 5 & body.length >= 100 & no banned_words` |
| **有量纲** | 数值条件有明确阈值 | `score >= threshold` | `quality_score >= 0.8` |
| **无元描述** | 不描述"做什么"，描述"判定什么" | `guard expression evaluates to true` | `guard_rule.expression eval → true`（通用模板）或 `order.amount > 0`（具体业务） |
| **引用数据源** | condition 中的变量在节点标注中有来源 | `enough stock` | `inventory.count >= order.quantity` |

**唯一例外**：通用抽象模板（如 T09 状态机）可使用参数化条件（`guard_rule.expression eval → true`），但必须标注 `read: guard_rule` 说明数据来源。

## 4. 边协议（W3H）

每条边也遵循 W3H：

| W3H | 边标签要素 | 必填 |
|-----|-----------|------|
| Who | 谁发起的调用 | 推荐标注在源节点 |
| What | 传递什么信息（载荷） | 推荐 |
| Why | 为什么需要这条连接（条件/原因） | 是 |
| How | 怎么调用（同步/异步） | 是 |

### 同步调用（实线）

```
B01-N02 -->|"HTTP POST(创建审批任务)<br/>payload: {approvalId, type}"| B02-N01
```

### 异步事件（虚线）

```
B02-N05 -.->|"event: order.created(通知下游)<br/>payload: {orderId, items}"| B03-N01
```

### 条件分支

```
B02-N03 -->|"是: stock >= quantity(充足)"| B02-N05
B02-N03 -->|"否: stock < quantity(不足)"| B02-N04
```

## 5. 异常处理约定

### 约定式标注（不展开分支）

```
B03-N02["发送通知(通知用户状态变更)<br/>external: email<br/>fallback: retry×3 → write: notification_failed"]
```

### 展开分支的时机

异常后走**不同下游**时展开：

```
B01-N02 -->|否| B01-N03["返回 403(无权限访问该资源)"]
B02-N03 -->|否| B02-N04["写入失败原因(引导用户修正) → 返回编辑页"]
```

判断标准：**异常后的下一步不一样 → 画分支；只是记日志 → 写在节点内。**

### 常见错误码标注

| 状态码 | 含义 | 标注方式 |
|--------|------|---------|
| 400 | 参数校验失败 | `返回 400: {field} 格式错误` |
| 401 | 未认证 | `返回 401: 需要登录` |
| 403 | 无权限 | `返回 403: 无{resource}操作权限` |
| 404 | 资源不存在 | `返回 404: {resource} 不存在` |
| 409 | 冲突 | `返回 409: {resource} 已存在/状态冲突` |
| 429 | 限流 | `返回 429: 请求过于频繁` |
| 500 | 服务异常 | `返回 500: 系统异常，请稍后重试` |
| 502/503 | 外部依赖不可用 | `fallback: retry×3 → 降级处理` |

## 6. 泳道组织约定

### 泳道 = 限界上下文（W3H）

每个泳道必须能回答 W3H：

```
subgraph B01["B01 用户与权限 — Who: 全体用户, What: 身份与权限管理, Why: 确保只有合法用户操作合法资源, How: JWT鉴权+RBAC"]
```

简写形式（推荐）：

```
subgraph B01["👤 B01 用户与权限"]
    %% Why: 确保只有合法用户操作合法资源
    %% How: JWT鉴权 + RBAC
    direction TB
    ...
end
```

### 泳道内约束

- 节点数 ≤ 10（超过说明领域边界太大）
- 每个节点用一行话能说清 What（需要两行 → 拆）
- 解释 Why 这个节点放这个泳道不超过 3 秒

### 跨泳道通信

| 类型 | 语法 | Why | How |
|------|------|-----|-----|
| 同步调用 | `-->|HTTP/RPC|` | 需要即时结果 | 调用方等待返回 |
| 异步事件 | `-.->|event: domain.action|` | 解耦、最终一致 | 不等待，事件驱动 |
| 共享读取 | `-->|query|` | 只读共享数据 | 无副作用 |

## 7. 完整性检查清单（W3H）

图写完后逐节点检查，每个维度都要有答案：

### Who 检查

| 检查项 | 通过标准 |
|--------|---------|
| AI 能写鉴权逻辑？ | 节点有 role 标注 |
| 每个入口标注了触发者？ | trigger 类型明确 |

### What 检查

| 检查项 | 通过标准 |
|--------|---------|
| AI 能写出函数签名？ | 节点名 → 函数名 |
| 节点命名动词+宾语？ | 无"处理""判断""管理" |

### Why 检查

| 检查项 | 通过标准 |
|--------|---------|
| AI 能写校验规则？ | 校验节点有 Why 说明业务目的 |
| AI 能写正确的错误文案？ | 异常节点有 Why 说明为什么失败 |
| AI 能写完整的测试断言？ | 边界节点有 Why 说明业务约束 |
| AI 不会漏掉关联操作？ | Why 暗示的所有副作用都画了 |

### How 检查

| 检查项 | 通过标准 |
|--------|---------|
| AI 能确定调用方式？ | 边标签有 HTTP/event + 目标 |
| AI 能确定读写哪张表？ | 节点有 read/write 标注 |
| AI 能写幂等逻辑？ | 写入节点标注了幂等策略 |
| AI 能写并发控制？ | 竞争资源标注了 lock |
| AI 能写外部调用？ | external 节点有 fallback |

## 8. 速查：节点类型与配色

| 节点类型 | 语法 | 配色 | 用途 |
|---------|------|------|------|
| 入口触发 | `[文字]` | triggerXxx | ENTRY 节点 |
| 网关路由 | `[文字]` | gateway | API Gateway |
| 业务操作 | `[文字]` | process | CRUD / 状态迁移 |
| 决策判断 | `{"文字"}` | decision | if/else |
| 异常错误 | `[文字]` | error | catch 块 |
| 外部依赖 | `[文字]` | event | 第三方服务 |
| 最终交付 | `[文字]` | resultNode | 用户可见结果 |
