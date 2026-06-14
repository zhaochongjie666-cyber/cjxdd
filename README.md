# xdd — 工匠型开发体系

> **平台中立的 AI 驱动软件开发框架。** 本质：`用户 prompt → 设计层（锚）→ 代码实现`。
> 设计层把用户意图固化，让代码不偏离用户。只靠 **skill + agent**（所有 AI coding 平台都支持），无 hook / plugin / 平台针对性代码。

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
[设计层] xdd-understand      意图锚: intent.md + design.md
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
| **平台中立** | 只有 agents/ + skills/，任何支持 agent+skill 的 AI 工具原样可跑 |
| **设计层是锚** | intent→design→RXX→architecture→plan task→`@implements RXX`→verify 全链追溯，代码不偏离用户 |
| **工匠型 agent** | walker 自己读文件/写代码/跑命令，不是 dispatcher；大项目可派 phase 子 agent 并行 |
| **13 skill 工具箱** | 设计 5 + 桥接 1 + 代码 2 + 入口 1 + 工具 4，按需装卸，渐进式披露 |
| **反 sham 底线** | 无存根/无假实现/必须跑通有证据（no-stub-check.sh + 文字纪律）|
| **真实可用契约** | 真实持久化/认证/跨服务链路/重启数据保留/P0 证据 + 生产接受契约 |

---

## 📦 目录结构

```
cjxdd/
├── agents/        # 8 agent: xdd-walker + xdd-orchestrator + 6 phase 子agent
├── skills/        # 13 skill (见下表)
├── docs/          # 用户文档 (WORKFLOW / BXX / 实战记录)
├── archive/       # 归档: platform-2026-06 (旧 hook+plugin) + skills-2026-06 + agents-2026-06
├── framework-conventions.md   # framework 维护习惯
├── install.sh     # 通用安装
├── CLAUDE.md      # Claude Code 项目入口
└── README.md
```

### 13 skill

| 层 | skill | 锚定什么 | 产出 |
|----|-------|---------|------|
| 入口 | `xdd-init` | — | `.xdd/` 骨架 |
| 设计 | `xdd-understand` | 意图 | `design/intent.md` + `design.md` |
| 设计 | `xdd-spec` | 规则 RXX | `design/spec/{slug}/` rules.md + *.feature |
| 设计 | `xdd-architecture` | 结构 | `design/architecture/{slug}/` architecture.md + flow.mermaid |
| 设计 | `xdd-wire` | 前端 | `design/wire/{page}/` 6 操作态 |
| 设计 | `xdd-resilience` | 韧性 | `architecture/{slug}/resilience/` 5 文档 |
| 桥接 | `xdd-plan` | 设计→计划 | `plan/{slug}/plan.md`（task 回指 RXX）|
| 代码 | `xdd-execute` | 实现 | 代码 `@implements RXX` + 测试 |
| 代码 | `xdd-verify` | 验证 | 验证报告（双契约 + 4 维一致性）|
| 工具 | `xdd-reverse` | 逆向 | 反推 design/ + @implements 追溯 |
| 工具 | `xdd-mermaid-check` | 图表 | flow.mermaid 渲染验证 |
| 工具 | `xdd-docker-helper` | 容器 | 中国区镜像源 |
| 工具 | `xdd-skill-creator` | 元工具 | 创建/编辑 skill |

---

## 📖 文档导航

| 想了解... | 看 |
|----------|---|
| 框架哲学 / 三层骨架 | 本文件 + `CLAUDE.md` |
| 三层工作流详解 | `docs/WORKFLOW.md` |
| 多 agent 编排 | `agents/xdd-orchestrator.md` |
| 多业务线（BXX）模型 | `docs/BXX.md` |
| Walker 5 步节奏 + Meta 守卫 | `agents/xdd-walker.md` |
| 单个 skill 怎么用 | `skills/{name}/SKILL.md` |
| 架构图 | `docs/architecture.mmd` |

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
