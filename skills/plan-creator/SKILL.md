---
name: plan-creator
description: |
  兼容旧入口的 plan 生成 skill。仅当用户明确提到"plan-creator"或需要维护历史用法时触发。
  新请求默认应使用 `plan-workflow`，本 skill 仅负责 JSON plan 与 Mermaid 的生成和转换子能力。
version: "1.1.0"
---

# Plan Creator - Compatibility Wrapper

本 skill 已并入 `plan-workflow`。

默认策略：

- 新请求优先触发 `plan-workflow`
- 只有用户明确提到 `plan-creator`，或你在维护旧文档/旧命令时，才单独使用本 skill
- 底层脚本仍是 `skills/plan-creator/scripts/plan_creator.py`
- 对外统一 CLI 优先使用 `skills/plan-workflow/scripts/plan_workflow.py`

使用时遵循 `plan-workflow` 的 JSON-first 约定：

- 先维护 JSON plan
- 再生成 Mermaid
- 如需执行，再交给 `plan-engine`

如需完整工作流说明，请使用 `skills/plan-workflow/SKILL.md`。
