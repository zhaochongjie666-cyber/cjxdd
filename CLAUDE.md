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
inline `/cjgoal {目标}` 回车, plugin 监听 `message.part.updated` 抓 user text, 写 `.shadow/goal-runs/{sessionID}/{runId}/goal.md` + `current.json`, 监听 `session.idle` 事件, **用主 session 启发式 eval** 判定是否完成 (COMPLETE/CONTINUE), 未完成则 toast 提示用户续杯, 最多 10 轮. 过程通过 `ui.toast` 右上角弹窗通知.

**Claude Code 端**: `commands/cjgoal.md` (slash command, `install-to-claude-code.sh` 软链到 `~/.claude/commands/`). 跟 OpenCode 行为对齐但**实现简化** — Claude Code 没有 TUI plugin SDK (`session.create` / `client.tui.showToast`), 用 prompt-based workflow: 写 goal.md + current.json, 引导 walker 推进, 用户手动调 `/cjgoal done` 标记完成 (写 `final.md`).

**差异表**:

| 维度 | OpenCode `/cjgoal` | Claude Code `/cjgoal` |
|------|-------------------|----------------------|
| 命令注册 | TUI plugin `command.register` | `commands/cjgoal.md` slash command |
| 目标输入 | inline `/cjgoal {text}` | 命令参数 `$ARGUMENTS` |
| 子命令 | `/cjgoal done` / `/stop` / `/status` (v2 修复, 主动收尾) | `/cjgoal done` / `/stop` / `/status` |
| 评估循环 | 自动: `session.idle` → 主 session 启发式 eval (4 维: 用户短完成信号 / AI 产物空 / AI 仅对话 / AI 有具体输出) | **手动**: `/cjgoal done` 写 final.md |
| 隐式完成 | 用户短答 `完成` / `done` / `ok` (≤15 chars, 不带 `?`) 触发 COMPLETE | — |
| Toast 通知 | TUI toast | 无 |
| 产物位置 | `.shadow/goal-runs/{sessionID}/{runId}/{goal.md, iter-N.md, final.md}` | 同 (Claude Code 写盘走 bash, 路径不强制带 sessionID) |
| 完成标志 | 主动: `/cjgoal done` / 隐式短答 / 10 轮 cap / `/cjgoal stop` 主动放弃 | 用户触发 `/cjgoal done` (或 `/stop`) 写 `final.md` |

**OpenCode 端 4 条收尾路径 (v2 修复)**:
1. `/cjgoal done` — 用户显式 COMPLETE, final.md 标 `ended_by: user_done`
2. 短答 `完成` / `done` / `ok` 等 (≤15 chars, 不带 `?`) — 隐式 COMPLETE, final.md 标 `ended_by: auto_eval (heuristic)`
3. `/cjgoal stop` — 用户显式 ABANDONED, final.md 标 `ended_by: user_stop`
4. 10 轮 cap — 兜底 FAI3URE-CAP, final.md 标 `ended_by: cap`

**OpenCode 端评估机制** (v2 修复): 之前用 `session.create` + `session.prompt` 起独立 evaluator session 有 OpenCode server bug (UnknownError + promptAsync 不响应), 砍掉. v2 改读主 session 最后 assistant + 最后 user, 启发式判定. 返回协议: evalResult 首行 = verdict (COMPLETE|CONTINUE), 后续 = reason. handleDecision 拆首行作 verdict.

**生命周期注册**: `shadow-schema.json:lifecycle_artifacts` 末尾 `goal-run-goal` / `goal-run-final` / `goal-run-iter` / `goal-runs-ctrl`, hook 自动识别 (v2 修正路径模板加 `{sessionID}` 层).

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

## § 11 L5 跨轮保活 + Bypass 显式化 (v2.1 — 防"AI 偷工"两件套)

**问题**: AI 实现者快 + 觉得项目小 → 走捷径 (L3 走过场 / L2 缩水 / InMemory 顶包 / 偷偷绕过 check) → L5 警告是一次性 toast, AI 看完就忘, 静默通过. 走查示例见 `bff404d` 等老 commit 里 "存根扫描" warning 长期累积.

**对策**: 两件套, 改动小, 零 advisory 灰色地带.

### 11.1 实施 #6: L5 warnings 跨轮保活

