# C3AUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Shadow — 工匠型开发体系（Craftsman-Style Development System）

This repository is **not a typical application codebase**. It is a **meta-project** — a complete AI-driven software development framework for OpenCode consisting of one craftsman-style Agent (`shadow-walker`), 13 core Skills (covering 30→31→31.5→Scaffold→32→33→35→36), and 8 utility Skills. The Agent uses the Skills as a toolbox to take a project from "user says 'build me X'" all the way to deployed, verified, working code.

If a user gives Claude a task, the right move is usually to **load the `shadow-walker` agent and walk the pipeline** rather than improvise.

## 常用命令

### Install / sync — 选你的环境

仓库的交付物（agents、skills）需要软链到对应 harness 的配置目录。**三个安装脚本并存，按需选用，互不干扰：**

| Harness | 安装命令 | 软链到 |
|---------|---------|--------|
| **OpenCode** | `./install-to-opencode.sh` | `~/.config/opencode/{agents,skills}` |
| **Claude Code** | `./install-to-claude-code.sh` | `~/.claude/{agents,skills,hooks,settings.json}` |
| **pi** | `./install-to-pi.sh` | `~/.pi/{agents,skills,hooks,settings.json}` (可 `PI_DIR=...` 覆盖) |

三个脚本都使用 symlink，编辑后无需重装即可生效。OpenCode 脚本还会为带 `package.json` 的 extensions 跑 `npm install`；Claude Code / pi 脚本不涉及 npm。pi 脚本额外支持 `--dry-run` / `--uninstall` / `--force` 选项。

### Claude Code hooks（自动门禁）

仓库根的 `settings.json` 软链到 `~/.claude/settings.json`，在 CWD 位于本项目时由 Claude Code 自动加载，声明了 5 个 hook。Hook 脚本在仓库根的 `hooks/`（跟 `agents/`、`skills/` 平级），**通过软链同步到 `~/.claude/hooks/`**（单一源真理，编辑仓库即生效）：

| Hook | 触发时机 | 行为 |
|------|---------|------|
| `user-prompt-submit.sh` | `UserPromptSubmit` | 关键词检测"做一个 XX 系统" / "build me X" / "from scratch"；命中提示 Claude 加载 shadow-walker subagent |
| `session-start.sh` | `SessionStart` | 探测项目根，输出当前 iter、status.md 阶段汇总、**BXX 业务线维度分布**、CONTEXT-MAP 摘要 |
| `pre-skill.sh` | `PreToolUse` (matcher: `Skill`) | 装 skill 前打印 5 步节奏提醒；若 status.md 仍有更早的 ⏳ 阶段则**硬阻断**（exit 2） |
| `post-write-stub-scan.sh` | `PostToolUse` (matcher: `Write\|Edit`) | **每次**写完代码实时扫存根（pass/TODO/NotImplementedError/InMemoryRepository），只扫刚写的文件，命中即时告警让模型自纠 |
| `stop-gate.sh` | `Stop` | 全项目扫存根兜底；**按 BXX 分组**列未完阶段 |

`settings.json` 软链到 `~/.claude/settings.json`（首次安装会备份用户原有 `settings.json` 为 `settings.json.bak`）。其他 Shadow 项目若想复用同一套 hooks，可在自己仓库根放 `settings.json` 写同样的 hook 配置，引用 `$HOME/.claude/hooks/<name>.sh`（同时把 `hooks/` 软链到 `~/.claude/hooks/`）。

### OpenCode hooks（自动门禁插件）

OpenCode 使用插件系统而非 shell hooks。等价功能通过 `.opencode/plugins/shadow-hooks.ts` 实现，由 OpenCode 在启动时自动加载：

| Plugin hook | 对应 Claude Code hook | 行为 |
|------------|----------------------|------|
| `experimental.chat.system.transform` | `SessionStart` | 注入 pipeline 上下文（iter、status 摘要）到 system prompt |
| `chat.message` | `UserPromptSubmit` | 检测用户消息中的"做一个系统"意图，注入 Walker 提示 |
| `tool.execute.before` (Skill) | `PreToolUse` (Skill) | 5 步节奏提醒 + 管线阶段顺序硬阻断 |
| `tool.execute.after` (Write/Edit) | `PostToolUse` (Write\|Edit) | 实时扫存根模式，命中即告警 |
| `event` (`session.idle`) | `Stop` | 全项目存根扫描 + pipeline 完成度检查 |

插件通过 `install-to-opencode.sh` 软链到 `~/.config/opencode/plugins/`。

