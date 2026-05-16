# AI Review Prompt

这份文档提供一个可直接复用的 `Wire SVG` 审查提示模板。

目标不是让模型自由发挥，而是让它在固定输入、固定检查维度、固定输出格式下完成灵活审查。

适用场景：

- 审查 `wire.svg` 是否把布局分区、浮层、状态、节点位置表达清楚
- 审查 `data-node` / `data-rule` 是否覆盖用户交互类规则
- 不接受 `wire.html` 或 `wire/*.vue` 作为 L1 Wire 正式产物

## 1. 推荐输入

把下面 3 类材料按最小集合给 AI：

1. `wire.svg`
2. `spec.md` 中 `需 Wire 承接` / `UI 载体/方位`
3. `project.flow.mermaid`

不要把整个模板库、全部历史文档、无关页面一起塞进上下文。

## 2. 推荐系统目标

告诉模型：

- 你的任务不是实现页面，而是审查 L1 `Wire SVG`
- 你需要区分“确定性问题”和“语义风险”
- 不要因为字段齐全就判定设计成立
- 不要把个人偏好当成问题
- 修改建议必须最小化，优先给 1~3 条高价值调整

## 3. 通用提示模板

```text
你现在在审查一份 L1 Wire SVG 契约。你的目标不是写代码，而是判断这份契约是否同时满足：

1. 人可以高效审查
2. AI 可以稳定实现
3. spec/flow 与 SVG 页面表达一致

请只基于我提供的以下材料进行判断：

- wire.svg
- project.flow.mermaid
- spec.md 中与 UI 承接相关的部分

请特别区分两类问题：

- 确定性问题：SVG 根节点缺失、布局分区缺失、节点/规则未落位、交互区域不可解析
- 语义风险：浮层选择不合理、状态反馈不足、页面表达无法支撑设计目标

审查时重点看：

- SVG 是否包含清晰的 header/sidebar/main/footer 或等价业务分区
- overlay / dialog / drawer 等交互区域是否符合交互上下文
- normal / empty / error / loading 等关键状态是否画出
- 关键 data-node 是否挂在用户可见动作或反馈上
- 用户交互类规则是否能找到对应 data-rule 或 data-node

输出要求：

第一部分：Findings
- 按严重程度列出问题
- 每条都说明影响
- 能引用文件就引用文件

第二部分：Semantic Risks
- 只写脚本不该硬拦、但会影响设计传达或 AI 实现稳定性的问题

第三部分：Minimal Fixes
- 只给 1~3 条最小必要修改建议
- 不要重写整页

如果没有发现明显问题，明确写：
- No critical findings
- Residual risks: ...
```

## 4. 更短的日常版

适合快速审查：

```text
请审查这份 L1 Wire SVG，重点判断：

1. spec/flow 与 wire.svg 是否一致
2. 页面主任务、浮层方位、状态反馈是否表达清楚
3. 哪些问题属于结构问题，哪些属于语义风险

按以下格式输出：
- Findings
- Semantic Risks
- Minimal Fixes
```

## 5. 推荐输出标准

理想输出应该像这样：

### Findings

- [高] `wire.svg` 没有 `data-node="B01-N15"` 的可见编辑区域，spec 中标记需 Wire 承接的编辑规则无法追踪。
- [中] `wire.svg` 只画了正常态，没有 empty/error/loading 状态分组，后续实现需要猜状态反馈。

### Semantic Risks

- 当前 `excluded` 排除了 `dialog-centered`，但没有说明为什么“保存确认”不需要阻塞式确认，后续实现可能漂移。

### Minimal Fixes

- 在 `WireTable` 上补 `default-sort`
- 在抽屉区域补 `trigger / close / afterClose`
- 在 `excluded` 中补一条与保存确认相关的排除理由

## 6. 不推荐的用法

不要这样让 AI 审：

- “帮我看看有没有问题”
- “随便 review 一下”
- “这个页面怎么样”

这类提示太泛，模型容易给出空泛意见或只看表面。

## 7. 一句话原则

好的 AI 审查提示，不是让模型更自由，而是让它在固定边界内做灵活判断。

## 8. 配套样例

如果需要一份完整示范，可直接参考：

- `references/ai-review-example-data-list.md`
- `references/ai-review-example-detail-form.md`
- `references/ai-review-example-dashboard.md`

如果需要比较不同模型或不同 prompt 的输出质量，再配合：

- `references/ai-review-rubric.md`
