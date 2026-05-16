# AI Review Example: Detail Form With Dialog

这份文档给出第 2 类 `Wire SVG` AI 审查样例。

它和列表页 + 抽屉场景互补，重点覆盖：

- 单对象编辑
- 阻塞式确认弹窗
- 表单分组
- 提交前确认与提交后回落

## 1. 示例对象

本例对应：

- `templates/examples/detail-form-with-dialog.template-selection.yaml`

页面类型：

- 详情编辑页
- 居中确认弹窗
- 单对象表单修改

说明：

当前仓库里的这个示例主要落在 `template-selection.yaml` 层，适合拿来校准模型如何判断“为什么这里应该用 dialog，而不是 drawer”。

## 2. 推荐输入

把下面内容作为最小输入给模型：

1. `wire/template-selection.yaml`
   用本例时可对应：
   `templates/examples/detail-form-with-dialog.template-selection.yaml`

2. `wire.svg`
   如果业务目录里已经有详情表单页和确认弹窗页，一并提供

3. `spec.md` 中 UI 承接相关的部分

如果当前还没有完整 `wire.svg`，模型也可以先只审 `template-selection.yaml`，但要明确说明结论会偏向“模板选择合理性”，而不是最终页面表达质量。

## 3. 推荐提示

可直接复用 [ai-review-prompt.md](/home/zhaocj/ws/opencode-skill/skills/shadow-l1-wire/references/ai-review-prompt.md) 里的通用模板。

若想更聚焦本例，可追加这一段：

```text
当前页面是“详情表单 + 确认弹窗”场景。请重点检查：

1. 页面主任务是否真的是 edit-single，而不是浏览列表或总览指标
2. 当前确认交互为什么适合 dialog，而不是 drawer
3. 保存动作是否明确先进入确认弹窗，再决定提交
4. dialog 是否写清 trigger / close / afterClose
5. 保存失败、保存成功之后的页面回落是否清楚
```

## 4. 理想输出示例

下面这份输出，代表“比较像样的 AI 审查结果”。

```text
Findings

- No critical findings.

Residual risks:
- template-selection.yaml 已明确选择 `layout/detail-form` 和 `overlay/dialog-centered`，这与“修改关键参数并在提交前完成确认”的页面目标一致。
- `excluded` 明确排除了 `overlay/drawer-right` 和 `collection/table`，能帮助审查者理解该页不是列表上下文，也不是非阻塞编辑。
- review_focus 已覆盖表单分组、保存触发确认、dialog 语义、失败反馈和成功回落，整体方向成立。

Semantic Risks

- 当前示例主要停留在 template-selection 层。如果没有对应的 `wire.svg`，模型无法继续判断表单分组是否真的按业务对象组织，还是只是字段堆叠。
- `overlay/dialog-centered` 的理由是“阻塞式确认”，这基本成立；但如果后续确认内容其实很复杂，可能会逐步逼近 drawer 语义。这个风险不应由脚本判断，但 AI 和人审都需要留意。
- `state` 目前只列了 `error` 和 `success`。对于编辑页来说这不一定错误，但如果保存前存在较长提交过程，后续可能仍需要补 `loading` 或 `pending` 的可见表达。

Minimal Fixes

- 在后续 `wire.svg` 中明确表单分组标题，避免 detail-form 退化成长表单平铺。
- 在 dialog 区域补 `trigger / close / afterClose` 的可见承接，确保“先确认再提交”不是只写在选择结果里。
- 如果保存动作存在明显等待过程，在状态模板或页面局部提示中补一条提交中反馈。
```

## 5. 什么算差的输出

下面这些都不算好：

- 只因为出现了 `dialog-centered` 就默认判断合理
- 只说“结构完整”，不判断为什么这里要阻塞确认
- 在没有 `wire.svg` 时假装已经验证过页面细节
- 一上来就把 dialog 改成 drawer，没有给出交互上下文依据

## 6. 审查者如何使用这份样例

人看这份样例时，重点检查模型有没有做到：

- 把“模板选择合理”与“页面已经表达清楚”区分开
- 说明 dialog 的适用边界，而不是只会机械复述
- 在缺少页面实现时，明确保留判断边界

## 7. 一句话原则

好的详情页审查，不是只看有没有 dialog，而是看“为什么这里必须先确认，再提交”有没有被稳定表达出来。
