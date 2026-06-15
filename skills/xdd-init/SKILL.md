---
name: xdd-init
description: |
  xdd 入口 —— 把空仓库变成 xdd 项目。生成简化版 .xdd/（design/ 设计层锚 + plan/ 桥接 + status.md 进度 + current-iteration）。
  + inject：cp WORKFLOW.md 模板 + rules/ 模板 + 往 AGENTS.md/CLAUDE.md 注入 xdd pointer（idempotent，被改过不动）。
  平台中立，无 hook 依赖。新项目第一步。
  触发：初始化、init、新项目、xdd-init、起项目、开始、脚手架骨架。
---

# xdd-init — 项目入口

把空仓库变成 xdd Walker 能识别的项目：生成 `.xdd/` 三层骨架。**新项目第一步**。

## 何时用

- 拿到空仓库/新目录，准备开始 `prompt → 设计 → 代码`
- 上一个 iter 完成，开新 iter（`--iter 2`）

**不要在以下情况用**：
- 项目已有 `.xdd/` 且想继续 → 直接调 walker / 下一个 skill
- 想迁移老项目 → 手改或重跑 `--force`

## 最快路径

```bash
# 任何项目目录下：
bash skills/xdd-init/scripts/init.sh
# 或装好后：bash ~/.claude/skills/xdd-init/scripts/init.sh
```

## 参数

| 参数 | 默认 | 说明 |
|------|------|------|
| `--iter N` | `1` | 初始化哪个 iter，写 `current-iteration` |
| `--force` | false | `.xdd/` 存在时强制覆盖（**危险**，丢 status） |
| `--bizlines B01-鉴权,B02-订单` | 空 | 多业务线项目：预生成 `spec/_landscape.md` + 每业务线 `spec/{slug}/business.md` 占位 |

## 生成的结构

```
.xdd/
├── WORKFLOW.md                ← 工作流指南（cp 模板，AI 必读）
├── rules/                     ← 项目规则模板（首次生成，用户可改）
│   ├── backend.rules          ← 后端约定（分层/错误码/auth/测试）
│   └── ui-ux.rules            ← 前端 UI/UX 约定（4 级 + 10 反模式）
├── design/                    ← 设计层（持久锚，跨 iter 保留）
│   ├── intent.md              ← 意图锚（xdd-understand 填）
│   ├── design.md              ← 收敛决策（xdd-understand 填）
│   ├── notes/                 ← 发散笔记（glossary 持久；其余设计期）
│   ├── spec/                  ← 规则锚 RXX + Gherkin（xdd-spec 填）
│   │   ├── _landscape.md      ← 业务线全景（--bizlines 时生成）
│   │   └── {slug}/business.md ← 业务线占位（--bizlines 时生成）
│   ├── architecture/          ← 结构锚 colocation（xdd-architecture 填）
│   └── wire/                  ← 前端锚（xdd-wire 填，纯后端跳过）
├── runs/                      ← 单轮工作记录（每 iter 一份）
│   └── iter-N/
│       ├── status.md          ← 本 iter 进度（3 层 × 业务线，✅/⏳）
│       ├── plan/{slug}/       ← 本 iter 的 TDD task DAG（xdd-plan 填）
│       └── audits/            ← 本 iter 的 PoC / arch-audit
└── current-iteration          ← "iter-N"（根级指针，找活跃 iter）
```

**design/ vs runs/ 二分**：`design/` 是持久锚（review 基准，跨 iter 保留）；`runs/iter-N/` 是单轮工作记录（plan/报告/审计，iter 间不覆盖）。`--iter N+1` 时旧 iter 原地保留作历史。

**inject 到用户文件**：若项目根已有 `AGENTS.md` / `CLAUDE.md`，init 在文件开头注入一段用 `<!-- xdd:start -->` / `<!-- xdd:end -->` 包裹的 pointer（Personality 留空段 + XDD/Backend/UI-UX/recap 指向 `.xdd/`）。

**砍掉的旧产物**（深度重构）：`scale.md`（不再 scale 降级，默认就做扎实）、`xdd-schema.json`（曾是闸门单一源真理，无闸门则不需要）、`gates/`（control_marker 目录）、5-marker 状态机（⏳/🔄/✅/❌/🚧 → 简化 ✅/⏳）。

## status.md（3 层骨架，简化）

```markdown
# Pipeline Status — iter-1

## 项目层
| 层 | 状态 | skill | 产出 |
|----|------|-------|------|
| 设计·理解 | ⏳ | xdd-understand | design/intent.md + design.md |
| 设计·规则 | ⏳ | xdd-spec | design/spec/{slug}/ |
| 设计·架构 | ⏳ | xdd-architecture | design/architecture/{slug}/ |
| 设计·前端 | ⏳ | xdd-wire | design/wire/{page}/ |
| 设计·韧性 | ⏳ | xdd-resilience | design/architecture/{slug}/resilience/ |
| 桥接·计划 | ⏳ | xdd-plan | plan/{slug}/plan.md |
| 代码·实现 | ⏳ | xdd-execute | 代码 @implements RXX |
| 代码·验证 | ⏳ | xdd-verify | 验证报告 |

## 上下文地图
### 当前
- 层: — / 活跃 slug: — / 失败计数: 0
### 本层必读
- skill: — / 输入: — / 上游指针: — / 自检: —
```

