# xdd workflow —— 外部 Python 编排层

> 用 Python 脚本按序调度 claude CLI，自动跑完 xdd 全链：brainstorm → spec → architecture → wire → resilience → plan → execute → verify。
>
> 这是**外部编排层**（给人/CI 直接跑），和 `agents/` 下的 walker/orchestrator（给 AI agent 自走）是两套范式。本目录依赖 claude CLI + models.yaml，**不属于平台中立的 skill/agent 层**。

## 为什么有两个

| | agents/（walker/orchestrator） | workflow/（本目录） |
|---|---|---|
| 谁调度 | AI agent 自己按 skill 流程走 | 外部 Python 脚本 subprocess 调 CLI |
| 依赖 | 只 skill+agent（平台中立） | claude CLI + models.yaml |
| 适合 | 交互式开发（人在 loop 里） | 无人值守/CI/批量跑 |

## 用法

```bash
# 1. 配模型（复制模板填 key，models.yaml 不入库）
cp workflow/models.yaml.template workflow/models.yaml
vim workflow/models.yaml   # 填 ANTHROPIC_API_KEY 等

# 2. 准备项目目录（须含 prd.md）
mkdir -p demo/my-project && echo "# 我的需求" > demo/my-project/prd.md

# 3. 跑
python workflow/run_workflow.py -t demo/my-project -m YACC

# 强制重跑所有节点（忽略已有产出）
python workflow/run_workflow.py -t demo/my-project -m YACC -f
```

## 文件

- `run_workflow.py` —— 调度主脚本（八节点顺序执行 + 验收循环）
- `models.yaml` —— 模型环境变量配置（**不入库，各自填 key**）
- `models.yaml.template` —— 配置模板
- `SYSTEM.md` —— 追加给每个 agent 的 system prompt

## 流程

**第一阶段（顺序执行八节点）**：每个节点 `use skill: <xdd-skill>`，产出文档含 `- [ ]` 自检清单。

**第二阶段（验收循环）**：verify 节点的报告当总闸——`test_gateway` 统计 `- [ ]` 数量，全 `- [x]` 才过；未过则回 plan→execute→verify 重做（`loop_main_N/`），直到通过。

## 验收闸

照搬 `- [ ]` 计数：各 xdd skill 的自检清单（`□` 项）就是验收点。文档里 `- [ ]` 全变 `- [x]` = 节点通过。verify 报告的自检全过 = 整个 workflow 通过。

## 注意

- 依赖 `claude` CLI 在 PATH 里，且 models.yaml 配好对应模型的 env
- `--permission-mode bypassPermissions`：自动跑不等人确认，确保在可信环境
- 产物落在 `<task_dir>/.xdd/`（和 xdd 三层模型一致）+ `<task_dir>/log/`（调度日志）
