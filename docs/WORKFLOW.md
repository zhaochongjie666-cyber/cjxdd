# xdd 工作流 — prompt → 设计 → 代码

xdd 的本质一句话：**用户 prompt → 设计层（锚）→ 代码实现**。设计层把用户意图固化，让代码不偏离用户。本文档详解三层骨架怎么走。

## 1. 三层骨架

```
用户 prompt
   ↓
┌─ 设计层（锚）──────────────────────────────────┐
│ understand → spec(RXX) → architecture →          │
│ wire → resilience                                 │
│ 每个产物带「上游指针 + 下游消费者」              │
└──────────────────────────────────────────────────┘
   ↓ 桥接: plan（每个 task 显式回指 RXX）
┌─ 代码层 ────────────────────────────────────────┐
│ execute → verify                                  │
│ commit → @implements RXX → plan task →            │
│   spec 规则 → design 意图  ← 追溯闭环             │
└──────────────────────────────────────────────────┘
```

## 2. 每层做什么

### 入口：xdd-init
生成 `.xdd/` 骨架（`design/` + `plan/` + `status.md` + `current-iteration`）。平台中立，无 hook。

### 设计层（5 skill，每个产出一个"锚"）

| 顺序 | skill | 锚定 | 产出 | 下游 |
|------|-------|------|------|------|
| 1 | `xdd-understand` | **意图** | `design/intent.md` + `design.md`（5 段决策）| spec 只读 design.md |
| 2 | `xdd-spec` | **规则 RXX** | `design/spec/{bxx-slug}/` rules.md + *.feature | architecture 把 RXX 映射到层/端点 |
| 3 | `xdd-architecture` | **结构** | `design/architecture/{bxx-slug}/` architecture.md + flow.mermaid + 端点/事件契约 + 运维视图 | plan 拆 task，resilience 在此目录加韧性 |
| 4 | `xdd-wire`（前端）| **前端** | `design/wire/{page}/` 6 操作态 + review.md | execute 实现前端，verify 验渲染 |
| 5 | `xdd-resilience` | **韧性** | `architecture/{bxx-slug}/resilience/` 5 文档 | plan 写兜底约束，verify 跑混沌 |

**用户审查节点**：design.md 写完（understand 出口）停下给用户看，确认意图对齐才进 spec。这是防偏的第一道闸。

### 桥接：xdd-plan
设计层 → 可执行 TDD 计划。每个 task 显式**回指 RXX**（plan task → RXX → design 意图）。禁占位符。产出 `plan/{bxx-slug}/plan.md`。

### 代码层（2 skill）

| skill | 做什么 | 核心纪律 |
|-------|--------|---------|
| `xdd-execute` | 按 plan task 写代码（TDD），代码 `@implements RXX` 回指 | 无存根/无假实现/跑通有证据（no-stub-check.sh）|
| `xdd-verify` | 真实验证：能跑/数据落地/页面开/无存根/双契约 | 禁偷懒归因 + 失败穷举 ≥3 假设 + 4 维一致性审计 |

## 3. 锚机制：传导链追溯

每个产物用 ID 回指上游，这就是"设计锚定代码、不偏离用户"的字面实现：

```
intent.md (why)                 ← xdd-understand
   ↓
design.md (决策 5 段)            ← xdd-understand
   ↓
spec/ RXX 规则 (做什么)          ← xdd-spec
   ↓
architecture.md (结构+API+事件)  ← xdd-architecture
   ↓
plan.md task (回指 RXX)           ← xdd-plan
   ↓
代码 @implements RXX              ← xdd-execute
   ↓
verify 运行证据                   ← xdd-verify
```

改任何一层，沿链往下重做（变更传播见 `agents/xdd-walker.md` 变更传播表）。

## 4. 多业务线（BXX）

项目有多条业务线时，每条 BXX 在 `design/spec/{bxx-slug}/` + `design/architecture/{bxx-slug}/` 下独立产出，但共享全局的 `spec/_landscape.md`（业务线全景）+ `architecture/aggregate-landscape.md`（聚合全景）+ `architecture/event-contract.md`（事件契约）。

跨业务线一致性 checklist（status.md 末尾）：术语 / API 命名 / 错误码 / auth / 审计 / multi-tenant 隔离 全统一。详见 `docs/BXX.md`。

## 5. status.md（walker / orchestrator 的工作内存）

walker 每切换一层就更新 `.xdd/runs/iter-N/status.md`：上一层 ✅，下一层 ⏳，更新"当前层 / 本层必读 / 上游指针"。让 status.md 替模型记，不靠脑子。骨架见 `skills/xdd-init/SKILL.md`。

## 6. 单工匠 vs 多 agent

| 模式 | 用谁 | 何时 |
|------|------|------|
| 单工匠 | `xdd-walker` 自己装 skill 全干完 | 中小项目（默认）|
| 多 agent | `xdd-orchestrator` 派 6 phase 子 agent | 大项目（≥3 业务线/多工种）|

两者共享同一套 13 skill + 三层骨架。详见 `agents/xdd-orchestrator.md`。

## 7. 反 sham 底线

session c3692b46 教训：60 端点只实施 23（38%）= sham。深度重构后纪律以可移植形式存活：

- **无存根**：`pass`/`TODO`/`NotImplementedError`/`InMemoryRepository` 都不行。commit 前跑 `skills/xdd-execute/scripts/no-stub-check.sh`。
- **无假实现**：mock DB / 硬编码 current_user 不行。
- **跑通有证据**：curl/截图/数据查询，不是 GREEN 数。
- **不假完成**：没跑通直说没跑通。

## 8. 卡住回退

同一处连续 3 试没过 → 不硬扛，写 `.xdd/runs/iter-N/failure-log.md`，回设计层找根因：

```
死胡同/空状态缺失 → 回 xdd-wire
工作流卡点       → 回 xdd-understand
API 错误         → 回 xdd-architecture
兜底不够/错      → 回 xdd-resilience
规则没写清       → 回 xdd-spec
```

4 试失败 → 问用户。

## 9. 平台中立

xdd 只依赖 skill + agent（所有 AI coding 平台都支持的最小公约数）。**没有 hook / plugin / 平台针对性代码**。纪律用 (a) skill 文字自检段 + (b) skill 自带可移植 bash 脚本表达。能在 Claude Code / OpenCode / Cursor / pi / 任何支持 agent+skill 的平台原样运行。

旧的平台层（hook + plugin ~7300 行）已归档到 `archive/platform-2026-06/`。
