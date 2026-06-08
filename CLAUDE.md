# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Shadow — 工匠型开发体系（Craftsman-Style Development System）

This repository is **not a typical application codebase**. It is a **meta-project** — a complete AI-driven software development framework for OpenCode consisting of one craftsman-style Agent (`shadow-walker`), 14 core Skills (covering 30→31→31.5→Scaffold→32→33→35→36), and 12 utility Skills. The Agent uses the Skills as a toolbox to take a project from "user says 'build me X'" all the way to deployed, verified, working code.

If a user gives Claude a task, the right move is usually to **load the `shadow-walker` agent and walk the pipeline** rather than improvise.

> **Changelog (最近 8 commits)**:
> - `011349c` L0 v2 — brainstorm + L1 消费 + web search 5 方向
> - `609ad09` zh-continue 静默 — 中文输入修
> - `13985fd` L5-impl v5.2 + L2 e2e v9.2 — Pre-write Signoff + Design-Conformance Gherkin
> - `10f739f` L5 plan/impl v5.1 — iter 间设计冲突保留正向 (4 机制)
> - `87b30c2` L5 plan/impl v5 — plan 是入口+索引, 上游是 detail
> - `a3886a9` /cjgoal v3 — 整段文本全收 + user-driven continue (TMUX 验证)
> - 详见 `git log --oneline | head -20`

**项目级方针**: `core.md` (122 字节) — wire 设计习惯 (L1-wire 目录组织 + selector+input 友好范式). 改 wire 相关 skill 时同步看.

## ⚠️ Meta: 你正在修改 Shadow 自身, 禁用 Shadow 流程

**这个项目就是 Shadow 框架本身** (`agents/` + `skills/` + `hooks/` + `plugins/` + `commands/` + `install-*.sh` + `core.md` + `settings.json`). 你在 cjxdd 工作就是**在改 framework**, 不是**在用 framework 改一个外部项目**.

### ❌ 严禁 (用 Shadow 改 Shadow 会自指递归, 工件污染)

- ❌ **不要加载 `shadow-walker` / `shadow-worker` / `shadow-walker-pi` agent 来开发本仓库** — walker 会在 `.shadow/` 写 status.md / 触发 L0 调研 / 跑 pipeline, 把 framework 自身当成"产品项目" 反复迭代
- ❌ **不要跑 Shadow 流水线** (L0→L1→L1.5→Scaffold→L2→L3→L5 Plan→L5 Impl→L6 Deploy) — 流水线是给"外部产品项目"用的, 给 framework 自身跑会污染 `.shadow/` 目录且毫无意义
- ❌ **不要在本仓库创建 `.shadow/`** — `.shadow/` 是产品项目的工作区, framework 自己的状态在 git 里
- ❌ **不要用 `shadow-init` / `shadow-l0-research` 等 skill 来"调研" framework 自身** — skill 输出工件的 schema 假定产物是产品代码, 不是 framework 源码
- ❌ **不要调 `/cjgoal` 推到生产可用** — goal mode 走的是 30→36 pipeline, 不适用 framework 自身迭代 (v3 修复: 整段文本全收 + user-driven continue, 但仍只对产品项目有意义)
- ❌ **不要被 `hooks/user-prompt-submit.sh` 引导"加载 walker 给我做一个 XX 系统"** — 关键词命中后 hook 会误推 walker, 但本仓库不是产品项目

### ✅ 正确做法 (直接当代码仓库改)