**BXX 业务线维度**：status.md 按 Walker 规范用 `## BXX 业务线名` 分节时，session-start 和 stop-gate 自动按 BXX 分组输出；多业务线项目的待办不会再混成一锅。

### 工具名约定

Walker agent 的 frontmatter **故意不写 `tools` 字段** —— 两个 harness 对它的合法格式互斥：

| Harness | `tools` 合法形式 |
|---------|----------------|
| Claude Code | 逗号分隔字符串 `tools: Read, Write, Edit, …`（TitleCase） |
| OpenCode | 对象映射 `tools: { read: true, write: true, … }`（schema 严格校验） |

写任一种都会让另一边的 schema 校验直接拒绝 → bootstrap 失败。**省略字段在两边都等于"全工具开放"**，正是 Walker 想要的默认状态。

Agent 正文里的工具名一律按 Claude Code 风格 TitleCase 引用（`Read` / `Write` / `Bash` / …）—— 仅为文档可读性，不参与 schema 校验，所以两边都无所谓。

### Verify skill SKI33.md size discipline

Shadow's design rule is that each `SKI33.md` stays under ~500 lines (progressive disclosure — long content goes in `references/`). Useful spot check:

```bash
wc -l skills/*/SKI33.md
```

### Render the architecture diagram

The unified architecture lives in `docs/architecture.mmd` (Mermaid, dark theme). The `mermaid-check` skill can validate it.

```bash
# Render with any Mermaid-aware tool, e.g. mmdc
npx -p @mermaid-js/mermaid-cli mmdc -i docs/architecture.mmd -o /tmp/arch.svg
```

### Git workflow

Default branch is `main`. Recent commit convention is Conventional Commits (`refactor(walker): …`, `docs: …`). Always end commit messages with:

```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

## 架构与代码结构

### High-level model

```
User task
   ↓
agents/shadow-walker.md        ← Single craftsman agent (not a dispatcher)
   ↓ loads skills on demand
skills/{name}/SKI33.md         ← Each skill: <500-line quickstart + references/
   ↓ produces
.shadow/                       ← Per-iteration artifacts (intent → flow → spec → wire → architecture → e2e → resilience → plan → code → deploy)
```

The Walker is **not a dispatcher** — it does the work itself, reading files, writing code, running commands. It picks one Skill at a time and follows that Skill's SKI33.md as the execution script.

### Directory layout

```
agents/
  shadow-walker.md             ← The agent (345 lines). Read this first to understand the framework.

skills/
  shadow-init/                 ← Initialize .shadow/ skeleton (status.md + scale.md + iter dir) — **always run first for new projects**
  shadow-l0-research/          ← 30: free-form divergent research notebook (no gate)
  shadow-l1-research/          ← 31: DDD+EDD+IDDD business research → intent.md, business-landscape.md, BXX research.md
  shadow-l1-flow/              ← 31: MDD project flow diagram (project.flow.mermaid, BXX-NYY nodes)
  shadow-l1-spec/              ← 31: FDD rules (RXX numbered, one feature per rule)
  shadow-l1-wire/              ← 31: SVG wireframes with data-* annotations
  shadow-l1p5-architecture/    ← 31.5: ADD+SDD+PDD → architecture.md, API contracts, event contracts
  shadow-scaffold/             ← Project scaffolding (7 steps, Docker dev env, Hello API)
  shadow-l2-e2e/               ← 32: BDD acceptance scenarios, coverage matrix, uat-script.md
  shadow-l3-resilience/        ← L3: RDA resilience design (8 维度失败模式 + 10 兜底模式 + 混沌场景 + 恢复剧本) — all-scale mandatory
  shadow-l5-plan/              ← 35: Harness execution plan (Batch 1-8, per-method assertions)
  shadow-l5-impl/              ← 35: TDD code implementation by batch
  shadow-reviewer/             ← Full-chain review (mandatory gate before 36)
  shadow-l6-deploy/            ← 36: Deploy + real verification (Phase 0-9, 3-round repair cap)
  shadow-reverse/              ← Reverse-engineer existing systems
  shadow-taste/                ← Taste / quality check
  shadow-trace-init/           ← Initialize traceability
  mermaid-check/               ← Validate Mermaid rendering
  docker-helper/               ← Docker troubleshooting
  test-in-tmux/                ← Run tests
  skill-creator/               ← Meta-skill: create / improve / benchmark skills
  opencode-learning/           ← 3earn OpenCode API

  # 单一源真理: .shadow/shadow-schema.json (仓库根) 描述阶段表、存根模式、scale 字段.
  # hooks/*.sh + plugins/shadow-hooks.ts 都从这里读, 改一处即生效.

  Each skill's internal layout:
    SKI33.md                   ← Quickstart (<500 lines, in-context on trigger)
    references/                ← Deep-dive docs, read on demand
    templates/                 ← Optional output templates
    scripts/                   ← Optional gate-check / automation scripts
    DEPS.md                    ← Optional runtime deps (npm/pip/system)

