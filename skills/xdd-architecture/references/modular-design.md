# 模块化设计实操手册 — 怎么划分模块、怎么复用

> 本文件回答两个实操问题:**模块怎么划** + **怎么复用**。
> 是 `xdd-architecture §13 模块化设计`的深度展开。SKILL.md 只讲原则(通用能力下沉、依赖单向),这里给可执行步骤。
> 配合 `ddd.md`(战略:上下文/子域/聚合)和 `architecture-patterns.md`(选哪种架构模式)——本文件专讲**通用能力怎么抽成基础模块 + 怎么被复用**。
> 模块粒度 = **DDD 限界上下文级**(不是代码包级;代码组织由 execute 按 architecture 落地)。

---

## 第一部分:模块怎么划分

### 划分决策流(5 步)

模块划分本质是回答:这个能力,**是项目独有的核心,还是行业通用的基础?**

#### 第 1 步:列出所有能力候选

从 brainstorm 的 design.md + spec 的 RXX 规则里,把所有"系统要做的事"列成能力清单。例:登录/鉴权/订单创建/支付/文件上传/通知/审计/日志/任务调度/搜索。

#### 第 2 步:对每个能力问 3 个判定问题

| 问题 | 答"是" | 答"否" |
|------|-------|-------|
| **Q1:它是项目的差异化竞争力吗?** 用户因为这个选你而非竞品 | 是 → **核心模块**(业务层) | 否 → 继续问 |
| **Q2:行业有成熟现成方案/开源/标准吗?** (OAuth2/S3 协议/JWT/Kafka) | 是 → **基础模块**(base 层,用现成) | 否 → 继续问 |
| **Q3:多个业务线都需要它吗?** (≥2 条业务线用到) | 是 → **基础模块**(下沉复用) | 否 → **业务私有**(留在该业务上下文内) |

判定结果:

```
核心 + 独有        → 业务模块(core,自建,重点投入)
通用 + 有现成      → 基础模块(base,用现成,别造轮子)
通用 + 无现成+多线 → 基础模块(base,自建简化)
仅单业务线用       → 业务私有(留在该上下文,不抽)
```

> **关键反模式**:把通用能力当核心业务设计。例:给 JWT 鉴权设计聚合根、给文件上传写一堆 RXX 业务规则——认证用现成 OAuth2 就够,文件上传用对象存储 SDK 就够,**别给通用能力套 DDD**。

#### 第 3 步:定模块边界(高内聚低耦合)

每个基础模块**只暴露一类能力**,边界清晰。判定:改这个模块的内部实现,会不会牵动别的模块?
- 会 → 边界划错了(耦合太高),重新切
- 不会 → 边界对(高内聚)

| 基础模块(例) | 该包含 | 不该包含(塞进去就坏了边界) |
|--------------|--------|---------------------------|
| auth | 登录/登出/token 验发/权限判定 | 业务用户画像(那是业务模块) |
| storage | 文件上传/下载/删除/元数据 | 文件的业务含义(订单附件 vs 头像) |
| notify | 发送渠道(邮件/短信/webhook)+ 模板渲染 | "什么业务事件触发什么通知"(那是业务) |
| audit | 记录谁在何时做了什么 | 业务规则判定(该不该审计) |

#### 第 4 步:定接口契约(基础模块对外暴露什么)

基础模块对业务模块只暴露**接口(端口)**,不暴露内部实现。业务模块依赖接口,不依赖实现类。

```
auth 模块对外:
  interface Authenticator { currentUser(): User; requireRole(role) }
  ↑ 业务模块只依赖这个接口,不依赖 AuthModule 内部怎么实现(JWT/Session 都行)
```

这就是**六边形架构的端口**——基础模块是适配器,业务模块通过端口用。详见 `architecture-patterns.md §14 六边形`。

#### 第 5 步:落到 module-landscape.md

```markdown
## 基础模块(base 层)
| 模块 | 子域类型 | 职责 | 对外接口(端口) | 实现方案 |
|------|---------|------|---------------|---------|
| auth | 通用 | 登录/鉴权/权限 | Authenticator | OAuth2 + JWT(现成) |
| storage | 通用 | 文件存取 | ObjectStore | S3 兼容 SDK(现成) |
| notify | 通用 | 多渠道通知 | Notifier | 自建(邮件+webhook) |
| audit | 支撑 | 操作审计 | AuditLogger | 自建简化 |

## 业务模块(业务层)
| 模块 | 子域类型 | 依赖的基础模块 |
|------|---------|---------------|
| order | 核心 | auth, storage, notify |
| payment | 核心 | auth, notify, audit |

## 依赖矩阵(✓=依赖;反向必须空)
| 业务\基础 | auth | storage | notify | audit |
|----------|------|---------|--------|-------|
| order | ✓ | ✓ | ✓ | |
| payment | ✓ | | ✓ | ✓ |
| auth | | | | | ← 基础模块行必须空(不依赖业务)
```

