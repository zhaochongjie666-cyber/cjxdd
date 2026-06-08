# xdd — 工匠型开发体系

> **AI 驱动的工匠型软件开发框架** —— 1 个 walker agent + 23 个 skill + 严苛 6 Phase 流水线 + 11 个自动化 gate.
>
> **前身**: Shadow Framework. 已合并 (xdd = 唯一命名, shadow 已归档到 `archive/shadow-2026-06/`, 90 天后删除).

---

## ⚡ 快速开始 (3 分钟)

### 1. 选你的 harness, 装到本地

```bash
# OpenCode 用户
./install-to-opencode.sh

# Claude Code 用户
./install-to-claude-code.sh

# pi 用户
./install-to-pi.sh
# 或自定义路径
PI_DIR=~/.config/pi ./install-to-pi.sh
```

**装什么** (软链, 修改自动同步):
- `agents/` → `~/.claude/agents/` 等
- `skills/` → `~/.claude/skills/` 等
- `hooks/` → `~/.claude/hooks/` 等 (含 11 个 xdd-gate-*.sh)
- `plugins/` → `~/.config/opencode/plugins/` (仅 OpenCode)
- `commands/` → `~/.claude/commands/` (含 /xdd-goal 等 slash command)
- `settings.json` → `~/.claude/settings.json` (钩子配置)

### 2. 启动

打开 Claude Code / OpenCode, 对 AI 说:

> "使用 xdd-walker subagent 给我做一个登录系统"

或加载 walker 自己做:

> "加载 xdd-walker subagent, 帮我从用户需求走到生产部署"

### 3. 走 6 Phase 流水线

```
Phase 0 INIT          xdd-init (按需) — 准备 .xdd/ 骨架
Phase 1 RESEARCH      xdd-l0 — 发散调研 (v2: brainstorm + 5 方向)
Phase 2 DESIGN        xdd-bdd / flow / add / wire / arch — 5 个工件
Phase 2.5 BDD          (含在 Phase 2, 含 Gherkin 业务约束)
Phase 2.7 SCAFFOLD    xdd-scaffold — 7 步 Docker 开发环境
Phase 3 REVIEW        用户审查 + 显式确认
Phase 4 PLAN          xdd-plan — 写 TDD 执行计划
Phase 5 EXECUTE       xdd-execute — 按 Batch 串行实现
Phase 6 VERIFY        xdd-l6 — 部署 + 真实验证 (含 L3 chaos)
```

---

## 🎯 核心特性

| 特性 | 价值 |
|------|------|
| **工匠型 agent** | 1 个 walker 自己读文件 / 写代码 / 跑命令, 不是 dispatcher |
| **23 个 skill 工具箱** | 14 核心流水线 + 9 utility, 按需装卸 |
| **6 Phase 流水线** | INIT → RESEARCH → DESIGN → SCAFFOLD → REVIEW → PLAN → EXECUTE → VERIFY |
| **11 个自动化 gate** | xdd-gate-{meta,0-6,pre-skill,stub-scan,session-start,stop,user-prompt-submit,team-dispatch,pressure} |
| **strict-default L 级** | scale.md 字段控制下游, 默认 L + 扩展模式 |
| **No-advisory 严苛** | 5 段 hard-gate, 3 试未修升级 HALT |
| **3 harness 适配** | Claude Code / OpenCode / pi 3 个, 1 套 source |
| **真实可用契约** | 真实持久化 / 真实账号 / 跨服务链路 / R11 4 层验证 |

---

## 📦 目录结构

