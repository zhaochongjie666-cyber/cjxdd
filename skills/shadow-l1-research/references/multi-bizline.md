# 多业务线 L1 设计规范

> 当一个项目涉及多条业务线（如用户管理、支付、订单、通知等），本规范定义如何在 L1 层清晰区分业务线、处理业务交叉、并保持 Mermaid 图分类清晰。

## 0. 业务线编号体系（BXX-NYY 路由）

### 0.1 核心原则

> **BXX（业务线编号） + NYY（节点编号） = 业务操作全局唯一坐标**
>
> 从代码出发：`@implements: {{SLUG}}-B01-N03` → 定位到 business line B01 的节点 N03 →
> 从节点出发：看 B01 的 project.flow.mermaid 感知该业务全局 → 从 project.flow.mermaid 主流程感知整个项目全局

### 0.2 编号规则

| 层级 | 标识 | 格式 | 作用域 | 示例 |
|------|------|------|--------|------|
| **业务线编号** | `BXX` | `B01`, `B02`...（两位数，01-99） | 项目全局唯一 | `B01` = 用户管理 |
| **流程节点编号** | `NYY` | `N01`, `N02`...（两位数，01-99） | 业务线内唯一 | `N03` = 提交注册表单 |
| **组合路由 ID** | `BXX-NYY` | `B01-N03` | 全局唯一 | `B01-N03` = 用户管理的注册提交节点 |
| **规则 ID** | `RYY` | `{{SLUG}}-R01` | 业务线内唯一 | 规则锚定于节点，一个节点可对应多条规则 |

### 0.3 节点粒度铁律

> **一个 Mermaid 节点 = 一个不可再拆的业务动作。**
> 如果节点内部还有子流程（多个步骤/分支/循环），必须拆分成子节点。
>
> 节点粒度直接决定代码实现质量和可追溯精度。

| 节点特征 | 处理 | 示例 |
|---------|------|------|
| 单一动作 | 保留为一个节点 | `N03[POST /api/register → 创建用户记录]` |
| 含条件分支 | 拆分为判断节点 + 结果节点 | `N03{邮箱是否已注册} → N04[注册成功] / N05[返回错误]` |
| 含异步等待 | 拆分为发送 + 等待 + 回调节点 | `N06[发送验证码] → N07[等待验证] → N08[验证回调]` |
| 含外部调用 | 标注外部依赖，失败时拆分降级节点 | `N09[调用 CRM] → N10[CRM 超时降级]` |
| 含人工操作 | 拆分出人工节点 | `N11[提交审批] → N12[管理员审批] → N13[审批结果]` |

**节点命名格式**：`NYY[动作]` 或 `NYY{判断条件}`，动作描述包含 HTTP 路径/函数名/业务动作。

### 0.4 INDEX.md 中的业务线编号

```markdown
# L1 业务索引

> 业务线子目录使用 `BXX-<slug>` 格式（如 `B01-user-management/`），文件系统可直接检索。

| B# | 业务目录 | 业务名称 | 主业务 | 状态 | 节点数 | 规则数 | 最后更新 |
|:--:|---------|---------|:-----:|:----:|:-----:|:-----:|----------|
| B01 | B01-user-management | 用户管理 | ⭐ | ✅ | 15 | 12 | 2026-05-12 |
| B02 | B02-payment | 支付系统 | | ✅ | 8 | 6 | 2026-05-12 |
| B03 | B03-notification | 通知服务 | | 🔄 | 5 | 4 | 2026-05-12 |
```

### 0.5 @implements 中的路由引用

```python
# 规则级（指向 spec 规则）
# @implements: user-management-R01, user-management-R02

# 节点级（指向 flow 节点，必须精确定位）
# @implements: user-management-B01-N03

# 函数级（同时引用规则和节点）
# @implements: user-management-R01 (B01-N03)
```

> **强制**：文件头用规则级 `@implements`，关键函数必须用节点级精确定位。节点坐标是全链路追溯的唯一锚点。

### 0.6 节点层级体系 — 跨文件引用与子节点聚合

> **核心思想**：每个 BXX-NYY 节点是全局可寻址的"原子操作"。节点可以跨文件/跨文件夹互相引用作为输入，也可以拥有子节点形成层级聚合。

#### 0.6.1 节点子层级编号

父节点可以展开为子节点，通过 `.ZZ` 后缀编号：