多业务线时（`--bizlines`），按 `## BXX 业务线名` 分段重复层表 + 末尾加跨业务线一致性 checklist。

## 设计原则

1. **只生骨架** — init 不写 design.md 内容（那是 xdd-understand 的活），只生占位 + 目录结构。
2. **入口路由判定** — 检测存量代码（源码/项目配置/git 跟踪文件）→ 警告指向 `xdd-reverse`，`--force` 才继续。不让 init 盲目 scaffold 进遗留项目。
3. **idempotent-with-warning** — 重复 init（同 iter）不静默覆盖，`--force` 才覆盖；不同 iter → 走迁移。
4. **iter 实质迁移** — `--iter N+1` 归档旧 iter（`runs/iter-N/` 原地保留），建新 iter 工作区，`design/` 持久锚不动。
5. **不调 walker** — init 完打印"下一步"，但 walker 由用户触发。
6. **平台中立** — 纯 bash，无 hook 依赖，无 schema.json，任何平台能跑。
7. **inject 尊重用户文件** — `AGENTS.md`/`CLAUDE.md` 是用户文件：init 不创建新的；软链跳过（只注入真文件）；注入块用 marker 包裹 + 忽略空白 diff，**被用户改过的不动只警告**。
8. **自检** — init 是唯一输出被全下游依赖的入口，必须自检（关键文件/git/inject marker）。

## inject 行为（幂等细节）

| 情况 | init 行为 |
|------|----------|
| 文件无 marker | 首次注入（插开头）|
| 有 marker，内容 == 模板（忽略空白）| 跳过（idempotent）|
| 有 marker，内容 != 模板（被改过）| **不动 + 警告**（让用户手动决定）|
| 文件是软链 | 跳过（真文件那次会处理，避免双写）|
| 文件不存在 | 跳过（不创建用户文件）|
| `rules/*.rules` 已存在 | 跳过（用户改过的保护）|
| `WORKFLOW.md` | 每次覆盖（framework 维护，非用户文件）|

## 入口路由判定（init 的入口职责）

用户到项目时有三条路，init 帮你判定走哪条：

| 现场情况 | init 行为 | 正确路径 |
|---------|----------|---------|
| 空目录 / 全新项目 | 正常 scaffold | init → walker |
| 有存量代码（无 `.xdd/`）| **警告 + exit**（指向 reverse）| `xdd-reverse`（反推设计 + 追溯）|
| 已有 `.xdd/` + 同 iter | exit（`--force` 才覆盖）| 直接调 walker 继续 |
| 已有 `.xdd/` + 新 iter | iter 迁移 | `init --iter N+1` |

存量检测信号：`package.json`/`go.mod`/`cargo.toml`/`pom.xml`/`requirements.txt`/`pyproject.toml`/`composer.json`/`Gemfile` 等任一，或 `src`/`app`/`server`/`lib` 等源码目录，或 git 已跟踪文件（排除 `.xdd/`）。

## iter 迁移（多轮开发）

```
iter-1 完成 → init --iter 2
  → runs/iter-1/ 原地保留（status/plan/audits 作历史快照）
  → runs/iter-2/ 新建（空工作区）
  → design/ 不动（持久锚跨 iter 保留：intent/spec/architecture/wire/resilience）
  → current-iteration → iter-2
```

新 iter 的 understand 读 `design/` 持久锚 + 翻 `runs/iter-(N-1)/` 看上轮记录，不重发明。

## 下一步

```bash
# 对 AI 说:
"用 xdd-walker 给我做一个 <你的功能>"

# walker 第一步装 xdd-understand 写 design/intent.md + design.md
```

## 自检（init 末尾自动跑）

```
□ 关键文件/目录都在（current-iteration / WORKFLOW.md / intent.md / design.md / notes/ / runs/iter-N/）？
□ design/ 持久锚 + runs/iter-N/ 工作区 都创建？
□ git 仓库？（非 git → ⚠️ 提醒 git init）
□ .gitignore 是否需要加 .xdd/runs/ 规则？（ℹ️ 提醒）
□ inject marker 落地（AGENTS.md/CLAUDE.md 若注入过）？
```

## 故障排查

| 现象 | 原因 | 修法 |
|------|------|------|
| `.xdd/ already exists` | 已初始化 | 换目录，或 `--force` 强覆盖 |
| walker 加载后看到空 status | init 漏跑 | `bash scripts/init.sh --force` |
| "检测到存量代码" | 仓库已有源码 | 改用 `xdd-reverse`，或 `--force` 确认新项目 |
