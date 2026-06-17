# xdd — 让开发更高效的工具集

> **平台中立。** 靠一条工作流提效：`用户 prompt → 设计层（锚）→ 代码实现`。
> 工作流把用户的精简描述逐层扩展成可评审、可封存的契约，让代码不偏离用户。
> 只靠 **skill + agent**（所有 AI coding 平台都支持），无 hook / plugin / 平台针对性代码。

---

## ⚡ 快速开始（3 分钟）

### 1. 装（通用，平台中立）

```bash
./install.sh                       # 自动探测 harness，软链 agents/ + skills/
TARGET_DIR=~/.claude ./install.sh  # 或指定目标目录
```

**只软链 `agents/` + `skills/` 两个目录**（平台公约数）。不装 hooks/plugins/commands/settings —— 那些是平台专属的，已归档。

支持的平台：Claude Code（`~/.claude/`）/ OpenCode（`~/.config/opencode/`）/ pi（`~/.pi/`）/ Cursor / 任何支持 agent+skill 的工具。手动软链也行：

```bash
ln -s "$(pwd)/agents"  ~/.claude/agents
ln -s "$(pwd)/skills"  ~/.claude/skills
```

### 2. 启动

打开你的 AI coding 工具，对 AI 说：

> "用 xdd-walker 给我做一个登录系统"

或大项目用多 agent 编排：

> "用 xdd-orchestrator 给我做一个 XX 系统"

### 3. 走三层流程

```
[入口]   xdd-init            生成 .xdd/ 骨架
   ↓
[设计层] xdd-brainstorm      意图锚: intent.md + design.md
         xdd-spec            规则锚: RXX 规则 + Gherkin
         xdd-architecture    结构锚: 架构 + flow + 端点/事件契约 + 运维
         xdd-wire            前端锚: 页面线框（纯后端跳过）
         xdd-resilience      韧性锚: 失败模式 + 兜底 + 混沌
   ↓
[桥接]   xdd-plan            设计→TDD计划, task 回指 RXX
   ↓
[代码层] xdd-execute         写代码 @implements RXX（TDD，无存根）
         xdd-verify          真实验证（真能用 + 双契约 + 4维一致性）
```

**用户审查节点**：`design.md` 写完（understand 出口）停下给用户看，确认意图对齐才继续。

---

## 🎯 核心特性

| 特性 | 价值 |
|------|------|
| **提效导向** | 不是文档框架，是开发工具集；契约是产物，效率是目的 |
| **平台中立** | 只有 agents/ + skills/，任何支持 agent+skill 的 AI 工具原样可跑 |
| **设计层是锚** | 把精简描述扩展成可封存契约：intent→design→RXX→architecture→plan task→`@implements RXX`→verify 全链追溯，代码不偏离用户 |
| **工匠型 agent** | walker 自己读文件/写代码/跑命令，不是 dispatcher；大项目可派 phase 子 agent 并行 |
| **17 skill 工具箱** | 设计 5 + 桥接 1 + 代码 4 + 入口 1 + 工具 6，按需装卸，渐进式披露 |
| **反 sham 底线** | 无存根/无假实现/必须跑通有证据（no-stub-check.sh + 文字纪律）|
| **真实可用契约** | 真实持久化/认证/跨服务链路/重启数据保留/P0 证据 + 生产接受契约 |

---

## 📦 目录结构

```
cjxdd/                          # xdd framework 仓库自身
├── agents/                     # 8 个 agent（平台中立）
│   ├── xdd-walker.md           # 单工匠主入口（默认，中小项目）
│   ├── xdd-orchestrator.md     # 多 agent 编排主调度（大项目用）
│   └── phase-{brainstorm,design,resilience,plan,build,verify}.md  # 6 子 agent 映射三层
├── skills/                     # 17 个 skill（设计5 + 桥接1 + 代码4 + 入口1 + 工具6）
│   ├── xdd-init/               # 入口：生成 .xdd/ 骨架
│   ├── xdd-brainstorm/         # 设计·意图锚（intent.md + design.md）
│   ├── xdd-spec/               # 设计·规则锚（RXX + Gherkin）
│   ├── xdd-architecture/       # 设计·结构锚（架构+flow+端点+事件+运维+模式决策库）
│   ├── xdd-wire/               # 设计·前端锚（页面线框，纯后端跳过）
│   ├── xdd-resilience/         # 设计·韧性锚（失败模式+兜底+混沌）
│   ├── xdd-plan/               # 桥接：设计→TDD计划，task 回指 RXX
│   ├── xdd-execute/            # 代码·实现（TDD，@implements RXX，无存根）
│   ├── xdd-verify/             # 代码·验证（真能用+双契约+4维一致性）
│   ├── xdd-reverse/            # 工具：逆向已有代码反推设计 + 追溯
│   ├── xdd-mermaid-check/      # 工具：图表渲染验证
│   ├── xdd-docker-helper/      # 工具：中国区 Docker 镜像
│   ├── xdd-skill-creator/      # 工具：创建/编辑 skill
│   └── xdd-git-commit/         # 工具：Conventional Commits 规范提交
├── docs/                       # 用户文档
├── archive/                    # 归档：agents/skills/docs/shadow/platform-2026-06 + 旧 xdd-add（已并入 arch）
├── framework-conventions.md    # framework 维护习惯
├── install.sh                  # 通用安装（软链 agents/+skills/ 到 harness 配置目录）
├── AGENTS.md                   # AI agent 项目指引（agents.md 约定，平台中立）
├── CLAUDE.md                   # → AGENTS.md 的软链（Claude Code 读这个文件名）
└── README.md
```

