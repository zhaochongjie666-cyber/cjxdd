---
name: plan-workflow
description: |
  统一处理 JSON plan 的生成、编辑、渲染、导入和执行。当用户提到"创建计划"、"json plan"、"plan json"、"任务拆解"、"workflow"、"执行计划"、"推进任务"、"查看进度"、"plan-creator"、"plan-engine"时触发此 skill。
  该 skill 采用 JSON-first 工作流：先定义 tasks/dependencies，再按状态推进执行；Mermaid 仅作为可视化表达。
version: "1.0.0"
---

# Plan Workflow

## 与 task-orchestrator 的边界

本 skill 和 `task-orchestrator` 是两个独立 skill。

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

- 用户要“自然语言任务 -> 自动拆计划 -> 安排执行”时，应优先使用 `task-orchestrator`
- 用户要“查看进度 / 推进任务 / 验证任务 / 回退 / 重规划”时，应优先使用 `plan-workflow`

## 角色职责

用一套统一工作流处理两类动作：

1. 定义计划：从自然语言或 JSON 生成 `tasks` / `dependencies`
2. 执行计划：创建运行时状态、推进任务、验证结果、查询进度

默认把 `JSON plan` 视为源数据，把 `Mermaid` 视为展示层，把 `.opencode/plan/*.json` 视为运行时状态。

## 触发原则

以下情况优先使用本 skill：

- 用户要把需求拆成计划
- 用户给了一份 JSON，希望转成 Mermaid 或执行态计划
- 用户要推进已有计划，例如 `complete-task`、`verify-task`、`status`
- 用户混合提出“先建计划，再执行计划”的请求

## 标准数据结构

推荐统一使用下面的 JSON 结构：

```json
{
  "title": "登录功能开发",
  "tasks": [
    {
      "id": "analyze",
      "label": "需求分析",
      "description": "阅读 PRD，确认边界",
      "output": "docs/requirements.md",
      "checkpoint": "review",
      "max_retries": 2
    },
    {
      "id": "implement",
      "label": "代码实现",
      "description": "完成后端和前端登录逻辑"
    }
  ],
  "dependencies": [
    { "from": "analyze", "to": "implement" }
  ]
}
```

约定：

- `tasks` / `dependencies` 是计划定义层
- `.opencode/plan/{plan_id}.json` 是执行状态层
- 不要把运行时状态文件当作原始计划定义文件

## 工作流

### 模式 1：设计计划

当用户还没有计划时：

1. 先抽取步骤和依赖
2. 产出标准 JSON plan
3. 如需要，再生成 Mermaid
4. 需要执行时，再导入 plan engine

常用命令：

```bash
python skills/plan-workflow/scripts/plan_workflow.py generate \
  --description "用户登录：需求分析→设计→实现→测试" \
  --format json

python skills/plan-workflow/scripts/plan_workflow.py generate \
  --description "用户登录：需求分析→设计→实现→测试" \
  --format both \
  --output login-plan.mermaid \
  --json-output login-plan.json

python skills/plan-workflow/scripts/plan_workflow.py generate \
  --from-json login-plan.json \
  --output login-plan.mermaid
```

### 模式 2：启动执行

当用户要把计划转成可推进状态时：

```bash
python skills/plan-workflow/scripts/plan_workflow.py create \
  --plan-id "login-feature" \
  --name "登录功能开发" \
  --from-json login-plan.json

python skills/plan-workflow/scripts/plan_workflow.py import \
  --plan-id "login-feature" \
  --name "登录功能开发" \
  --from-mermaid flow.mermaid
```

### 模式 3：推进执行

当用户要继续推进已有计划时：

```bash
python skills/plan-workflow/scripts/plan_workflow.py complete-task \
  --plan-id "login-feature" \
  --note "已完成实现"

python skills/plan-workflow/scripts/plan_workflow.py verify-task \
  --plan-id "login-feature" \
  --result passed \
  --note "验证通过"

python skills/plan-workflow/scripts/plan_workflow.py status \
  --plan-id "login-feature" \
  --json
```

### 模式 4：高级执行控制

当用户需要失败处理、回退、重置或动态调整计划时：

```bash
python skills/plan-workflow/scripts/plan_workflow.py reject-task \
  --plan-id "login-feature" \
  --note "验证失败"

python skills/plan-workflow/scripts/plan_workflow.py fallback-task \
  --plan-id "login-feature"

python skills/plan-workflow/scripts/plan_workflow.py reset \
  --plan-id "login-feature"

python skills/plan-workflow/scripts/plan_workflow.py add-task \
  --plan-id "login-feature" \
  --task-id security-review \
  --label "安全复查" \
  --after implement

python skills/plan-workflow/scripts/plan_workflow.py add-dep \
  --plan-id "login-feature" \
  --from security-review \
  --to test

python skills/plan-workflow/scripts/plan_workflow.py replan \
  --plan-id "login-feature" \
  --reason "需求变化" \
  --from-json updated-plan.json
```

## 行为规范

- 优先维护 JSON plan，不要只改 Mermaid
- 保留已有 `task id`，不要无故重命名
- 如果用户同时要“设计 + 执行”，先产 JSON plan，再创建执行态
- 如果只是查看进度或推进状态，不要重建计划
- 如果已有 Mermaid 而没有 JSON，可先解析 Mermaid，再补回 JSON plan

## 资源选择

- 默认入口：`skills/plan-workflow/scripts/plan_workflow.py`
- 底层生成器：`skills/plan-creator/scripts/plan_creator.py`
- 底层执行器：`skills/plan-engine/scripts/plan_engine.py`
- 需要更长示例时，按需查看：
  - `skills/plan-engine/EXAMPLES.md`
  - `skills/plan-engine/DETAILED-WORKFLOW.md`
  - `skills/plan-engine/TUI-INTEGRATION.md`

## 关键约束

- `task id` 必须唯一且稳定
- 依赖关系必须保持 DAG，无循环
- `output` 应尽量明确，便于验证
- 计划生成后，默认先向用户展示，再决定是否进入执行态