| 层级 | 格式 | 示例 | 说明 |
|------|------|------|------|
| **父节点** | `BXX-NYY` | `B01-N03` | 提交注册表单（聚合节点） |
| **一级子节点** | `BXX-NYY.ZZ` | `B01-N03.01` | 校验邮箱格式 |
|  |  | `B01-N03.02` | 检查邮箱是否已存在 |
|  |  | `B01-N03.03` | 创建用户记录 |
|  |  | `B01-N03.04` | 发送验证码邮件 |
| **二级子节点** | `BXX-NYY.ZZ.WW` | `B01-N03.02.01` | 查询数据库 |
|  |  | `B01-N03.02.02` | 比对结果 |
| **三级子节点** | `BXX-NYY.ZZ.WW.VV` | `B01-N03.02.01.01` | 构建 SQL |

**铁律**：
- 子节点编号最多 3 级（`.01` → `.01.01` → `.01.01.01`），超过则说明父节点粒度过粗，应重新拆分
- 父节点本身仍然是 project.flow.mermaid 中的正式节点，子节点是展开细节
- 子节点总数建议 ≤ 8 个，超过则父节点应拆为多个兄弟节点
- 子节点编号必须连续（如 N03 的子节点应为 .01, .02, .03...，禁止跳号如 .01, .02, .04）。缺号 → L1 Gate FAIL
- **Mermaid ID 与坐标映射**：project.flow.mermaid 中节点 ID 用下划线（如 `N03_01`、`N03_01_02`），因为 Mermaid 语法不支持点号；spec/wire/代码 等其他文件用点号坐标（如 `B01-N03.01`、`B01-N03.01.02`）。转换规则：`_` ↔ `.`，读取 flow 生成其他文件时必须替换

#### 0.6.2 跨文件/跨文件夹节点引用

任何节点都可以通过 BXX-NYY 坐标引用其他文件中的节点作为输入：

```
[B01-N03 提交注册] 的输出 → 作为 [B02-N01 发送欢迎邮件] 的输入
[B01-N07 支付成功] 的输出 → 作为 [B03-N02 更新库存] 的输入
```

**引用方式**：

| 场景 | 写法 | 说明 |
|------|------|------|
| **同文件引用** | `→ B01-N05` | 同一 project.flow.mermaid 内的边 |
| **跨业务线引用** | `→ B02-N01` | 不同 biz-{id} 的节点 |
| **跨文件引用** | `→ B01-N03.02` | 引用子节点，精确定位 |
| **wire 产物引用** | `data-node="B01-N03.02"` | UI 元素精确到子节点 |
| **代码引用** | `@implements: slug-R01 (B01-N03.02)` | 代码精确到子节点 |

#### 0.6.3 节点输入/输出声明

每个节点在 spec.md 中必须声明输入和输出：

```markdown
### B01-N03 提交注册表单

| 属性 | 值 |
|------|------|
| 输入 | `B01-N02` 的邮箱/密码数据 |
| 输出 | 用户记录（S01→S02） |
| 子节点 | N03.01 校验邮箱 → N03.02 查重 → N03.03 创建记录 |
| 异常 | N03.02 查重失败 → B01-N04 返回冲突 |
```

#### 0.6.4 Mermaid 中的子节点表达

**方式一：subgraph 展开**（推荐用于关键节点）

```mermaid
flowchart TD
    N02["N02 填写注册表单"] --> N03{"N03 提交注册"}
    
    subgraph N03_detail["📦 B01-N03 提交注册（4 个子步骤）"]
        direction TB
        N03_01["N03.01 校验邮箱格式"] --> N03_02{"N03.02 邮箱是否已存在"}
        N03_02 -->|否| N03_03["N03.03 创建用户记录"]
        N03_03 --> N03_04["N03.04 发送验证码邮件"]
        N03_02 -->|是| N03_ERR["N03.05 返回 409 Conflict"]
    end
    
    N03 --> N03_detail
    N03_detail --> N04["N04 展示验证码输入框"]
```

**方式二：内联标注**（推荐用于简单子节点）

```mermaid
flowchart TD
    N02["N02 填写注册表单"] --> N03_01["N03.01 校验邮箱"]
    N03_01 --> N03_02{"N03.02 邮箱已存在？"}
    N03_02 -->|否| N03_03["N03.03 创建用户 S01→S02"]
    N03_02 -->|是| N04["N04 返回 409"]
    N03_03 --> N03_04["N03.04 发送验证码"]
    N03_04 --> N05["N05 展示验证码输入框"]
```