**每个 skill 内部**：`SKILL.md`（<500 行 quickstart）+ `references/`（按需深读）+ `templates/`（输出模板，部分有）+ `scripts/`（可移植 bash 自检，部分有）。

### 17 skill

| 层 | skill | 锚定什么 | 产出 |
|----|-------|---------|------|
| 入口 | `xdd-init` | — | `.xdd/` 骨架（三层：项目层/业务线层 BXX/迭代层）|
| 设计 | `xdd-brainstorm` | 意图 | `design/intent.md` + `design.md`（项目层总意图）|
| 设计 | `xdd-spec` | 规则 RXX | `design/spec/{bxx-slug}/` rules.md + *.feature |
| 设计 | `xdd-architecture` | 结构 | `design/architecture/{bxx-slug}/` architecture.md + flow.mermaid |
| 设计 | `xdd-wire` | 前端 | `design/wire/{page}/` 6 操作态 |
| 设计 | `xdd-resilience` | 韧性 | `architecture/{bxx-slug}/resilience/` 5 文档 |
| 桥接 | `xdd-plan` | 设计→计划 | `runs/iter-N/plan/{bxx-slug}/plan.md`（task 回指 RXX）|
| 代码 | `xdd-execute` | 实现（通用 TDD） | 代码 `@implements RXX` + 测试，按 Stack 派发专项 |
| 代码 | `xdd-backend` | 后端实现锚 | 加载 backend.rules + 后端检查（DB/端点/事件/事务） |
| 代码 | `xdd-frontend` | 前端实现锚 | 加载 frontend.rules + 前端检查（对照 wire 6 态/600行） |
| 代码 | `xdd-verify` | 验证 | 验证报告（双契约 + 4 维一致性）|
| 工具 | `xdd-reverse` | 逆向 | 反推 design/ + @implements 追溯 |
| 工具 | `xdd-mermaid-check` | 图表 | flow.mermaid 渲染验证 |
| 工具 | `xdd-docker-helper` | 容器 | 中国区镜像源 |
| 工具 | `xdd-skill-creator` | 元工具 | 创建/编辑 skill |
| 工具 | `xdd-gherkin-plus` | Gherkin 语法锚 | 被引用（无产出文件）|
| 工具 | `xdd-git-commit` | 提交 | Conventional Commits message + `git commit` |

---

## 🧭 关键设计原则

1. **渐进式披露** —— 每个 `SKILL.md` 是 <500 行 quickstart，详细内容在 `references/` 按需读。永远跟 skill 自己的 SKILL.md 流程走，别自由发挥。

2. **传导链追溯（锚机制）** —— 每个产物用 ID 回指上游：`intent.md`(why) → `design.md`(决策) → `spec/ RXX`(规则) → `architecture.md`(结构+API+事件) → `plan.md` task(回指 RXX) → 代码 `@implements RXX` → `verify` 运行证据。这就是"设计锚定代码、不偏离用户"的字面实现。

3. **平台中立** —— 只用 skill + agent。纪律以两种可移植形式存活：(a) 每个 skill 的文字自检段；(b) skill 自带的可移植 bash 自检脚本（`scripts/`，如 `no-stub-check.sh`）。**不再有平台 hook 强制**。

4. **默认扎实设计** —— 不做 S/M/L scale 降级，默认就做完整设计（韧性 ≥6 维、兜底 ≥5 模式、wire 4 级审查等）。架构层按质量属性场景选模式，不默认套分层（见 `skills/xdd-architecture/references/architecture-patterns.md`）。

