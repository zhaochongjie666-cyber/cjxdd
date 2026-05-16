# Plan Workflow Skills

基于 OpenCode Skill 的 JSON-first 计划工作流。

当前推荐入口是 `plan-workflow`：

- 先生成或维护 `JSON plan`
- 再按需生成 `Mermaid`
- 最后进入执行态并推进状态

如果你要的是“自然语言任务 -> 协调者自动拆计划 -> 再进入执行”，请优先使用 `task-orchestrator`：

- `task-orchestrator`：上层协调器，负责接自然语言任务、选模板、生成实例计划
- `plan-workflow`：下层执行系统，负责创建执行态、查看状态、推进任务

最短调用关系：

```text
User Task
  -> task-orchestrator
  -> plans/instances/xxx.json
  -> plan-workflow create/start
  -> .opencode/plan/xxx.json
  -> plan-workflow status/complete-task/verify-task
```

## 目录

```text
.
├── skills/
│   ├── plan-workflow/
│   │   ├── SKILL.md
│   │   └── scripts/
│   │       ├── __init__.py
│   │       └── plan_workflow.py
│   ├── plan-creator/
│   │   ├── SKILL.md
│   │   └── scripts/plan_creator.py
│   └── plan-engine/
│       ├── SKILL.md
│       ├── EXAMPLES.md
│       └── scripts/plan_engine.py
└── README.md
```

## 推荐工作流

### 0. 自然语言任务协调

如果你先只有一句自然语言任务，先走 `task-orchestrator`：

```bash
python skills/task-orchestrator/scripts/init_task_orchestration.py \
  --task "给登录模块新增短信验证码登录，并补测试" \
  --plan-id login-sms
```

如果希望生成计划后直接进入执行态：

```bash
python skills/task-orchestrator/scripts/init_task_orchestration.py \
  --task "修复登录后 session 偶发失效问题，并验证回归" \
  --plan-id fix-login-session \
  --execute
```

### 1. 生成计划

```bash
python skills/plan-workflow/scripts/plan_workflow.py generate \
  --description "用户登录：需求分析→设计→实现→测试" \
  --format both \
  --output login-plan.mermaid \
  --json-output login-plan.json
```

### 2. 启动执行

```bash
python skills/plan-workflow/scripts/plan_workflow.py start \
  --plan-id login-feature \
  --name "登录功能开发" \
  --from-json login-plan.json
```

### 3. 推进计划

```bash
python skills/plan-workflow/scripts/plan_workflow.py complete-task \
  --plan-id login-feature \
  --note "已完成实现"

python skills/plan-workflow/scripts/plan_workflow.py verify-task \
  --plan-id login-feature \
  --result passed \
  --note "验证通过"
```

### 4. 查看状态

```bash
python skills/plan-workflow/scripts/plan_workflow.py status \
  --plan-id login-feature \
  --json
```

## 统一 CLI

`skills/plan-workflow/scripts/plan_workflow.py` 目前提供这些主命令：

- `generate`：从自然语言或 JSON 生成 JSON plan / Mermaid
- `start`：生成计划并立即创建执行态
- `create`：从 JSON / Mermaid / tasks JSON 创建执行态
- `import`：兼容式导入 JSON / Mermaid 到执行态
- `parse`：将 Mermaid 解析回 JSON 结构
- `status`：查看计划状态
- `complete-task`：将当前任务推进到验证态
- `verify-task`：验证当前任务
- `reject-task`：将当前任务标记失败
- `fallback-task`：沿回退边回到目标任务
- `replan`：保留已完成任务并替换未完成部分
- `reset`：重置整个计划或单个任务
- `add-task`：运行时插入任务
- `add-dep`：运行时新增依赖
- `render`：渲染 ASCII / Mermaid
- `list`：列出已有执行态计划

## 数据层次

推荐明确区分三层数据：

1. `JSON plan`
   - 包含 `tasks` / `dependencies`
   - 是计划定义层
   - 应提交到版本库

2. `Mermaid`
   - 是可视化展示层
   - 可由 JSON plan 再生成

3. `.opencode/plan/*.json`
   - 是执行状态层
   - 由 `plan-engine` 写入
   - 不要替代原始计划定义文件

## 兼容入口

旧入口仍保留：

- `skills/plan-creator/`
- `skills/plan-engine/`

新增上层协调入口：

- `skills/task-orchestrator/`

但它们现在只是兼容包装。新请求默认应使用 `plan-workflow`。
