# CLAUDE.md

给 Claude Code（claude.ai/code）在本仓库工作时的指引。

# xdd — 工匠型开发体系（Craftsman-Style Development System）

这个仓库**不是普通应用代码库**。它是一个 **meta-project** —— 一套平台中立的 AI 驱动软件开发框架，由 **1 个工匠 agent + 8 个 agent + 13 个 skill** 组成。本质是一句话：

> **用户 prompt → 设计层（锚）→ 代码实现。** 设计层把用户意图固化，让代码不偏离用户。

如果用户给 Claude 一个"做个 XX 系统"的任务，正确的做法通常是**加载 `xdd-walker` agent**，按 `prompt → 设计 → 代码` 三层走完。

## ⚠️ Meta：你正在修改 xdd 自身，禁用 xdd 流程

**这个项目就是 xdd 框架自身**（`agents/` + `skills/` + `archive/` + `docs/` + `install.sh` + `framework-conventions.md`）。在 cjxdd 工作就是**改 framework**，不是**用 framework 改外部产品**。

### ❌ 严禁（用 xdd 改 xdd 会自指递归）

- ❌ 不要加载 `xdd-walker` / `xdd-orchestrator` 来开发本仓库
- ❌ 不要跑三层流水线（understand→spec→...→verify）
- ❌ 不要在本仓库创建 `.xdd/`
- ❌ 不要用 `xdd-init` / `xdd-understand` 等 skill "调研" framework 自身

### ✅ 正确做法（直接当代码仓库改）

- ✅ 直接 Read/Edit/Write `agents/` / `skills/` 下的源码
- ✅ 改完跑 smoke 验证（见下方常用命令）
- ✅ 直接 commit（Conventional Commits + 末尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`）
- ✅ 想"用 framework 验证 framework" → 在 `./demo/<project-slug>/` 起一个产品项目，在那里 cd 后跑 walker

### 怎么判断"我是不是在做 Meta 任务"

```bash
[ -f agents/xdd-walker.md ] && [ -f skills/xdd-understand/SKILL.md ] && echo "META: 在改 framework 自身"
```

或 `pwd` 含 `/cjxdd` 且仓库根有 `agents/xdd-walker.md` → Meta 任务。

`agents/xdd-walker.md` / `xdd-orchestrator.md` 顶部都有 Meta 守卫段，加载时先检测 project root，若是 cjxdd 自身立即拒绝执行。

## 架构（一句话 + 三层骨架）

```
用户 prompt
   ↓
┌─ 设计层（锚）──────────────────────────────┐
│ understand → spec(RXX) → architecture →     │
│ wire → resilience                            │
│ 每个产物带「上游指针 + 下游消费者」           │
└──────────────────────────────────────────────┘
   ↓ 桥接: plan（每个 task 显式回指 RXX）