```
cjxdd/                          # xdd framework 仓库自身
├── agents/                     # 工匠型 agent
│   ├── xdd-walker.md           # 主入口 (CC/OC 通用, ~500 行)
│   └── xdd-walker-pi.md        # pi 协议变体 (~310 行)
├── skills/                     # 23 个 skill
│   ├── xdd-core/               # 用户意图 (不可删)
│   ├── xdd-init/               # Phase 0 INIT
│   ├── xdd-l0/                 # Phase 1 发散
│   ├── xdd-bdd/                # Phase 2.5 BDD
│   ├── xdd-flow/               # Phase 2 Flow
│   ├── xdd-add/                # Phase 2 ADD
│   ├── xdd-wire/               # Phase 2 Wire
│   ├── xdd-arch/               # Phase 2.5 Architecture
│   ├── xdd-scaffold/           # Phase 2.7 Scaffold
│   ├── xdd-l3/                 # Phase 3 L3 韧性
│   ├── xdd-plan/               # Phase 4 Plan
│   ├── xdd-execute/            # Phase 5 Execute
│   ├── xdd-l6/                 # Phase 6 Verify
│   ├── xdd-artifact-lifecycle/ # 元 skill
│   └── (9 utility: xdd-taste / xdd-mermaid-check / xdd-docker-helper / etc.)
├── hooks/                      # 11 个 xdd-gate-*.sh
│   ├── xdd-gate-lib.sh         # 共享 lib (832 行)
│   ├── xdd-gate-session-start.sh
│   ├── xdd-gate-user-prompt-submit.sh
│   ├── xdd-gate-pre-skill.sh
│   ├── xdd-gate-stub-scan.sh
│   ├── xdd-gate-stop.sh
│   ├── xdd-gate-team-dispatch.sh
│   ├── xdd-gate-meta.sh
│   ├── xdd-gate-pressure.sh
│   └── xdd-gate-{0-init,1-research,2-design,3-review,4-plan,5-execute,6-verify}.sh
├── plugins/                    # OpenCode 端 3 个 plugin
│   ├── xdd-gates.ts            # 3000+ 行 (合并 shadow-hooks + back-cover)
│   ├── xdd-cover.ts           # ~230 行 (防伪完成硬锁)
│   └── xdd-goal.tsx            # ~430 行 (TUI plugin)
├── commands/                   # Claude Code slash command
│   ├── xdd-goal.md             # /xdd-goal {目标}
│   ├── xdd-status.md           # /xdd-status (打印当前 Phase)
│   └── xdd-halt.md             # /xdd-halt (触发 3 试 HALT)
├── prompts/
│   ├── xdd_full.md             # 6 Phase 完整 prompt
│   └── xdd-team-loop.md
├── docs/                       # 用户文档
│   ├── WORKFLOW.md             # 6 Phase 工作流总览
│   ├── architecture.mmd        # Mermaid 架构图
│   ├── SCALE.md                # scale.md 字段说明
│   ├── BXX.md                  # 多业务线模型
│   ├── GATES.md                # 11 gate 编排器
│   └── xdd/
│       └── PLAN-TEMPLATE.md    # 实施计划模板
├── framework-conventions.md    # framework 自身操作习惯
├── settings.json               # Claude Code 钩子配置
├── CLAUDE.md                   # Claude Code 项目级入口
├── install-to-{claude-code,opencode,pi}.sh
└── archive/
    └── shadow-2026-06/         # 旧 shadow 体系归档 (90 天后删除)
```

---

## 📖 文档导航

| 想了解... | 看 |
|----------|-----|
| 框架整体定位 / 哲学 | `CLAUDE.md` § 0 |
| 6 Phase 流水线 | `docs/WORKFLOW.md` |
| 4 类核心抽象 (业务/架构/验收/韧性) | `docs/WORKFLOW.md` § 3 |
| Walker 5 步节奏 + Meta 守卫 | `agents/xdd-walker.md` |
| 7 类 ID 全链追溯 | `docs/WORKFLOW.md` § 5 |
| Iter 模型 | `docs/WORKFLOW.md` § 6 |
| Scale 模型 + strict-default | `docs/SCALE.md` |
| 多业务线 (BXX) | `docs/BXX.md` |
| 11 gate 编排器 | `docs/GATES.md` |
| 钩子 vs 插件 (CC vs OpenCode) | `docs/WORKFLOW.md` § 10 |
| Meta 项目边界 | `framework-conventions.md` § 7 |
| 已知限制 + 待办 | `docs/WORKFLOW.md` § 12 |

---

## 🛠️ 自动门禁 (Hooks)

11 个 xdd-gate-*.sh 钩子 + 3 个 OpenCode 插件, 实施 5 类门禁:

| 类别 | 抓什么 | 力度 |
|------|--------|------|
| **存根扫描** (stub scan) | `pass` / `TODO` / `NotImplementedError` / `InMemoryRepository` | 软 → 硬 (Phase 6 升级) |
| **设计基线改动传播** | 设计基线 mtime 异常 | 软警告 |
| **漂移检测** | 5 角色 lifecycle 一致, 路径不在 schema | **R5 hard** |
| **L0 重做门禁** | per-iter 14 天 mtime | Round 1 软 → Round 2 硬 |
| **L5 Consistency Audit** | 4 维 (spec↔code / wire↔code / arch↔code / l3↔code) ≥ 0.9 | **hard** |
| **3 试 HALT** | 连续 3 轮未修 P1 | **hard** + 升级 HALT |
| **bypass 显式化** | `# bypass-shdw: <reason>` 注释 | audit log |
| **zh-continue schema 修** | 模糊词误触 OpenCode 拒收 | **hard (fix)** |
| **5 段压力信号** | RUSH/TIME/SKIP/SIMPLIFY/WORKLOAD | 软提醒 |
| **API error 兜底** | 6 类分类 + toast 恢复指引 | warning/error |
| **R11 真实烟雾测试** | 4 层验证 (marker / 解析 / 测试 / hash) | **新项目 hard** / 老 advisory |

