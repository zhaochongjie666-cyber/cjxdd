---
name: xdd-init
description: 一键初始化 xdd 项目 — 把空仓库变成 xdd-walker 可识别的项目。生成 .xdd/ 目录结构、status.md、scale.md（带 strict-default 字段）、BXX 业务线分组模板。xdd 6 Phase 流程（0 INIT）入口。
---

# xdd-init — 一键初始化 xdd 项目

把空仓库变成 xdd Walker 可识别的项目：生成 `.xdd/` 目录结构、初始 status.md、scale.md（带 strict-default 字段）、SHADOW_VERSION 标记。**新项目第一步**。

## 何时使用

- 拿到一个空仓库 / 新目录，准备开始用 Walker 走 Phase 0→6
- 上一个 iter 完成了，要开 iter-2（用 `xdd-init --iter 2`）
- 想重新生成被删掉的 `.xdd/xdd-version`
- 想给多业务线项目预设 BXX 业务线分组

**不要在以下情况用**：
- 项目已经有 `.xdd/` 且你想继续 — 直接调 walker / 下一个 skill
- 想迁移老 Shadow 项目到新版本 — 那是 `xdd-migrate`（暂未实现，先手改）

## 最快路径

```bash
# 任何 xdd 项目目录下：
bash ~/.claude/skills/xdd-init/scripts/init.sh

# 或在仓库根：./skills/xdd-init/scripts/init.sh
# 跑完会自动打印"下一步: 加载 xdd-walker"
```

脚本会：
1. 读 `.xdd/xdd-schema.json` 里的 `xdd_version` 字段
2. 检查 `.xdd/` 是否已存在（已存在则 abort，要求 `--force` 或新 iter）
3. 生成 4 个文件：`xdd-version`、`current-iteration`、`iterations/iter-1/pipeline/status.md`、`scale.md`
4. 在 research/ 建占位 `.gitkeep`
5. 打印下一步操作清单

## 参数

| 参数 | 默认 | 说明 |
|------|------|------|
| `--iter N` | `1` | 初始化哪个 iter。会写 `current-iteration` 和 `iterations/iter-N/` |
| `--force` | false | `.xdd/` 存在时强制覆盖（**危险**，会丢 status） |
| `--schema PATH` | 自动找 | 指定 schema.json 路径（默认解软链找仓库根的 `.xdd/xdd-schema.json`） |
| `--no-scale` | false | 不生成 scale.md 占位（极简模式） |
| `--bizlines B01,B02` | `[]` | 多业务线项目：预生成 `## BXX` 段落 |
| `--strict-mode true\|false` | `true` | strict-default 开关：true 按 L 规模 + 扩展模式跑，false 才降级 |

## 生成的文件

```
.xdd/
├── xdd-version                       # 单行：schema 里的 xdd_version
├── current-iteration                 # 单行：当前 iter 名（默认 "iter-1"）
├── scale.md                          # 默认值（带 strict-default 字段），下游 5 个 skill 读
├── baseline/                         # 跨 iter design_baseline (4 子目录扁平, v3.0 9→4 合并: 删 intent/add/business/flow/resilience)
│   ├── research/
│   │   ├── 00-intent.md             # Phase 0 写: 项目意图 / 成功标准 (v2.1, 旧 baseline/intent/intent.md 迁入)
│   │   └── .gitkeep                  # xdd-l0 后填 01-08
│   ├── bdd/
│   │   ├── _landscape.md            # 业务线全景 (v2.0, 旧 baseline/business/business-landscape.md 迁入)
│   │   ├── {BXX-slug}/business.md   # 每个业务线分组 (v2.0, 旧 baseline/business/{slug}.md 迁入)
│   │   └── .gitkeep                  # xdd-bdd 后填 spec.md + *.feature
│   ├── arch/                         # 业务线一站式架构资料夹 (v8.0.0 colocation)
│   │   ├── aggregate-landscape.md   # 全局聚合全景 (xdd-arch)
│   │   ├── event-contract.md         # 全局 EDD 契约 (xdd-arch)
│   │   ├── {BXX-slug}/
│   │   │   ├── architecture.md       # xdd-arch (含 § 12 运维视图, v7.0.0 合并自 xdd-add)
│   │   │   ├── flow.mermaid          # xdd-flow v2.0 (旧 baseline/flow/{slug}.mermaid 迁入)
│   │   │   ├── docker-compose.yml + docker-compose.test.yml
│   │   │   └── resilience/           # xdd-l3 v2.0 (5 韧性文档, 旧 baseline/resilience/{slug}/ 迁入)
│   │   │       ├── failure-modes.md
│   │   │       ├── failsafe-design.md
│   │   │       ├── chaos-scenarios.md
│   │   │       ├── resilience-test-plan.md
│   │   │       └── recovery-runbook.md
│   │   └── .gitkeep                  # xdd-arch / xdd-flow / xdd-l3 后填
│   └── wire/
│       └── .gitkeep                  # xdd-wire 后填
├── gates/                            # 项目级 control_marker
│   ├── scale.md                      # (alias of root scale.md, 6 目录后)
│   ├── current-iteration
│   └── xdd-version
└── iterations/
    └── iter-1/
        └── pipeline/
            └── status.md             # 12 行阶段表，全部 ⏳
```