- ✅ **直接读** `agents/` / `skills/` / `hooks/` / `plugins/` / `commands/` 下的源码 — 跟改普通代码一样用 Read/Edit/Write
- ✅ **改完跑 smoke test 验证** — 详见 [§ 修改 framework 时常用命令](#-修改-framework-时常用命令)
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

`hooks/user-prompt-submit.sh` 已加旁路: 当 CWD 命中 framework 自身 (cjxdd) 时, **不触发** "build me X" / "做一个 XX 系统" → walker 加载的引导. 详见 `hooks/lib.sh:detect_meta_project()`.

`agents/shadow-walker.md` / `shadow-worker.md` / `shadow-walker-pi.md` 顶部都加了 "Meta 守卫" 段, 加载时先检测 project root, 若是 cjxdd 自身, 立即拒绝执行并提示用户直接改源码.

## 常用命令

### Install / sync — 选你的环境

仓库的交付物（agents、skills）需要软链到对应 harness 的配置目录。**三个安装脚本并存，按需选用，互不干扰：**

| Harness | 安装命令 | 软链到 |
|---------|---------|--------|
| **OpenCode** | `./install-to-opencode.sh` | `~/.config/opencode/{agents,skills,plugins}` |
| **Claude Code** | `./install-to-claude-code.sh` | `~/.claude/{agents,skills,hooks,settings.json}` |
| **pi** | `./install-to-pi.sh` | `~/.pi/{agents,skills,hooks,settings.json}` (可 `PI_DIR=...` 覆盖) |

三个脚本都使用 symlink，编辑后无需重装即可生效。OpenCode 脚本还会为带 `package.json` 的 extensions 跑 `npm install`；Claude Code / pi 脚本不涉及 npm。pi 脚本额外支持 `--dry-run` / `--uninstall` / `--force` 选项。**完整安装步骤 + pi/OpenCode 用户体验差异见 `README.md` § 快速开始。**

### ⚠️ 真实路径 (避免踩 README 的坑)

**Claude Code 端 hook 软链**: `~/.claude/hooks/` **就是符号链接** → 仓库根 `hooks/` (跟 `agents/`、`skills/` 平级). 编辑 `hooks/` 下任何文件立即生效, **不要去 `~/.claude/hooks/` 找 — 那只是个 link**. 同样 `~/.claude/skills/` 链接到仓库根 `skills/`.

**因此 hooks 6 个全清单** (`hooks/*.sh` + `~/.claude/hooks/*.sh` 软链):

| Hook | 触发时机 | 行为 |
|------|---------|------|
| `user-prompt-submit.sh` | `UserPromptSubmit` | 关键词检测"做一个 XX 系统" / "build me X" / "from scratch"；命中提示 Claude 加载 shadow-walker subagent (CWD 在 cjxdd 时旁路). **v3 fix: zh-continue 静默**, 避免误触拒收 user message (OpenCode 1.16.2 server schema 严格校验 synthetic part). |
| `session-start.sh` | `SessionStart` | 探测项目根，输出当前 iter、status.md 阶段汇总、**BXX 业务线维度分布**、CONTEXT-MAP 摘要 |
| `pre-skill.sh` | `PreToolUse` (matcher: `Skill`) | 装 skill 前打印 5 步节奏提醒；若 status.md 仍有更早的 ⏳ 阶段则**硬阻断**（exit 2） |
| `post-write-stub-scan.sh` | `PostToolUse` (matcher: `Write\|Edit`) | **每次**写完代码实时扫存根（pass/TODO/NotImplementedError/InMemoryRepository），只扫刚写的文件，命中即时告警让模型自纠 |
| `stop-gate.sh` | `Stop` | 全项目扫存根兜底；**按 BXX 分组**列未完阶段；5 段 hard-gate 编排器 (stub / pending / drift / lifecycle / R5 + §13 L5 consistency) |
| `worker-dispatch-hint.sh` | `PreToolUse` (matcher: `Task`) | walker 通过 Task 派 work order 给 worker 时, 校验 WO 字段 (CLAUDE.md 路径穿透等), 漏字段给 hint |

`settings.json` 软链到 `~/.claude/settings.json`（首次安装会备份用户原有 `settings.json` 为 `settings.json.bak`）。其他 Shadow 项目若想复用同一套 hooks，可在自己仓库根放 `settings.json` 写同样的 hook 配置，引用 `$HOME/.claude/hooks/<name>.sh`（同时把 `hooks/` 软链到 `~/.claude/hooks/`）。

### OpenCode 端: 6 个 plugin hook 对齐

OpenCode 使用插件系统而非 shell hooks。等价功能通过 `plugins/` 实现 (3 个文件: `shadow-hooks.ts` 3069 行 + `back-cover.ts` 229 行 + `goal-mode.tsx` 432 行), 由 OpenCode 在启动时自动加载. 事件映射跟 Claude Code 6 个 hook 1:1 对齐 (e2e 行为校验, 16/16 烟雾测试 PASS).

**BXX 业务线维度**：status.md 按 Walker 规范用 `## BXX 业务线名` 分节时，session-start 和 stop-gate 自动按 BXX 分组输出；多业务线项目的待办不会再混成一锅。

**Toast 通道 (OpenCode 独有)**: plugin 用 `client.tui.showToast({variant, title, message, duration})` 弹右上角通知, 4 variant (info/success/warning/error), 不污染 TUI 文本流. 加 1500ms 去重 Map, 防 5 段 stop-gate 连续弹屏.

**详细 16 项 P0 行为对齐表 + 事件映射 + E2E 验证状态**见 `README.md` § 自动门禁 (Hooks).

### Docker 镜像源自动探测（scaffold Step 3.5）

中国区/受限网络下直接 `docker pull postgres:16` 会超时或 403。`scaffold` Step 3.5 强制在拉任何镜像前跑探测, exit 1 时**强制先装 `docker-helper` skill**:

```bash
bash skills/docker-helper/scripts/probe-registry.sh
# 退出码: 0 直连 OK / 1 需代理 (装 docker-helper) / 2 Docker 未装 / 3 不可达
```

详见 `skills/docker-helper/SKILL.md` § 1 "环境检测" + `skills/smoke-scaffold-docker.sh` (16 项断言).

### `/cjgoal` 自驱循环（OpenCode + Claude Code 都有）

- **OpenCode 端**: `plugins/goal-mode.tsx` (TUI plugin) 注册 slash 命令 `/cjgoal` (别名 `/cj` / `/g`). v3 修复: 整段文本全收 (PREFIX_RE `[\s\S]+` 跨行) + user-driven continue (chain loop 靠 user 输 "继续" 推, 因 OpenCode 1.16.2 idle session 不唤醒 model). 4 条收尾路径: `/cjgoal done` / 隐式短答 (≤15 chars) / `/cjgoal stop` / 10 轮 cap.
- **Claude Code 端**: `commands/cjgoal.md` (slash command) — 实现简化, **手动** `/cjgoal done` 触发 final.md (CC 无 TUI plugin SDK).

OpenCode 跟 Claude Code 端 `/cjgoal` 完整差异表 (维度 / 收尾 / 评估 / Toast) 见 `README.md` § `/cjgoal` 自驱循环 (若 README 还没写, 参见本文件 git 历史).

### 工具名约定 (Walker frontmatter 必踩)

Walker agent 的 frontmatter **故意不写 `tools` 字段** —— 两个 harness 对它的合法格式互斥：

| Harness | `tools` 合法形式 |
|---------|----------------|
| Claude Code | 逗号分隔字符串 `tools: Read, Write, Edit, …`（TitleCase） |
| OpenCode | 对象映射 `tools: { read: true, write: true, … }`（schema 严格校验） |

写任一种都会让另一边的 schema 校验直接拒绝 → bootstrap 失败。**省略字段在两边都等于"全工具开放"**，正是 Walker 想要的默认状态。**改 `agents/shadow-walker.md` / `shadow-worker.md` / `shadow-walker-pi.md` frontmatter 时, 不要加 `tools` 字段.**

Agent 正文里的工具名一律按 Claude Code 风格 TitleCase 引用（`Read` / `Write` / `Bash` / …）—— 仅为文档可读性，不参与 schema 校验，所以两边都无所谓。

## 修改 framework 时常用命令

### Smoke 测试 (改完即跑, 跑通即 PASS)

```bash
# 改 plugins/hooks/scale 相关后跑
bash skills/smoke-r11-round2.sh           # R11 Round 2 验证 (16 项断言)
bash skills/smoke-scaffold-docker.sh      # scaffold + docker 集成 (16 项断言)

# 改 agents/ 后跑 (跟 CC/OpenCode 端 walker 行为对齐)
# (暂无标准 smoke, 走真实 e2e: 仓库外 /tmp/test-product/ 起项目验证)
```

### 调试 hooks

```bash
# 在项目根外 (无 .shadow/): 应该输出 "No .shadow/ found"
cd /tmp && bash $HOME/.claude/hooks/session-start.sh

# 模拟 Skill 调用, 看阶段硬阻断
echo '{"tool_name":"Skill","tool_input":{"skill":"shadow-l6-deploy"}}' \
  | bash $HOME/.claude/hooks/pre-skill.sh

# 模拟 stop, 看 5 段 hard-gate 编排器
echo '{}' | bash $HOME/.claude/hooks/stop-gate.sh

# 测中文输入 (zh-continue 修后, "完成" 不应被 hook 误触)
echo '{"user_prompt":"完成"}' | bash $HOME/.claude/hooks/user-prompt-submit.sh
# 期望: 无输出 (silent), 不污染 schema
```

### 静态检查 (CI 友好)

```bash
# SKI33.md 渐进式披露 size discipline — 每个 < 500 行
wc -l skills/*/SKI33.md | sort -n -r | head

# 扫 system prompt 跟模板里的"内容过滤 trigger 词" (教学悖论: 列了反而触发, 必须 0 命中)
# 详见 § 14.2.1 + plugins/shadow-hooks.ts:§14
grep -cE "\b(exploit|vulnerability|attack|malware|shellcode|0day|CVE)\b" \
  plugins/*.ts skills/*/SKI33.md skills/*/templates/*.md
# 期望: 所有文件命中数 0

# 验证 commit 末尾带 Co-Authored-By
git log -1 --format="%B" | grep -q "Co-Authored-By: Claude Opus 4.8"
```

### Render the architecture diagram

```bash
# docs/architecture.mmd 是统一架构图 (Mermaid, dark theme)
npx -p @mermaid-js/mermaid-cli mmdc -i docs/architecture.mmd -o /tmp/arch.svg
# 也可用 mermaid-check skill 验证
```

### Git workflow

Default branch is `main`. Recent commit convention is Conventional Commits (`refactor(walker): …`, `docs: …`, `fix(framework): …`). **末尾必须**带:

```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

## 架构与代码结构

### High-level model

```
User task
   ↓
agents/shadow-walker.md        ← Single craftsman agent (not a dispatcher), 641 行
   ↓ loads skills on demand
skills/{name}/SKI33.md         ← Each skill: <500-line quickstart + references/
   ↓ produces
.shadow/                       ← Product-project 工作区 (framework 自身**不**创建)
```

The Walker is **not a dispatcher** — it does the work itself, reading files, writing code, running commands. It picks one Skill at a time and follows that Skill's SKI33.md as the execution script.

### 目录与流水线 (详情见 README.md)

- **完整目录树** + skill 列表 (26 个含 14 核心 + 12 utility) → `README.md` § 目录结构
- **流水线** 30→31→31.5→Scaffold→32→33→35→36 → `README.md` § 流水线
- **统一架构图** (Mermaid) → `docs/architecture.mmd`
- **3 个 agent 变体**:
  - `agents/shadow-walker.md` (641 行) — Claude Code / OpenCode 共用版
  - `agents/shadow-walker-pi.md` (310 行) — pi 专属变体, frontmatter 适配 pi 协议
  - `agents/shadow-worker.md` (264 行) — 通用接单员, 被 walker 通过 `Task` 派 work order

**核心 skill 清单** (14): `shadow-init` / `shadow-l0-research` / `shadow-l1-research` / `shadow-l1-flow` / `shadow-l1-spec` / `shadow-l1-wire` / `shadow-l1p5-architecture` / `shadow-scaffold` / `shadow-l2-e2e` / `shadow-l2p5-fdd` / `shadow-l3-resilience` / `shadow-l5-plan` / `shadow-l5-impl` / `shadow-l5-stargate-checker` / `shadow-l6-deploy` / `shadow-reviewer` (实际 16 个核心, 跟 README "13 核心" 表述差异: 含 l2p5-fdd / l5-stargate-checker / 拆分后 l1p5 单 skill 替 3 旧 skill)

**utility skill** (10): `shadow-reverse` / `shadow-taste` / `shadow-trace-init` / `shadow-artifact-lifecycle` (元 skill) / `skill-creator` / `mermaid-check` / `docker-helper` / `test-in-tmux` / `gherkin-writer` / `opencode-learning`

**单一源真理**: `.shadow/shadow-schema.json` (skill 模板里, 仓库根没) 描述阶段表、存根模式、scale 字段. **所有 hooks (`hooks/lib.sh`) + plugins (`plugins/shadow-hooks.ts`) 都从这读**, 改一处即生效.

**每个 skill 内部布局**:
```
skill-name/
  SKI33.md        ← Quickstart (<500 行, 触发时 in-context)
  references/     ← Deep-dive docs, read on demand
  templates/      ← Output templates (部分 skill 有)
  scripts/        ← Gate-check / automation scripts (部分 skill 有)
  DEPS.md         ← Optional runtime deps (npm/pip/system)
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

   4a. **Strict-default (用户偏好, memory: `strict-mode-default`)** — 走 Shadow 的项目无论 scale 标签 (S/M/L), 默认按 L 规模 + 扩展模式跑 (l3_extended_mode=true, wire_passes=4, coverage_dimensions=20, persona_dimensions=8, persona_max=12). 5 个下游 skill 读 scale.md 字段不读 scale 标签. 降级必须显式 (改 .shadow/scale.md 字段). **不重写老 demo** (cjxdd-demo 等 7+ 走老 default 留着), 只新项目按 strict. 详见 `skills/shadow-init/templates/shadow-schema.json:scale_schema.fields.*` (default 改为 L 级).

5. **工藤伦底线 (Walker's hard rules)** — No stubs, no fake implementations (no InMemoryRepository, no hardcoded `current_user`), no skipped phases, no fake "DONE". "Tests pass" is not "code is correct" — read assertion quality. After 4 failed attempts at the same step, write `FAI3URE-3OG.md` and ask the user.

6. **36 漫游修复硬上限 (3-round repair cap)** — 35/36 is not an infinite loop. If P1 issues remain after 3 repair rounds, retreat to the design layer (`shadow-l1-wire` for dead-ends, `shadow-l1-research` for workflow blockers, `shadow-l1p5-architecture` for API errors).

7. **No-advisory 原则 (用户偏好, memory: `no-advisory-policy`)** — 走 Shadow = 严丝不漏, L5 stop-gate 5 段全 hard (no advisory 灰色地带), 3 轮未修升级 HALT. 小项目不走 Shadow. 详见 `plugins/shadow-hooks.ts:§15` + `skills/shadow-artifact-lifecycle/SKILL.md`.

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

## § 设计规范指针 (改 framework 时去哪儿看)

这是 framework 自己的**单一源真理指针** — 每个机制只写一次, 改 plugin/hook 跟改 CLAUDE.md 两边都改易"两份真理", 下面表只列位置, 详细看对应文件.

| 主题 | 实施位置 | 何时看 |
|------|---------|--------|
| **L0 v2** (brainstorm + L1 消费 + web search 5 方向) | `skills/shadow-l0-research/SKILL.md` (v2.0) | 改 L0 笔记本模板 / 引导问 / L1 消费机制 |
| **L0 每轮重做门禁** (per-iter, 14 天 mtime) | `plugins/shadow-hooks.ts` L3 P0-Y 段 + `pre-skill.sh:114-140` | 改 L0 笔记本 / 调 freshness 阈值 |
| **L1-business 5 角色 lifecycle** (design_baseline / process_output / evidence_archive / control_marker / template_instance) | `.shadow/shadow-schema.json:lifecycle_artifacts[]` + `skills/shadow-artifact-lifecycle/SKILL.md` | 改 schema / 加新工件 / 调 drift 检测 |
| **L2 e2e v9.2** (Design-Conformance Gherkin) | `skills/shadow-l2-e2e/SKILL.md` (v9.2) | 改 Gherkin 业务约束翻译 / L5 reviewer audit 配套 |
| **L3 韧性 (8/9 维 + 10/12 模式 + 5/8 字段 FMEA)** | `skills/shadow-l3-resilience/SKILL.md` | 改韧性模式 / 失败模式 / L 规模扩展 |
| **L5 plan v5** (plan 是入口+索引, 上游是 detail) | `skills/shadow-l5-plan/SKILL.md` (v5) + `templates/harness-plan-template.md` | 改 plan 顶部 @upstream 矩阵 / plan 模板 |
| **L5 plan v5.1** (iter 间 3 态 + plan-iter-check + @iter 标记) | `skills/shadow-l5-impl/SKILL.md` (v5.1) + `agents/shadow-walker.md` 变更记录段 | 改 iter 间冲突保留正向机制 |
| **L5-impl v5.2** (Pre-write Signoff) | `skills/shadow-l5-impl/SKILL.md` (v5.2) | 改 method 写前 sign-off 模板 / reviewer hard error 规则 |
| **L5 Consistency Audit** (4 维 spec↔code / wire↔code / arch↔code / l3↔code) | `plugins/shadow-hooks.ts:§13` (auditL5Consistency 主入口) | 改 4 维阈值 / 加新维度 |
| **L6 R11 真实烟雾测试门禁** (4 层验证, 新项目 hard / 老项目 advisory) | `plugins/shadow-hooks.ts:§9` + `skills/shadow-artifact-lifecycle/scripts/gate-check-lifecycle.sh:307-412` + `skills/smoke-r11-round2.sh` | 改 L2 验收 / L6 部署 / production-scenarios 契约 |
| **No-advisory + 3 试 HALT** | `plugins/shadow-hooks.ts:§15` + `.l5-unresolved.json` / `.l5-halt.json` | 改 halt 阈值 / 调 HALT 段 prompt |
| **/cjgoal v3** (整段文本全收 + user-driven continue) | `plugins/goal-mode.tsx` (v3) | 改 PREFIX_RE 解析 / evaluate 启发式 / re-inject (已砍) |
| **zh-continue 中文输入修** | `hooks/user-prompt-submit.sh:134-144` | 改 zh-continue / en-new-build 等意图判定, 防误触 schema 拒收 |
| **压力信号检测** (RUSH/TIME/SKIP/SIMPLIFY/WORKLOAD 5 类) | `hooks/lib.sh:check_pressure_signals()` + `plugins/shadow-hooks.ts` L2/L3 part | 调阈值 / 加新信号类 / 改 dedup 逻辑 |
| **Strict-default (L 规模默认参数)** | `skills/shadow-init/templates/shadow-schema.json:scale_schema.fields.*` | 改 scale default / 调下游 strict 行为 |
| **模型 API error 兜底** (6 类分类 + toast) | `plugins/shadow-hooks.ts:§14` (classifyApiError + handleSessionError) | 加新 provider 错误类 / 改 toast 文案 |
| **P0-Y L0 重做门禁** | `plugins/shadow-hooks.ts` L3 P0-Y 段 + `pre-skill.sh:114-140` | 改 L0 笔记本 / 调 freshness 阈值 |
| **bypass-shdw: 显式化** | `plugins/shadow-hooks.ts:§11.2` + bypass 注释约定 | 改 bypass log 收集 / 跨轮保活 |

**为什么这些是"指针"不是"复述"**: framework 自身的 schema / plugin / hook 是 1 个**单一源真理**, CLAUDE.md 复述任何一段都会变成"两份真理" → 改了 plugin 忘了改 CLAUDE.md 反而误导. 需要时按表去对应文件读.

## Where to start

- **To understand the framework**: read `agents/shadow-walker.md` (641 行, 顶部有 Meta 守卫), then `docs/architecture.mmd` (rendered), then `README.md`.
- **To understand a single stage**: open `skills/{stage}/SKI33.md`. It is the execution script.
- **To understand stage-to-stage handoffs**: read the change-propagation table and retreat decision tree in `agents/shadow-walker.md`.
- **To create a new skill**: use `skills/skill-creator/SKILL.md` (it has its own eval/iterate loop).
- **To reverse-engineer an existing codebase with no `.shadow/`:** start with `shadow-reverse`, not 30.
- **To trace an artifact's lifecycle role**: see `skills/shadow-artifact-lifecycle/SKILL.md` + § 设计规范指针.
- **To plan iter-N+1 without re-inventing**: read iter-N's L1 first (L0 v2 step 1), then L0 v2 brainstorm + 7 notebooks, then walk L1.
- **To verify code follows spec**: enforce L5-impl v5.2 Pre-write Signoff (read / understand / assume) + L2 v9.2 Design-Conformance Gherkin (业务约束 → Gherkin step).


demo目录是采用工作流开发的demo项目