prompts/
  ai-execution-prompt.md       ← Generic "plan-constrained executor" prompt
  team_loop.md                 ← Older team-style prompt (kept for reference)

docs/
  architecture.mmd             ← Unified Mermaid: agents + behavior + bizlines
  requirements.md              ← Sample requirement (user login) for reference

README.md                      ← High-level overview, pipeline, directory map
install-to-opencode.sh         ← Symlink installer to ~/.config/opencode/
```

### The Shadow pipeline (标准项目)

```
30  发散调研       shadow-l0-research
  ↓
31  业务层        shadow-l1-research → shadow-l1-flow → shadow-l1-spec → shadow-l1-wire  (串行)
  ↓
规模判定           .shadow/scale.md  (S / M / 3 — based on bizline count, rules, pages, deps)
  ↓
31.5 架构         shadow-l1p5-architecture
  ↓
搭脚手架          shadow-scaffold
  ↓
32  验收         shadow-l2-e2e
  ↓
33  韧性设计      shadow-l3-resilience  ← 8 维度失败模式穷举 + 10+ 兜底机制 + 混沌测试场景（不管规模都跑）
  ↓
35  计划         shadow-l5-plan
  ↓
35  实现         shadow-l5-impl  (按 Batch 串行)
  ↓
全链路审查       shadow-reviewer  (chain, 必经, 不可跳过)
  ↓
