# Agent 归档（2026-06-14）

深度重构中，agent 层从 11 个 → 8 个。

## 合并

| 旧 | 新 | 说明 |
|----|----|------|
| `xdd-walker` + `xdd-walker-pi` | `xdd-walker`（合并）| hook 删除后 pi 变体差异塌缩（仅 frontmatter），合并为一个平台中立 walker |

## 重命名 / 重映射三层

| 旧 phase 子 agent | 新 phase 子 agent | 映射 |
|-------------------|-------------------|------|
| phase-researcher | phase-understand | 设计层·意图锚 |
| phase-designer + phase-architect | phase-design | 设计层·规则+结构+前端 |
| phase-resilience-designer | phase-resilience | 设计层·韧性 |
| phase-scaffolder | （删除，scaffold 并入 phase-build Step 0）| — |
| phase-planner | phase-plan | 桥接 |
| phase-executor | phase-build | 代码层·实现 |
| phase-verifier | phase-verify | 代码层·验证 |

旧子 agent 紧绑「95% 阈值 6 闸门」描述，重写后剥闸门，改成"装 skill + 产出锚 + 回指上游 ID + 出口自检"。

新 8 agent：`xdd-walker` / `xdd-orchestrator` / `phase-{understand,design,resilience,plan,build,verify}`。
