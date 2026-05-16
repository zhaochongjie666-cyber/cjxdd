# Example Catalog

下面列出可直接复用的 `template-selection.yaml` 示例。

除模板选择样板外，也提供 AI 审查示例，帮助校准模型输出质量。

## 可用示例

| 示例 | 文件 | 适用场景 |
|------|------|---------|
| 数据列表 + 编辑抽屉 | `templates/examples/data-list-with-drawer.template-selection.yaml` | 数据中台、标注管理、后台记录管理 |
| 详情表单 + 确认弹窗 | `templates/examples/detail-form-with-dialog.template-selection.yaml` | 配置修改、审批提交、风险操作确认 |
| 仪表盘 + 最近任务表 | `templates/examples/dashboard-with-task-table.template-selection.yaml` | 首页总览、运营监控、管理驾驶舱 |
| AI 审查样例：列表页 + 抽屉 | `references/ai-review-example-data-list.md` | 校准 LLaMA / 其他模型的审查输出，判断什么算有效 review |
| AI 审查样例：详情页 + 确认弹窗 | `references/ai-review-example-detail-form.md` | 校准模型如何审查阻塞式确认、表单分组与提交回落 |
| AI 审查样例：仪表盘 + 任务表 | `references/ai-review-example-dashboard.md` | 校准模型如何审查总览页的主次关系、异常提示和待处理任务表达 |
| AI 审查评分 Rubric | `references/ai-review-rubric.md` | 比较不同模型、不同 prompt 的 review 质量，形成稳定审查基线 |

## 使用方式

1. 先选最接近当前业务的示例
2. 复制到 `.shadow/L1-business/BXX-<slug>/wire/template-selection.yaml`
3. 只修改与当前业务相关的字段
4. 再根据 `context_pack` 读取最小模板集合

## 使用约束

- 示例是起点，不是固定答案
- 如果当前页面没有抽屉，不要直接复用带抽屉的示例
- 如果当前页面主任务不是列表页，不要从 `data-list-with-drawer` 开始改
- 如果当前页面是编辑页，优先从 `detail-form-with-dialog` 开始改
- 如果当前页面是总览页，优先从 `dashboard-with-task-table` 开始改