#### 0.6.5 wire 产物中的子节点映射

UI 元素必须精确到子节点级别：

```html
<div class="card" data-node="B01-N03.01">
  <strong>邮箱校验区 [N03.01]</strong>
  <div class="input" data-node="B01-N03.01.01">邮箱输入框 [实时格式校验]</div>
  <div class="error" data-node="B01-N03.01.02">格式错误提示 [红色]</div>
</div>

<div class="card" data-node="B01-N03.03">
  <strong>提交按钮 [N03.03]</strong>
  <div class="btn" data-node="B01-N03.03.01">提交按钮 [N03.01+N03.02 通过后启用]</div>
  <div class="loading" data-node="B01-N03.03.02">Loading 动画 [提交中]</div>
</div>
```

#### 0.6.6 跨业务线节点聚合示例

```
B01 用户管理              B02 通知服务              B03 订单服务
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│ B01-N03 提交  │──输出──▶│ B02-N01 发邮件 │         │              │
│  ├─ N03.01   │         │  ├─ N01.01   │         │              │
│  ├─ N03.02   │         │  ├─ N01.02   │         │              │
│  └─ N03.03   │         │  └─ N01.03   │         │              │
└──────────────┘         └──────────────┘         └──────────────┘
                               │                         ▲
                               └──输出──────────────────▶│
                                         B03-N02 创建订单
```

**规则**：
- 跨线引用必须通过明确定义的接口节点（API/Event）
- 输出方节点必须在 spec.md 的 `## 跨业务线依赖` 章节声明
- 输入方节点必须在 spec.md 的 `## 接入点` 章节声明来源
- **双向声明强制**：当 A 的 spec 声明 `A-N03 → B-N01` 时，B 的 spec 必须在 `## 接入点` 章节反向声明"来自 A-N03"。L1 Gate 检查时验证双向声明一致性，缺失反向声明 → Gate FAIL

## 1. 业务线标识系统

### 1.1 业务线 ID 命名

| 规则 | 格式 | 示例 |
|------|------|------|
| 格式 | `biz-{领域名词}`（kebab-case，2-3 个单词） | `biz-user`, `biz-payment`, `biz-order` |
| 长度 | 不超过 3 级层级 | `biz-user-auth`（3 级），`biz-payment-alipay`（3 级） |
| 禁止 | 动词、形容词、内部代号 | ~~`biz-process`~~, ~~`biz-fast`~~ |

### 1.2 数据流程业务线

如果你的工作偏数据流程管理，以下业务线覆盖数据管道全生命周期：

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ biz-collect │───▶│  biz-transform│───▶│  biz-store  │───▶│  biz-serve  │
│   数据采集    │    │  数据转换     │    │  数据存储    │    │  数据服务    │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
        │                  │                  │                  │
        ▼                  ▼                  ▼                  ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  biz-orchest │    │  biz-quality │    │ biz-monitor │    │  biz-export │
│  管道编排     │    │  数据质量     │    │  监控告警    │    │  数据分发    │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

| 业务线 ID | 职责 | 典型能力 |
|-----------|------|----------|
| `biz-collect` | 数据采集/接入 | API 拉取、CDC、日志采集、文件上传 |
| `biz-transform` | 数据转换/清洗 | ETL、字段映射、数据标准化、聚合计算 |
| `biz-store` | 数据存储/建模 | 数仓分层、表结构、分区策略、索引 |
| `biz-serve` | 数据服务/查询 | API 查询、报表展示、数据导出、Dashboard |
| `biz-orchest` | 管道编排/调度 | DAG 定义、任务依赖、定时调度、重试策略 |
| `biz-quality` | 数据质量校验 | Schema 校验、完整性检查、异常值检测、对账 |
| `biz-monitor` | 监控告警 | 延迟告警、失败重试、血缘追踪、SLA 监控 |
| `biz-export` | 数据分发/同步 | 数据推送、消息队列、跨系统同步、文件导出 |

### 1.3 业务线分类原则

```
[核心业务]     直接产生业务价值的流程（订单、支付、注册）
  ↓
[支撑业务]     为核心业务提供能力（通知、日志、鉴权）
  ↓
[基础设施]     跨业务线共享（DB、缓存、消息队列）
```

**分类决策树：**

