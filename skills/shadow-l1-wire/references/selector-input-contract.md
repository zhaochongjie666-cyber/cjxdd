# Selector Input Contract

这份文档定义 `Wire Template Selector` 的标准输入。

目标是让人和 AI 在进入 `wire` 设计前，先用同一份结构化输入描述页面需求，避免：

- 直接把整段需求全文塞进上下文
- 模板选择依赖隐含理解
- 人和 AI 对“当前页面要解决什么问题”理解不一致

---

## 1. 输入目标

输入只回答 4 件事：

1. 当前页面的主任务是什么
2. 当前页面需要哪些交互载体
3. 当前页面要覆盖哪些状态
4. 当前页面属于什么业务领域

如果这 4 件事答不清，先不要进入 `wire` 设计。

---

## 2. 标准输入格式

推荐使用 YAML：

```yaml
page_name: 数据列表
page_goal: 快速定位待处理数据并完成编辑
task: browse-list
domain: data-management

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
  - success

primary_actions:
  - label: 新增数据
    target: drawer-right
  - label: 编辑
    target: drawer-right
  - label: 批量删除
    target: table

overlay_rules:
  - type: drawer-right
    trigger: 点击表格行“编辑”
    close: 右上角关闭 / 遮罩关闭
    after_close: 回到列表页并保留当前筛选与分页

table_rules:
  default_sort: 创建时间倒序
  empty_text: 当前筛选条件下暂无数据
  bulk_hint: 支持批量导入、导出、删除

filter_rules:
  primary_goal: 快速定位待处理数据并缩小结果集
  search_hint: 优先按名称、状态、时间范围组合筛选
```

---

## 3. 字段定义

### 基础字段

| 字段 | 必填 | 含义 |
|------|------|------|
| `page_name` | 是 | 页面名称 |
| `page_goal` | 是 | 页面主目标，用一句话描述 |
| `task` | 是 | 主任务类型 |
| `domain` | 否 | 业务领域 |

### `task` 枚举

只能选一个：

- `browse-list`
- `edit-single`
- `overview-metrics`
- `confirm-risk`

### `interactions`

可多选：

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

### `states`

可多选：

- `loading`
- `empty`
- `error`
- `pending`
- `success`
- `permission-denied`

---

## 4. 约束规则

### Rule 1: `task` 必须唯一

错误示例：

```yaml
task:
  - browse-list
  - overview-metrics
```

正确做法：

- 如果主要是列表页，就选 `browse-list`
- 如果列表只是仪表盘中的附属区块，主任务仍然选 `overview-metrics`

### Rule 2: `interactions` 只能写用户可见载体

不要写技术实现词：

错误：

- `api`
- `store`
- `service`
- `router`

正确：

- `drawer-right`
- `table`
- `filter`

### Rule 3: `states` 不能省略

就算某个状态不适用，也应该显式判断后排除。

至少要思考：

- `loading`
- `empty`
- `error`

### Rule 4: 浮层必须补规则

如果 `interactions` 里出现：

- `drawer-right`
- `drawer-left`
- `dialog-centered`

那么必须补 `overlay_rules`。

至少写清：

- `trigger`
- `close`
- `after_close`

### Rule 5: 列表页必须补列表规则

如果 `interactions` 里出现 `table`，那么建议补：

- `default_sort`
- `empty_text`
- `bulk_hint`

### Rule 6: 筛选区必须补筛选规则

如果 `interactions` 里出现 `filter`，那么建议补：

- `primary_goal`
- `search_hint`

---

## 5. 人工填写流程

### Step 1

先写 `page_goal`。

如果一句话说不清页面的主目标，说明需求本身还没收敛。

### Step 2

选 `task`。

只能选一个最主要的任务，不允许“都算”。

### Step 3

列出用户真正能看到的交互载体。

不要写实现层对象，只写界面层对象。

### Step 4

列出必须可见的状态。

### Step 5

如果有抽屉/弹窗/列表/筛选区，补充对应规则。

---

## 6. AI 消费方式

AI 不应该直接从长需求里猜模板。

正确流程：

1. 先将需求压缩成 `Selector Input Contract`
2. 再把这份输入喂给 `template-selector.md`
3. 生成：
   - `template_bundle`
   - `context_pack`
   - `excluded`
4. 最后再开始生成 `wire.svg`

---

## 7. 输出映射关系

输入字段和后续产物的关系：

| 输入字段 | 下游消费 |
|---------|---------|
| `task` | 选择主视图模板 |
| `interactions` | 选择组件模板 / 浮层模板 |
| `states` | 决定需要覆盖哪些可见状态 |
| `overlay_rules` | 决定 `WireDialog` / `WireDrawer` 的审查语义 |
| `table_rules` | 决定列表区的默认审查提示 |
| `filter_rules` | 决定筛选区的主任务与筛选提示 |

---

## 8. 最小输入示例

### 示例 A：列表页 + 编辑抽屉

```yaml
page_name: 数据列表
page_goal: 快速定位待处理数据并完成编辑
task: browse-list
domain: data-management
interactions:
  - filter
  - table
  - pagination
  - drawer-right
states:
  - loading
  - empty
  - error
overlay_rules:
  - type: drawer-right
    trigger: 点击表格行“编辑”
    close: 右上角关闭 / 遮罩关闭
    after_close: 回到列表页并保留当前筛选与分页
table_rules:
  default_sort: 创建时间倒序
  empty_text: 当前筛选条件下暂无数据
filter_rules:
  primary_goal: 快速定位待处理数据并缩小结果集
```

### 示例 B：详情编辑页 + 确认弹窗

```yaml
page_name: 传感器配置
page_goal: 修改参数并确认提交
task: edit-single
domain: sensor-config
interactions:
  - form-section
  - dialog-centered
states:
  - error
  - success
overlay_rules:
  - type: dialog-centered
    trigger: 点击“保存”
    close: 取消 / 右上角关闭
    after_close: 回到详情表单并保留已填写内容
```

---

## 9. 反模式

以下输入方式无效：

- 只有自然语言大段描述，没有结构化字段
- `task` 选多个
- `interactions` 写成技术层对象
- 有抽屉但不写 `overlay_rules`
- 有表格但不写任何列表规则

---

## 10. 最终目的

`Selector Input Contract` 是把“需求理解”变成一份可审查、可复用、可压缩的结构化输入。

它的作用是：

- 对人：逼着你先想清楚页面主任务和交互边界
- 对 AI：降低上下文噪音，减少猜测
- 对项目：让模板选择过程标准化、可复核、可追溯
