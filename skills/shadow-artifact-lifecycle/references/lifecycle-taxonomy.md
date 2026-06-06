# 工件生命周期分类(5 类)深度说明

> 本文是 `shadow-schema.json:lifecycle_artifacts[]` 的深度解读。
> 完整 58 工件映射见 schema;本文只讲 5 类角色的**判定细节 + 边界情形**。

## 1. 设计基线(`design_baseline`)

### 定义

> 下次开发**必主动引用**;Walker 反复回查;改动会触发下游变更传播。

### 判定铁三角

| 信号 | 怎么验证 |
|------|---------|
| Walker 必读 | 改这份文件时,Walker 加载对应 skill 的 SKILL.md 是不是有"读 X"指针指向它 |
| 跨迭代复用 | 新需求来时,这份文件**原位修改**还是重写?原位修改 → design_baseline |
| 触发下游 | 改它会触发其它 stage 重跑?会 → design_baseline |

### 典型示例(从 schema 摘)

- `spec.md` (RXX 规则) — L1.5 / L2 / L5 全部回查
- `architecture.md` (API 端点) — L2 / L3 / L5 全部回查
- `failure-modes.md` / `failsafe-design.md` — L3 / L5 兜底约束源
- `harness-plan.md` (约束段) — 下次开发的批次划分基线
- 项目代码 — 既是产品交付又是 design_baseline

### 边界

- **不是所有"在 .shadow/ 顶层"的文件都是 design_baseline** — `INDEX.md` / `TRACE.md` 在顶层但是 control_marker
- **不是所有 `.md` 都是 design_baseline** — `status.md` 是 process_output
- **修改频率不直接判定** — `current-iteration` 改得勤,却是 control_marker

## 2. 过程产物(`process_output`)

### 定义

> 一次性消费,消费完即弃;只服务于**本轮 pipeline 流转**。

### 判定铁三角

| 信号 | 怎么验证 |
|------|---------|
| 不被下次开发引用 | "下个需求来时我会不会读它?" — 答"不会" |
| iter 冻结随 iter 走 | 冻结时这份文件归到 `iterations/iter-N/` 一起不再被新 iter 访问 |
| 没有跨 iter 价值 | 即使保留归档,也不会被新 iter 的 skill 重新加载 |

### 典型示例

- L0 笔记本(`01..07-*.md`) — L1 收敛后即弃
- `wire-skeleton.svg` / `wire-content.svg` — L1 Wire Pass 1/2 中间产物
- `status.md` — 每 iter 复制新模板
- 审查报告 `reviews/{type}-review-{slug}-{ts}.md` — 当次审查快照
- 部署报告 `deployment-report.md` — 当次部署报告
- `code-skeleton/` — L5-impl 起点,被覆盖填实
- `e2e/{feature}.binding.yaml`(未填实) — 填实后转 design_baseline

### 边界

- **`result.json` / `failed.json` 是 process_output,但 `.passed` 是 control_marker** — 同在 `gate/` 下,角色不同
- **审查报告** 看起来"应该持久" — 实际"下个 iter 我不会再读",所以 process_output;若要持久,归 `evidence_archive`(详细 L6 wander-evidence 就是)

## 3. 证据存档(`evidence_archive`)

### 定义

> 只读不可变;只用于**审计 / 复盘 / 合规**;不再被下游加工。

### 判定铁三角

| 信号 | 怎么验证 |
|------|---------|
| 只读 | chmod 444;改之前先反思 |
| 不被下游消费 | "下次 L1-L5 跑会读它吗?" — 答"不会,只用于复盘" |
| 不可变 | iter 冻结时加 `.archived` 锁,文件名带时间戳后缀 |

### 典型示例

- `wander-evidence/` — Phase 5.6 漫游截图 + trace(供 36 漫游修复 3 轮硬上限 + 设计层回退参考)
- `chaos-drill-evidence/` — Phase 5.7 灾难演练
- `issues.json` — P0/P1/P2 + root_cause + fix_suggestion + trace_to_design
- 部署报告内部"证据段" — "真实验证 / 演练记录"段

### 边界

