# AI Review Contract

这份文档定义 `Wire SVG` 的混合审查原则：

- 脚本负责确定性底线
- AI 负责灵活语义判断
- 人负责最终裁决

目标不是把规则全部写死，而是用最轻的结构约束，配合模型完成更像设计审查的判断。

## 1. 审查分层

### A. 脚本层

脚本只检查容易确定的事情：

- 文件是否存在
- SVG 根节点是否存在
- 布局分区是否存在
- `data-node` 是否出现
- 用户交互规则是否有 `data-rule` 或 `data-node`

脚本不负责判断这些高语义问题：

- 这个抽屉到底该不该用 dialog 代替
- 当前筛选区是否真的表达了主任务
- 空态文案是否足够贴近业务
- 审查重点是否抓住了真正风险

这些问题交给 AI 和人。

### B. AI 审查层

AI 负责判断“表达是否成立”，而不是只数字段。

AI 应重点看：

- SVG 布局分区是否支撑页面主任务
- overlay / dialog / drawer 选择是否符合交互上下文
- normal / empty / error / loading 等状态是否表达清楚
- `wire.svg` 里的实际布局、浮层、状态是否支撑 spec 和 flow 的说法

### C. 人审层

最终由人判断：

- 这是不是当前业务最合适的交互方式
- 模板组合有没有把页面带偏
- AI 的实现有没有过度套模板

## 2. 轻脚本原则

`template-selection` 的脚本校验应遵循 3 条原则：

### Rule 1

只把“结构损坏”当成 FAIL。

例如：

- 缺少顶层必填字段
- 分组不是数组/对象
- `excluded.templates` 和 `excluded.reasons` 长度不一致

### Rule 2

把“表达不足”降级为 WARN。

例如：

- `review_focus` 太少或为空
- `selection_rationale` 没写完整
- `trace` 不完整
- `excluded` 没写

这些问题不阻断流程，但会提醒 AI 或人继续补强。

### Rule 3

脚本不要尝试推断业务正确性。

例如不要在脚本里写死：

- `browse-list` 一定要有 `overlay/drawer-right`
- 仪表盘一定不能有表单
- 有 `table` 就必须有 `pagination`

这些都应该是 AI 审查或人审判断，而不是 bash 规则。

## 3. AI 审查输入

AI 做 `Wire SVG` 审查时，建议最少读取：

1. `wire.svg`
2. `spec.md` 中 `需 Wire 承接` / `UI 载体/方位`
3. `project.flow.mermaid`

不建议直接把整个模板库塞进上下文。

## 4. AI 审查输出格式

建议 AI 输出分成 3 段：

### A. 确定性问题

脚本已经能确认的问题，但仍需说明影响：

- 缺字段
- 缺分组
- 节点未落位

### B. 语义风险

AI 判断出来但脚本不该硬拦的问题：

- 模板选择和页面目标不一致
- 抽屉/弹窗选择不稳
- 审查重点过泛
- 排除项写了但不成立

### C. 修改建议

只给最小必要调整：

- 补 1 条 `review_focus`
- 改 1 个浮层选择
- 在 `WireTable` 上补空态/排序语义

实际调用模型时，建议直接使用：

- `references/ai-review-prompt.md`
- `references/ai-review-rubric.md`

## 5. 一句话原则

`Wire SVG` 的检查体系应该是：

- 用脚本守住结构底线
- 用 AI 审表达与合理性
- 不把业务判断硬编码成 bash
