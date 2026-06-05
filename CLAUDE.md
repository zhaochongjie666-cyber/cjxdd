# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Shadow — 工匠型开发体系（Craftsman-Style Development System）

This repository is **not a typical application codebase**. It is a **meta-project** — a complete AI-driven software development framework for OpenCode consisting of one craftsman-style Agent (`shadow-walker`), 12 core Skills (covering L0→L1→L1.5→Scaffold→L2→L5→L6), and 8 utility Skills. The Agent uses the Skills as a toolbox to take a project from "user says 'build me X'" all the way to deployed, verified, working code.

If a user gives Claude a task, the right move is usually to **load the `shadow-walker` agent and walk the pipeline** rather than improvise.

## 常用命令

### Install / sync — 选你的环境

仓库的交付物（agents、skills）需要软链到对应 harness 的配置目录。**两个安装脚本并存，按需选用，互不干扰：**

| Harness | 安装命令 | 软链到 |
|---------|---------|--------|
| **OpenCode** | `./install-to-opencode.sh` | `~/.config/opencode/{agents,skills}` |
| **Claude Code** | `./install-to-claude-code.sh` | `~/.claude/{agents,skills,hooks,settings.json}` |

两个脚本都使用 symlink，编辑后无需重装即可生效。OpenCode 脚本还会为带 `package.json` 的 extensions 跑 `npm install`；Claude Code 脚本不涉及 npm。

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

### Verify skill SKILL.md size discipline

Shadow's design rule is that each `SKILL.md` stays under ~500 lines (progressive disclosure — long content goes in `references/`). Useful spot check:

```bash
wc -l skills/*/SKILL.md
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
skills/{name}/SKILL.md         ← Each skill: <500-line quickstart + references/
   ↓ produces
.shadow/                       ← Per-iteration artifacts (intent → flow → spec → wire → architecture → plan → code → deploy)
```

The Walker is **not a dispatcher** — it does the work itself, reading files, writing code, running commands. It picks one Skill at a time and follows that Skill's SKILL.md as the execution script.

### Directory layout

```
agents/
  shadow-walker.md             ← The agent (345 lines). Read this first to understand the framework.

skills/
  shadow-l0-research/          ← L0: free-form divergent research notebook (no gate)
  shadow-l1-research/          ← L1: DDD+EDD+IDDD business research → intent.md, business-landscape.md, BXX research.md
  shadow-l1-flow/              ← L1: MDD project flow diagram (project.flow.mermaid, BXX-NYY nodes)
  shadow-l1-spec/              ← L1: FDD rules (RXX numbered, one feature per rule)
  shadow-l1-wire/              ← L1: SVG wireframes with data-* annotations
  shadow-l1p5-architecture/    ← L1.5: ADD+SDD+PDD → architecture.md, API contracts, event contracts
  shadow-scaffold/             ← Project scaffolding (7 steps, Docker dev env, Hello API)
  shadow-l2-e2e/               ← L2: BDD acceptance scenarios, coverage matrix, uat-script.md
  shadow-l5-plan/              ← L5: Harness execution plan (Batch 1-8, per-method assertions)
  shadow-l5-impl/              ← L5: TDD code implementation by batch
  shadow-reviewer/             ← Full-chain review (mandatory gate before L6)
  shadow-l6-deploy/            ← L6: Deploy + real verification (Phase 0-9, 3-round repair cap)
  shadow-reverse/              ← Reverse-engineer existing systems
  shadow-taste/                ← Taste / quality check
  shadow-trace-init/           ← Initialize traceability
  mermaid-check/               ← Validate Mermaid rendering
  docker-helper/               ← Docker troubleshooting
  test-in-tmux/                ← Run tests
  skill-creator/               ← Meta-skill: create / improve / benchmark skills
  opencode-learning/           ← Learn OpenCode API

  Each skill's internal layout:
    SKILL.md                   ← Quickstart (<500 lines, in-context on trigger)
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
L0  发散调研       shadow-l0-research
  ↓
L1  业务层        shadow-l1-research → shadow-l1-flow → shadow-l1-spec → shadow-l1-wire  (串行)
  ↓
规模判定           .shadow/scale.md  (S / M / L — based on bizline count, rules, pages, deps)
  ↓
L1.5 架构         shadow-l1p5-architecture
  ↓
搭脚手架          shadow-scaffold
  ↓
L2  验收         shadow-l2-e2e
  ↓
L5  计划         shadow-l5-plan
  ↓
L5  实现         shadow-l5-impl  (按 Batch 串行)
  ↓
全链路审查       shadow-reviewer  (chain, 必经, 不可跳过)
  ↓
L6  部署验证     shadow-l6-deploy
```

