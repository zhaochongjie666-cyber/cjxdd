# Shadow — 带工具箱的工匠型开发体系

基于 OpenCode Agent + Skill 的全链路软件开发体系。一个 Agent（Shadow Walker）带一套工具箱（12 个核心 Skill），从调研到部署一个人把项目做到能交付。

## 架构

```text
Agent: shadow-walker（工匠，不是调度员）
  ↓ 按需加载 skill
Skills: 12 个核心工具 + 8 个小工具
  ↓ 产出到 .shadow/ 目录
产出: intent.md → flow → spec → wire → architecture → harness-plan → code → deploy
```

### 流水线

```text
L0 发散调研      ── shadow-l0-research
L1 业务层        ── shadow-l1-research → flow → spec → wire（串行）
规模判定          ── .shadow/scale.md（S/M/L）
L1.5 架构        ── shadow-l1p5-architecture
搭脚手架          ── shadow-scaffold
L2 验收场景      ── shadow-l2-e2e
L5 执行计划      ── shadow-l5-plan
L5 代码实现      ── shadow-l5-impl（按 Batch 串行）
全链路审查        ── shadow-reviewer（必经）
L6 部署验证      ── shadow-l6-deploy
```

## 目录结构

```text
agents/
  shadow-walker.md          # 工匠型 Agent

skills/
  shadow-l0-research/       # L0 发散笔记本（112 行）
  shadow-l1-research/       # L1 DDD+EDD+IDDD 业务调研（468 行）
  shadow-l1-flow/           # L1 MDD 流程总图（367 行）
  shadow-l1-spec/           # L1 FDD 业务规格（271 行）
  shadow-l1-wire/           # L1 SVG 线框图（486 行）
  shadow-l1p5-architecture/ # L1.5 ADD 架构设计（357 行）
  shadow-scaffold/          # 项目脚手架（255 行）
  shadow-l2-e2e/            # L2 BDD 验收场景（250 行）
  shadow-l5-plan/           # L5 Harness 精密执行计划（393 行）
  shadow-l5-impl/           # L5 代码实现（159 行）
  shadow-l6-deploy/         # L6 部署验证（247 行）
  shadow-reviewer/          # 全链路审查（222 行）
  skill-creator/            # Skill 创建标准（494 行）
  shadow-reverse/           # 逆向已有系统
  shadow-taste/             # 品味检查
  shadow-trace-init/        # 追溯初始化
  mermaid-check/            # Mermaid 渲染验证
  docker-helper/            # Docker 问题排查
  test-in-tmux/             # 测试运行

  # 每个 skill 目录结构：
  skill-name/
    SKILL.md                # 快速入门（< 500 行）
    references/             # 详细指南（按需读取）
    templates/              # 模板文件（部分 skill 有）
    scripts/                # Gate 检查脚本（部分 skill 有）

.claude/                    # Claude Code 兼容层（项目级）
  settings.json             #   hook 配置（CWD 在本项目时自动加载）
  hooks/
    lib.sh                  #   共用工具函数
    user-prompt-submit.sh   #   UserPromptSubmit hook
    session-start.sh        #   SessionStart hook
    pre-skill.sh            #   PreToolUse(Skill) hook
    post-write-stub-scan.sh #   PostToolUse(Write|Edit) hook
    stop-gate.sh            #   Stop hook

install-to-opencode.sh      # 装到 ~/.config/opencode/
install-to-claude-code.sh   # 装到 ~/.claude/，含 hooks 软链
```

## 设计原则

### 渐进式披露

每个 Skill 的 SKILL.md 是快速入门（< 500 行），详细内容在 `references/` 里按需读取。Walker 不会一次读完所有材料，而是跟着 SKILL.md 的流程走，遇到需要深入了解的环节才读对应的 reference。

### 传导链追溯

```text
intent.md（为什么做）
  → research.md（业务领域）
    → project.flow.mermaid（BXX-NYY 节点编号）
      → spec.md（RXX 规则编号）
        → architecture.md（API 端点清单）
          → harness-plan.md（逐方法实现指令 + 测试断言）
            → 代码（@implements 标注节点和规则编号）
```

每条规则、每个 API 端点、每行代码都能追溯到业务意图。

### 全局约束（L5 Harness）

多租户隔离、认证授权、统一错误格式、事件发布、分页、事务边界等横切关注点在 Harness 计划中作为"全局约束"段定义，所有文件统一遵守。

## 快速开始

### OpenCode

1. 运行 `./install-to-opencode.sh`，把 agents/skills 软链到 `~/.config/opencode/`
2. 在 OpenCode 中加载 `shadow-walker` agent
3. 告诉 walker 你要做什么：*"给我做一个 XX 系统"*
4. Walker 自动走完 L0→L6 全流程
5. 交付物在 `.shadow/` 目录 + 项目代码中

### Claude Code

