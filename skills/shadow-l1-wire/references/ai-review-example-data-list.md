# AI Review Example: Data List With Drawer

这份文档给出一个完整的 `Wire SVG` AI 审查样例。

目的不是证明模型一定会这样回答，而是给团队一个稳定参照：

- 该喂给模型什么
- 该怎么发起审查
- 什么样的输出才算有用

## 1. 示例对象

本例对应：

- `templates/examples/data-list-with-drawer.template-selection.yaml`
- `templates/views/DataListView.vue`

页面类型：

- 列表页
- 右侧编辑抽屉
- 筛选 + 表格 + 分页 + 批量动作

## 2. 推荐输入

把下面内容作为最小输入给模型：

1. `wire/template-selection.yaml`
   用本例时可对应：
   `templates/examples/data-list-with-drawer.template-selection.yaml`

2. `wire.svg`
   用本例时可对应：
   `templates/views/DataListView.vue`

3. `spec.md` 中 UI 承接相关的部分

## 3. 推荐提示

可直接复用 [ai-review-prompt.md](/home/zhaocj/ws/opencode-skill/skills/shadow-l1-wire/references/ai-review-prompt.md) 里的通用模板。

若想更聚焦本例，可追加这一段：

```text
当前页面是“数据列表 + 编辑抽屉”场景。请重点检查：

1. 筛选区是否表达了“快速定位待处理数据”的主任务
2. 表格是否明确默认排序、空态文案、批量动作
3. 编辑动作是否稳定指向右侧抽屉
4. 抽屉是否写清 trigger / close / afterClose
5. template-selection.yaml 中的 excluded 和 review_focus 是否真的成立
```

## 4. 理想输出示例

下面这份输出，代表“比较像样的 AI 审查结果”。

```text
Findings

- No critical findings.

Residual risks:
- 当前页面已经把列表页主骨架、筛选区、表格、分页和右侧抽屉表达出来，template-selection.yaml 与 DataListView.vue 基本一致。
- `WireTable` 已补 `default-sort`、`empty-text`、`bulk-hint`，能支撑 review_focus 中对默认排序、空态和批量动作的审查。
- `WireDrawer` 已补 `trigger / close / afterClose`，右侧抽屉语义与 `overlay/drawer-right` 一致。

Semantic Risks

- 统计卡片存在于页面头部，但 template-selection.yaml 的 `review_focus` 没有明确提示审查者判断“统计卡片是否只是背景信息，还是会影响列表筛选路径”。这不是结构错误，但可能导致人审忽略顶部信息和主任务之间的关系。
- `excluded` 排除了 `dialog-centered`，理由说明了“保留底层上下文”，这基本成立；但如果后续补入“保存确认”动作，当前排除理由可能不够覆盖二次确认场景。
- 状态覆盖主要通过选择结果和局部文案表达，页面里虽然有状态 badge，但“错误 / 加载中 / 待处理”还没有形成非常明确的独立可见区域。对实现阶段来说问题不大，但对纯审查场景仍偏轻。

Minimal Fixes

- 在 `review_focus` 中补 1 条：检查统计卡片是否支持主任务，而不是沦为装饰区。
- 在页面中补一个更明确的错误或加载中承接区域，避免状态表达只停留在 badge 和选择结果里。
- 在 `excluded` 或 `selection_rationale` 中补一句：如果后续存在高风险提交，再单独引入确认 dialog，而不是默认沿用当前排除结论。
```

## 5. 什么算差的输出

下面这些都不算好：

- 只说“整体没问题”
- 只复述页面结构，不判断风险
- 只抓字段，不看 `wire.svg`
- 一上来就建议大改模板，而不是先看当前表达是否已成立

## 6. 审查者如何使用这份样例

人看这份样例时，重点不是背答案，而是检查模型有没有做到：

- 先区分结构问题和语义风险
- 结论能不能回到具体页面元素
- 建议是不是足够小、足够实用

## 7. 一句话原则

好的审查样例，不是给模型标准答案，而是给团队一把判断“这个 AI review 靠不靠谱”的尺子。
