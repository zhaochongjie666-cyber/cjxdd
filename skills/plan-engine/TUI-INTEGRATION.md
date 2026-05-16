# Plan Workflow TUI 集成

默认仍建议读取 `.opencode/plan/*.json` 的执行态，因为进度状态由 `plan-engine` 维护。

## 推荐命令

紧凑状态：

```bash
python skills/plan-workflow/scripts/plan_workflow.py status \
  --plan-id my-flow \
  --compact
```

## Python API 示例

```python
from pathlib import Path
import sys

sys.path.insert(0, str(Path("skills/plan-engine/scripts").resolve()))
from plan_engine import PlanEngine

engine = PlanEngine(".opencode/plan")
plan = engine.read_plan("my-flow")
if plan:
    status = engine.get_tui_status(plan)
    print(status["full"])
```

## Plugin / Hook 集成

```typescript
async function updatePlanStatus(planId: string): Promise<string> {
  const result = await $`python skills/plan-workflow/scripts/plan_workflow.py status --plan-id ${planId} --compact`
  return result.stdout.trim()
}
```

## Shell 集成

```bash
function plan_prompt() {
    local status=$(python skills/plan-workflow/scripts/plan_workflow.py status --plan-id my-flow --compact 2>/dev/null)
    if [ -n "$status" ]; then
        echo "[$status] "
    fi
}
```

## 说明

- TUI 展示层建议走 `plan_workflow.py status`
- 更底层的状态计算仍可直接使用 `PlanEngine.get_tui_status()`
