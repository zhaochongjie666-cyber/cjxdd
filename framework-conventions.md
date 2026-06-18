# Framework Conventions

> **xdd 框架自身（cjxdd 仓库）维护时的操作习惯。**

## 1. wire 设计习惯

1. **wire 放在 `.xdd/design/wire/` 目录下**（深度重构后路径）。
   - 跟 `.xdd/design/spec/` / `.xdd/design/architecture/` 平级
   - 相关 group 页面单独目录（如登录流程：`login/index.html` + `login/index.mobile.html`）
2. **用户最友好的操作**：`input` + `selector`（最稳定的交互范式），不依赖 mouse 坐标 / 复杂 key 序列。
3. 详见 `skills/xdd-wire/SKILL.md`。

## 2. 命名约定

### 2.1 skill 命名
- 全部带 `xdd-` 前缀
- 17 个 skill（设计 5 + 桥接 1 + 代码 4 + 入口 1 + 工具 6）：
  - 设计层：`xdd-brainstorm` / `xdd-spec` / `xdd-architecture` / `xdd-wire` / `xdd-resilience`
  - 桥接：`xdd-plan`
  - 代码层：`xdd-execute` / `xdd-backend` / `xdd-frontend` / `xdd-verify`
  - 入口：`xdd-init`
  - 工具：`xdd-reverse` / `xdd-mermaid-check` / `xdd-docker-helper` / `xdd-skill-creator` / `xdd-gherkin-plus` / `xdd-git-commit`
- 旧的 `xdd-l0` / `xdd-bdd` / `xdd-arch` / `xdd-flow` / `xdd-l3` / `xdd-l6` / `xdd-core` / `xdd-gherkin-writer` / `xdd-ux-design` / `xdd-scaffold` / `xdd-artifact-lifecycle` / `xdd-trace-init` 等已归档（合并/废弃见 `archive/skills-2026-06/README.md`）

### 2.2 agent 命名
- 全部带 `xdd-` 前缀（walker / orchestrator）；phase 子 agent 用 `phase-` 前缀
- 8 个：`xdd-walker` / `xdd-orchestrator` / `phase-{brainstorm,design,resilience,plan,build,verify}`
- 旧的 `xdd-walker-pi` 已合并进 `xdd-walker`（hook 删除后差异塌缩）；旧 8 个 phase 子 agent 已归档

### 2.3 skill 结构约定（「工作方式在前」）
- 每个 skill 的 SKILL.md 必须有 `## 怎么做` 段，紧跟定位段。定位段后允许跟 **1-2 个**方法论框架段（如 architecture 的「ADD 思维链 / 三面手」、spec 的「BDD 边界 / 输入对齐」——先框定方法论再讲流程），`## 怎么做` 在文档前部即可，不强制第二位。
- 定位段标题按 skill 类型选：锚 / 数据流 skill 用 `## 我锚定什么 / 上游 / 下游`；带上下游的工具用 `## 我做什么 / 上游 / 下游`；纯工具用 `## 何时用`。
- `## 怎么做` 先讲**流程/方法**（这个 skill 怎么干活，建议用伪代码 `work(): ...` 或有序步骤），再讲补充
- 规范 / 参考表 / 自检等是**补充**，放 `## 怎么做` 之后
- 读者打开任何 SKILL.md，扫到前几个 `##` 就能抓到「怎么干」，不用翻全文

### 2.4 没有平台专属命名
- **不再有** `xdd-gate-*` hook 命名、`plugins/*.ts` plugin 命名、`commands/*.md` slash command 命名 —— 这些平台层全部归档
- skill 自带的可移植 bash 自检脚本放 `skills/{name}/scripts/*.sh`（如 `no-stub-check.sh` / `wander-test.sh` / `chaos-runner.sh`），不是平台 hook

### 2.5 上游/下游表语义（数据流图，双向闭合）

主链 skill 的 `## 我锚定什么 / 上游 / 下游` 段有一张上下游表。**语义统一为「直接消费主产物的下一跳 skill」**（数据流，不是「文件被谁碰过」）：

- **上游** = 本 skill 直接读其主产物作为输入的 skill
- **下游** = 直接读本 skill 主产物作为输入的 skill
- **双向闭合**：X 在下游列了 Y ⇔ Y 在上游列了 X。改一边必须改另一边

