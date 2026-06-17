# AGENTS.md

> 本文件遵循 [agents.md](https://agents.md) 约定，给**所有** AI coding agent（Claude Code / OpenCode / Cursor / Codex 等）读。
> `CLAUDE.md` 是本文件的软链接 —— 单一真理源，避免两份。
>
> 这不是"编辑规则清单"。这是动手前**先想清楚要干啥**的认知协议。
> 项目说明（工具集是什么、目录、skill 清单、设计原则）见 [`README.md`](./README.md)。本文件只讲：**怎么定位自己、减少与用户的认知偏差**。

---

## 🧭 定位：先想清楚两点（别混）

1. **这个仓库 = 一个工作流的仓库。**
   主题：`用户 prompt → 设计层（锚）→ 代码实现` 这条开发工作流，用 skills + agents + docs 编码承载。

2. **我们在这里做的事 = 打造让开发更高效的工具集。**
   skills / agents = 工具；工作流 = 机制；契约 / 锚 = 工具的产物；**效率才是目的**。

→ 你是「**造工具的人**」，不是「跑工作流的人」。跑工作流是用户在别的产品项目里用 walker 干的事。所以改 skills/agents/docs 的标准不是"跑通流程"，而是"能不能让用户的开发更高效、更少认知偏差"。

---

## 🗺️ 第一步永远：打开流程图定位

**地图**：[`docs/xdd/flow.mermaid`](./docs/xdd/flow.mermaid)（渲染版）。定位用的 compact 文本版：

```
prompt → [入口 init]
          ↓
        [设计层·锚] understand → spec(RXX) → architecture → wire → resilience
          ↓                              （每个产物带「上游指针 + 下游消费者」）
        [桥接] plan（task 回指 RXX）
          ↓
        [代码层] execute（@implements RXX）→ verify（对照封存契约验）
```

**动手前默念定位三问**：

1. **我在哪个节点？** —— understand / spec / architecture / wire / resilience / plan / execute / verify？
2. **产物落哪？** —— 封存契约（`design/`，跨 iter 保留）还是工作记录（`runs/iter-N/`，单轮）？上游指针指谁？下游谁消费？
3. **用户能从图上看懂我要干啥吗？** —— 看不懂 = 认知偏差，先对齐再动手。

定位清楚 = 想清楚要干啥。这张图是**你和用户的共享地图**：你说"我在改韧性锚的兜底设计"，用户看图就知道那是哪个节点、产出落在 `design/architecture/{bxx-slug}/resilience/`、上游是 architecture。认知偏差在定位这一步被截住，不在代码里爆发。

---

## 🧬 xdd 靠什么提效（契约是产物，不是本质）

xdd 是**让开发更高效的工具集**。提效靠一条工作流机制：**把用户的精简描述逐层扩展成可评审、可封存、可回溯的契约**。契约是工具产出的东西，不是工具本身。

| 阶段 | 精简描述扩展成什么 | 产物的契约性质 |
|------|-----------|---------|
| understand | 意图 + 决策（design.md）| **用户审的契约** —— 确认对齐才往下 |
| spec | 规则 RXX | **做什么的契约** |
| architecture | 结构 + 端点 + 事件 | **怎么做的契约** |
| wire / resilience | 前端 + 韧性 | **长啥样 / 挂了咋办的契约** |
| plan | task DAG（回指 RXX）| 实现路线 |
| execute | 代码（`@implements RXX`）| 契约的落地 |
| verify | 对照封存契约验代码 | 契约的回检 |

### 提效关键：评审资料要封存

设计层产物（`design/`）= **封存的契约**：评审通过即冻结，作为**代码 review 的基准**。代码不凭印象写 —— **对照封存契约写**。verify 不是"测试通过没"，是"代码符不符合封存的契约"。这一步把"开发完才发现做错"的高昂返工成本，前移到"评审闸"低成本截住 —— 这就是提效的核心来源。

产物分两类（也是目录重规划的动机）：

- **`design/`** = 封存契约（持久锚，review 基准，跨 iter 保留）
- **`runs/iter-N/`** = 扩展过程的工作记录（plan / 执行报告 / 验证报告 / 审计，单轮）

### 工作流的提效闭环

```
精简描述 → 流程扩展 → 评审封存 → 照契约写码 → 拿契约回检
```

每一步可追溯，认知偏差在**评审闸**（design.md 用户审）被截住，而不是在代码交付时才爆发。

---

## ⚠️ Meta：你正在修改 xdd 自身，禁用 xdd 流程

**这个项目就是 xdd 框架自身**（`agents/` + `skills/` + `archive/` + `docs/` + `install.sh` + `framework-conventions.md`）。在 cjxdd 工作就是**改 framework**，不是**用 framework 改外部产品**。

### ❌ 严禁（用 xdd 改 xdd 会自指递归）

- ❌ 不要加载 `xdd-walker` / `xdd-orchestrator` 来开发本仓库
- ❌ 不要跑三层流水线（understand→spec→...→verify）
- ❌ 不要在本仓库创建 `.xdd/`
- ❌ 不要用 `xdd-init` / `xdd-brainstorm` 等 skill "调研" framework 自身

### ✅ 正确做法（直接当代码仓库改）

- ✅ 先在流程图上定位（见上）—— 你改的是哪个节点的契约/产物？
- ✅ 直接 Read/Edit/Write `agents/` / `skills/` 下的源码
- ✅ 改完跑 smoke 验证（见下方常用命令）
- ✅ 直接 commit（Conventional Commits + 末尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`）
- ✅ 想"用 framework 验证 framework" → 在 `./demo/<project-slug>/` 起一个产品项目，在那里 cd 后跑 walker

### 怎么判断"我是不是在做 Meta 任务"

```bash
[ -f agents/xdd-walker.md ] && [ -f skills/xdd-brainstorm/SKILL.md ] && echo "META: 在改 framework 自身"
```

或 `pwd` 含 `/cjxdd` 且仓库根有 `agents/xdd-walker.md` → Meta 任务。

`agents/xdd-walker.md` / `xdd-orchestrator.md` 顶部都有 Meta 守卫段，加载时先检测 project root，若是 cjxdd 自身立即拒绝执行。

---

## 常用命令

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

# 三层骨架 smoke
bash skills/smoke-xdd-design-anchor.sh   # 期望 13/13 PASS
```

### 端到端测试 xdd 流程

在 `./demo/<project-slug>/` 起一个产品项目（`demo/` 在根 `.gitignore` 里被 ignore，跟 framework 解耦）：

```bash
DEMO=demo/<新项目>
mkdir -p $DEMO && cd $DEMO
./install.sh          # 或软链 agents/+skills/ 到 harness 配置目录
# 启动 AI coding agent（Claude Code / OpenCode 等），说："用 xdd-walker 给我做一个登录系统"
# 监督走完 understand → spec → architecture → wire → resilience → plan → execute → verify
cat .xdd/status.md    # 看各层状态
```

### 安装（通用，平台中立）

```bash
./install.sh                  # 自动探测 harness，软链 agents/+skills/ 到对应配置目录
TARGET_DIR=~/.claude ./install.sh   # Claude Code
TARGET_DIR=~/.config/opencode ./install.sh   # OpenCode
# 不装 hooks/plugins/commands/settings —— 只有 agents/ + skills/
```

详见 `README.md § 快速开始`。

---

## Git workflow

默认分支 `main`。Conventional Commits（`refactor(walker): …` / `docs: …` / `fix(skills): …`）。**末尾必须**带：

```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## 改 framework 时去哪查机制

项目说明、目录结构、设计原则、skill 清单、设计规范指针表 → 全部在 [`README.md`](./README.md)（单一真理源，避免两份）。本文件不再重复。

按你进仓库的目的挑入口：

- **理解框架**：读 `README.md`，再 `agents/xdd-walker.md`（顶部有 Meta 守卫），再 `docs/WORKFLOW.md`
- **改某个 skill**：先在流程图定位该 skill 是哪个节点，再开 `skills/{name}/SKILL.md`；深度内容在同目录 `references/`
- **创建新 skill**：用 `skills/xdd-skill-creator/SKILL.md`
- **逆向已有代码库（无 `.xdd/`）**：从 `xdd-reverse` 开始，不是 init
- **验证代码符合设计**：xdd-verify 的 4 维一致性审计（spec↔code / wire↔code / architecture↔code / resilience↔code）
- **查重构历史**：`git log --oneline`（历史不进文档，只放"现在怎么干"）