```
用户/调用方能否直接感知此功能？
  ├─ 是 → 核心业务（biz-order, biz-user）
  └─ 否 → 是否为核心业务不可或缺？
          ├─ 是 → 支撑业务（biz-notification, biz-audit）
          └─ 否 → 基础设施（不分配 biz-id，归入 infra 区）
```

## 2. 项目级流程总图体系

### 2.1 单图结构

```
.shadow/L1-business/project.flow.mermaid   ← 唯一项目级总图，包含所有业务域/泳道
```

### 2.2 总图职责

| 文件 | 职责 | 包含内容 |
|------|------|---------|
| `.shadow/L1-business/project.flow.mermaid` | 展示全项目端到端业务流、业务域协作、关键异常路径 | BXX 泳道 subgraph、BXX-NYY 节点、同步调用边、异步事件边、resultNode |

禁止再创建 `biz-{id}.flow.mermaid`、`biz-{id}-{module}.flow.mermaid` 等业务线独立流程图。复杂内部步骤进入 `spec.md` 规则、异常路径和状态迁移。

### 2.3 总图（project.flow.mermaid）模板

```mermaid
%%{init: {"theme": "base", "themeVariables": {"background": "#0B1220"}}}%%
flowchart TD
  %% ===== 触发源 =====
  TRIGGER[用户/外部触发] --> GATEWAY

  %% ===== 接口层 =====
  subgraph GATEWAY["🌐 API Gateway / Event Router"]
    direction LR
    API[API 路由]
    EVT[事件分发]
  end

  %% ===== 业务线 =====
  subgraph BIZ_USER["👤 biz-user"]
    U1[用户注册] --> U2[身份验证]
  end

  subgraph BIZ_PAYMENT["💳 biz-payment"]
    P1[创建支付] --> P2[支付回调]
  end

  subgraph BIZ_ORDER["📦 biz-order"]
    O1[创建订单] --> O2[订单履约]
  end

  subgraph BIZ_NOTIFY["🔔 biz-notification"]
    N1[邮件发送]
    N2[短信发送]
  end

  %% ===== 跨线连接（通过接口节点）=====
  GATEWAY -->|HTTP| BIZ_USER
  GATEWAY -->|HTTP| BIZ_ORDER
  BIZ_USER -->|event: user.registered| BIZ_NOTIFY
  BIZ_ORDER -->|event: order.created| BIZ_PAYMENT
  BIZ_PAYMENT -->|event: payment.completed| BIZ_ORDER
  BIZ_ORDER -->|event: order.shipped| BIZ_NOTIFY

  %% ===== 交付物 =====
  BIZ_USER --> R1((用户账号))
  BIZ_ORDER --> R2((订单确认))
  BIZ_NOTIFY --> R3((通知送达))

  classDef triggerNode fill:#3D2C00,stroke:#FBBF24,color:#FEF3C7,stroke-width:2px
  classDef gatewayNode fill:#1A1A3E,stroke:#7C3AED,color:#EDE9FE,stroke-width:2px,dashed
  classDef bizUser fill:#123B5D,stroke:#38BDF8,color:#E0F2FE,stroke-width:2px
  classDef bizPayment fill:#2A1850,stroke:#A78BFA,color:#F4F0FF,stroke-width:2px
  classDef bizOrder fill:#1B3A2D,stroke:#34D399,color:#D1FAE5,stroke-width:2px
  classDef bizNotify fill:#3B2F00,stroke:#F59E0B,color:#FEF3C7,stroke-width:2px
  classDef crossLine stroke-dasharray: 5 5,stroke:#FB923C,stroke-width:2px
  classDef resultNode fill:#173E2D,stroke:#34D399,color:#D1FAE5,stroke-width:2px

  class TRIGGER triggerNode
  class GATEWAY gatewayNode
  class BIZ_USER bizUser
  class BIZ_PAYMENT bizPayment
  class BIZ_ORDER bizOrder
  class BIZ_NOTIFY bizNotify
  class R1,R2,R3 resultNode
```

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

## 4. 总图泳道视觉规范

### 4.1 业务线配色表

