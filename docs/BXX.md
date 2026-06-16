# xdd BXX 业务线模型

> **本文件目的**: 解释业务线（BXX）的目录组织 + 编号规则 + 跨线一致性 checklist。
>
> 目录结构权威声明见 `skills/xdd-init/SKILL.md § 生成的结构`（含三层模型：项目层 / 业务线层 / 迭代层）。本文件只讲 BXX 特有的编号规则 + 跨线一致性。

---

## 1. BXX-NYY 编号规则

- `BXX` = 业务线 ID (两位数字, 01-99)
- `NYY` = 该业务线内 Feature 序号 (01-99)
- `RXX` = 该业务线内规则编号（如 `B01-R01`）

**例**:
- `B01` = 业务线 1（目录名，始终带 BXX）
- `B01-R01` = 业务线 1 的第 1 条规则
- `B01-001` = 业务线 1 的第 1 个 Feature
- `B01-001-NNN` = 业务线 1 的第 2 个 Feature 的第 N 个 Scenario

**功能维度不增设目录**：业务线内多功能靠 RXX 规则编号（`B01-R01/R02`）+ Gherkin Feature 名区分，不在 `spec/{bxx-slug}/` 下再建功能子目录。

---

## 2. 触发条件 / 生成

- `xdd-init --bizlines B01-auth,B02-order` → 预生成 `design/spec/_landscape.md` + 每业务线 `spec/{bxx-slug}/business.md` 占位。
- **无 `--bizlines`** → 默认建 `design/spec/B01/`（始终用 BXX，单业务线 = 一个 B01）。

**始终用 BXX**：单业务线也带 BXX 前缀，单→多演进零重构（无需重命名目录）。

---

## 3. 目录组织（三层模型）

```
.xdd/
├── design/                          【持久锚，跨 iter 保留】
│   ├── intent.md                    ← 【项目层】总意图（跨业务线共享）
│   ├── design.md                    ← 【项目层】项目级总决策（跨业务线）
│   ├── spec/
│   │   ├── _landscape.md            ← 业务线全景（仅 --bizlines 时生成）
│   │   ├── B01-auth/                ← 【业务线层】
│   │   │   ├── business.md
│   │   │   ├── rules.md             ← RXX 规则（B01-R01...）
│   │   │   └── *.feature            ← Gherkin
│   │   ├── B02-order/
│   │   │   └── ...
│   │   └── cross-cutting/           ← 跨业务线（如 auth）
│   ├── architecture/                ← 【业务线层】（与 spec 同 BXX 分层）
│   │   ├── aggregate-landscape.md   ← 全局聚合全景
│   │   ├── event-contract.md        ← 全局事件契约
│   │   ├── B01-auth/
│   │   │   ├── architecture.md
│   │   │   ├── flow.mermaid         ← 节点用 BXX-NYY 编号
│   │   │   └── resilience/          ← 韧性 colocation（5 文档）
│   │   └── B02-order/
│   │       └── ...
│   └── wire/                        ← 【业务线层】前端线框
└── runs/
    └── iter-N/                      【迭代层】单轮工作记录（plan/报告/审计）
        ├── status.md                ← 含 ## BXX 分段 + cross-BXX 一致性 checklist
        ├── plan/{bxx-slug}/
        └── audits/
```

**三层边界**：项目层（intent/design，无 BXX）→ 业务线层（spec/architecture/wire，带 BXX）→ 迭代层（runs/iter-N）。详见 `skills/xdd-init/SKILL.md`。

---

## 4. 跨 BXX 一致性 checklist

每写完一个 BXX (B01/B02/...) 的同层产物，立即对照 `status.md` 的 "cross-BXX 一致性" 段：

- **命名规范** 是否统一 (e.g., `ServiceXxx` vs `XxxService`)
- **事件命名** 是否统一 (e.g., `domain.event` vs `EventName`)
- **API 风格** 是否统一 (RESTful 资源路径)
- **错误码** 是否共用一套
- **auth/authz 模型** 是否一致 (RBAC / ABAC / 数据权限)
- **审计日志** 字段是否一致
- **multi-tenant 隔离** 是否一致

不一致 → 改最新写的，保持风格统一后再进下一层。

---

## 5. 变更传播（BXX 内）

| 改了什么 (BXX 内) | 只需重跑 |
|-------------------|---------|
| BXX 事件归属 | BXX spec/flow，wire 视情况 |
| BXX 术语 | BXX spec，下游视情况 |
| BXX 聚合边界 | BXX spec + architecture 聚合全景 |
| 跨 BXX 事件 | 两侧 BXX spec/flow + 全局事件流 |
