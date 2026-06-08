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
├── iterations/
│   └── iter-1/
│       └── pipeline/
│           └── status.md             # 12 行阶段表，全部 ⏳
└── research/
    └── .gitkeep                      # 提示 walker 第一个阶段是发散调研
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

## 故障排查

| 现象 | 原因 | 修法 |
|------|------|------|
| `schema not found` | 没在 xdd 仓库里 / 软链解不开 | `pwd` 确认在仓库根；`ls .xdd/xdd-schema.json` 存在？ |
| `.xdd/ already exists` | 项目已初始化 | 删 `.xdd/` 重跑，或 `--iter 2` 开新 iter，或 `--force` 强覆盖 |
| status.md 看着不对 | 老版本生成的（没 `last_updated`） | `cat .xdd/xdd-version`，如 < 0.1.0，手补 `last_updated:` 行 |
| walker 加载后看到空 status | init 漏跑了 | 跑 `bash scripts/init.sh --force` |
| `strict_mode` 字段没出现在 scale.md | 用了老 init 脚本 | 重跑 init 或手动补 `strict_mode: true` 行 |
