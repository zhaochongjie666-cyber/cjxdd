# shadow-init — 一键初始化 Shadow 项目

把空仓库变成 Shadow Walker 可识别的项目：生成 `.shadow/` 目录结构、初始 status.md、scale.md 占位、SHADOW_VERSION 标记。**新项目第一步**。

## 何时使用

- 拿到一个空仓库 / 新目录，准备开始用 Walker 走 L0→L6
- 上一个 iter 完成了，要开 iter-2（用 `shadow-init --iter 2`）
- 想重新生成被删掉的 `.shadow/SHADOW_VERSION`

**不要在以下情况用**：
- 项目已经有 `.shadow/` 且你想继续 — 直接调 walker / 下一个 skill
- 想迁移老 Shadow 项目到新版本 — 那是 `shadow-migrate`（暂未实现，先手改）

## 最快路径

```bash
# 任何 shadow 项目目录下：
bash ~/.claude/skills/shadow-init/scripts/init.sh

# 或在仓库根：./skills/shadow-init/scripts/init.sh
# 跑完会自动打印"下一步: 加载 shadow-walker"
```

脚本会：
1. 读 `framework/shadow-schema.json` 里的 `shadow_version` 字段
2. 检查 `.shadow/` 是否已存在（已存在则 abort，要求 `--force` 或新 iter）
3. 生成 4 个文件：`SHADOW_VERSION`、`current-iteration`、`iterations/iter-1/pipeline/status.md`、`scale.md`
4. 在 L0-research/ 建占位 `.gitkeep`
5. 打印下一步操作清单

## 参数

| 参数 | 默认 | 说明 |
|------|------|------|
| `--iter N` | `1` | 初始化哪个 iter。会写 `current-iteration` 和 `iterations/iter-N/` |
| `--force` | false | `.shadow/` 存在时强制覆盖（**危险**，会丢 status） |
| `--schema PATH` | 自动找 | 指定 schema.json 路径（默认解软链找仓库根的 `framework/shadow-schema.json`） |
| `--no-scale` | false | 不生成 scale.md 占位（极简模式） |
| `--bizlines B01,B02` | `[]` | 多业务线项目：预生成 `## BXX` 段落 |

## 生成的文件

```
.shadow/
├── SHADOW_VERSION                    # 单行：schema 里的 shadow_version
├── current-iteration                 # 单行：当前 iter 名（默认 "iter-1"）
├── scale.md                          # 默认值，下游 5 个 skill 读
├── iterations/
│   └── iter-1/
│       └── pipeline/
│           └── status.md             # 12 行阶段表，全部 ⏳
└── L0-research/
    └── .gitkeep                      # 提示 walker 第一个阶段是发散调研
```

status.md 模板（含 `last_updated` 字段，hook 用它检测过期）：

```markdown
# Pipeline Status — iter-1

last_updated: 2026-06-05T14:32:00+08:00
shadow_version: 0.2.0

> Per-stage table below. Mark each row with ⏳ pending / 🔄 doing / ✅ done / ❌ failed.
> For multi-bizline projects, organize by `## BXX 业务线名` sections.

| 阶段 | 状态 | 产出 | 自检 |
|------|------|------|------|
| L0 | ⏳ | — | — |
| L1 Research | ⏳ | — | — |
| L1 Flow | ⏳ | — | — |
| L1 Spec | ⏳ | — | — |
| L1 Wire | ⏳ | — | — |
| L1.5 | ⏳ | — | — |
| Scaffold | ⏳ | — | — |
| L2 | ⏳ | — | — |
| L5 Plan | ⏳ | — | — |
| L5 Impl | ⏳ | — | — |
| 全链路审查 | ⏳ | — | — |
| L6 | ⏳ | — | — |
```

scale.md 模板（默认值，下游 skill 读 `persona_dimensions` 等）：

```markdown
# Project Scale

> 字段值由 walker 在 L1 → L1.5 之间"规模判定"步骤填写。
> 下游 5 个 skill（l0/l1-research/l1-wire/l2/l6）按此文件调整行为。

scale: M
persona_dimensions: 6
persona_max: 8
wire_passes: 3
coverage_dimensions: 14
l6_core_phases_only: false
```

## 设计原则

1. **模板从 schema.json 派生** — status.md 表的行数、字段都对应 `framework/shadow-schema.json` 的 `stages[]`，所以改 schema 不会导致 init 出来的 status.md 跟阶段表对不上。
2. **idempotent-with-warning** — 重复 init 不会静默覆盖。`--force` 才会。
3. **不调 walker** — init 只生骨架。L0 发散本身是 walker + l0-research 的活。
4. **多业务线项目**：用 `--bizlines B01 用户,B02 订单` 一次性把 BXX section 写进 status.md，**避免** walker 跑到 L1 才"发现"需要拆分。

## 后续：让 walker 接手

```bash
# 1. 加载 walker
# Claude Code: "使用 shadow-walker subagent 继续走 L0"
# OpenCode:    加载 shadow-walker agent

# 2. walker 第一步会调 shadow-l0-research
# 3. l0-research 完成后, status.md 的 L0 行会被 post-write-stub-scan.sh
#    (或 OpenCode 同等 hook) 自动改成 ✅, 并提示加载 l1-research
```

## 故障排查

| 现象 | 原因 | 修法 |
|------|------|------|
| `schema not found` | 没在 shadow 仓库里 / 软链解不开 | `pwd` 确认在仓库根；`ls framework/shadow-schema.json` 存在？ |
| `.shadow/ already exists` | 项目已初始化 | 删 `.shadow/` 重跑，或 `--iter 2` 开新 iter，或 `--force` 强覆盖 |
| status.md 看着不对 | 老版本生成的（没 `last_updated`） | `cat .shadow/SHADOW_VERSION`，如 < 0.2.0，手补 `last_updated:` 行 |
| walker 加载后看到空 status | init 漏跑了 | 跑 `bash scripts/init.sh --force` |
