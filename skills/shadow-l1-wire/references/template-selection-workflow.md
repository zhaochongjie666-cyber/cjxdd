# Template Selection Workflow

这份文档定义 `template-selection.yaml` 的推荐落盘方式与使用流程。

## 推荐落盘位置

正式 wire 必须落盘为 `wire.svg`。如需保留模板选择过程，也不得替代 `wire.svg`：

```text
.shadow/L1-business/BXX-<slug>/wire/
├── template-selection.yaml
├── <PageA>.vue
└── <PageB>.vue
.shadow/L1-business/wire.svg
```

这样做的目的：

- `template-selection.yaml` 负责解释“为什么这么设计”
- `wire.svg` 负责表达“页面长什么样、交互怎么落位”

## 推荐流程

1. 先根据 `selector-input-contract.md` 整理页面输入
2. 再根据 `template-selector.md` 选择模板组合
3. 将结果写入 `template-selection.yaml`
4. 最后基于该结果生成 `wire.svg`
5. 运行 `check-wire.sh`，确认 `wire.svg`、节点和规则映射通过检查

## 使用约束

这条流程采用混合审查：

- 脚本负责结构完整性
- AI 负责设计表达与模板合理性
- 人负责最终裁决

### Rule 1

如果没有 `template-selection.yaml`，说明：

- 模板选择过程不可追溯
- 审查者不知道为什么选这个模板而不是另一个
- AI 下次重做时容易重新猜一遍

### Rule 2

`template-selection.yaml` 不应复制整份需求文档。

它只保留：

- 页面目标
- 模板组合
- 最小上下文
- 排除项
- 审查重点

## 审查方式

审查 `wire` 前，先看 `template-selection.yaml` 的 4 个地方：

1. `template_bundle`
2. `context_pack`
3. `excluded`
4. `review_focus`

如果这 4 处明显不合理，就不必继续往下审页面细节。

## AI 使用方式

AI 实现 `wire` 时建议按这个顺序读取：

1. `wire/template-selection.yaml`
2. `context_pack` 中列出的最小模板
3. 对应的 `spec.md` 中 `需 Wire 承接` / `UI 载体/方位`
4. 生成或修改 `wire.svg`
5. 运行 `check-wire.sh`，确认 SVG、节点和规则映射通过检查

不要跳过 `template-selection.yaml` 直接读全模板库。

进一步审查时，应同时参考：

- `references/ai-review-contract.md`
- `references/ai-review-prompt.md`

不要把所有设计判断都塞进脚本。