**机制**: L5 stop-gate (`plugins/shadow-hooks.ts:runStopGate`) 把每条 warning/error 跟 section 名一起记, 写到 `.shadow/iterations/iter-N/.l5-unresolved.json` (control_marker 角色, 见 schema `l5-unresolved`).

- **新增项** (本轮 5 段里出现, 盘上没): `first_seen = now, count = 1`
- **续期项** (本轮 + 盘上都有): `last_seen = now, count++`
- **消项** (本轮没出现, 盘上有): 丢弃 (自动 resolved)

L1 SessionStart (`experimental.chat.system.transform`) 读这文件, 把未解决列表**强制注入 system prompt**, AI 看到 → 下次要么修代码让 L5 跑不到, 要么显式处理.

**为何有效**: 把"软提醒"质变为"持续可见". 30s toast 消失没用, 但 system prompt 是必读的, AI 装看不见都装不了.

**约束**:
- 5 段 stop-gate 仍然 advisory (不阻断 AI 当前轮) — 因为 hard-block 会让小项目跑不动
- 但**未解决跨轮累积**, 越拖越显眼, 形成"软压力"
- 严重 (R5 hard-gate fail) 仍会触发 error toast + 升 `level: "error"` 在 unresolved 里, 12s 弹窗

### 11.2 实施 #3: Bypass 显式化 + audit log

**机制**: AI 想绕过某条 check, 必须写注释:

```python
# bypass-shdw: 这里是 fixture, 不需要真 resilience
def stub_user_lookup(): return {"id": "admin"}
```

支持语法: `//` (js/ts/go/rust/swift), `#` (py/sh/yaml/sql/toml), `--` (sql), `/* */` (c/java).

L5 stop-gate 段 1.5 (`scanBypassMarkers` → `appendBypassLog`) 扫所有源码文件, 收录 `(file, line, reason)` 三元组, 写 `.shadow/iterations/iter-N/bypass-log.md` (evidence_archive 角色, 见 schema `bypass-log`).

- 同一 `(file, line, reason)` 多次出现: djb2 hash 去重, 只记首次
- 文件头有 header 段说明 "L6 部署前 user 必审"
- L1 SessionStart 同步注入 system prompt, 强制 AI 看到自己之前写的 bypass

**为何有效**: 隐式 bypass → 显式 audit. AI 不能"我先这样写, 反正 L5 不会发现" — L5 立即收进 log, user 一眼看到. 配合 L6 部署前 user 必审, bypass 必须有合理 reason 才能带进生产.

**AI 写作纪律**:
- ❌ 别写裸 stub / hardcoded 绕过 — 没有 reason 注释 = L5 警告 + unresolved 累积
- ✅ 写 `// bypass-shdw: <具体原因>` — 显式, user-review 时通过
- ✅ 真不需要的 resilience 写 `# bypass-shdw: 单元测试 fixture, 不入生产` — bypass 显式, 走 audit 流程

## § 12 Strict-default 策略 (v2.1 — 生产水准不分规模)

**用户偏好 (memory: `strict-mode-default`)**: 走 Shadow 工作流的项目, 无论声明的 `scale: S / M / L`, 默认按 **L 规模 + 扩展模式** 跑, 完整全面达到生产水准. 用户原话:

> 如果我走 Shadow 工作流，无论项目大小，我都希望完整全面的能达到生产水准。

### 12.1 行为变化 (v2.1 升 strict)

| 字段 | 旧默认 (M 规模) | 新默认 (L 级 strict) | 含义 |
|------|----------------|---------------------|------|
| `scale` | `M` | `M` (标签, 不改行为) | scale 只是规模标签, **不**触发降级 |
| `l3_extended_mode` | `false` | `true` | 9 维失败模式 + 12 兜底机制 + 8 字段 FMEA |
| `wire_passes` | 3 | 4 | Wireframe 多轮精修 |
| `coverage_dimensions` | 14 | 20 | 验收覆盖维度 |
| `persona_dimensions` | 6 | 8 | 用户画像维度 |
| `persona_max` | 8 | 12 | 用户画像上限 |
| `l3_required` | `true` | `true` | (不变) L3 韧性设计所有规模必跑 |
| `l6_core_phases_only` | `false` | `false` | (不变) L6 全 9 phase 跑 |

### 12.2 实施位置