5. **工藤伦底线** —— 无存根、无假实现（无 InMemoryRepository、无硬编码 current_user）、不跳层、不假"完成"。"测试通过"≠"代码对"，看断言质量。4 试失败写 FAILURE-LOG 问用户。

---

## 🔧 设计规范指针（改 framework 时去哪儿看）

framework 的机制只写一次在源码里，下表只列位置，详细看对应文件（避免"两份真理"）：

| 主题 | 实施位置 |
|------|---------|
| **三层骨架** prompt→设计→代码 | `agents/xdd-walker.md` + `docs/WORKFLOW.md` |
| **意图锚** brainstorm+发散+通用语言(DDD 起点)+design.md 收敛 | `skills/xdd-brainstorm/SKILL.md` |
| **规则锚** RXX 规则编号 + Gherkin + 业务线=限界上下文(子域分类) | `skills/xdd-spec/SKILL.md` |
| **结构锚** ADD+SDD+PDD+ODD + 端点/事件契约 + flow colocation + 模式决策库 | `skills/xdd-architecture/SKILL.md` + `references/architecture-patterns.md` |
| **DDD 方法论** 通用语言 + 限界上下文 + 聚合划分（三层联动：understand→spec→architecture） | `skills/xdd-architecture/references/ddd.md` |
| **前端锚** 三步法 + 6 操作态 + 攻击式 review + UX 4 级 | `skills/xdd-wire/SKILL.md` + `references/ux-review.md` |
| **韧性锚** RDA 8 维失败模式 + 10 兜底 + @chaos | `skills/xdd-resilience/SKILL.md` + `scripts/chaos-runner.sh` |
| **桥接** plan task 回指 RXX + 禁占位符 | `skills/xdd-plan/SKILL.md` |
| **代码层** TDD + Pre-write Signoff + 反 sham + `@implements RXX` | `skills/xdd-execute/SKILL.md` + `scripts/no-stub-check.sh` |
| **代码层验证** 禁偷懒归因 + 双契约 + 4 维一致性 + 漫游 | `skills/xdd-verify/SKILL.md` + `scripts/wander-test.sh` |
| **多 agent 编排** | `agents/xdd-orchestrator.md` |
| **逆向 + 追溯** | `skills/xdd-reverse/SKILL.md` |

---

## 📖 文档导航

| 想了解... | 看 |
|----------|---|
| 框架哲学 / 三层骨架 | 本文件（§ 核心特性 + § 关键设计原则）|
| 在本仓库开发的流程指引（Meta 守卫 / 常用命令 / Git workflow） | `CLAUDE.md` |
| 三层工作流详解 | `docs/WORKFLOW.md` |
| 流程总览图 | `docs/xdd/flow.mermaid` |
| 多 agent 编排 | `agents/xdd-orchestrator.md` |
| 多业务线（BXX）模型 | `docs/BXX.md` |
| Walker 5 步节奏 + Meta 守卫 | `agents/xdd-walker.md` |
| 单个 skill 怎么用 | `skills/{name}/SKILL.md` |
| 改 framework 时去哪查机制 | 本文件 § 设计规范指针 |

---

## 🤝 贡献（修改 framework 自身）

这是 Meta 任务（改 framework，不是用 framework 做产品）：

1. **不要加载 walker/orchestrator**，直接 Read/Edit 改 `agents/` / `skills/` 源码
2. 改完验证：`grep -rIn 'xdd-gate\|hooks/xdd\|plugins/' agents/ skills/` 期望 0（排除 archive）；`wc -l skills/*/SKILL.md` 全 <500
3. **直接 commit** —— Conventional Commits，末尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

想"用 framework 验证 framework"：在 `./demo/<project>/` 起产品项目，cd 后跑 walker，跟 framework 解耦。

详见 `CLAUDE.md § Meta`。

---

## 📜 为什么砍掉 hook + plugin（重构说明）

重构前有 `hooks/`（19 文件 3255 行）+ `plugins/`（3 文件 4033 行）+ commands/settings/3 install 脚本，共 ~7300 行"强制机器"。砍掉理由：

- **不可移植**：Claude Code 的 hook 事件 vs OpenCode 的 plugin SDK 是两套完全不同的 API，要支持第三个平台就得再写一套
- **没真起作用**：实证（审计记录）7000 行闸门产出的 reviewer 是 sham —— spec↔code 脱节、L6 没跑

砍掉后纪律以可移植形式存活：每个 skill 的文字自检段 + skill 自带的可移植 bash 自检脚本（`no-stub-check.sh` / `wander-test.sh` / `chaos-runner.sh`）。旧平台代码归档在 `archive/platform-2026-06/`，需要参考闸门逻辑实现时可读源码移植。
