# Selector Output Contract

这份文档定义 `Wire Template Selector` 的标准输出。

目标是让模板选择结果从“口头说明”变成一份可审查、可存档、可复用的结构化产物。

推荐输出文件名：

- `.shadow/L1-business/BXX-<slug>/wire/template-selection.yaml`

---

## 目录

- [1. 输出目标](#1-输出目标)
- [2. 标准输出格式](#2-标准输出格式)
- [3. 字段定义](#3-字段定义)
- [4. 产出规则](#4-产出规则)
- [5. 生成流程](#5-生成流程)
- [6. 典型输出案例](#6-典型输出案例)
- [7. 人和 AI 的使用方式](#7-人和-ai-的使用方式)
- [8. 最终目的](#8-最终目的)

## 1. 输出目标

输出必须回答 5 件事：

1. 选了哪些模板
2. 最小上下文需要加载什么
3. 明确排除了哪些模板
4. 为什么这么选
5. 这份选择结果对应哪一页、哪一版需求

如果这 5 件事没有结构化落盘，后续仍然容易回到“靠上下文堆砌和口头解释”的状态。

---

## 2. 标准输出格式

推荐使用 YAML：

```yaml
page_name: 数据列表
page_goal: 快速定位待处理数据并完成编辑
task: browse-list
domain: data-management

template_bundle:
  layout:
    - layout/data-list
  collection:
    - collection/filter
    - collection/table
    - collection/pagination
    - collection/bulk-actions
  overlay:
    - overlay/drawer-right
  detail: []
  state:
    - state/loading
    - state/empty
    - state/error
    - state/success

context_pack:
  views:
    - templates/views/DataListView.vue
  components:
    - templates/components/WireFilter.vue
    - templates/components/WireTable.vue
    - templates/components/WirePagination.vue
    - templates/components/WireDrawer.vue
  references:
    - references/component-library.md#浮层语义约定
    - references/component-library.md#列表页语义约定
    - references/template-index.md#组合-a-数据管理列表-编辑抽屉

excluded:
  templates:
    - layout/dashboard
    - overlay/dialog-centered
    - detail/tabs
  reasons:
    - 当前页面不是仪表盘
    - 当前交互不需要阻塞式确认弹窗
    - 当前页面不是多标签详情页

selection_rationale:
  primary_view_reason: 页面主任务是 browse-list，因此选择 layout/data-list
  overlay_reason: 存在列表行编辑动作，且要求保留底层上下文，因此选择 overlay/drawer-right
  state_reason: 该页面必须可见 loading / empty / error / success 四类状态

review_focus:
  - 检查筛选区是否表达主任务和筛选路径
  - 检查表格是否明确默认排序、空态和批量动作
  - 检查抽屉是否写明 trigger / close / after_close

trace:
  source_input: references/selector-input-contract.md
  selector_rule: references/template-selector.md
  generated_from: 页面需求结构化输入 v1
```

---

## 3. 字段定义

### 基础字段

| 字段 | 必填 | 含义 |
|------|------|------|
| `page_name` | 是 | 页面名称 |
| `page_goal` | 是 | 页面主目标 |
| `task` | 是 | 主任务类型 |
| `domain` | 否 | 业务领域 |

### `template_bundle`

表示最终选中的模板分类结果。

固定分组：

- `layout`
- `collection`
- `overlay`
- `detail`
- `state`

要求：

- 每组必须存在
- 没选内容也要写空数组

### `context_pack`

表示真正应该给 AI 或设计流程加载的最小上下文。

固定分组：

- `views`
- `components`
- `references`

要求：

- 只列实际需要的文件
- 不允许出现整目录路径

错误示例：

```yaml
components:
  - templates/components/
```

正确示例：

```yaml
components:
  - templates/components/WireTable.vue
  - templates/components/WireDrawer.vue
```

### `excluded`

表示本次明确排除的模板，以及排除原因。

固定结构：

```yaml
excluded:
  templates: []
  reasons: []
```

要求：

- `templates` 和 `reasons` 一一对应
- 不能只写排除项，不写理由

### `selection_rationale`

表示为什么这么选，而不是只列结果。

固定字段：

- `primary_view_reason`
- `overlay_reason`
- `state_reason`

如果某项不适用，也要写：

- `overlay_reason: 当前页面无浮层，不加载 overlay 模板`

### `review_focus`

表示人审查时最该盯的 2~5 个点。

要求：

- 必须是可审查的问题
- 不能写泛话

错误：

- `看看页面是否正确`

正确：

- `检查抽屉关闭后是否保留当前分页和筛选条件`

### `trace`

表示这份结果从哪里来。

固定字段：

- `source_input`
- `selector_rule`
- `generated_from`

---

## 4. 产出规则

### Rule 1: 输出必须是“结果 + 理由 + 排除项”

如果只有 `template_bundle`，没有理由和排除项，这份结果不合格。

### Rule 2: `context_pack` 必须最小化

不能把全部模板当作上下文。

### Rule 3: `review_focus` 必须和当前组合相关

例如：

- 列表页 + 抽屉
  就该关注筛选区、表格、抽屉

- 仪表盘
  就该关注卡片区、图表区、异常指标

### Rule 4: 输出必须可落盘

不能只是聊天回复里的说明。

建议每页都生成一份：

- `template-selection.yaml`

### Rule 5: 结构必填，不把业务判断写死

`template-selection.yaml` 需要稳定结构，方便脚本和 AI 消费。

但这不意味着把业务正确性硬编码成规则。

例如下面这些应交给 AI / 人审，而不是写成硬脚本：

- 当前页面是否更适合 drawer 而不是 dialog
- 当前 `review_focus` 是否真的抓住了风险
- `excluded` 是否合理
- 页面目标和模板组合是否存在语义漂移

---

## 5. 生成流程

### Step 1

读取 `selector-input-contract` 的输入结果

### Step 2

按 `template-selector.md` 规则生成：

- `template_bundle`
- `context_pack`
- `excluded`

### Step 3

补充：

- `selection_rationale`
- `review_focus`
- `trace`

### Step 4

写入 `template-selection.yaml`

---

## 6. 典型输出案例

### Case A: 数据管理列表页 + 编辑抽屉

```yaml
page_name: 数据列表
page_goal: 快速定位待处理数据并完成编辑
task: browse-list
domain: data-management

template_bundle:
  layout:
    - layout/data-list
  collection:
    - collection/filter
    - collection/table
    - collection/pagination
    - collection/bulk-actions
  overlay:
    - overlay/drawer-right
  detail: []
  state:
    - state/loading
    - state/empty
    - state/error

context_pack:
  views:
    - templates/views/DataListView.vue
  components:
    - templates/components/WireFilter.vue
    - templates/components/WireTable.vue
    - templates/components/WirePagination.vue
    - templates/components/WireDrawer.vue
  references:
    - references/component-library.md#浮层语义约定
    - references/component-library.md#列表页语义约定

excluded:
  templates:
    - layout/dashboard
    - overlay/dialog-centered
    - detail/tabs
  reasons:
    - 当前页面不是仪表盘
    - 当前交互不需要阻塞式确认弹窗
    - 当前页面不是多标签详情页

selection_rationale:
  primary_view_reason: 主任务是 browse-list，因此选择列表页骨架
  overlay_reason: 编辑动作需要保留底层上下文，因此选择右侧抽屉而不是 dialog
  state_reason: 列表页必须可见 loading / empty / error

review_focus:
  - 检查筛选区是否说明主任务和筛选提示
  - 检查表格是否明确默认排序、空态和批量动作
  - 检查抽屉是否写明 trigger / close / after_close
```

---

## 7. 人和 AI 的使用方式

### 对人

这份输出让审查者不需要翻所有模板，只看：

- 选了什么
- 为什么选
- 没选什么
- 应该重点审什么

### 对 AI

这份输出让 AI 不需要再从长需求里回推模板。

AI 只要：

1. 读取 `template-selection.yaml`
2. 加载 `context_pack`
3. 生成 `wire.svg`

---

## 8. 最终目的

`Selector Output Contract` 是把“模板选择结果”从临时上下文，变成正式产物。

它的价值在于：

- 对人：能复核模板是否选对
- 对 AI：能最小化加载上下文
- 对项目：能把页面设计过程留痕、复盘、复用