### bdd/ 职责 (强约束, 实战验证) — v2.0 (9→6) 吸收原 business/

**`baseline/bdd/` = 业务规则 + 业务线维度 + Gherkin 验收 三合一**. v2.0 (9→6 目录合并) 后, 老 `baseline/business/` 工件 (business-landscape.md + {slug}.md) 全部迁入 bdd/ 目录, 跟 spec.md / *.feature 同级.

**强约束** (BXX > 1 时, 即 `--bizlines` 启用):
- `baseline/bdd/_landscape.md` **必填** (跨业务线关系图, 哪怕只有 1 BXX 也建议填; 旧 business-landscape.md)
- `baseline/bdd/{BXX-slug}/business.md` **每个 BXX 必填** (业务线说明: 目标 + 关键问题 + 范围 + 关联 RXX/Arch/Resilience; 旧 business/{slug}.md)
- `baseline/bdd/{BXX-slug}/spec.md` **每个 BXX 必填** (RXX 规则列表)
- `baseline/bdd/{BXX-slug}/*.feature` **每个 RXX 至少 1 个** (Gherkin 验收)

**为什么把 business 并入 bdd**: session c3692b46 + 实战 pricecompare 发现, business / bdd 都是按 BXX-slug 分组, 跨目录跳查导致"业务线散射 8 处". 合并到 bdd/{slug}/ 下后, 单个业务线的所有材料 (业务说明 + 规则 + 验收) 在同一目录, 跨 iter 找业务线无需跳目录.

**模板** (init 时按 `bizline_placeholder_template` 字段自动生成):
```markdown
# B01-customer

> 业务线说明 — 目标 + 关键问题 + 范围.

## 业务目标
- 目标 1
- 目标 2

## 关键问题
1. 问题 1
2. 问题 2

## 范围
- in-scope: 范围内
- out-of-scope: 范围外

## 关联
- RXX 规则: R01, R02, ... (见同目录 spec.md)
- Arch 设计 (含运维视图): baseline/arch/{slug}/architecture.md
- Resilience: baseline/resilience/{slug}/failure-modes.md
- 前端线框: baseline/wire/{slug}/
- 流程图: baseline/flow/{slug}.mermaid
```

### status.md 模板（含 `last_updated` 字段，hook 用它检测过期；含 BXX 分组段）

```markdown
# Pipeline Status — iter-1

last_updated: 2026-06-08T14:32:00+08:00
xdd_version: 0.1.0
strict_mode: true

> Per-stage table below. Mark each row with ⏳ pending / 🔄 doing / ✅ done / ❌ failed.
> For multi-bizline projects, organize by `## BXX 业务线名` sections.

| Phase | 状态 | 产出 | 自检 |
|------|------|------|------|
| 0 INIT | ✅ DONE | .xdd/, scale.md, status.md | gate-check-init.sh |
| 1 RESEARCH | ⏳ | — | — |
| 2 DESIGN | ⏳ | — | — |
| 2.5 BDD | ⏳ | — | — |
| 2.7 SCAFFOLD | ⏳ | — | — |
| 3 REVIEW | ⏳ | — | — |
| 4 PLAN | ⏳ | — | — |
| 5 EXECUTE | ⏳ | — | — |
| 6 VERIFY | ⏳ | — | — |
```

多业务线时（BXX > 1），按下面结构生成：

```markdown
## BXX-001 业务线名
| Phase | 状态 | 备注 |
|-------|------|------|
| 1 RESEARCH | ⏳ | |
| 2 DESIGN | ⏳ | |
| ... | | |