详见 `docs/GATES.md`.

---

## 🔌 自动化护栏 (Hooks / Plugins)

### 6 个 CC 端 hook 1:1 对齐 OpenCode 3 个 plugin

| 事件 | Claude Code | OpenCode |
|------|------------|----------|
| `SessionStart` | `xdd-gate-session-start.sh` | `experimental.chat.system.transform` |
| `UserPromptSubmit` | `xdd-gate-user-prompt-submit.sh` | `chat.message` |
| `PreToolUse(Skill)` | `xdd-gate-pre-skill.sh` | `tool.execute.before` (Skill) |
| `PreToolUse(Task)` | `xdd-gate-team-dispatch.sh` | 同上 (Task 也匹配) |
| `PostToolUse(Write\|Edit)` | `xdd-gate-stub-scan.sh` | `tool.execute.after` |
| `Stop` | `xdd-gate-stop.sh` | `event(message.updated finish=stop)` |

**Toast 通道** (OpenCode 独有): `client.tui.showToast({variant, title, message, duration})` 弹右上角通知, 4 variant (info/success/warning/error), 1500ms 去重.

### `/xdd-goal` 自驱循环 (OpenCode + Claude Code)

- **OpenCode**: `plugins/xdd-goal.tsx` (TUI plugin) 注册 `/xdd-goal` slash command. v3 修复: 整段文本全收 (PREFIX_RE `[\s\S]+` 跨行) + user-driven continue. 4 条收尾路径: `/xdd-goal done` / 隐式短答 (≤15 chars) / `/xdd-goal stop` / 10 轮 cap.
- **Claude Code**: `commands/xdd-goal.md` (slash command) — 简化, 手动 `/xdd-goal done` 触发 final.md.

---

## 🚀 端到端流程 (示例: 登录功能)

### Phase 0: INIT
- 跑 xdd-init → 生成 `.xdd/scale.md` (strict_mode=true) + status.md + iter-1/
- 写 `.xdd/core/intent.md` (业务目标 / 关键问题 / 范围)

### Phase 1: RESEARCH
- 调 xdd-l0 → 9 份发散笔记本
- scale ≥ M 触发; bxx_enabled 决定 BXX 业务线划分

### Phase 2: DESIGN
- 2.1 BDD: 6+ Scenario (密码登录 / 密码错误 / 账号锁定 / 记住我 / 短信 / OAuth)
- 2.2 Flow: AuthService + POST /api/auth/login + bcrypt + JWT
- 2.3 ADD: 状态机 + 启动/关闭序列 + 排障清单
  - **L3 韧性段** (强制): 9 维失败模式 + 12 模式 + FMEA 8 字段
- 2.4 BDD: Design-Conformance Gherkin 业务约束翻译
- 2.5 Arch: API 8 端点 + ADR + 事件契约
- 2.7 Scaffold: 7 步 Docker

### Phase 3: REVIEW
- `git diff .xdd/` 给用户看
- 用户确认 → 进 Plan

### Phase 4: PLAN
- 12+ Task 按 BDD Scenario 1:1 拆
- 依赖关系 DAG, BDD 覆盖追踪表
- plan-iter-check (v5.1, 防过期 plan)

### Phase 5: EXECUTE
- Pre-write Signoff (v5.2, 写前 sign-off block)
- 阻塞上报 → 回 Phase 2 补 BDD

### Phase 6: VERIFY
- 全量测试 PASS
- 4 维 L5 一致性审计
- L6 子阶段: health-check + wander-test + chaos-drill + R11
- `final.md` 收尾

---

## 🤝 贡献指南

修改 framework 自身时 (这是 Meta 任务):

1. **不要加载 walker**, 直接 Read/Edit 改源码
2. 改完跑对应 smoke
3. **直接 commit** — Conventional Commits, 末尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

想"用 framework 验证 framework":
- 仓库外另起产品项目 (e.g. `/tmp/test-product/`)
- 在那里 `cd` 后 `claude` + 调 walker, 走完整 6 Phase
- 跟 framework 解耦

详见 `CLAUDE.md` § ⚠️ Meta: 你正在修改 xdd 自身, 禁用 xdd 流程.

---

## 📜 已知限制 + 未来工作

详见 `docs/WORKFLOW.md` § 12.

---

**xdd 是单一框架**. 没有 shadow 体系, 没有兼容性路径. 旧 shadow 体系 (2026-06-08 前) 已归档到 `archive/shadow-2026-06/`, 90 天后 (2026-09-08) 删除.
