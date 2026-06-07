# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Shadow — 工匠型开发体系（Craftsman-Style Development System）

This repository is **not a typical application codebase**. It is a **meta-project** — a complete AI-driven software development framework for OpenCode consisting of one craftsman-style Agent (`shadow-walker`), 13 core Skills (covering 30→31→31.5→Scaffold→32→33→35→36), and 8 utility Skills. The Agent uses the Skills as a toolbox to take a project from "user says 'build me X'" all the way to deployed, verified, working code.

If a user gives Claude a task, the right move is usually to **load the `shadow-walker` agent and walk the pipeline** rather than improvise.

## ⚠️ Meta: 你正在修改 Shadow 自身, 禁用 Shadow 流程

**这个项目就是 Shadow 框架本身** (`agents/` + `skills/` + `hooks/` + `plugins/` + `commands/` + `install-*.sh`). 你在 cjxdd 工作就是**在改 framework**, 不是**在用 framework 改一个外部项目**.

### ❌ 严禁 (用 Shadow 改 Shadow 会自指递归, 工件污染)

- ❌ **不要加载 `shadow-walker` / `shadow-worker` / `shadow-walker-pi` agent 来开发本仓库** — walker 会在 `.shadow/` 写 status.md / 触发 L0 调研 / 跑 pipeline, 把 framework 自身当成"产品项目" 反复迭代
- ❌ **不要跑 Shadow 流水线** (L0→L1→L1.5→Scaffold→L2→L3→L5 Plan→L5 Impl→L6 Deploy) — 流水线是给"外部产品项目"用的, 给 framework 自身跑会污染 `.shadow/` 目录且毫无意义
- ❌ **不要在本仓库创建 `.shadow/`** — `.shadow/` 是产品项目的工作区, framework 自己的状态在 git 里
- ❌ **不要用 `shadow-init` / `shadow-l0-research` 等 skill 来"调研" framework 自身** — skill 输出工件的 schema 假定产物是产品代码, 不是 framework 源码
- ❌ **不要调 `/cjgoal` 推到生产可用** — goal mode 走的是 30→36 pipeline, 不适用 framework 自身迭代
- ❌ **不要被 `hooks/user-prompt-submit.sh` 引导"加载 walker 给我做一个 XX 系统"** — 关键词命中后 hook 会误推 walker, 但本仓库不是产品项目

### ✅ 正确做法 (直接当代码仓库改)