## BXX-002 业务线名
| Phase | 状态 | 备注 |
|-------|------|------|
| ... | | |

## cross-BXX 一致性 (BXX > 1 时强制)
- [ ] 跨业务线术语一致
- [ ] 跨业务线 API 命名风格一致
- [ ] 跨业务线错误码格式一致
- [ ] 跨业务线 auth/authz 模型一致
- [ ] 跨业务线审计日志字段一致
- [ ] 跨业务线 multi-tenant 隔离一致
```

### scale.md 模板（默认值，strict-mode 默认 true）

```yaml
# .xdd/scale.md
---
project_name: <产品名>
created: 2026-MM-DD
updated: 2026-MM-DD

# === 项目规模 (取最大值) ===
bizline_count: 1
total_rule_count: 50
page_count: 12
external_dep_count: 3

# === 推导 ===
scale: M  # 上面最大值: S<5, M<20, L<50, XL>=50

# === strict-default 开关 (用户偏好: 不因 scale 降级) ===
strict_mode: true   # 默认 L 规模 + 扩展模式, 显式 false 才降级

# === 阶段触发 (按 scale 推导, 用户可显式覆盖) ===
l0_required: true          # scale >= M 触发 xdd-l0 市场调研
l3_required: true          # 全部规模强制 (韧性是底线)
l6_required: true          # scale >= M 触发 xdd-l6 部署门禁
scaffold_required: true    # 新项目触发 xdd-scaffold
bxx_enabled: false          # bizline_count > 1 时强制 true
persona_max: 12            # strict-mode=true 时 12, 否则 scale 推导
persona_dimensions: 8
coverage_dimensions: 20
wire_passes: 4
l3_extended_mode: true     # strict-mode=true 时 true

# === 验收约束 ===
no_advisory: true          # 5 段 hard-gate, 不留灰色地带
halt_after: 3              # 3 试未过升级 HALT
```

字段说明：

| 字段 | 谁读 | 默认值 | strict-mode=true | strict-mode=false |
|------|------|--------|------------------|-------------------|
| `l0_required` | xdd-walker | false | true (M+) | 按 scale 推导 |
| `l3_required` | xdd-walker | true | true | true (全部强制) |
| `l6_required` | xdd-walker | false | true (M+) | 按 scale 推导 |
| `scaffold_required` | xdd-walker | true (新项目) | true | true |
| `bxx_enabled` | xdd-walker | false | false | bizline_count > 1 时 true |
| `persona_max` | xdd-bdd | 8 | 12 | 按 scale 推导 |
| `persona_dimensions` | xdd-bdd | 6 | 8 | 按 scale 推导 |
| `coverage_dimensions` | xdd-bdd | 14 | 20 | 按 scale 推导 |
| `wire_passes` | xdd-wire | 3 | 4 | 按 scale 推导 |
| `l3_extended_mode` | xdd-l3 | false | true | scale=L 才自动 true |
| `no_advisory` | xdd-walker | true | true | true |
| `halt_after` | xdd-walker | 3 | 3 | 3 |

## 设计原则

1. **模板从 schema.json 派生** — status.md 表的行数、字段都对应 `.xdd/xdd-schema.json` 的 `stages[]`，所以改 schema 不会导致 init 出来的 status.md 跟阶段表对不上。
2. **idempotent-with-warning** — 重复 init 不会静默覆盖。`--force` 才会。
3. **不调 walker** — init 只生骨架。Phase 1 RESEARCH 本身是 walker + xdd-l0 的活。
4. **多业务线项目**：用 `--bizlines B01 用户,B02 订单` 一次性把 BXX section 写进 status.md，**避免** walker 跑到 Phase 1 才"发现"需要拆分。
5. **strict-default 必含** — scale.md 顶部必含 `strict_mode: true`，5 个下游 skill 读这个字段不读 scale 标签 (用户偏好)。

## 后续：让 walker 接手

```bash
# 1. 加载 walker
# Claude Code: "使用 xdd-walker subagent 继续走 Phase 1"
# OpenCode:    加载 xdd-walker agent

