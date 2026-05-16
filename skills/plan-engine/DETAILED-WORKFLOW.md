# Plan Workflow 详细工作流

## 推荐顺序

统一使用 `plan_workflow.py`：

1. `generate` 生成 JSON plan
2. `start` 或 `create` 创建执行态
3. `complete-task` / `verify-task` 推进状态
4. `status` / `render` 查询和展示结果

## 完整示例：用户登录功能开发

### 1. 生成计划定义

```bash
python skills/plan-workflow/scripts/plan_workflow.py generate \
  --description "阅读需求文档
调研现有代码
确认需求细节
设计用户表
设计 API 接口
设计登录流程
实现后端认证
实现前端登录页面
编写测试
部署到测试环境
人工验收
部署到生产环境" \
  --format both \
  --output login-feature.mermaid \
  --json-output login-feature.json
```

### 2. 创建执行态

```bash
python skills/plan-workflow/scripts/plan_workflow.py start \
  --plan-id login-feature-v2 \
  --name "用户登录功能开发" \
  --from-json login-feature.json
```

### 3. 逐步推进

```bash
python skills/plan-workflow/scripts/plan_workflow.py status \
  --plan-id login-feature-v2 \
  --json
```

```bash
python skills/plan-workflow/scripts/plan_workflow.py complete-task \
  --plan-id login-feature-v2 \
  --note "已完成当前步骤并提交产出物"
```

```bash
python skills/plan-workflow/scripts/plan_workflow.py verify-task \
  --plan-id login-feature-v2 \
  --result passed \
  --note "检查通过，进入下一步"
```

重复以上两步，直到计划完成。

## 修改层级约定

如果要改步骤定义：

- 优先修改 `login-feature.json`
- 再重新生成 Mermaid
- 必要时重新创建执行态

如果只是推进状态：

- 直接使用 `complete-task` / `verify-task` / `status`
- 不要重新生成计划

## 失败与回退

当前统一 CLI 先覆盖主路径。需要底层高级能力时，可直接调用兼容执行器：

```bash
python skills/plan-engine/scripts/plan_engine.py --json reject-task \
  --plan-id login-feature-v2 \
  --note "验证失败"
```

```bash
python skills/plan-engine/scripts/plan_engine.py --json fallback-task \
  --plan-id login-feature-v2 \
  --note "回退到上一任务"
```

## 说明

这份文档保留在 `plan-engine/` 目录，是因为很多高级执行细节仍由 `plan_engine.py` 提供；但面向用户的默认入口已经迁到 `plan_workflow.py`。