| 业务线类型 | 背景色 | 边框色 | 文字色 | 场景 |
|-----------|--------|--------|--------|------|
| 👤 用户/身份 | `#123B5D` | `#38BDF8` | `#E0F2FE` | 注册、登录、权限 |
| 💳 支付/财务 | `#2A1850` | `#A78BFA` | `#F4F0FF` | 支付、退款、账单 |
| 📦 订单/物流 | `#1B3A2D` | `#34D399` | `#D1FAE5` | 订单、发货、库存 |
| 🔔 通知/消息 | `#3B2F00` | `#F59E0B` | `#FEF3C7` | 邮件、短信、推送 |
| 🔍 搜索/推荐 | `#3B1028` | `#F472B6` | `#FCE7F3` | 搜索、推荐、排行 |
| ⚙️ 管理/配置 | `#1F2937` | `#6B7280` | `#F3F4F6` | 后台管理、设置 |
| 📊 数据/分析 | `#1A2744` | `#60A5FA` | `#DBEAFE` | 报表、统计、埋点 |
| 🌐 网关/路由 | `#1A1A3E` | `#7C3AED` | `#EDE9FE` | API Gateway、事件路由 |
| ⚠️ 告警/异常 | `#4A1D24` | `#FB7185` | `#FFE4E6` | 错误处理、熔断 |
| 🔗 跨线出口 | `#4A2A16` | `#FB923C` | `#FFEDD5` | 流向他线的节点 |

### 4.2 新增业务线配色规则

当现有配色不够用时，遵循：

```
1. 色相环上间隔 ≥ 60°（避免相邻色混淆）
2. 饱和度 40-70%（太鲜艳刺眼，太暗淡不显眼）
3. 明度 15-35%（暗色背景适配）
4. 边框色比背景色亮 2-3 级
5. 文字色用对应边框色的最浅色阶
```

### 4.3 Subgraph 标题格式

```
subgraph BIZ_ID["图标 业务线名称"]
```

- 使用 emoji 图标增强视觉识别
- 标题不加节点形状标记（`[]`、`()`）
- ID 全部大写，名称用中文

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

## 6. L1 多业务线工作流

### 6.1 新增业务的接入判断

```
[收到新业务需求]
  ↓
[扫描 `.shadow/L1-business/project.flow.mermaid` 总图]
  ↓
{是否存在匹配的业务线？}
  ├─ 是 → 在总图对应 biz-{id} subgraph 中扩展节点和边
  │        → 如有新跨线连接 → 在总图增加带标签的跨泳道边
  └─ 否 → 在总图创建新的 biz-{new-id} subgraph
           → 添加入口、出口、异常路径和跨泳道连接
           → 更新 mermaid.md 配色表（如需要新配色）
```

### 6.2 修改现有业务的影响面分析

当修改某个业务线时：

```
1. 确定变更的业务域/泳道 biz-{id}
2. 读取 `.shadow/L1-business/project.flow.mermaid` 总图，查找所有连接到 biz-{id} 的边
3. 列出受影响的业务线（上游调用方 + 下游消费方）
4. 在 research.md 变更记录中声明影响面
5. 在同一张总图中更新受影响节点和边
6. 更新跨业务线依赖表（spec.md 中）
```

## 7. Gate 检查扩展

多业务线场景下，Gate 检查增加以下项：

| # | 检查项 | 说明 |
|---|--------|------|
| M1 | 总图包含所有业务线 subgraph | `.shadow/L1-business/project.flow.mermaid` 中有所有 biz-{id} 的 subgraph |
| M2 | 不存在业务线独立流程图 | 禁止 `biz-{id}.project.flow.mermaid` |
| M3 | 跨线连接经过接口节点 | 无边直接连接两个业务线 subgraph 的内部节点 |
| M4 | 连接标签完整 | 每条跨线边都有标签 |
| M5 | 事件命名规范 | 使用 `domain.action` 格式 |
| M6 | 无循环依赖 | 业务线间无 A→B→A 调用链 |
| M7 | 配色唯一性 | 每个业务线使用独立的 classDef 配色 |
| M8 | spec.md 有跨线依赖表 | 当存在跨线连接时必须有此表 |
| M9 | 节点均可追溯 | 所有正式业务动作都有 BXX-NYY 编号 |
| M10 | 总图可读 | 通过泳道、事件边和异常分支保持结构清晰 |
| M11 | 跨线引用双向声明 | 输出方声明 `A→B` 时，B 的 spec 接入点章节必须有反向声明；缺失 → FAIL |
| M12 | 子节点编号连续性 | 每个父节点的子节点编号 .01, .02, .03...必须连续无跳号；跳号 → FAIL |
| M13 | 子节点总数 ≤ 8 | 每个父节点的子节点总数不超过 8；超过 → 建议拆分为兄弟节点 |
