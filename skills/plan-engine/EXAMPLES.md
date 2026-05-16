# Plan Workflow 使用示例

本文件保留在 `plan-engine/` 下作为扩展示例，但默认入口已经切到：

`python skills/plan-workflow/scripts/plan_workflow.py ...`

## 示例 1: 先生成 JSON plan

```bash
python skills/plan-workflow/scripts/plan_workflow.py generate \
  --description "需求分析\n设计\n实现\n测试" \
  --format both \
  --output feature-xyz.mermaid \
  --json-output feature-xyz.json
```

## 示例 2: 从 JSON 启动执行

```bash
python skills/plan-workflow/scripts/plan_workflow.py start \
  --plan-id feature-xyz \
  --name "Feature XYZ 开发" \
  --from-json feature-xyz.json
```

## 示例 3: 查看状态

```bash
python skills/plan-workflow/scripts/plan_workflow.py status \
  --plan-id feature-xyz
```

JSON 输出：

```bash
python skills/plan-workflow/scripts/plan_workflow.py status \
  --plan-id feature-xyz \
  --json
```

## 示例 4: 推进当前任务

```bash
python skills/plan-workflow/scripts/plan_workflow.py complete-task \
  --plan-id feature-xyz \
  --note "已完成当前任务"
```

```bash
python skills/plan-workflow/scripts/plan_workflow.py verify-task \
  --plan-id feature-xyz \
  --result passed \
  --note "验证通过"
```

## 示例 5: 渲染视图

```bash
python skills/plan-workflow/scripts/plan_workflow.py render \
  --plan-id feature-xyz \
  --format both
```

## 示例 6: 仅从 JSON 创建执行态

```bash
python skills/plan-workflow/scripts/plan_workflow.py create \
  --plan-id feature-xyz \
  --name "Feature XYZ 开发" \
  --from-json feature-xyz.json
```

## 示例 7: 从 Mermaid 回填 JSON

```bash
python skills/plan-workflow/scripts/plan_workflow.py parse \
  --file feature-xyz.mermaid \
  --json
```

## 示例 8: 列出执行态计划

```bash
python skills/plan-workflow/scripts/plan_workflow.py list --json
```

## 示例 9: 底层兼容命令

只有在维护旧脚本或做底层调试时，才直接调用：

- `skills/plan-creator/scripts/plan_creator.py`
- `skills/plan-engine/scripts/plan_engine.py`