┌─ 代码层 ────────────────────────────────────┐
│ execute → verify                             │
│ commit → @implements RXX → plan task →       │
│   spec 规则 → design 意图  ← 追溯闭环         │
└──────────────────────────────────────────────┘
```

**设计层是锚**：把用户意图固化成 design.md（为什么）+ RXX 规则（做什么）+ architecture（怎么做）+ wire（长什么样）+ resilience（挂了怎么办）。代码层每步回指这些锚，所以不偏离用户。

**平台中立**：只依赖 skill + agent（所有 AI coding 平台都支持的最小公约数）。**没有 hook、没有 plugin、没有平台针对性代码**。能在 Claude Code / OpenCode / Cursor / pi / 任何支持 agent+skill 的平台原样运行。

（重构前的 hook + plugin 平台层 ~7300 行已归档到 `archive/platform-2026-06/`，理由：不可移植 + 实证无效。）

## 目录结构

```
cjxdd/                          # xdd framework 仓库自身
├── agents/                     # 8 个 agent（平台中立）
│   ├── xdd-walker.md           # 单工匠主入口（合并了旧 pi 变体）
│   ├── xdd-orchestrator.md     # 多 agent 编排主调度（大项目用）
│   └── phase-{understand,design,resilience,plan,build,verify}.md  # 6 子 agent 映射三层
├── skills/                     # 13 个 skill（设计5 + 桥接1 + 代码2 + 入口1 + 工具4）
│   ├── xdd-init/               # 入口：生成 .xdd/ 骨架
│   ├── xdd-understand/         # 设计·意图锚（intent.md + design.md）
│   ├── xdd-spec/               # 设计·规则锚（RXX + Gherkin）
│   ├── xdd-architecture/       # 设计·结构锚（架构+flow+端点+事件+运维）
│   ├── xdd-wire/               # 设计·前端锚（页面线框，纯后端跳过）
│   ├── xdd-resilience/         # 设计·韧性锚（失败模式+兜底+混沌）
│   ├── xdd-plan/               # 桥接：设计→TDD计划，task 回指 RXX
│   ├── xdd-execute/            # 代码·实现（TDD，@implements RXX，无存根）
│   ├── xdd-verify/             # 代码·验证（真能用+双契约+4维一致性）
│   ├── xdd-reverse/            # 工具：逆向已有代码反推设计 + 追溯
│   ├── xdd-mermaid-check/      # 工具：图表渲染验证
│   ├── xdd-docker-helper/      # 工具：中国区 Docker 镜像
│   └── xdd-skill-creator/      # 工具：创建/编辑 skill
├── docs/                       # 用户文档
├── archive/                    # 归档（platform-2026-06 + skills-2026-06 + agents-2026-06）
├── framework-conventions.md    # framework 维护习惯
├── install.sh                  # 通用安装（软链 agents/+skills/ 到 harness 配置目录）
└── README.md
```

**每个 skill 内部**：`SKI33.md`（注：文件名是 `SKILL.md`，<500 行 quickstart）+ `references/`（按需深读）+ `templates/`（输出模板，部分有）+ `scripts/`（可移植 bash 自检，部分有）。

## 关键设计原则

1. **渐进式披露** —— 每个 `SKILL.md` 是 <500 行 quickstart，详细内容在 `references/` 按需读。永远跟 skill 自己的 SKILL.md 流程走，别自由发挥。

2. **传导链追溯（锚机制）** —— 每个产物用 ID 回指上游：`intent.md`(why) → `design.md`(决策) → `spec/ RXX`(规则) → `architecture.md`(结构+API+事件) → `plan.md` task(回指 RXX) → 代码 `@implements RXX` → `verify` 运行证据。这就是"设计锚定代码、不偏离用户"的字面实现。

3. **平台中立** —— 只用 skill + agent。纪律以两种可移植形式存活：(a) 每个 skill 的文字自检段；(b) skill 自带的可移植 bash 自检脚本（`scripts/`，如 `no-stub-check.sh`）。**不再有平台 hook 强制**。

4. **规模不降级** —— 深度重构后没有 S/M/L scale 降级，默认就做扎实设计（韧性 ≥6 维、兜底 ≥5 模式、wire 4 级审查等）。没有 `scale.md` 机器。

5. **工藤伦底线** —— 无存根、无假实现（无 InMemoryRepository、无硬编码 current_user）、不跳层、不假"完成"。"测试通过"≠"代码对"，看断言质量。4 试失败写 FAILURE-LOG 问用户。

## 常用命令

### 安装（通用，平台中立）

```bash
./install.sh                  # 自动探测 harness，软链 agents/+skills/ 到对应配置目录
TARGET_DIR=~/.claude ./install.sh   # 指定目标目录
# 不装 hooks/plugins/commands/settings —— 只有 agents/ + skills/
```

详见 `README.md § 快速开始`。

### 修改 framework 时

```bash
# 验证零平台耦合（核心约束）
grep -rIn 'xdd-gate\|hooks/xdd\|plugins/' agents/ skills/   # 期望 0（排除 archive）

