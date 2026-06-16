---
name: xdd-backend
description: |
  xdd 代码层专项 —— 后端实现锚。被 xdd-execute 按 task 的 Stack=backend 派发装入。
  从 architecture.md §技术栈 读后端栈，加载 .xdd/rules/backend.rules（用户约定），按 plan task TDD 实现。
  execute 是通用 TDD 主流程；本 skill 补后端栈特定的约定与检查（DB 迁移 / API 端点对齐 / 事件 producer / 事务边界）。
  触发：后端实现、写后端代码、backend、API 实现、service 层、DB 迁移、后端 TDD。
---

# xdd-backend — 后端实现锚

> 代码层专项：不取代 xdd-execute 的 TDD 主流程，只补后端栈特定的约定与检查。
> 由 execute 读 task 的 `**Stack:** backend` 字段后装入。

## 我锚定什么 / 上游 / 下游

| | |
|---|---|
| **上游** | `xdd-execute`（派发装入）+ `architecture.md §技术栈`（后端语言/框架/ORM 决策）+ `.xdd/rules/backend.rules`（项目级 WHAT 约定：分层/错误码/auth/命名） |
| **我产出** | 后端代码（`@implements RXX`）+ 栈特定检查通过 |
| **下游消费者** | `xdd-verify`（端点契约 + 真实持久化验收） |
| **回溯锚** | 代码 `@implements RXX` ← plan task ← spec 规则 ← design 意图 |

## 怎么做

```
work():
  1. 读栈     -> architecture.md §技术栈：后端语言/框架/ORM/MQ（如 Python+FastAPI+SQLAlchemy）
  2. 读约定   -> .xdd/rules/backend.rules：分层 / 错误码 / auth / 命名（用户按项目改过的版本）
  3. 实现     -> 按 plan task 的 Step 顺序：TDD 红→绿→重构→commit（message 含 @implements RXX）
  4. 栈检查   -> DB 迁移跑过 / API 端点对齐 architecture 清单 / 事件 producer 真发 / 事务边界明确
  5. 反 sham -> no-stub-check.sh 零命中 + 无假实现（mock DB / 硬编码 current_user 禁）
```

## 后端特定关注点

- **DB 真实持久化**：写 → 查 → 重启后还在（不是 InMemoryRepository / mock DB）
- **端点全覆盖**：architecture 的 API 端点清单，每个都有真实现（别 60→23 那种缩水）
- **事件契约**：producer → queue → consumer → DB 关键路径真跑通（对照 architecture 事件契约）
- **迁移脚本**：`alembic upgrade head` 或等价，schema 变更必须可回放
- **事务边界**：跨服务/聚合的操作标清事务范围，对照 architecture 并发模型

## 自检

```
□ backend.rules 的分层/错误码/auth/命名都遵守了？
□ architecture 端点清单每个都真实现（无缩水）？
□ DB 迁移跑过，重启后数据还在？
□ 事件关键路径 producer→queue→consumer→DB 真跑通？
□ no-stub-check.sh 零命中，无 mock DB / 硬编码用户？
□ 每处代码 @implements RXX，每个 RXX 有测试通过？
```

---

本 skill 只管「后端怎么实现得扎实」；通用 TDD 流程（任务调度 / 阻塞处理 / 卡住升级）在 `xdd-execute`。