---

## 第二部分:怎么复用

基础模块建好后,业务模块怎么用它?核心原则:**业务依赖基础,基础不感知业务**。但有 3 种复用机制,按场景选:

### 机制 A:直接调用(同步,最常见)

业务模块直接调用基础模块的接口。

```python
# order 模块(业务)
class OrderService:
    def __init__(self, auth: Authenticator, storage: ObjectStore):
        self.auth = auth      # 依赖接口,不依赖实现
        self.storage = storage

    def create_order(self, ...):
        user = self.auth.currentUser()        # 用 auth
        self.storage.save(order_file, ...)    # 用 storage
```

**依赖方向**:order → auth/storage ✅(业务→基础,单向)
**禁止**:auth 内部 `import order` ❌(基础→业务,反向,架构腐烂起点)

### 机制 B:依赖注入(解耦实现)

基础模块的**实现**(JWT 版 vs Session 版)不该被业务模块硬编码。用依赖注入:启动时装配,业务只拿接口。

```
启动装配(Composition Root,在 architecture 定):
  auth = JWTAuthenticator(secret)      # 选实现
  storage = S3ObjectStore(bucket)      # 选实现
  order = OrderService(auth, storage)  # 注入接口

业务模块代码里:
  只出现 Authenticator / ObjectStore 接口,不出现 JWTAuthenticator / S3ObjectStore
```

好处:换实现(测试用 mock、换云厂商)只改装配点,业务代码零改动。这和 `architecture-patterns.md §14 六边形`的端口-适配器是同一套。

### 机制 C:事件订阅(基础感知业务的唯一合法方式)

有时候基础模块需要"知道"业务发生的事(例:audit 模块要记录订单创建)。**禁止基础模块直接依赖业务模块**——用事件订阅:业务发事件,基础订阅,基础不 import 业务。

```python
# order 模块(业务)发事件
class OrderService:
    def create_order(self, ...):
        ... 创建订单 ...
        events.publish(OrderCreated(order_id, user_id))   # 只发,不管谁听

# audit 模块(基础)订阅事件
@events.subscribe(OrderCreated)
def audit_order_created(evt):
    audit_log.record("order_created", evt.order_id, evt.user_id)
```

**依赖方向**:order 不依赖 audit;audit 依赖事件类型(OrderCreated)。
**注意**:事件类型放哪?放一个**中立的共享事件契约**(`event-contract.md`,业务和基础都引,但谁都不引对方的模块)。这避免 audit 引 order 模块。

### 3 种机制什么时候用

| 场景 | 机制 |
|------|------|
| 业务要"用"基础能力(拿当前用户/存文件) | A 直接调用 |
| 想解耦基础模块的实现(便于测试/换方案) | B 依赖注入 |
| 基础要"感知"业务事件(审计/通知触发) | C 事件订阅 |

### 禁止的复用(反模式)

| 反模式 | 为什么错 | 正确做法 |
|--------|---------|---------|
| **基础模块 import 业务模块** | 反向依赖,基础被业务绑架 | 用机制 C 事件订阅 |
| **Shared Kernel 滥用**(业务和基础共享一个模型类) | 双向耦合,改一处动两处 | 基础暴露接口/值对象,业务自己建模型 |
| **业务模块之间直接 import** | 业务耦合,改一个动一串 | 业务间用事件(最终一致)或走基础模块中转 |
| **基础模块硬编码业务规则**(auth 里写"订单用户才能登录") | 基础被业务污染 | 业务规则留业务模块,基础只做通用能力 |

---

## 常见错误清单(自检对照)

1. ❌ 给通用能力(认证/存储)设计聚合根、写一堆业务 RXX → ✅ 通用能力用现成方案,归 base 模块
2. ❌ 每条业务线各写一遍登录/上传 → ✅ 抽成 base 模块,业务线复用
3. ❌ auth 模块里 import order → ✅ 反向依赖,改用事件订阅
4. ❌ 业务模块直接 new 基础模块的实现类 → ✅ 依赖注入接口
5. ❌ 模块边界混乱(auth 里塞用户画像) → ✅ 一个模块一类能力,高内聚
6. ❌ 把所有共享的都塞进 shared/common 大杂烩 → ✅ 按能力分模块(common/auth/common/storage 独立)

---

## 与 xdd 产物的对应

| 本手册的概念 | 落到哪个产物 |
|-------------|-------------|
| 模块划分决策(5 步) | `architecture.md` 的分层/模块段 |
| 基础模块清单 + 依赖矩阵 | `module-landscape.md`(§13 新增产物) |
| 事件订阅复用 | `event-contract.md`(事件契约) |
| 接口契约(端口) | `architecture.md` 的 API/接口段 |
| brainstorm 识别的"通用 vs 核心"种子 | `design.md` Selected/Assumptions(brainstorm 产出) |