# 2. walker 第一步会调 xdd-l0
# 3. xdd-l0 完成后, status.md 的 Phase 1 行会被 post-write-stub-scan.sh
#    (或 OpenCode 同等 hook) 自动改成 ✅, 并提示加载 xdd-bdd
```

## 5.5 项目级 AI 指引注入 (新, 实施 #23)

**意图**: 让 xdd workflow 跟用户项目**整合**, 而不是孤立存在于 `.xdd/` 里. 用户 (跟 AI 助手对话时) 在项目根读 `CLAUDE.md` / `AGENTS.md` 时, 能看到 xdd 的存在跟入口.

**机制** (3 个文件, 3 个角色):
| 文件 | owner | 内容 | 何时被改 |
|------|-------|------|---------|
| `CLAUDE.md` (项目根) | **用户 99%** | 用户自己的 AI 指引 (项目背景 / 团队规范 / 风格偏好 等) | xdd 永不覆盖 marker 外内容 |
| `<!-- xdd:start -->` ... `<!-- xdd:end -->` (CLAUDE.md 内的 marker 块) | **xdd 5-10 行** | 1 句 pointer 指向 `.xdd/WORKFLOW.md` | xdd 写 1 次, 后续 idempotent re-sync |
| `.xdd/WORKFLOW.md` (项目 .xdd/ 内) | **xdd-owned 80+ 行** | 完整 workflow 指南 (5-step / 6-phase / HARD-GATE / 风格) | xdd 整体重写, re-sync 时自动更新 |

**为什么是"指针 + WORKFLOW.md" 而不是 "50 行直接注入 CLAUDE.md"**:
- 用户 CLAUDE.md 是 sacred 的 — 99% 用户拥有, xdd 不该占 50 行
- re-sync 零风险 — 只覆盖 `.xdd/WORKFLOW.md` (xdd-owned), 用户 CLAUDE.md 不动
- 用户 opt-out 简单 — 删 5-10 行 marker 块就完了
- multi-harness 一致 — Claude Code 读 `CLAUDE.md` / OpenCode + Cursor 读 `AGENTS.md`, 都指同一 `.xdd/WORKFLOW.md`

**5 步节奏** (init 注入时):
1. 检测 `.xdd/` 是否已存在 → 注入 idempotent (重 init 不会重复 append)
2. 写 `.xdd/WORKFLOW.md` (cp 模板, 整体重写 OK)
3. 检测 `CLAUDE.md` / `AGENTS.md` 是否存在 (用户文件, 不创建新的)
4. 存在 → 注入 5-10 行 pointer wrapped in `<!-- xdd:start -->` ... `<!-- xdd:end -->`
5. 已在 marker → idempotent replace (同版本跳过, 旧版本升级)

**re-sync 兜底**: `hooks/xdd-gate-pre-skill.sh` 装 xdd skill 前调 `inject_claude_md_pointer`, 缺 marker 就 re-add, 旧版本 marker 就升级. 老 demo (无 .xdd/LIFECYCLE.md) grandfather 跳过.

**详见**:
- 模板: `skills/xdd-init/templates/WORKFLOW.md` (xdd-owned payload) + `skills/xdd-init/templates/CLAUDE.md.snippet.md` (5-10 行 pointer)
- Helper: `hooks/xdd-gate-lib.sh:inject_claude_md_pointer()`
- 设计指针: `CLAUDE.md § 设计规范指针 #23`

## 故障排查

| 现象 | 原因 | 修法 |
|------|------|------|
| `schema not found` | 没在 xdd 仓库里 / 软链解不开 | `pwd` 确认在仓库根；`ls .xdd/xdd-schema.json` 存在？ |
| `.xdd/ already exists` | 项目已初始化 | 删 `.xdd/` 重跑，或 `--iter 2` 开新 iter，或 `--force` 强覆盖 |
| status.md 看着不对 | 老版本生成的（没 `last_updated`） | `cat .xdd/xdd-version`，如 < 0.1.0，手补 `last_updated:` 行 |
| walker 加载后看到空 status | init 漏跑了 | 跑 `bash scripts/init.sh --force` |
| `strict_mode` 字段没出现在 scale.md | 用了老 init 脚本 | 重跑 init 或手动补 `strict_mode: true` 行 |