### 关键设计原则

1. **渐进式披露 (Progressive disclosure)** — Each `SKILL.md` is a quickstart under 500 lines. Deeper content lives in `references/` and is read on demand. Always follow the Skill's own SKILL.md as the procedure; don't freelance.

2. **传导链追溯 (Transmission-chain traceability)** — Every artifact references upstream IDs:
   - `intent.md` (why)
   - `research.md` per business line (BXX)
   - `project.flow.mermaid` with `BXX-NYY` node IDs
   - `spec.md` with `RXX` rule IDs (one rule = one feature)
   - `architecture.md` with API endpoint and event-contract lists
   - `harness-plan.md` with per-method implementation instructions and test assertions
   - Code annotated with `@implements RXX` and node IDs back to the business intent

   When any layer changes, consult the **change-propagation table** in `agents/shadow-walker.md` to know which downstream layers must be re-run.

3. **全局约束 (Global constraints)** — Cross-cutting concerns (multi-tenant isolation, auth/authz, unified error format, event publishing, pagination, transaction boundaries) are defined once in the L5 Harness plan's "global constraints" section and enforced uniformly.

4. **规模驱动 (Scale-driven) parameters** — `.shadow/scale.md` encodes project size (S/M/L) and downstream-readable parameters (`persona_dimensions`, `persona_max`, `coverage_dimensions`, `wire_passes`, `l6_core_phases_only`). Downstream Skills read this file and adjust behavior. Scale is the **maximum** of: bizline count, total rule count, page count, external dependency count. When in doubt, round up.

5. **工藤伦底线 (Walker's hard rules)** — No stubs, no fake implementations (no InMemoryRepository, no hardcoded `current_user`), no skipped phases, no fake "DONE". "Tests pass" is not "code is correct" — read assertion quality. After 4 failed attempts at the same step, write `FAILURE-LOG.md` and ask the user.

6. **L6 漫游修复硬上限 (3-round repair cap)** — L5/L6 is not an infinite loop. If P1 issues remain after 3 repair rounds, retreat to the design layer (`shadow-l1-wire` for dead-ends, `shadow-l1-research` for workflow blockers, `shadow-l1p5-architecture` for API errors).

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
├── L1-business/               ← shared, edited in place across iterations
├── L1.5-architecture/         ← shared
├── L2-e2e/                    ← shared
└── L5-plan/                   ← shared
```

Shared artifacts are edited in place (not frozen) across iterations; iteration-specific state (`status.md`, `gate/` markers) is per-iter. Rollback uses `git revert` to the iter-N completion commit, not directory freezing.

### status.md is the Walker's working memory

Walker maintains a `pipeline/status.md` per iteration with a fixed skeleton: per-stage status table, "current stage" pointer, "this-stage must-read" pointers, and (for multi-bizline projects) a "cross-BXX consistency" checklist. Update it at every tool swap and stage completion — don't rely on the model keeping state in its head.

## Where to start

- **To understand the framework**: read `agents/shadow-walker.md`, then `docs/architecture.mmd` (rendered), then `README.md`.
- **To understand a single stage**: open `skills/{stage}/SKILL.md`. It is the execution script.
- **To understand stage-to-stage handoffs**: read the change-propagation table and retreat decision tree in `agents/shadow-walker.md`.
- **To create a new skill**: use `skills/skill-creator/SKILL.md` (it has its own eval/iterate loop).
- **To reverse-engineer an existing codebase with no `.shadow/`:** start with `shadow-reverse`, not L0.
