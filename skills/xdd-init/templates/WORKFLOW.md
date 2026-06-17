# xdd 工作流 — prompt → 设计 → 代码

> 本文件由 xdd-init 生成。产品项目工作流指南。
> xdd 的本质一句话：**用户 prompt → 设计层（锚）→ 代码实现**。设计层把用户意图固化，让代码不偏离用户。

## 1. 三层骨架

```
prompt ->
  design_layer():                    # 设计层（锚）—— 每个产物带「上游指针 + 下游消费者」
    understand(use skill: xdd-brainstorm)
    -> spec(use skill: xdd-spec, RXX)
    -> architecture(use skill: xdd-architecture)
    -> wire(use skill: xdd-wire)
    -> resilience(use skill: xdd-resilience)
  -> plan(use skill: xdd-plan, 每个 task 回指 RXX)        # 桥接
  -> code_layer():
       execute(use skill: xdd-execute)
       -> verify(use skill: xdd-verify)
       commit -> @implements RXX -> plan task -> spec 规则 -> design 意图   # 追溯闭环
```

> **纪律**：每进一个节点，**先 `use skill: <name>` 装对应 skill 再干**（skill 注入"怎么做"）。上层 ✅ 才装下层。`status.md` 的「skill」列就是当前该装的 skill。

## 2. 每层做什么

### 入口：xdd-init
生成 `.xdd/` 骨架（`design/` + `runs/iter-N/` + `status.md` + `current-iteration`）+ 本文件 + `.xdd/rules/`。

### 设计层（5 skill，每个产出一个"锚"）

```
design_layer():
  understand(use skill: xdd-brainstorm) -> intent.md + design.md(5段决策)   # 锚定：意图
                   >> 用户审查闸：design.md 写完停下，用户确认意图对齐才进 spec（防偏第一道闸）
  spec(use skill: xdd-spec)             -> spec/{bxx-slug}/ rules.md + *.feature  # 锚定：规则 RXX
  architecture(use skill: xdd-architecture) -> architecture/{bxx-slug}/ architecture.md + flow.mermaid + 端点/事件契约 + 运维视图   # 锚定：结构
  wire(use skill: xdd-wire)             -> wire/{page}/ 6 操作态 + review.md  # 锚定：前端（纯后端跳过）
  resilience(use skill: xdd-resilience) -> architecture/{bxx-slug}/resilience/ 5 文档  # 锚定：韧性
```

### 桥接：xdd-plan
设计层 → 可执行 TDD 计划。每个 task 显式**回指 RXX**（plan task → RXX → design 意图）。禁占位符。产出 `runs/iter-N/plan/{bxx-slug}/plan.md`。

### 代码层（2 skill）

| skill | 做什么 | 核心纪律 |
|-------|--------|---------|
| `xdd-execute` | 按 plan task 写代码（TDD），代码 `@implements RXX` 回指 | 无存根/无假实现/跑通有证据 |
| `xdd-verify` | 真实验证：能跑/数据落地/页面开/无存根/双契约 | 禁偷懒归因 + 失败穷举 ≥3 假设 + 4 维一致性审计 |

## 3. 锚机制：传导链追溯

每个产物用 ID 回指上游，这就是"设计锚定代码、不偏离用户"的字面实现：

```
trace_chain():
  intent.md(why)                 <- understand(use skill: xdd-brainstorm)
     |
  design.md(决策 5 段)            <- understand(use skill: xdd-brainstorm)
     |
  spec/ RXX 规则(做什么)          <- spec(use skill: xdd-spec)
     |
  architecture.md(结构+API+事件)  <- architecture(use skill: xdd-architecture)
     |
  plan.md task(回指 RXX)          <- plan(use skill: xdd-plan)
     |
  代码 @implements RXX            <- execute(use skill: xdd-execute)
     |
  verify 运行证据                 <- verify(use skill: xdd-verify)

# 改任何一层，沿链往下重做
```

## 4. 三层模型 + 业务线层（BXX）

目录分三层，对应「项目 → 业务线 → 迭代」：