**不算上下游**（特殊关系，写在各自 skill，不进数据流图）：
- **transitive**：信息经中间 skill 传递（如 execute 经 plan 间接拿到 architecture 的端点清单 → execute 上游只列 plan，不算 architecture 的直接下游）
- **派发装入**：`xdd-backend` / `xdd-frontend` 由 `xdd-execute` 派发装入（load 关系，不是消费主产物）
- **被引用**：`xdd-gherkin-plus` 是语法权威，被 spec/resilience 等引用（reference，不是消费主产物）

核心数据流图（按此语义双向闭合）：

```
brainstorm    → spec, architecture, wire, plan
spec          → architecture, wire, resilience, plan, verify
architecture  → resilience, plan, verify
wire          → plan, verify
resilience    → plan, verify
plan          → execute
execute       → verify
verify        → （终态）
```

## 3. 工件目录

- **产品项目**：`.xdd/` 三层模型（结构见 `skills/xdd-init/SKILL.md`）：
  - **项目层**：`design/intent.md` + `design.md`（总意图 + 跨业务线全局决策，跨 iter 保留）
  - **业务线层**：`design/spec/{bxx-slug}/` + `design/architecture/{bxx-slug}/` + `design/wire/`（每业务线，始终用 BXX）
  - **迭代层**：`runs/iter-N/`（`status.md` + `plan/{bxx-slug}/` + `audits/`，单轮工作记录）
  - 根级 `current-iteration` 指针
- **framework 自身**：git 仓库（`/home/zhaocj/ws/cjxdd/`）
- **不创建** `.shadow/`（已废弃）、不再有 `baseline/` 子树（深度重构后扁平到 `design/`）

## 4. install

- 单一 `install.sh`（通用，自动探测 harness，只软链 `agents/` + `skills/`）
- 不再有 `install-to-{claude-code,opencode,pi}.sh` 三个平台脚本（已归档）
- 软链目标：`~/.claude/`（CC）/ `~/.config/opencode/`（OC）/ `~/.pi/`（pi）/ 等

## 5. 平台中立是硬约束

改 skill / agent 时必须保持：

```bash
# 零平台耦合（核心约束）
grep -rIn 'xdd-gate\|hooks/xdd\|plugins/' agents/ skills/   # 期望 0（排除 archive/）
# SKILL.md size discipline
wc -l skills/*/SKILL.md                                       # 全 < 500
```

命中即违规。纪律用 (a) skill 文字自检段 + (b) skill 自带可移植 bash 脚本表达，不用平台 hook。

## 6. Meta 项目边界

**这个项目就是 xdd 框架自身。**

- ❌ 不要加载 `xdd-walker` / `xdd-orchestrator` agent 开发本仓库（会污染 `.xdd/`）
- ❌ 不要跑三层流水线
- ❌ 不要在本仓库创建 `.xdd/`
- ❌ 不要用 `xdd-init` / `xdd-brainstorm` 等 skill "调研" framework 自身
- ✅ 直接 Read/Edit 改 `agents/` / `skills/` 源码
- ✅ 改完跑验证（见 §5）
- ✅ 直接 commit（Conventional Commits + 末尾 `Co-Authored-By`）
- ✅ 想"用 framework 验证 framework" → `./demo/<project>/` 起产品项目

`agents/xdd-walker.md` / `xdd-orchestrator.md` 顶部 Meta 守卫段，加载时检测 project root，若是 cjxdd 自身立即拒绝执行。

## 7. 工具名 / frontmatter（walker 必踩）

Walker / orchestrator agent 的 frontmatter **故意不写 `tools` 字段** —— 各 harness 对它的合法格式互斥（CC 是逗号分隔字符串 `Read, Write`；OpenCode 是对象 `{read: true}`；pi 类似 CC）。写任一种都会让另一边 schema 拒绝。**省略 = 全工具开放**，跨平台兼容。改 agent frontmatter 时不要加 `tools` 字段。

Agent 正文里的工具名按 Claude Code 风格 TitleCase 引用（`Read`/`Write`/`Bash`/...）—— 仅为文档可读性，不参与 schema 校验，两边都无所谓。