`skills/shadow-init/templates/shadow-schema.json:scale_schema.fields.*` — 每个字段的 `default` 改为 L 级. `init.sh` 用 `jq` 提取 default 写 scale.md, 自动用新值.

### 12.3 跟现有 demo 的关系

**不**重写 `demo/{cloud-gpu,vlademo}/.shadow/scale.md`. 老 demo 是按当时 default 初始化的, 留着. 只**未来新项目**默认按 L 级 strict 跑. 想覆盖老 demo: 手工改它们的 scale.md (复制新 default 进去).

### 12.4 显式降级的方式

如果某个项目**确实**要降级 (e.g. 一次性脚本 / 用户明确说"不要 resilience"), 改 `.shadow/scale.md` 字段:

```yaml
scale: S
l3_extended_mode: false      # 退回 8 维 + 10 模式
wire_passes: 2               # 少 wire passes
coverage_dimensions: 10      # 少 coverage 维度
```

降级必须**显式**, 不能隐式. 5 个下游 skill 读 scale.md 字段, 不读 scale 标签, 所以 `scale: S` 配 strict 字段 = 实际 strict 行为. 这是 "标签 ≠ 行为" 的关键.

### 12.5 跟 §11 (L5 跨轮保活 + Bypass 显式化) 协同

§11 是"AI 偷工"的**事后**防御 (L5 警告跨轮保活 + bypass 显式化). §12 是"AI 不偷工"的**事前**防御 (默认就按 L 级跑, AI 没机会"觉得项目小就简化"). 两者协同: 事前给满弹药, 事后盯逃逸.

## § 13 L5 Consistency Audit (v2.1 — 跟上游设计一致)

**问题 (用户原话)**: "特别是 L5 的代码实现，要跟前面的设计一致，经常会偷工减料." L5-impl 是 AI 偷工最严重的阶段 — spec 写 50 条 RXX, 代码只实现 30 条; L3 写 9 维失败模式, 代码没对应兜底; architecture 列 20 个 endpoint, 代码只注册 15 个. 4 维"设计 ↔ 实现"脱节是 L5 偷工的典型表现.

