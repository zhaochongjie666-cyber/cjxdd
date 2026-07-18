---
name: xdd-subagents
description: Use when orchestrating cjxdd subagents for scouting, planning, implementation, and adversarial review with positive/fallback evidence loops.
---

# xdd-subagents

使用 xdd subagent 时，先用 `xdd_list_subagents` 确认可用角色，再用 `xdd_delegate_prompt` 为具体角色生成委派提示。

角色选择：
- 不理解代码或入口时：`xdd-scout`
- 需要外部事实/官方文档时：`xdd-researcher`
- 需要交接上下文包时：`xdd-context-builder`
- 需要拆计划和验证闭环时：`xdd-planner`
- 已批准实现时：`xdd-worker`
- 需要攻击检查或回炉判断时：`xdd-reviewer`
- 高风险决策前：`xdd-oracle`
- 无专门角色覆盖的小任务：`xdd-delegate`

完成标准：必须同时报告正向路径证据、兜底攻击证据，以及失败是否触发回炉修复。