# SKILL.md size discipline（<500 行）
wc -l skills/*/SKILL.md | sort -n -r | head

# 测 init（在 scratch 目录）
rm -rf /tmp/xdd-test && mkdir /tmp/xdd-test && cd /tmp/xdd-test
bash /home/zhaocj/ws/cjxdd/skills/xdd-init/scripts/init.sh --bizlines B01-auth,B02-order
find .xdd -type d   # 应见 design/{spec,architecture,wire} + plan/

# 端到端验证（起 demo 产品项目跑 walker，见下方"端到端测试"）
```

### 端到端测试 xdd 流程

在 `./demo/<project-slug>/` 起一个产品项目（`demo/` 在根 `.gitignore` 里被 ignore，跟 framework 解耦）：

```bash
DEMO=demo/<新项目>
mkdir -p $DEMO && cd $DEMO
./install.sh          # 或软链 agents/+skills/ 到 ~/.claude/
# 启动 Claude Code / OpenCode，对 AI 说："用 xdd-walker 给我做一个登录系统"
# 监督走完 understand → spec → architecture → wire → resilience → plan → execute → verify
cat .xdd/status.md    # 看各层状态
```

### Git workflow

默认分支 `main`。Conventional Commits（`refactor(walker): …` / `docs: …` / `fix(skills): …`）。**末尾必须**带：

```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

## § 设计规范指针（改 framework 时去哪儿看）

framework 的机制只写一次在源码里，下表只列位置，详细看对应文件（避免"两份真理"）：

| 主题 | 实施位置 |
|------|---------|
| **三层骨架** prompt→设计→代码 | `agents/xdd-walker.md` + `docs/WORKFLOW.md` |
| **意图锚** brainstorm+发散+design.md 收敛 | `skills/xdd-understand/SKILL.md` |
| **规则锚** RXX 规则编号 + Gherkin | `skills/xdd-spec/SKILL.md` |
| **结构锚** ADD+SDD+PDD+ODD + 端点/事件契约 + flow colocation | `skills/xdd-architecture/SKILL.md` |
| **前端锚** 三步法 + 6 操作态 + 攻击式 review + UX 4 级 | `skills/xdd-wire/SKILL.md` + `references/ux-review.md` |
| **韧性锚** RDA 8 维失败模式 + 10 兜底 + @chaos | `skills/xdd-resilience/SKILL.md` + `scripts/chaos-runner.sh` |
| **桥接** plan task 回指 RXX + 禁占位符 | `skills/xdd-plan/SKILL.md` |
| **代码层** TDD + Pre-write Signoff + 反 sham + `@implements RXX` | `skills/xdd-execute/SKILL.md` + `scripts/no-stub-check.sh` |
| **代码层验证** 禁偷懒归因 + 双契约 + 4 维一致性 + 漫游 | `skills/xdd-verify/SKILL.md` + `scripts/wander-test.sh` |
| **多 agent 编排** | `agents/xdd-orchestrator.md` |
| **逆向 + 追溯** | `skills/xdd-reverse/SKILL.md` |

## Where to start

- **理解框架**：读 `agents/xdd-walker.md`（顶部有 Meta 守卫），再 `docs/WORKFLOW.md`
- **理解单个 skill**：开 `skills/{name}/SKILL.md`，它就是执行脚本
- **创建新 skill**：用 `skills/xdd-skill-creator/SKILL.md`
- **逆向已有代码库（无 `.xdd/`）**：从 `xdd-reverse` 开始，不是 init
- **验证代码符合设计**：xdd-verify 的 4 维一致性审计（spec↔code / wire↔code / architecture↔code / resilience↔code）

## Changelog（最近重构）

- `4209b65` refactor(init): .xdd/ 简化（去 scale/schema/gate/iterations 子树/5-marker/halt.json）
- `420ba65` refactor(agents): 11→8 agent 重写（walker 合并 + 子agent 重映射三层、剥闸门）
- `56310cd` refactor(skills): 26→13 skill 重建完成（桥接+代码层+入口+工具）
- `532fd86` refactor(skills): 设计层 5 skill 重建（prompt→设计→代码 三层之「设计层」）
- `f7dfe5b` refactor(xdd): 删平台专属层（hooks/plugins/commands/settings/install×3）→ archive

详见 `git log --oneline`。
