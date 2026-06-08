# xdd BXX 业务线模型

> **本文件目的**: 解释多业务线项目 (BXX > 1) 的目录组织 + 编号规则 + 跨线一致性 checklist

---

## 1. BXX-NYY 编号规则

- `BXX` = 业务线 ID (两位数字, 01-99)
- `NYY` = 该业务线内 Feature 序号 (01-99)

**例**:
- `B01-001` = 业务线 1 的第 1 个 Feature
- `B01-002-NNN` = 业务线 1 的第 2 个 Feature 的第 N 个 Scenario

---

## 2. 触发条件

`.xdd/scale.md`:
- `bizline_count > 1` → `bxx_enabled: true` (强制)
- `bizline_count == 1` → `bxx_enabled: false` (单业务线)

Walker 在 L1 完成后检测此字段, 自动调整目录结构.

---

## 3. 多业务线时目录组织

```
.xdd/
├── scale.md                       # bxx_enabled: true
├── core/                          # 用户意图 (跨业务线共享)
├── project.flow.mermaid           # 全局图, 节点用 BXX-NYY 编号
├── arch/                          # 架构 (跨业务线)
├── bdd/
│   ├── B01-001/                   # 业务线 1
│   │   ├── B01-001-001-login.feature
│   │   └── B01-001-002-logout.feature
│   ├── B02-001/                   # 业务线 2
│   │   └── B02-001-001-order-create.feature
│   └── cross-cutting/             # 跨业务线
│       └── auth.feature
├── add/
│   ├── shared/                    # 共享架构
│   │   └── api-gateway.md
│   ├── B01/                       # 业务线 1 专属
│   │   └── state-machine.md
│   └── B02/                       # 业务线 2 专属
│       └── order-workflow.md
└── iterations/iter-N/pipeline/status.md
    ## B01 用户管理
    | Phase | 状态 | 备注 |
    |-------|------|------|
    | 1 | ⏳ | |
    | 2 | ⏳ | |
    ## B02 订单管理
    | Phase | 状态 | 备注 |
    |-------|------|------|
    | 1 | ⏳ | |
    | 2 | ⏳ | |
    ## cross-BXX 一致性 (强制)
    - [ ] 跨业务线术语一致
    - [ ] 跨业务线 API 命名风格一致
    - [ ] 跨业务线错误码格式一致
    - [ ] 跨业务线 auth/authz 模型一致
    - [ ] 跨业务线审计日志字段一致
    - [ ] 跨业务线 multi-tenant 隔离一致
```

---

## 4. 单业务线时 (bxx_enabled=false)

```
.xdd/
├── scale.md                       # bxx_enabled: false
├── core/
├── project.flow.mermaid           # 节点直接 N01/N02 (无 BXX 前缀)
├── arch/
├── bdd/
│   ├── login.feature
│   └── ...
├── add/
│   └── state-machine.md
└── iterations/iter-N/pipeline/status.md
    | Phase | 状态 | 备注 |
    |-------|------|------|
    | 1 | ⏳ | |
    ...
```

---

## 5. 跨 BXX 一致性 checklist

每写完一个 slug (B01/B02/...) 的同层产物, 立即对照 status.md 的 "cross-BXX 一致性" 段:

- **命名规范** 是否统一 (e.g., `ServiceXxx` vs `XxxService`)
- **事件命名** 是否统一 (e.g., `domain.event` vs `EventName`)
- **API 风格** 是否统一 (RESTful 资源路径)
- **错误码** 是否共用一套
- **auth/authz 模型** 是否一致 (RBAC / ABAC / 数据权限)
- **审计日志** 字段是否一致
- **multi-tenant 隔离** 是否一致

不一致 → 改最新写的, 保持风格统一后再进下一层.

---

## 6. 变更传播 (BXX 内)

| 改了什么 (BXX 内) | 只需重跑 |
|-------------------|---------|
| BXX 事件归属 | BXX research + flow + spec, wire 视情况 |
| BXX 术语 | BXX research + spec, 下游视情况 |
| BXX 聚合边界 | BXX research + spec + Phase 2.5 聚合全景 |
| 跨 BXX 事件 | 两侧 BXX research + flow + 全局事件流 |
