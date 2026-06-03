# Wire Template Selector

`Wire Template Index` 负责告诉你“有哪些模板”。

`Wire Template Selector` 负责告诉你“当前业务需求该怎么选模板、最少加载哪些内容、明确排除哪些无关模板”。

---

## 目录

- [1. 输入格式](#1-输入格式)
- [2. 选择规则](#2-选择规则)
- [3. 组合输出格式](#3-组合输出格式)
- [4. 最小上下文算法](#4-最小上下文算法)
- [5. 典型选择案例](#5-典型选择案例)
- [6. 审查者视角](#6-审查者视角)
- [7. AI 视角](#7-ai-视角)
- [8. 最终目的](#8-最终目的)

## 1. 输入格式

先把业务需求压缩成 4 个判断维度：

### A. 页面主任务

只能选一个主任务：

- `browse-list`：浏览/筛选/定位多条记录
- `edit-single`：查看并编辑单条对象
- `overview-metrics`：看总览、指标、趋势
- `confirm-risk`：执行高风险确认动作

### B. 交互载体

按需选择 0~N 个：

- `filter`
- `table`
- `pagination`
- `bulk-actions`
- `drawer-right`
- `drawer-left`
- `dialog-centered`
- `tabs`
- `form-section`
- `desc-list`

### C. 状态需求

按需选择：

- `loading`
- `empty`
- `error`
- `pending`
- `success`
- `permission-denied`

### D. 业务领域

可选，用于补默认组合：

- `data-management`
- `vehicle-management`
- `sensor-config`
- `dashboard-ops`

---

## 2. 选择规则

### Rule 1: 先选主视图模板

| 页面主任务 | 主视图模板 |
|-----------|-----------|
| `browse-list` | `layout/data-list` |
| `edit-single` | `layout/detail-form` |
| `overview-metrics` | `layout/dashboard` |
| `confirm-risk` | `layout/detail-form` 或承接页面 + `overlay/dialog-centered` |

**铁律：** 一次只允许 1 个主视图模板进入上下文。

---

### Rule 2: 再选交互载体模板

| 交互载体 | 模板索引 |
|---------|---------|
| `filter` | `collection/filter` |
| `table` | `collection/table` |
| `pagination` | `collection/pagination` |
| `bulk-actions` | `collection/bulk-actions` |
| `drawer-right` | `overlay/drawer-right` |
| `drawer-left` | `overlay/drawer-left` |
| `dialog-centered` | `overlay/dialog-centered` |
| `tabs` | `detail/tabs` |
| `form-section` | `detail/form-section` |
| `desc-list` | `detail/desc-list` |

**铁律：** 不需要的载体不要加载。

例子：
- 页面没有浮层，就不要把 `overlay/*` 带进去
- 页面只有抽屉，不要同时带 `dialog-centered`

---

### Rule 3: 再选状态模板

至少显式判断这 5 类：

- `loading`
- `empty`
- `error`
- `pending`
- `success`

结论必须是二选一：

- `适用`：加入当前上下文
- `不适用`：明确排除

不能默认全带。

---

### Rule 4: 业务领域只做补强，不替代主任务判断

领域模板只是快捷入口，不是直接跳过选择流程。

例如：
- `data-management` 不能直接等于“把所有列表模板和抽屉模板都带上”
- 仍然要先判断是不是 `browse-list`

---

## 3. 组合输出格式

每次选择都要输出下面 3 份内容。

### A. 模板组合

```yaml
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
  state:
    - state/loading
    - state/empty
    - state/error
  detail: []
```

### B. 最小上下文清单

```yaml
context_pack:
  - templates/views/DataListView.vue
  - templates/components/WireFilter.vue
  - templates/components/WireTable.vue
  - templates/components/WirePagination.vue
  - templates/components/WireDrawer.vue
  - references/component-library.md#浮层语义约定
  - references/component-library.md#列表页语义约定
```

### C. 显式排除项

```yaml
excluded:
  - layout/dashboard
  - overlay/dialog-centered
  - detail/tabs
  - domain/sensor-config
reason:
  - 当前页面不是仪表盘
  - 当前交互不需要阻塞式确认弹窗
  - 当前页面不是多标签详情页
```

---

## 4. 最小上下文算法

### 算法目标

不是“给 AI 最多信息”，而是“给 AI 最少但足够的信息”。

### Step 1

加载主视图模板：

- 必须加载 1 个

### Step 2

加载本页面直接用到的组件模板：

- 只加载命中的组件
- 不加载未使用组件

### Step 3

加载对应的规则段落：

- 浮层语义约定
- 列表页语义约定
- 三角链接约定（若涉及 `data-node`）

### Step 4

禁止整库加载：

禁止以下做法：

- 读取 `templates/views/` 全部文件
- 读取 `templates/components/` 全部文件
- 读取 `references/` 全部文件

---

## 5. 典型选择案例

### Case A: 数据管理列表页 + 编辑抽屉

输入：

```yaml
task: browse-list
interactions:
  - filter
  - table
  - pagination
  - bulk-actions
  - drawer-right
states:
  - loading
  - empty
  - error
domain: data-management
```

输出：

```yaml
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
  state:
    - state/loading
    - state/empty
    - state/error
excluded:
  - layout/dashboard
  - overlay/dialog-centered
  - detail/tabs
```

### Case B: 配置详情页 + 提交确认弹窗

输入：

```yaml
task: edit-single
interactions:
  - form-section
  - dialog-centered
states:
  - error
  - success
domain: sensor-config
```

输出：

```yaml
template_bundle:
  layout:
    - layout/detail-form
  detail:
    - detail/form-section
  overlay:
    - overlay/dialog-centered
  state:
    - state/error
    - state/success
excluded:
  - layout/dashboard
  - collection/table
  - overlay/drawer-right
```

### Case C: 仪表盘首页 + 最近任务表

输入：

```yaml
task: overview-metrics
interactions:
  - table
states:
  - pending
  - error
domain: dashboard-ops
```

输出：

```yaml
template_bundle:
  layout:
    - layout/dashboard
  collection:
    - collection/table
  state:
    - state/pending
    - state/error
excluded:
  - collection/filter
  - overlay/drawer-right
  - overlay/dialog-centered
```

---

## 6. 审查者视角

审查者不需要知道整个模板库，只要看这 4 项：

1. 主视图是否选对
2. 交互载体是否选全/选多
3. 状态模板是否遗漏
4. 排除项是否合理

如果这 4 项对了，`wire.svg` 的质量通常会稳定很多。

---

## 7. AI 视角

AI 生成 `wire` 时，应遵循：

1. 先输出选择结果
2. 再说明最小上下文清单
3. 再按组合生成页面

不允许：

- 先读全库再“自由发挥”
- 不做排除项说明
- 只说“我选了 DataListView”但不说为什么没选别的模板

---

## 8. 最终目的

选择器不是多一层文档，而是把模板使用过程变成一种可审查、可复用、可节省 token 的规则。

它的价值在于：

- 对人：减少拍脑袋选模板
- 对 AI：减少无关上下文
- 对项目：减少模板滥用和表达漂移