- **`wander-evidence/` 与 `e2e-evidence/` 的关系** — 同一类,后者是 cjlabel 实物里的别名(已纳入 aliases)
- **不是"重要的就归证据存档"** — `harness-plan.md` 也很重要,但是 design_baseline(下次开发要读)
- **不是"iter 冻结的就归证据存档"** — `status.md` 也冻结,但是 process_output(没有审计价值)

## 4. 控制标记(`control_marker`)

### 定义

> 空文件 / 单行,跟生命周期绑定;表达"这层已通过 / 这步已完成"。

### 判定铁三角

| 信号 | 怎么验证 |
|------|---------|
| 空文件 / 单行 | `stat` 出来 size 通常 < 100 字节 |
| 存在即表达状态 | 删除 = 重置状态;改名 = 失效 |
| 跨 iter 顶层 vs iter 局部 | 跨 iter 的(`SHADOW_VERSION` / `INDEX.md` / `TRACE.md`)在顶层;iter 局部的(`.passed` / `.done`)在 `iterations/{iter}/` |

### 典型示例

- `SHADOW_VERSION` / `current-iteration` / `scale.md` — 跨 iter 顶层
- `INDEX.md` / `TRACE.md` — 跨 iter 双向追溯基础设施
- `gate/{layer}.{slug}.passed` — iter 局部门禁决策
- `feature-status/{slug}/BXX-NYY.done` — iter 局部进度标记
- `scaffold.verified` / `reverse-complete` — 一次性握手

### 边界

- **"被 5 个 skill 读" 不代表 design_baseline** — `scale.md` 被 5 个 skill 读,但本质是 control_marker(被读 ≠ 是设计)
- **空文件 ≠ 无价值** — `scaffold.verified` 空文件,表达"已验证"状态,Walker 看到这个标记就不重跑脚手架
- **不要重命名 `.passed`** — 它跟 Reviewer SKILL.md 里的"门禁决策文件"约定强绑定

## 5. 模板与实例(`template_instance`)

### 定义

> 模板(skill 内 `templates/`)是空骨架,实例(`.shadow/` 内)是填实的;**实例落地后即"晋升"为该阶段的主角色**。

### 判定铁三角

| 信号 | 怎么验证 |
|------|---------|
| 在 `skills/{name}/templates/` 下 | 是 |
| 内容是占位符 | 是 |
| 没有内容 = 正常 | 是(等被填) |

### 典型示例

- L1.5:`skills/shadow-l1p5-architecture/templates/{architecture,filelist,quality}-template.md`
- L3:`skills/shadow-l3-resilience/templates/{failure-modes,failsafe-design,chaos-scenarios,resilience-test-plan,recovery-runbook}.md`
- L5-plan:`skills/shadow-l5-plan/templates/harness-plan-template.md`
- L6:`skills/shadow-l6-deploy/templates/L6.md`
- L1 wire:`skills/shadow-l1-wire/templates/*.yaml` + `views/*.vue`

### 实例落地后的角色切换

| 模板 | 实例 | 实例角色 |
|------|------|---------|
| `l1p5/architecture-template.md` | `.shadow/L1.5-architecture/{slug}/architecture.md` | `design_baseline` |
| `l3/failure-modes.md` | `.shadow/L3-resilience/{slug}/failure-modes.md` | `design_baseline` |
| `l5/harness-plan-template.md` | `.shadow/L5-plan/{slug}/harness-plan.md` | `design_baseline`(约束段) + `process_output`(指令段) |
| `l6/L6.md` | `.shadow/iterations/{iter}/L6-deploy/{slug}/deployment-report.md` | `process_output`(文件) + `evidence_archive`(内部证据段) |

### 边界

- **L1 wire 的 Vue 组件是模板** — `skills/shadow-l1-wire/views/*.vue`,实例是 `wire.svg`
- **L1 flow 的 T0X-*.md 是场景模板** — 但它们不在 `templates/` 下,在 `references/` 下,**不归 template_instance**,归 references(框架内部知识)
- **`code-skeleton/` 不是模板** — 是 L5-impl 起点,归 process_output(填实后被覆盖)
