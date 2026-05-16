---
name: task-orchestrator
description: |
  自然语言任务协调器。把用户的自然语言开发任务路由成“协调者 -> 规划工程师 -> 执行工程师”的三段式工作流。
  当用户提到“协调者”“规划工程师”“执行工程师”“自动规划”“自然语言生成计划”“orchestrate”“任务编排”“先规划再执行”时触发。
  该 skill 复用 plans/templates 和 plan-workflow：先自动选择模板并生成 JSON plan，再按需创建执行态并推进当前任务。
version: "1.0.0"
---

# Task Orchestrator

## 与 plan-workflow 的边界

本 skill 和 `plan-workflow` 是两个独立 skill。

调用关系：

```text
User Task
  -> task-orchestrator
  -> plans/instances/xxx.json
  -> plan-workflow create/start
  -> .opencode/plan/xxx.json
  -> plan-workflow status/complete-task/verify-task
```

职责划分：

- `task-orchestrator`
  - 角色：Coordinator
  - 输入：自然语言任务
  - 输出：实例计划 `plans/instances/*.json`
  - 负责：选模板、扩展计划、决定是否进入执行态
  - 不负责：推进任务状态、直接管理执行流转

- `plan-workflow`
  - 角色：Planner + Execution Engine
  - 输入：结构化 JSON plan
  - 输出：执行态 `.opencode/plan/*.json`
  - 负责：`create`、`status`、`complete-task`、`verify-task`、`reject-task`、`replan`
  - 不负责：理解高层业务意图、自动判断任务类型

选择规则：

- 用户要“自然语言任务 -> 自动拆计划 -> 安排执行”时，用 `task-orchestrator`
- 用户要“查看进度 / 推进任务 / 验证任务 / 回退 / 重规划”时，用 `plan-workflow`

## 角色职责

本 skill 只负责三件事：

1. 协调者：识别任务类型，选择模板，控制流程
2. 规划工程师：把自然语言任务扩展成结构化 JSON plan
3. 执行工程师：把 plan 交给 `plan-workflow` 执行推进

底层能力全部复用已有资源：

- 计划模板：`plans/templates/*.json`
- 实例计划：`plans/instances/*.json`
- 执行规则：`prompts/ai-execution-prompt.md`
- 执行引擎：`skills/plan-workflow/scripts/plan_workflow.py`

## 触发原则

以下情况优先使用本 skill：

- 用户给出一段自然语言任务，希望自动拆解
- 用户希望“先规划，再执行”
- 用户明确提到协调者 / 规划工程师 / 执行工程师
- 用户要把模板式工作流变成自动编排入口

## 工作流

### 模式 1：只生成计划

1. 读取自然语言任务
2. 自动判断任务类型：`feature / bugfix / small-task / research`
3. 生成 `plans/instances/*.json`
4. 返回计划路径和计划摘要

常用命令：

```bash
python skills/task-orchestrator/scripts/init_task_orchestration.py \
  --task "给登录模块新增短信验证码登录，并补测试" \
  --plan-id login-sms
```

### 模式 2：生成计划并进入执行态

```bash
python skills/task-orchestrator/scripts/init_task_orchestration.py \
  --task "修复登录后 session 偶发失效问题，并验证回归" \
  --plan-id fix-login-session \
  --execute
```

### 模式 3：AI 协调执行

当用户希望直接进入完整协同时，按下面顺序：

1. 协调者生成实例计划
2. 规划工程师补齐 `goal / tasks / outputs / checkpoints`
3. 如用户同意，创建执行态
4. 执行工程师只处理当前 active 任务

## 自动分类规则

优先顺序：

1. 明显研究/选型/评估：`research`
2. 明显修复/报错/回归：`bugfix`
3. 明显小改动/脚本微调/半天任务：`small-task`
4. 默认：`feature`

如分类不明确：

- 默认先按 `feature`
- 同时在结果中提示用户当前分类是推断值

## 规划工程师规则

规划时必须补齐：

- `title`
- `goal`
- `non_goals`
- `constraints`
- `definition_of_done`
- `tasks[*].description`
- `tasks[*].output`
- `tasks[*].checkpoint`

不要直接照抄模板占位符。

规划细则见：`references/role-contract.md`

## 执行工程师规则

执行阶段必须同时读取：

- 当前实例计划
- `prompts/ai-execution-prompt.md`

执行时遵守：

- 只处理当前 active 任务
- 不得跳阶段
- 每一步都要给证据
- 未验证不得进入下一任务

## 脚本入口

默认脚本：

```bash
python skills/task-orchestrator/scripts/init_task_orchestration.py --task "..."
```

常用参数：

- `--task`：自然语言任务
- `--plan-id`：计划 ID
- `--type`：显式指定类型，可选 `auto/feature/bugfix/small-task/research`
- `--title`：覆盖默认标题
- `--execute`：生成后直接创建执行态

## 关键约束

- 本 skill 是上层调度器，不替代 `plan-workflow`
- 不直接修改模板文件，只生成实例文件
- 自动生成结果必须允许人工审阅后再执行
- 当用户只要计划，不自动进入执行态