| 层 | 落点 | 内容 | 跨 iter？ |
|----|------|------|-----------|
| **项目层** | `design/intent.md` + `design.md` | 项目总意图 + 跨业务线的全局决策（技术栈/错误码/auth）| 是（持久锚）|
| **业务线层** | `design/spec/{bxx-slug}/` + `architecture/{bxx-slug}/` + `wire/` | 每条业务线的规则/结构/前端 | 是（持久锚）|
| **迭代层** | `runs/iter-N/` | 单轮 plan/报告/审计 | 否（单轮）|

**始终用 BXX**：单业务线 = 一个 B01，多业务线 = B01/B02/...。单→多演进零重构。业务线内多功能靠 RXX 编号（B01-R01/R02）区分，不增设子目录。

```
for each BXX:
  独立产出 spec/{bxx-slug}/ + architecture/{bxx-slug}/      # 各 BXX 独立
多业务线额外共享:
  spec/_landscape.md            # 业务线全景（仅 --bizlines 时生成）
  architecture/aggregate-landscape.md   # 聚合全景
  architecture/event-contract.md        # 事件契约

# 跨 BXX 一致性 checklist（status.md 末尾）：
#   术语 / API 命名 / 错误码 / auth / 审计 / multi-tenant 隔离 全统一
```

## 5. status.md（walker 的工作内存）

walker 每切换一层就更新 `.xdd/runs/iter-N/status.md`：上一层 ✅，下一层 ⏳，更新"当前层 / 本层必读 / 上游指针"。让 status.md 替模型记，不靠脑子。

**ACK 索引源**：回复开头的 ACK `%>R.. G.. T.. W..%` 四区指向 —— R 指本仓库的全局 rule；G 指 `.xdd/runs/iter-N/goals.md` 的 G 编号；T 指 `runs/iter-N/plan/{bxx-slug}/plan.md` 的 task 编号；W 指 `.xdd/workflows.md` 的 W 编号。status.md 仍是 walker 进度内存，goals.md / plan.md / workflows.md 是 ACK 的索引源（职责不同，不混）。

## 6. 单工匠 vs 多 agent

| 模式 | 用谁 | 何时 |
|------|------|------|
| 单工匠 | `xdd-walker` 自己装 skill 全干完 | 中小项目（默认）|
| 多 agent | `xdd-orchestrator` 派 6 phase 子 agent | 大项目（≥3 业务线/多工种）|

两者共享同一套 skill + 三层骨架。

## 7. 反 sham 底线

- **无存根**：`pass`/`TODO`/`NotImplementedError`/`InMemoryRepository` 都不行。
- **无假实现**：mock DB / 硬编码 current_user 不行。
- **跑通有证据**：curl/截图/数据查询，不是 GREEN 数。
- **不假完成**：没跑通直说没跑通。

## 8. 卡住回退

```
# 起点：同一 task 连续 3 试没过（计数见 runs/iter-N/failure-log.md 该 task 出现次数）
if 同一 task 3 试没过:
  写 runs/iter-N/failure-log.md（命令 + 错误 + 试过什么）
  rollback(根因):                    # 判定（那个产物缺了什么）→ 回到的锚
    空状态/页面缺（wire/{page}/ 缺该状态）-> wire
    工作流卡点（design.md 该决策缺失）     -> understand
    API/事件错（architecture.md 没覆盖）   -> architecture
    兜底不够/错（resilience/ 没覆盖）       -> resilience
    规则没写清（rules.md 该 RXX 模糊）      -> spec
  → 沿 propagate 往下重做
elif 同一 task 4 试没过:
  停下问用户（不自己在代码层反复试）
```

## 9. 项目规则文件

- `.xdd/rules/backend.rules` — 后端开发约定（分层/错误码/auth/测试）
- `.xdd/rules/ui-ux.rules` — 前端 UI/UX 约定（组件/布局/动效/可达性）
- `.xdd/rules/frontend.rules` — 前端工程约定（命名/文件结构/600 行/组合式 API/路由）

用户按项目实际情况修改。AI 写代码前必读。