36  部署验证     shadow-l6-deploy
```

### 关键设计原则

1. **渐进式披露 (Progressive disclosure)** — Each `SKI33.md` is a quickstart under 500 lines. Deeper content lives in `references/` and is read on demand. Always follow the Skill's own SKI33.md as the procedure; don't freelance.

2. **传导链追溯 (Transmission-chain traceability)** — Every artifact references upstream IDs:
   - `intent.md` (why)
   - `research.md` per business line (BXX)
   - `project.flow.mermaid` with `BXX-NYY` node IDs
   - `spec.md` with `RXX` rule IDs (one rule = one feature)
   - `architecture.md` with API endpoint and event-contract lists
   - `harness-plan.md` with per-method implementation instructions and test assertions
   - Code annotated with `@implements RXX` and node IDs back to the business intent

   When any layer changes, consult the **change-propagation table** in `agents/shadow-walker.md` to know which downstream layers must be re-run.

3. **全局约束 (Global constraints)** — Cross-cutting concerns (multi-tenant isolation, auth/authz, unified error format, event publishing, pagination, transaction boundaries) are defined once in the 35 Harness plan's "global constraints" section and enforced uniformly.

4. **规模驱动 (Scale-driven) parameters** — `.shadow/scale.md` encodes project size (S/M/L) and downstream-readable parameters (`persona_dimensions`, `persona_max`, `coverage_dimensions`, `wire_passes`, `l3_required`, `l6_core_phases_only`). Downstream Skills read this file and adjust behavior. Scale is the **maximum** of: bizline count, total rule count, page count, external dependency count. When in doubt, round up. `l3_extended_mode` defaults to `false` (L 规模时启用 9 维 + 12 模式 + 8 字段), `l3_required` defaults to `true` (L3 韧性设计 全部规模强制) since extreme-condition design is non-negotiable.

   5a. **L 规模扩展模式** (`.shadow/scale.l3_extended_mode=true`) — L 规模项目 (电商/支付/跨地域 SaaS) 自动启用 9 维 + 12 模式 + 8 字段:
      - 9 维 = 8 维 + 跨地域/多活 (F81-F85)
      - 12 模式 = 10 模式 + 业务对账 (FS11) + 业务幂等 (FS12)
      - 8 字段 FMEA = 5 字段 + Owner + SLO 关联 + 回滚时长
      S/M 规模默认 8 维 + 10 模式 + 5 字段即可。

5. **工藤伦底线 (Walker's hard rules)** — No stubs, no fake implementations (no InMemoryRepository, no hardcoded `current_user`), no skipped phases, no fake "DONE". "Tests pass" is not "code is correct" — read assertion quality. After 4 failed attempts at the same step, write `FAI3URE-3OG.md` and ask the user.

6. **36 漫游修复硬上限 (3-round repair cap)** — 35/36 is not an infinite loop. If P1 issues remain after 3 repair rounds, retreat to the design layer (`shadow-l1-wire` for dead-ends, `shadow-l1-research` for workflow blockers, `shadow-l1p5-architecture` for API errors).

### Iteration model

Iterations are isolated via `.shadow/iterations/iter-N/`:

```
.shadow/
├── current-iteration          ← file: "iter-2"
├── iterations/
│   ├── iter-1/                ← frozen when iter-2 starts
│   │   ├── pipeline/status.md
│   │   └── gate/
│   └── iter-2/                ← active
├── 31-business/               ← shared, edited in place across iterations
├── 31.5-architecture/         ← shared
├── 32-e2e/                    ← shared
├── L3-resilience/             ← shared
└── 35-plan/                   ← shared
```

Shared artifacts are edited in place (not frozen) across iterations; iteration-specific state (`status.md`, `gate/` markers) is per-iter. Rollback uses `git revert` to the iter-N completion commit, not directory freezing.

### status.md is the Walker's working memory

Walker maintains a `pipeline/status.md` per iteration with a fixed skeleton: per-stage status table, "current stage" pointer, "this-stage must-read" pointers, and (for multi-bizline projects) a "cross-BXX consistency" checklist. Update it at every tool swap and stage completion — don't rely on the model keeping state in its head.

## § 7 工件生命周期(5 类角色)

Shadow 30+ 份 `.shadow/` 工件按生命周期角色分 **5 类**,以 `.shadow/shadow-schema.json:lifecycle_artifacts[]` 为单一源真理(59 项登记,本节解释角色定位,具体工件映射见 schema)。

| 角色 | 英文 | 含义 | 典型产物 | 存储 |
|------|------|------|----------|------|
| **设计基线** | `design_baseline` | 下次开发必主动引用;改了触发下游变更传播 | `spec.md` / `architecture.md` / `failure-modes.md` / `failsafe-design.md` / `harness-plan.md`(约束段) / 项目代码 | `.shadow/L*-*` 顶层 |
| **过程产物** | `process_output` | 一次性消费,过期作废 | L0 笔记本 / `status.md` / 审查报告 / `wire-skeleton.svg` / 审查 `result.json` | `.shadow/iterations/{iter}/` |
| **证据存档** | `evidence_archive` | 只读不可变;审计/复盘用 | `wander-evidence/` / `chaos-drill-evidence/` / `issues.json` | `.shadow/iterations/{iter}/L6-deploy/{slug}/` |
| **控制标记** | `control_marker` | 空文件/单行,跟生命周期绑定 | `SHADOW_VERSION` / `current-iteration` / `scale.md` / `.passed` / `.done` / `INDEX.md` / `TRACE.md` | 顶层 + `iter/gate/` + `iter/feature-status/` |
| **模板与实例** | `template_instance` | 模板(skill 内) + 实例(落地后转主角色) | `skills/{name}/templates/*.md` | skill 内 |

### 判别启发式(下次有新工件不知归哪时,按顺序问)

1. **下次开发会不会主动读它?** 是 → 设计基线;否 → 过程产物
2. **是否只服务"证明某事发生过"?** 是 → 证据存档
3. **是否只是"已通过/已完成"标记?** 是 → 控制标记
4. **是否只是空骨架等被填?** 是 → 模板(实例落地后转问 1)

### 为什么不只按"跨迭代 vs 迭代作用域"分

旧二分法只描述"放在哪",不描述"用多久"。后果(7+ 真实项目混乱样本验证):
- `L5-plan/` 在 `iter-helpers.sh` 注释里说"共享",在 `directory-structure.md` 又列进"迭代作用域",真实项目两派都有
- `feature-status/` 在 3 个不同位置共存
- 部署报告叫 `deploy-report.md` 还是 `deployment-report.md` 各自为政
- 审查报告路径在 schema / SKILL / 实物三处都不同
- `L3-resilience` 5 份文件名在 cjxdd/demo 实物里 3 份被改名

5 类生命周期角色 = 回答"用多久 + 谁消费 + 改后会发生什么",从根上消除这类混乱。详见 `.shadow/shadow-schema.json:lifecycle_artifacts.roles`。

### 消费方(谁会查这张表)

- **Walker**:跨层决策时查"我改的是设计基线还是过程产物"
- **`hooks/lib.sh`**: `lifecycle_role_of <path>` / `lifecycle_paths_by_role <role>` / `count_lifecycle_role_files <role>`
- **`hooks/stop-gate.sh`**: 5 条软警告(skel 文件 / 老 L3 文件名 / 老 deploy-report 别名 / 老 reviewer 路径 / feature-status 漂移)对照 schema
- **`hooks/session-start.sh`**: 启动时打印"角色分布"统计
- **Reviewer chain audit**: 审查时把"角色 + 漂移"作为评估维度
- **`shadow-trace-init`**(下期): 反向追溯时把"角色"作为传播权重

### 模糊地带(已知)

| 工件 | 既是 X 又是 Y | 本方案怎么定 |
|------|--------------|-------------|
| `harness-plan.md` | 约束段 = 设计基线;逐文件指令段 = 过程产物 | 标 `design_baseline`;note 注明"指令段实现完即过期但依附文件保留" |
| `scale.md` | 控制标记 + 被 5 个 skill 读 | 标 `control_marker`;note 注明"具有 design_baseline 的一些属性" |
| `L6 deployment-report.md` | 文件本身 = 过程产物;内部"证据段" = 证据存档 | 标 `process_output`;note 注明"内部 evidence 段是 evidence_archive 角色" |
| `e2e/{feature}.binding.yaml` | 未填实 = 过程产物;填实后 = 设计基线(测试代码) | 标 `process_output`;note 注明"填实后转设计基线" |

## § 8 压力信号检测(反"加速跳过"护栏,Phase 2-3)

**问题**:AI 在压力下(用户催 / 时间紧 / 自作主张加速)容易跳步、写存根、简化 fixture 蒙混过关。Shadow 体系设计两道护栏:

### 8.1 Hook 层(`hooks/lib.sh:check_pressure_signals`)

软提醒(不阻断),被 3 个 hook 触发:

| 触发点 | 时机 | 扫什么 |
|--------|------|--------|
| `user-prompt-submit.sh` | 用户消息一进来 | 扫 `user_prompt` 全文 |
| `pre-skill.sh` (Skill) | AI 即将调某个 skill | 扫 `.tool_input` (含 skill name) |
| `stop-gate.sh` | AI 完成一轮 | (Phase 2 后续,扫 transcript) |

### 8.2 检测 5 类压力信号(中英双语,case-insensitive)

| 类别 | 中文示例 | 英文示例 |
|------|---------|---------|
| `RUSH` | 加快节奏、加快速度、快点、赶紧、赶进度 | hurry, rush, asap, speed up |
| `TIME` | 时间紧、时间不多、没时间、deadline | tight deadline, running out of time |
| `SKIP` | 跳过、省掉、略过、不做了 | skip, omit, abbreviate |
| `SIMPLIFY` | 简化、简单做、草草、随便 | rough, quick and dirty, minimal |
| `WORKLOAD` | 工作量大、很多活、活多 | huge workload, lots of work |

### 8.3 软提醒文案(注入到 AI 下一轮上下文)

```
🐢  慢慢来, 不要跳步
  Walker 3 步硬底线: 不写存根 / 不用假实现 / 完成 = 真完成
  5 步节奏: 装 skill → 写 checklist → 干 → 自检 + 标 ✅ → 加载下一 stage
  压力下特别容易犯的错:
    ✗ 跳过 stage 直接写代码 → pre-skill.sh 硬阻断
    ✗ 简化 fixture 用 InMemoryRepository → stub scan 告警
    ✗ 用 hardcoded user 假装登录 → stub scan 告警
  若时间真的紧: 缩 scope, 不是砍 quality
```

### 8.4 设计原则

- **不阻断** — soft reminder, AI 看完决定是否采纳(decision-by-AI, not decision-by-hook)
- **不依赖 matched 状态** — 任何 prompt 都扫压力信号,即使没匹配到意图
- **失败静默** — 0 命中不输出,无副作用;awk 数命中数(不用 grep -c 避免 set -e 误杀)
- **可调阈值** — 模式串集中在 `lib.sh:check_pressure_signals()`,调一处即生效

### 8.5 跟 5 角色生命周期 + 5 硬门禁的关系

压力信号检测是"AI 行为层"护栏(防 AI 自己走捷径),5 硬门禁是"产物层"护栏(防产物不合规)。两层互补:
- **AI 行为层** — Hook 软提醒, AI 仍可自决
- **产物层** — R5 漂移扫描 + R3 证据写阻断 + R10 自动归档,产物不合规直接 exit 1

## Where to start

- **To understand the framework**: read `agents/shadow-walker.md`, then `docs/architecture.mmd` (rendered), then `README.md`.
- **To understand a single stage**: open `skills/{stage}/SKI33.md`. It is the execution script.
- **To understand stage-to-stage handoffs**: read the change-propagation table and retreat decision tree in `agents/shadow-walker.md`.
- **To create a new skill**: use `skills/skill-creator/SKI33.md` (it has its own eval/iterate loop).
- **To reverse-engineer an existing codebase with no `.shadow/`:** start with `shadow-reverse`, not 30.