1. 运行 `./install-to-claude-code.sh`，把 agents 软链到 `~/.claude/agents/`、skills 软链到 `~/.claude/skills/`、hooks 软链到 `~/.claude/hooks/`、`settings.json` 软链到 `~/.claude/settings.json`（用户的旧 `settings.json` 会备份成 `settings.json.bak`）
2. 在 Claude Code 中对 Claude 说：*"使用 shadow-walker subagent 给我做一个 XX 系统"*
3. Walker 按需 `Skill` 加载工具，逐阶段推进到交付
4. 工具名按 Claude Code 规范（`Read` / `Write` / `Bash` / `Glob` / `Grep` / `Skill` / `Task` / `WebFetch` / `WebSearch`），详见 walker frontmatter 的 `tools` 字段
5. 两个安装脚本互不影响，可同时使用：OpenCode 用户用 `install-to-opencode.sh`，Claude Code 用户用 `install-to-claude-code.sh`

#### 自动门禁（Hooks）

仓库根的 `settings.json` 声明了 5 个 hook，由 `install-to-claude-code.sh` 软链到 `~/.claude/settings.json`，在 CWD 位于本项目时由 Claude Code 自动加载。所有 hook 脚本在仓库根的 `hooks/`（跟 `agents/`、`skills/` 平级），**通过软链同步到 `~/.claude/hooks/`，单一源真理**：

| Hook | 触发时机 | 行为 |
|------|---------|------|
| `user-prompt-submit.sh` | UserPromptSubmit | 关键词检测"做一个 XX 系统" / "build me X" / "from scratch"等意图；命中时提示 Claude 加载 shadow-walker subagent（已有 `.shadow/` 则提醒继续走 pipeline） |
| `session-start.sh` | SessionStart | 探测项目根，输出当前 iter、status.md 阶段汇总、**BXX 业务线维度分布**、CONTEXT-MAP 摘要 |
| `pre-skill.sh` | PreToolUse (Skill) | 装任何 skill 前打印 5 步节奏提醒；若 status.md 仍有更早的 ⏳ 阶段，**硬阻断**（exit 2） |
| `post-write-stub-scan.sh` | PostToolUse (Write\|Edit) | **每次**写完代码实时扫存根（pass / TODO / NotImplementedError / InMemoryRepository），只扫刚写的文件，命中即时告警（让模型在同 turn 自纠） |
| `stop-gate.sh` | Stop | 扫源码里的存根模式（兜底，PostToolUse 已扫过的文件会重复但仍可能发现遗漏）；**按 BXX 列出** status.md 还有哪些 ⏳/🔄 阶段未完 |

工具脚本在仓库根的 `hooks/`：

```
(项目根)
  settings.json         # hook 配置（被 install 脚本软链到 ~/.claude/settings.json）
  hooks/
    lib.sh              # 共用：find_project_root / get_shadow_dir / read_bxx_breakdown / scan_stub_in_file 等
    user-prompt-submit.sh
    session-start.sh
    pre-skill.sh
    post-write-stub-scan.sh
    stop-gate.sh
```

**实时 vs 批量扫存根**：

| 维度 | `post-write-stub-scan.sh` (PostToolUse) | `stop-gate.sh` (Stop) |
|------|---------------------------------------|---------------------|
| 时机 | 每次 Write/Edit 之后 | 会话结束 |
| 范围 | 只扫刚写的文件 | 全项目 src/ |
| 反馈 | 同 turn 内告警，模型可自纠 | 一次性补刀，已晚 |
| 性能 | 轻（grep 单文件，<50ms） | 较重（grep -r 整个项目） |
| 兜底 | — | ✓（PostToolUse 漏网的全项目复扫） |

**BXX 业务线维度**：status.md 按 Walker 规范使用 `## BXX 业务线名` 分节时，session-start 和 stop-gate 自动按业务线分组输出，未完阶段按 BXX 归类显示（不会把所有 BXX 的待办混成一锅）。多业务线项目推荐遵循 Walker 的 status.md 格式：

```markdown
# Pipeline Status — iter-1

## B01 用户管理

| 阶段 | 状态 | 产出 | 自检 |
|------|------|------|------|
| L0 | ✅ | ... | — |
| L1 Research | 🔄 | ... | — |
...

## B02 订单管理

| 阶段 | 状态 | 产出 | 自检 |
|------|------|------|------|
| L0 | ✅ | ... | — |
| L1 Research | ⏳ | — | — |
...
```

**调试 hook**：

```bash
# 在项目根外（无 .shadow/）：应该输出 "No .shadow/ found"
cd /tmp && bash $HOME/.claude/hooks/session-start.sh

# 模拟 Skill 调用，看阻断逻辑
echo '{"tool_name":"Skill","tool_input":{"skill":"shadow-l6-deploy"}}' \
  | bash $HOME/.claude/hooks/pre-skill.sh
```
