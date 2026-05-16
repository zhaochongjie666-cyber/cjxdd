---
name: plan-engine
description: |
  兼容旧入口的 plan 执行 skill。仅当用户明确提到"plan-engine"或需要维护历史执行命令时触发。
  新请求默认应使用 `plan-workflow`，本 skill 仅负责计划执行、状态推进和运行时查询子能力。
version: "1.1.0"
---

# Plan Engine - Compatibility Wrapper

本 skill 已并入 `plan-workflow`。

默认策略：

- 新请求优先触发 `plan-workflow`
- 只有用户明确提到 `plan-engine`，或你在维护旧执行命令/旧状态文件时，才单独使用本 skill
- 底层脚本仍是 `skills/plan-engine/scripts/plan_engine.py`
- 对外统一 CLI 优先使用 `skills/plan-workflow/scripts/plan_workflow.py`

使用时遵循 `plan-workflow` 的边界：

- `plan-workflow` 负责计划定义层
- 本 skill 只负责执行层
- 运行时状态写入 `.opencode/plan/*.json`

如需完整工作流说明，请使用 `skills/plan-workflow/SKILL.md`。
