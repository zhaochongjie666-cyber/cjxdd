# AI Review Example: Dashboard With Task Table

这份文档给出第 3 类 `Wire SVG` AI 审查样例。

它和前两个样例互补，重点覆盖：

- 总览页
- 指标卡片
- 图表区
- 最近任务表
- 异常 / 待处理表达

## 1. 示例对象

本例对应：

- `templates/examples/dashboard-with-task-table.template-selection.yaml`
- `templates/views/DashboardView.vue`

页面类型：

- 仪表盘总览页
- 指标卡片 + 图表区 + 最近任务表

## 2. 推荐输入

把下面内容作为最小输入给模型：

1. `wire/template-selection.yaml`
   用本例时可对应：
   `templates/examples/dashboard-with-task-table.template-selection.yaml`

2. `wire.svg`
   用本例时可对应：
   `templates/views/DashboardView.vue`

3. `spec.md` 中 UI 承接相关的部分

## 3. 推荐提示

可直接复用 [ai-review-prompt.md](/home/zhaocj/ws/opencode-skill/skills/shadow-l1-wire/references/ai-review-prompt.md) 里的通用模板。

若想更聚焦本例，可追加这一段：

```text
当前页面是“仪表盘 + 最近任务表”场景。请重点检查：

1. 页面主任务是否真的是 overview-metrics，而不是列表浏览
2. 卡片区、图表区、任务表区是否职责清楚，不互相抢主视觉
3. 最近任务表是否真的承接“待处理任务”，而不是只放静态信息
4. pending / error 状态是否有足够可见的表达
5. 页面是否错误引入筛选区、抽屉或确认弹窗，破坏总览节奏
```

## 4. 理想输出示例

下面这份输出，代表“比较像样的 AI 审查结果”。

```text
Findings

- No critical findings.

Residual risks:
- template-selection.yaml 已明确选择 `layout/dashboard`，并排除了 filter、drawer、dialog、form-section，整体方向与 overview-metrics 的页面目标一致。
- DashboardView.vue 已将页面拆成统计卡片、图表区和最近任务表三块，基础骨架能够支撑“先看指标，再看任务”的总览节奏。
- 最近任务表中已经出现状态 badge，能够初步承接 pending 语义，而不是纯展示表。

Semantic Risks

- template-selection.yaml 在 `state` 中强调 `pending` 和 `error`，但 DashboardView.vue 当前对 error 的表达仍偏弱。页面里能看见趋势和任务状态，但异常指标还没有非常明确的风险承接区。
- 最近任务表目前存在“查看”动作，但没有特别强调哪些任务是最值得立刻处理的。如果后续任务量变多，overview 页面可能会逐渐滑向“列表页感”。
- 图表区目前还是占位表达。对 L1 审查来说这不算错误，但如果 review_focus 想让人判断图表和任务表的主次关系，后续可能还需要更明确的视觉重点提示。

Minimal Fixes

- 在某个指标卡片或任务表上补一个更明确的异常提示承接，避免 `state/error` 只存在于选择结果里。
- 在 review_focus 中补一句：检查最近任务表是否突出最高优先级任务，而不是平均呈现所有任务。
- 在任务表或卡片说明中补一句“为什么这张表留在 dashboard，而不是拆去独立列表页”。
```

## 5. 什么算差的输出

下面这些都不算好：

- 因为页面里有表格，就直接把它当成列表页审
- 只复述“有卡片、有图表、有表格”，不判断主次关系
- 不区分 pending 表达和 error 表达
- 一上来就建议加筛选区或编辑抽屉，破坏总览页面节奏

## 6. 审查者如何使用这份样例

人看这份样例时，重点检查模型有没有做到：

- 先判断这是不是总览页，而不是把所有页面都当列表页
- 能否抓到总览页最核心的问题是“主次关系”和“风险显著性”
- 建议是否保持节制，没有把 dashboard 误导成操作页

## 7. 一句话原则

好的仪表盘审查，不是看内容多不多，而是看“哪些信息该先被看到、哪些风险该先被感知”有没有被稳定表达出来。