**对策 (实施 #14)**: L5 stop-gate 加 segment 5.5, 跑 4 维一致性审计. 任一维 coverage < 0.9 → **hard error** (跟 stub scan 一档力度), AI 必须补齐才能标 iter 完成.

### 13.1 4 维一致性检查

| 维度 | 上游产物 | 抽设计项 | 代码侧证据 | 阈值 |
|------|---------|---------|-----------|------|
| **spec ↔ code** | `.shadow/L1-business/**/spec.md` | `RXX-NN` 规则 ID (regex `\b[A-Z]{1,3}\d{1,3}\b`) | `@implements RXX` 注释 | ≥ 90% |
| **wire ↔ code** | `.shadow/L1-business/wire.svg` | `data-page="..."` 属性 | src 下 Page/page. 文件 | ≥ 90% |
| **arch ↔ code** | `.shadow/L1.5-architecture/**/architecture.md` | `GET/POST/PUT/DELETE/PATCH /path` | `@router.get(` 等装饰器 | ≥ 90% |
| **l3 ↔ code** | `.shadow/L3-resilience/**/failure-modes.md` | `F0N` 失败模式 ID | retry/circuitBreaker/fallback/timeout 关键字 | ≥ 90% |

### 13.2 实施位置

`plugins/shadow-hooks.ts:§13`:
- `auditL5Consistency(projectRoot, shadowDir, sourceDirs, threshold=0.9)` 主入口
- `extractRxxIds(text)` / `extractFmeaIds(text)` 抽设计项
- `scanImplements(sourceDirs)` 走源目录, 抽 `@implements` 标记
- `scanFailsafes(sourceDirs)` 数 retry/circuit-breaker/fallback/timeout 行
- `runStopGate` segment 5.5 调用, 不达标 → push `errors` + `tracked`

### 13.3 跟 §11 / §12 协同 (4 层夹击)

| 层级 | 抓什么 | 触发 |
|------|--------|------|
| **§12 事前** (strict-default) | 默认 L 级参数, AI 没机会"觉得项目小" | shadow-init |
| **§13 L5 consistency** (本段) | L5-impl 跟上游设计一致, 不偷工 | L5 stop-gate segment 5.5 |
| **§11.1 L5 跨轮保活** | L5 warnings 跨轮可见, AI 不能忘 | L5 stop-gate + L1 system |
| **§11.2 Bypass 显式化** | 显式 bypass 必带 reason, L6 user 必审 | L5 stop-gate + L1 system |
| **stub scan (现有)** | pass/TODO/InMemory/current_user=admin | L4 PostToolUse + L5 segment 1 |
| **R5 hard-gate (现有)** | 5 角色 lifecycle 一致 | L5 segment 5 |

**完整链路**: 默认 strict (L 级) → L5 跑 spec/arch/wire/l3 一致性检查 → stub scan 抓假实现 → R5 抓角色错位 → bypass 必带 reason → 跨轮警告必被看见. 偷工 6 重门, 几乎不可能漏过.

### 13.4 现行覆盖

**当前实现 (Phase 1)**:
- spec ↔ code: ✅ 完整 (regex `\b[A-Z]{1,3}\d{1,3}\b` 抽 RXX, 走源目录扫 `@implements`)
- l3 ↔ code: ✅ 完整 (FMEA regex + 4 种兜底关键字)
- wire ↔ code: ⚠️ 粗略 (数 `data-page` 属性 + `Page` 文件名匹配, 不验证 state variant 实现)
- arch ↔ code: ⚠️ 粗略 (HTTP method + path regex + `@router.` 装饰器计数)

**Phase 2 计划** (待办):
- wire state variant 实现检查: `data-state="loading/empty/error"` 必须在代码里有对应处理
- arch event contract 实现: arch 写的 event 名必须在代码里有 publish/subscribe
- 跨 BXX 一致性: BXX-A 的 spec 跟 BXX-B 的 spec 不冲突 (共享类型 / 命名一致)

## § 14 模型 API error 兜底 (v2.1 — 实施 #15)

**问题**: 模型 API provider (e.g., MiniMax M3) 有内容安全过滤. 模型输出被 flag 时返回 `{"type":"api_error","message":"output new_sensitive (1027)"}` 之类的 error. OpenCode 把 error 直接显示在 chat 流, 用户看到 `~ Preparing write...` 后跟一坨 JSON, 不知道是 framework bug 还是模型问题, 也不知道怎么恢复.

**对策 (实施 #15)**: 两层 — **事后** 弹清晰 toast + **事前** L1 system 提示规避.

### 14.1 事后: `session.error` 事件 → 分类 + toast

`plugins/shadow-hooks.ts:§14`:
- `classifyApiError(rawError)` — 6 维分类:
  1. **content_filter** (e.g., `new_sensitive 1027`): 模型输出被内容安全过滤
  2. **context_overflow**: 上下文超限
  3. **rate_limit** (429): 限流
  4. **auth** (401/403): 鉴权失败 / 配额用完
  5. **model_unavailable** (5xx): provider 端故障
  6. **unknown**: 其他
- `handleSessionError(client, props, diag)` — L5 event hook 接到 `event.type === "session.error"` 时调用
  - 弹 toast (warning/error variant, 12s 弹窗)
  - 内容: 根因 + 3 步恢复指引 + error code

**用户看到的效果** (替换原先的 `~ Preparing write... {json}`):
```
[toast] Shadow: 模型 API 内容过滤触发
        模型输出被 MiniMax 安全过滤拒绝, 不是 Shadow 框架 bug.

        恢复:
        1) 重发 "继续" 让 AI 重新生成, 大概率能过
        2) 把上一步拆成小步 (e.g., 分多次写文件)
        3) 改写敏感词 — 用中性工程术语代替
           (例如 "exploit" → "edge case", "vulnerability" → "defect")

        (error code: 1027)
```

### 14.2 事前: L1 system transform 提示 AI 规避

L1 system prompt 在 5 步节奏后加段, **抽象** 提示 AI 写朴素工程语, 不演示对抗性/安全语境的 payload:

```
=== 内容过滤规避 (实施 #15, 事前防线) ===
provider 的安全过滤 (新触发机制) 可能拒收你的输出, 触发 session.error.
策略:
  - 写朴素的工程措辞, 避免涉及安全/对抗性/恶意语境的词汇
  - 写示例代码时, 不要演示攻击/注入/绕过的具体 payload
  - 注释里要避开的, 用 Shadow 自有约定 (bypass-shdw:) 替代
不确定时: 拆小步写, 触发后用户说"继续"让 AI 重写.

(本段故意不列具体 trigger 词 — 列了反而让 model 记住这些词, 触发率上升.)
```

### 14.2.1 教学悖论 (priming 反效果) — v2.1.1 教训

**v2.1 初版错误**: 我在 §14.2 列了具体 trigger 词 (exploit / vulnerability / attack / malware / shellcode 等) + 中性替代. 意图是帮 model 避开. **实际效果相反**: 经典 priming 效应 — model 读到 trigger 词列表, 反而**更可能**在输出里使用这些词 (尤其在解释规则或写示例时), **提高**触发率.

**修正 (v2.1.1)**: §14.2 改成抽象描述, 不列具体词. 跟 `classifyApiError` 的 recovery 消息同步删 trigger 词示例.

**经验**:
- 教 model 避开某词, 反而让它记住某词
- 抽象描述 ("安全语境词汇" / "对抗性 payload") 比具体列表更安全
- 任何"教 model 规避 X"的 system prompt, 都得自问: "X 在 prompt 里出现, model 会不会跟着用 X?"
- 同样原则适用于: 教避开脏话 / 教避开品牌名 / 教避开竞品 — 列表 = 反效果

**审查命令** (新加进 framework 自查清单):
```bash
# 扫 system prompt 跟模板里的 trigger 词, 命中 0 才算合格
grep -cE "\b(exploit|vulnerability|attack|malware|shellcode|0day|CVE)\b" \
  plugins/*.ts skills/*/SKI33.md skills/*/templates/*.md
```

**为啥 `bypass` 不算 trigger**: `bypass-shdw:` 是 Shadow 自有的代码注释约定 (标识符级), 不是普通英文 "bypass" (动词, 触发过滤). model 读 `bypass-shdw:` 不会跟安全语境挂钩. 跟 `TODO` / `FIXME` 一样是中性标识符.

### 14.3 跟现有体系的关系

| 触发场景 | 行为 |
|---------|------|
| 内容过滤 (new_sensitive 1027) | warning toast + 3 步恢复 |
| 上下文超限 | warning toast + 跑 /compact 建议 |
| 限流 (429) | warning toast + 切换 provider 建议 |
| 鉴权失败 | error toast + 检查 env / auth |
| 模型服务不可用 (5xx) | error toast + 等 1-2min |
| 未知 error | error toast + 贴给 walker 看 |

**注意**: framework 不重试, 也不 call provider API. 这些是 OpenCode 的责任. framework 职责 = **解释清楚 + 给恢复路径**, 让用户不用裸看 JSON.

### 14.4 已知问题

- **payload 形态多变**: provider / OpenCode 升级可能改 session.error payload 结构. `classifyApiError` 走的是宽松正则 + 关键词, 鲁棒但非精确. 未来加新 provider 只需在分类函数加 case.
- **没法自动重试**: framework 不该直接重发 model API, 这是 OpenCode 的活. 用户看到 toast 后手动 "继续" 是最稳的路径.
- **不持久化到 unresolved**: 这不是产物问题, 是 transient provider 行为. 写 .l5-unresolved.json 没意义 (下轮 L5 跑不到这个 error, 自然消项).

## § 15 No-advisory 原则 (v2.1 — 实施 #16)

**问题**: 之前 L5 stop-gate 5 段里有 4 段 (stub / pending / drift / lifecycle) 是 warning 模式. 哲学冲突:

- 工藤伦底线: 不写存根 / "完成" = 真完成
- 现实: AI 看到 warning 30s 后忘掉, 继续偷工. 警告没传递压力
- 用户原话: **"advisory 是不可行的, 如果是小型项目, 我就不走这么重的工作流了. 既然要走工作流, 必定要非常严苛, 严丝不漏."**

**对策 (实施 #16)**: 二元化 — 走 Shadow = 全套 hard, 没 advisory 灰色地带. 不走 Shadow = 别用 Shadow, 走别的轻量工作流. 没有 shadow-lite 模式.

### 15.1 L5 5 段全部 hard (no advisory)

| 段 | 之前 | 之后 (v2.1) | 含义 |
|----|------|-------------|------|
| 1. stub scan | warning | **ERROR** | 存根必删, 不修不能继续 |
| 1.5 Bypass log | info | info (不变) | audit log, 不是 violation |
| 2. pending stages | warning | **ERROR** | ⏳ stage 必须先完成 |
| 3. L5 drift | warning | **ERROR** | status ↔ 产物必须一致 |
| 4. lifecycle drift | warning | **ERROR** | 5 角色一致性必保 |
| 5. R5 hard-gate | error | error (不变) | 已是 hard |
| 5.5 L5 consistency | error | error (不变) | 已是 hard |
| 6. API error | warning/error | warning/error (不变) | 分类已合理 |

`warnings` 数组仍存在 (供未来扩展) 但 L5 5 段不再 push. `tracked` 数组里所有项 `level: "error"` (跨轮保活全是 error, 不再有"小问题"灰色).

### 15.2 3 试 HALT 规则 (用户看不见压力就止步)

`unresolved.json` 跨轮保活的项, 如果 `count > 3` (连续 3 轮 L5 跑都还在) → 升级为 **HALT** 项. HALT 项:

1. **写到 `.l5-halt.json`** (control_marker, 见 schema `l5-halt`)
2. **L1 system transform 注入 HALT 段** (实施 #16, 优先级最高, 在 unresolved 之前):
   ```
   🛑🛑🛑 HALT — N 项持续 > 3 轮未修复
   严苛模式: 走 Shadow = 严丝不漏, 没 advisory 灰色地带.
   强制处置 (按优先级):
     1) 回退上游 design (改 spec/arch)
     2) 调 scale 字段 (误报才改)
     3) 走变更令 (跟 walker 重新协调)
     4) 写 bypass-shdw: 注释 (真要绕, 带 reason)
   不要: 删 unresolved.json / 改 schema 躲检查 / 装作没看见
   ```
3. **toast 升 error 12s 弹窗** + 🛑 emoji + 显式 "这是 halt, 不是 warning"

**为什么 3 试**: 1-2 轮给 AI 修复机会 (软压力, advisory → 升 hard). 3 轮没修 = 显然不是"小问题", 是 design 跟实现脱节, 必须停下问 user.

### 15.3 例外 (跟原则不冲突)

- **cjxdd 仓库自身** (framework 源码) — Meta 旁路跳过 stop-gate, framework 自身迭代用
- **老 demo 项目 (无 LIFECYCLE.md)** — 仍走 advisory (零迁移承诺, 不破坏)
- **Bypass log** — 是 audit log, 不是 violation. 显式 bypass 必带 reason, 走 §11.2 流程, 不算 advisory

### 15.4 跟 §12/§13/§14 协同 (8 重防线)

| # | 防线 | 抓什么 | 力度 |
|---|------|--------|------|
| 1 | §12 strict-default | 默认 L 级参数, 不给偷工借口 | 事前 |
| 2 | §13 L5 consistency | L5-impl 跟 4 维上游设计一致 | 硬 |
| 3 | §15 no-advisory (新) | L5 5 段全 hard, 没灰色地带 | 硬 |
| 4 | §15 3 试 halt (新) | 连续 3 轮 fail 升级 HALT, AI 必须停下 | 硬 |
| 5 | §11.1 L5 unresolved | L5 警告跨轮可见 | (升 hard 后) 硬 |
| 6 | §11.2 Bypass 显式化 | bypass 必带 reason + L6 必审 | 软 (audit) |
| 7 | §14 API error 兜底 | 模型 API 错 弹清晰 toast + 恢复 | 警告/error |
| 8 | R5 hard-gate (现有) | 5 角色 lifecycle 一致 | 硬 |

8 重防线, 偷工/出错几乎无路.

### 15.5 旧 commit 反思

- `bff404d` "R5 advisory fix" — 当时把 R5 降 advisory 是错误方向. 用户原话否定了. v2.1 后 R5 默认 hard, 老项目维持 advisory 是兼容性.
- 任何 "fix: X advisory" 类型的 commit 都要重新审视, 大概率方向错了.

### 15.6 一句话

> **Shadow 是严苛工作流, 没有"轻量模式". 用户走 Shadow 就是要严丝不漏; 用户不想严苛, 就不走 Shadow, 别期望"用 Shadow 但保留 advisory 灰色地带". 走 = 严苛.**


demo目录是采用工作流开发的demo项目