- ✅ **直接读** `agents/` / `skills/` / `hooks/` / `plugins/` / `commands/` 下的源码 — 跟改普通代码一样用 Read/Edit/Write
- ✅ **直接跑 smoke test** — `bash skills/smoke-scaffold-docker.sh` 这类脚本是 framework 自身的回归测试, 跑通即 PASS
- ✅ **直接 commit** — Conventional Commits, 末尾加 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`, 走 git 即可
- ✅ **若想"用 framework 验证 framework"** — 在仓库外另起一个产品项目 (例如 `/tmp/test-product/`), 在那里 `cd` 后 `claude` + 调 walker, 用 Shadow 跑端到端验证, 跟 framework 解耦
- ✅ **修改 hooks 时** — 改 `hooks/lib.sh` 后通过 `bash hooks/stop-gate.sh` 跑真实场景, 跟修改前对比输出
- ✅ **修改 plugin 时** — `plugins/shadow-hooks.ts` / `plugins/goal-mode.tsx` 改完后用 `bun plugins/<file>.ts` (Bun 加载) 跑 smoke, 跟 OpenCode 端行为对齐

### 🔍 怎么判断"我是不是在做 Meta 任务"

跑一句:

```bash
# 满足任意一条 → 你是 Meta (在改 framework 自身, 不能用流程)
[ -f agents/shadow-walker.md ] && [ -f skills/shadow-init/SKILL.md ] && echo "META: 在改 framework 自身"
```

或者看 CWD 是不是这个仓库: `pwd` 输出含 `/cjxdd` 且仓库根有 `agents/shadow-walker.md` → Meta 任务.

### 🛡️ 防御式 hook 旁路

`hooks/user-prompt-submit.sh` 已加旁路: 当 CWD 命中 framework 自身 (cjxdd) 时, **不触发** "build me X" / "做一个 XX 系统" → walker 加载的引导. 详见 `hooks/lib.sh:detect_meta_project()` (若已加).

agents/shadow-walker.md / shadow-worker.md / shadow-walker-pi.md 顶部也加了 "Meta 守卫" 段, 加载时先检测 project root, 若是 cjxdd 自身, 立即拒绝执行并提示用户直接改源码.

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

OpenCode 使用插件系统而非 shell hooks。等价功能通过 `plugins/shadow-hooks.ts` 实现（仓库根 `plugins/` 目录，被 `install-to-opencode.sh` 软链到 `~/.config/opencode/plugins/`），由 OpenCode 在启动时自动加载。

**5 个 hook 行为对齐基线**: `hooks/*.sh` (Claude Code) 跟 `plugins/shadow-hooks.ts` (OpenCode) 在以下 13 项 P0 行为上 1:1 对齐 (5 项端到端 + 16/16 烟雾测试 PASS, 详见 § "E2E 验证"):

| 行为 | 源 bash | OpenCode 入口 | 行为摘要 |
|------|---------|---------------|---------|
| **5 步节奏注入** | `pre-skill.sh:78-88` | L3 toast | 装 skill 前 5 步 reminder |
| **阶段顺序硬阻断** | `pre-skill.sh:90-112` (exit 2) | L3 throw | 跳 stage → 阻断 |
| **auto-mark DOING** | `pre-skill.sh:57-75` | L3 synthetic part | 装 skill 时 ⏳→🔄 DOING |
| **auto-mark DONE** | `post-write-stub-scan.sh:62-87` | L4 synthetic part | 写 stage 产物时 → ✅ DONE, 推下一 stage skill |
| **stub 实时扫描** | `post-write-stub-scan.sh:111-133` | L4 toast + metadata | 写完单文件立即扫存根, 设 `output.metadata.shadowStubWarning` |
| **R3 evidence_archive** | `post-write-stub-scan.sh:89-155` | L4 toast | 写入证据存档软警告 (TS 修复了 bash 重复块) |
| **P0-Y L0 重做门禁** | `pre-skill.sh:114-140` | L3 toast | 14 天 mtime 软警告, 每轮 iter 必查 |
| **P0-Z wire.svg 变体** | `pre-skill.sh:142-166` | L3 toast | `data-state < data-page × 3` 时软警告 |
| **R5 硬门禁** | `stop-gate.sh:216-240` | L5 execSync | 调 `gate-check-lifecycle.sh`, exit 1 → error toast |
| **L5 stage 漂移** | `stop-gate.sh:95-141` | L5 toast | 产物存在但 status 是 ⏳/🔄 → DRIFT |
| **lifecycle 漂移 (5 类)** | `stop-gate.sh:147-214` | L5 toast | `.skel` / 老 L3 别名 / 部署报告别名 / feature-status 漂移 / 老 wire 路径 |
| **5 类意图识别** | `lib.sh:detect_intent_pattern` | L2 synthetic part | zh-new-build / zh-continue / en-new-build / en-greenfield + 路由 |
| **5 类压力信号** | `lib.sh:check_pressure_signals` | L2 + L3 part | RUSH/TIME/SKIP/SIMPLIFY/WORKLOAD + 30s fingerprint 去重 |
| **stage 状态查询** | `user-prompt-submit.sh:58-96` | L2 part | "当前 stage" / "下一 stage" / "where am i" → 中英回答 |
| **5 角色 lifecycle 分布** | `session-start.sh:64-74` | L1 system prompt | session-start 打印 design_baseline/process_output/evidence_archive/control_marker 计数 |
| **BXX 维度 per-bizline** | `lib.sh:91-121` | L1+L5 | `## BXX 业务线名` 分组的 status / pending / stage 漂移 |
| **Toast 去重 (1500ms)** | — (plugin 独有) | notify() | 5 段 stop-gate 不连弹, 同 key 短时间抑制 |

**事件映射**:

| Plugin hook | 对应 Claude Code hook | 入口 |
|------------|----------------------|------|
| `experimental.chat.system.transform` | `SessionStart` | L1 注入 5 角色分布 + current stage + 5 步节奏 + CONTEXT-MAP |
| `chat.message` | `UserPromptSubmit` | L2 stage 查询 (短路) + 压力信号 + 4 类意图 + 路由 |
| `tool.execute.before` (Skill + Task) | `PreToolUse` (Skill/Task) | L3 6 段流水线 + task worker 派单 WO 校验 |
| `tool.execute.after` (Write/Edit) | `PostToolUse` (Write\|Edit) | L4 5 段: auto-mark DONE → R3 → stub scan |
| `event` (`message.updated` finish=stop) | `Stop` | L5 5 段编排器 + execSync R5 |

**BXX 业务线维度**：status.md 按 Walker 规范用 `## BXX 业务线名` 分节时，session-start 和 stop-gate 自动按 BXX 分组输出；多业务线项目的待办不会再混成一锅。

**Toast 通道 (OpenCode 独有)**: plugin 用 `client.tui.showToast({variant, title, message, duration})` 弹右上角通知, 4 variant (info/success/warning/error), 不污染 TUI 文本流. 加 1500ms 去重 Map, 防 5 段 stop-gate 连续弹屏.

**E2E 验证状态** (5 项端到端对比 bash vs plugin, 行为对齐):
- L1 SessionStart: pipeline 摘要 / 5 角色 / 当前 stage / 5 步节奏 ✅
- L2 stage 查询 "当前 stage": 1:1 字符级一致 ✅
- L3 装 skill: auto-mark + 5 步 + P0-Y + P0-Z + 阶段硬阻断 ✅
- L4 stub 扫描 + auto-mark DONE: 修复 bash 重复块, 等价 ✅
- L5 stop-gate: 真实 R5 execSync, 5 段汇总成 1 toast ✅

### Docker 镜像源自动探测（scaffold Step 3.5）

中国区/受限网络下直接 `docker pull postgres:16` 会超时或 403。`scaffold` Step 3.5 强制在拉任何镜像前跑探测, exit 1 时**强制先装 `docker-helper` skill**:

```bash
bash skills/docker-helper/scripts/probe-registry.sh
# 退出码:
#   0 — docker.io 直连 OK, 走 daemon.json 镜像源
#   1 — GFW 阻断, docker.1ms.run 代理可达 → 装 docker-helper, 走代理前缀
#   2 — Docker 未装 / daemon 未运行 → 阻断
#   3 — 完全无法访问任何 Registry → 阻断, 建议 VPN
```

`skills/shadow-scaffold/SKILL.md` Step 3.5 跟 `skills/docker-helper/SKILL.md` 顶部"何时自动加载"块**互相引用**, 任何 walker 跑 scaffold Step 4 (Docker 部署) 时, 强制先做 GFW 探测. 跑 `skills/smoke-scaffold-docker.sh` (16 项断言) 验证集成完整.

详见 § "Scaffold + Docker" (若有) 或 `skills/docker-helper/SKILL.md` § 1 "环境检测".

### `/cjgoal` 自驱循环（OpenCode + Claude Code 都有）

**OpenCode 端**: `plugins/goal-mode.tsx` (TUI plugin) 注册 slash 命令 `/cjgoal` (别名 `/cj` / `/g`)。
inline `/cjgoal {目标}` 回车, plugin 监听 `message.part.updated` 抓 user text, 写 `.shadow/goal-runs/{run-id}/goal.md` + `current-goal.json`, 监听 `session.idle` 事件, **用独立 evaluator session 评估**是否完成 (CONTINUE/COMPLETE), 未完成则回填目标继续推进, 最多 10 轮. 过程通过 `ui.toast` 右上角弹窗通知.

**Claude Code 端**: `commands/cjgoal.md` (slash command, `install-to-claude-code.sh` 软链到 `~/.claude/commands/`). 跟 OpenCode 行为对齐但**实现简化** — Claude Code 没有 TUI plugin SDK (`session.create` / `client.tui.showToast`), 用 prompt-based workflow: 写 goal.md + current-goal.json, 引导 walker 推进, 用户手动调 `/cjgoal done` 标记完成 (写 `final.md`).

**差异表**:

| 维度 | OpenCode `/cjgoal` | Claude Code `/cjgoal` |
|------|-------------------|----------------------|
| 命令注册 | TUI plugin `command.register` | `commands/cjgoal.md` slash command |
| 目标输入 | inline `/cjgoal {text}` | 命令参数 `$ARGUMENTS` |
| 评估循环 | 自动: `session.idle` → 独立 evaluator session → COMPLETE/CONTINUE (10 轮 cap) | **手动**: `/cjgoal done` 写 final.md |
| Toast 通知 | TUI toast | 无 |
| 产物位置 | `.shadow/goal-runs/{runId}/goal.md` + `current-goal.json` | 同 |
| 完成标志 | plugin 自动写 `final.md` ✅ / ❌ FAI3URE-CAP | 用户触发 `/cjgoal done` 写 `final.md` |

**生命周期注册**: `shadow-schema.json:lifecycle_artifacts` 末尾 `goal-run-goal` / `goal-run-final` / `goal-runs-ctrl`, hook 自动识别.

**OpenCode 端评估机制**: evaluator session 是 short-lived, 走 `session.create()` + `session.prompt()` + `session.messages()` 三件套, 不污染主 session 流. Claude Code 端无此机制, 用户手动 `/cjgoal done` 触发 final.md.

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

plugins/                       ← OpenCode 端实现 (跟 agents/ skills/ 平级)
  shadow-hooks.ts              ← 5 hook body + 30 helper, 行为对齐 hooks/*.sh (1353 行)
  back-cover.ts                ← 防"伪完成"硬锁, verify_completion 工具
  goal-mode.tsx                ← OpenCode TUI plugin: /cjgoal 自驱循环 (10 轮 cap)

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

## § 9 真实烟雾测试门禁 (R11, P0-X Round 2 — 新项目硬阻断 / 老项目 advisory)

**问题**: "测试通过 ≠ 真实可用" gap。单元/集成测试可以全过, 但用户拿浏览器点击时**登录都登录不了**。6 硬门禁 (R1/R3/R5/R6/R10) 都是**产物形态**验证, 没人验证**产物跑起来行为对不对**。R11 补这个盲区。

### 9.1 行为验证 vs 产物验证

| 维度 | R1/R3/R5/R6/R10 | R11 |
|------|------------------|-----|
| 验证对象 | 产物文件在不在 / 角色对不对 | 产物跑起来行为对不对 |
| 检查时机 | L5-impl 写代码时 + L6 部署末尾 | L6 部署末尾 (真实验证后) |
| 阻断力度 | 软警告 + 硬阻断 (按门禁) | **新项目: 4 层验证硬阻断** / 老项目: advisory |
| 自动化程度 | schema 驱动自动跑 | **新项目: 自动 Playwright** (L6 Phase 5.8) |

### 9.2 R11 检测逻辑 (Round 2 升级)

扫 `.shadow/iterations/iter-N/L6-deploy/*/smoke-test-passed`, **4 层验证**:

| 层 | 验证 | 失败处置 |
|----|------|----------|
| **L1** | marker 存在 + mtime < 7 天 | FAIL (stale) |
| **L2** | marker 首行正则 `production-scenarios @production: [0-9]+ passed` | FAIL (Round 1 旧 marker, 提示重跑 Phase 5.8) |
| **L3** | `prod-evidence/summary.json.failed == 0` + `playwright.log` 末行有 `passed` | FAIL (测试失败, 看 playwright.log) |
| **L4** | marker 中 `prod-config-hash=...` == `prod-evidence/prod-config-hash.txt` (sha256 匹配) | FAIL (marker 复用, 看 L3 evidence 跟 L4 hash 是否同次跑) |

**项目分叉**:
- 新项目 (`.shadow/LIFECYCLE.md` 存在) → 4 层验证, **任一失败 → exit 1 硬阻断**
- 老项目 (`.shadow/LIFECYCLE.md` 缺席) → Round 1 advisory (软警告, exit 0), 行为不变

实现位置: `skills/shadow-artifact-lifecycle/scripts/gate-check-lifecycle.sh:307-412` (替换原 R11 段) + 末尾硬门禁触发 (`exit 1`)。

### 9.3 穷尽式生产场景 (L2 新增产物)

L2 必须为每个 BXX 在 `production-scenarios/` 下生成 8 维穷举的 Playwright spec 套件:

- `prod.config.json` — 机器可读的"跟生产一致"契约
- `playwright.config.ts` — `@playwright/test` 配置
- `specs/P0_main_*.spec.ts` / `P0_cross_bxx_*.spec.ts` / `P0_persistence_*.spec.ts` / `P0_auth_*.spec.ts` / `F_*.spec.ts` — Playwright 测试
- `helpers/{auth,db,event}.ts` — 真实账号/DB/事件总线 helper
- `fixtures/accounts.example.json` + `seed.example.sql` — 模板 (不入库)
- `e2e.binding.yaml` 追加 `production_scenarios` 顶层块

8 维穷举: Rules / Pages / Interactions / Roles / Data scale / Cross-service / Error states / Real-world chaos. 详见 `skills/shadow-l2-e2e/templates/production-scenarios.md` + `references/production-scenario-contract.md`.

### 9.4 L6 Phase 5.8 自动跑

L6 Phase 5.8 在 Phase 5.6 (漫游) 之后, Phase 6 (后端 E2E) 之前, 自动跑:

```bash
bash skills/shadow-l6-deploy/scripts/run-production-scenarios.sh {slug}
```

- exit 0 → 写 marker (含 `production-scenarios @production: N passed | prod-config-hash=...`), evidence 落 `prod-evidence/`, chmod 444
- exit 1/2/3 → 不写 marker, 留 evidence, R11 必 fail

退出码契约:
- 0: 所有 @P0 spec 通过
- 1: Playwright 测试失败
- 2: 契约违反 (缺 config / 缺 env / npx 不可用)
- 3: Spec 存在但 selector 不存在 (前端未实现, 派 L5-impl 修 selector)

### 9.5 历史

- **2026-06-07** (本升级): Round 1 → Round 2 启用. 新项目硬阻断, 老项目 advisory 零破坏.
- **Round 1 故意是软警告** (历史): 怕改了之后老项目 (cjxdd-demo 等 7+) 突然被卡, 破坏零迁移承诺.
- **Round 2 之后**: 新项目 (有 LIFECYCLE.md) 硬阻断; 老项目 (LIFECYCLE.md 缺席) 仍 advisory, 一劳永逸豁免.

### 9.6 暂不启用策略

新项目 (有 LIFECYCLE.md) 暂不启用 R11 Round 2: 在 `.shadow/scale.md` 加 `gate_options.production_scenarios: off` (off / warn / hard, 默认 hard). cjxdd 第一次 L6 部署前, 若 4 BXX production-scenarios 还没准备好, 可临时 off.

## § 10 L0 调研重做门禁 (P0-Y Round 1)

**问题**: 每轮 iter 启动时, L0 调研常被跳过 — 上一轮的 L0 笔记本被默认复用。
**但新需求可能涉及新方案/新竞品/新约束**, 必须每轮重做调研。L0 是"每轮的起点", **不是"项目一次性", 也不是"iter-1 例外"**。

**概念纠正** (用户原话): "并不是 iter-1 就是说是项目级的, iter-1 只是项目的首次开发, iter-2 是第二次开发, 项目一直都是迭代的嘛。"
→ iter-1 也是"项目首轮开发", 跟 iter-2+ 一样, 每轮 iter 都必须重做 L0。

### 10.1 现状 vs 期望

| 维度 | 现状 (Phase 4 前) | 加 P0-Y 后 |
|------|---------------------|------------|
| L0 产物位置 | `.shadow/L0-research/` (schema 项目级) | + per-iter `.shadow/iterations/iter-N/L0-research/` |
| 每轮必做 | ❌ iter ≥ 2 默认复用 iter-1 L0 | ✓ 每轮 (含 iter-1) 软警告 (Round 1) / 硬阻断 (Round 2) |
| 检查时机 | — | `pre-skill.sh` 装 L1+ skill 前 |

### 10.2 检测逻辑(在 `pre-skill.sh`)

每轮 iter 装 L1+ skill 时, 扫 `.shadow/iterations/iter-N/L0-research/`:

| 状态 | 条件 | 输出 |
|------|------|------|
| skip | 老项目无 `.shadow/iterations/` (cjxdd-demo 等 7+) | — |
| warn 缺 | 目录不存在 | "L0 调研目录不存在" |
| warn 空 | 目录存在但无 `.md` | "L0 调研目录为空 (无 .md 笔记本)" |
| warn stale | 1+ 个 `.md` 但 mtime ≥ 14 天 | "L0 调研 ≥ 14 天未重做" |
| pass | 1+ 个 `.md` 且 mtime < 14 天 | (无警告) |

### 10.3 Walker 怎么"重做" L0

每轮 iter 启动时, 调 `shadow-l0-research` skill, 创 7 份发散笔记本到 `.shadow/iterations/iter-N/L0-research/`:

```
01-industry-notes.md       行业调研
02-competitor-analysis.md  竞品分析 (新需求可能有新竞品)
03-user-personas.md        用户画像
04-user-journeys.md        用户旅程
05-tech-research.md        技术方案 (新需求可能需要新方案)
06-events-brainstorm.md    事件风暴
07-external-references.md  外部参考
```

mtime 自动刷新 → Round 1 软警告自动消失。

### 10.4 设计原则

- **Round 1 软警告**: 怕改了之后老项目突然被卡, 破坏零迁移
- **每轮都触发** (含 iter-1): 项目一直都是迭代的, L0 是"每轮的起点"
- **mtime ≤ 14 天视为"近"**: 自动检测, Walker 写完就 pass

### 10.5 Round 2 计划(下次)

1. L0 段: 升级为**硬阻断** (跟 R5/R3 同等力度)
2. 新项目 (有 `.shadow/LIFECYCLE.md`): L0 缺/旧 → 拒绝 L1+ skill 加载
3. 老项目 (无 LIFECYCLE.md): 仍 advisory, 零破坏
4. 加 `.shadow/LIFECYCLE.md` 的项目才视为"启用硬门禁"

> 这是"想错改对"迭代: Round 1 先提示到位, 让用户跑通, Round 2 才硬断。
> 跟 R11 / R3 同样的"多轮迭代"模式。

## Where to start

- **To understand the framework**: read `agents/shadow-walker.md`, then `docs/architecture.mmd` (rendered), then `README.md`.
- **To understand a single stage**: open `skills/{stage}/SKI33.md`. It is the execution script.
- **To understand stage-to-stage handoffs**: read the change-propagation table and retreat decision tree in `agents/shadow-walker.md`.
- **To create a new skill**: use `skills/skill-creator/SKI33.md` (it has its own eval/iterate loop).
- **To reverse-engineer an existing codebase with no `.shadow/`:** start with `shadow-reverse`, not 30.
