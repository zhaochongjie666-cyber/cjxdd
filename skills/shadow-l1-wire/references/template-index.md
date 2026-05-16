# Wire Template Index

`Wire SVG` 的目标不是堆模板，而是按业务需求选择最少、最合适的 SVG 分区、交互和状态表达。

## 核心原则

1. 先识别页面类型，再选基础视图模板
2. 再识别交互载体，补浮层/表单/状态模板
3. 再识别状态需求，补空态/错误态/待处理态
4. 只加载当前业务需要的模板，不把整个模板库塞进上下文

## 3-Pass 模板消费指引

模板按 3-Pass 渐进式精化流水线分批加载，每 pass 只消费自己需要的模板类型：

```
Pass 1（大块骨架）  → 只加载 layout/*        → 确定页面分区和尺寸
Pass 2（小块填充）  → 加载 collection/*        → 填充筛选/表格/分页/批量操作
                      加载 overlay/*           → 填充弹窗/抽屉结构
                      加载 detail/*            → 填充表单/详情/标签页
Pass 3（细节契约）  → 加载 state/*            → 添加 loading/empty/error 状态变体
```

| 模板类别 | 消费 pass | 何时加载 |
|---------|-----------|---------|
| `layout/*` | Pass 1 | 每个页面选 1 个主型，确定骨架分区 |
| `collection/*` | Pass 2 | 页面有筛选/列表/分页/批量操作时 |
| `overlay/*` | Pass 2 | 页面有弹窗/抽屉时 |
| `detail/*` | Pass 2 | 页面有表单/详情/标签页时 |
| `state/*` | Pass 3 | 每个页面都需判断，至少选 4 类状态 |
| `domain/*` | — | 预组合参考，内部仍按 pass 分步展开 |

**禁止在 Pass 1 加载 collection/overlay/detail/state 模板。**
**禁止在 Pass 2 加载 state 模板。**
**禁止跨 pass 跳步。**

## 索引结构

### 1. `layout/*` — 页面骨架

| 索引 | 适用场景 | 推荐模板 |
|------|---------|---------|
| `layout/data-list` | 列表页、管理台、数据中台 | `templates/views/DataListView.vue` |
| `layout/dashboard` | 首页、总览、监控盘 | `templates/views/DashboardView.vue` |
| `layout/detail-form` | 详情页、编辑页、配置页 | `DataListView.vue` 变体 + `WireForm` / `WireDescList` |

### 2. `collection/*` — 数据交互区

| 索引 | 作用 | 推荐组件 |
|------|------|---------|
| `collection/filter` | 筛选、检索、搜索入口 | `WireFilter` |
| `collection/table` | 列表数据承接 | `WireTable` |
| `collection/pagination` | 翻页、每页数量 | `WirePagination` |
| `collection/bulk-actions` | 批量导入/导出/删除 | `WireButton` + 操作栏 |

### 3. `overlay/*` — 浮层载体

| 索引 | 作用 | 推荐组件 |
|------|------|---------|
| `overlay/dialog-centered` | 阻塞式确认、提交前二次确认 | `WireDialog` |
| `overlay/drawer-right` | 列表页右侧编辑、配置面板 | `WireDrawer placement="right"` |
| `overlay/drawer-left` | 辅助导航、树结构选择 | `WireDrawer placement="left"` |
| `overlay/drawer-bottom` | 移动端/底部详情 | `WireDrawer placement="bottom"` |

### 4. `state/*` — 可见状态

| 索引 | 作用 | 推荐组件 |
|------|------|---------|
| `state/loading` | 加载中 | `WireBadge` + 占位区 |
| `state/empty` | 空态 | `WireBadge` + 空数据文案 |
| `state/error` | 错误提示 | `WireBadge` + 行内错误/浮层错误说明 |
| `state/pending` | 待处理 | `WireBadge type="warning"` |
| `state/success` | 完成/成功 | `WireBadge type="success"` |

### 5. `detail/*` — 详情编辑区

| 索引 | 作用 | 推荐组件 |
|------|------|---------|
| `detail/form-section` | 分组表单 | `WireForm` |
| `detail/desc-list` | 只读详情 | `WireDescList` |
| `detail/tabs` | 分标签详情 | `WireTabs` |

### 5.5 `interaction/*` — 特殊交互模式

| 索引 | 作用 | SVG 标注约定 |
|------|------|-------------|
| `interaction/drag-sort` | 拖拽排序（看板卡片、列表项重排） | 源元素: `data-action="drag-{noun}"`，目标区域: `data-target="drop-zone-{id}"`，视觉表达: 虚线框+移动箭头 |
| `interaction/bulk-select` | 批量选择+批量操作 | 选择框: `data-action="select-item"`，全选: `data-action="select-all"`，操作栏: 浮动 action bar |
| `interaction/inline-edit` | 行内编辑（点击文字→变输入框） | 静态态: `data-state="viewing"`，编辑态: `data-state="editing"`，用虚线框标注切换 |

**拖拽排序 SVG 示例**：
```svg
<!-- 拖拽源 -->
<g data-action="drag-card" data-rule="kanban-R03" data-target="drop-zone-column-done">
  <rect .../>  <text>任务卡片</text>
</g>
<!-- 放置目标 -->
<g id="drop-zone-column-done" data-state="column-done">
  <rect stroke-dasharray="5,5" .../>  <text>已完成</text>
</g>
```

### 6. `domain/*` — 业务领域变体

| 索引 | 场景 | 基础组合 |
|------|------|---------|
| `domain/data-management` | 数据管理、标注管理 | `layout/data-list` + `collection/filter` + `collection/table` + `overlay/drawer-right` |
| `domain/vehicle-management` | 车辆管理 | `layout/data-list` + `collection/filter` + `collection/table` + `detail/form-section` |
| `domain/sensor-config` | 传感器配置、标定参数 | `layout/detail-form` + `detail/tabs` + `overlay/dialog-centered` |
| `domain/dashboard-ops` | 运营/监控总览 | `layout/dashboard` + `collection/table` + `state/pending` |

## 选择流程（按 3-Pass 分步执行）

### Pass 1 — Step 1: 识别页面主型

只选一个主型，只决定布局骨架：

- 如果页面主任务是"查找/筛选/浏览多条记录" → `layout/data-list`
- 如果页面主任务是"看总览和统计" → `layout/dashboard`
- 如果页面主任务是"看详情并修改单条对象" → `layout/detail-form`

**产出**：每个页面的骨架结构（header/sidebar/main/footer 分区 + 尺寸）。**Pass 1 结束，不进 Step 2-4。**

### Pass 2 — Step 2: 识别交互载体

在已有骨架上按需附加内容模板：

- 需要筛选/搜索 → `collection/filter`
- 需要表格 → `collection/table`
- 需要分页 → `collection/pagination`
- 需要批量操作 → `collection/bulk-actions`
- 需要编辑侧栏 → `overlay/drawer-right`
- 需要二次确认 → `overlay/dialog-centered`
- 需要表单 → `detail/form-section`
- 需要只读详情 → `detail/desc-list`
- 需要标签切换 → `detail/tabs`

**产出**：各分区内的内容填充。**Pass 2 结束，不进 Step 3。**

### Pass 3 — Step 3: 识别状态需求

在已有内容上叠加状态变体。至少检查这 5 个状态是否适用：

- `state/loading`
- `state/empty`
- `state/error`
- `state/pending`
- `state/success`

不是全部都强制画满，但必须显式判断"适用 / 不适用"。

**产出**：各状态的变体 `<g>` 区域 + data-state 标注 + metadata。

### 模板组装规则

只把命中的模板组合进当前页面。同一页面的 layout/collection/overlay/detail/state 按 pass 分步加载，不一次性全部塞入上下文。

## 典型组合

以下组合展示了各 pass 的模板分配。AI 执行时不直接加载组合，而是按 pass 分批加载对应的模板。

```
组合 A (data-list + drawer) 的 3-pass 分解:
  Pass 1: layout/data-list                    → 骨架分区
  Pass 2: collection/filter + collection/table 
          + collection/pagination 
          + collection/bulk-actions 
          + overlay/drawer-right              → 内容填充
  Pass 3: state/loading + state/empty + state/error  → 状态变体
```

### 组合 A：数据管理列表 + 编辑抽屉

适用：
- 数据中台
- 标注数据管理
- 后台记录管理

模板组合：
- `layout/data-list`
- `collection/filter`
- `collection/table`
- `collection/pagination`
- `collection/bulk-actions`
- `overlay/drawer-right`
- `state/loading`
- `state/empty`
- `state/error`

输出重点：
- 筛选区主任务
- 列表默认排序
- 批量动作
- 行操作按钮
- 抽屉触发源 / 关闭方式 / 关闭后回落

### 组合 B：详情页 + 确认弹窗

适用：
- 配置修改
- 审批提交
- 风险操作确认

模板组合：
- `layout/detail-form`
- `detail/form-section`
- `overlay/dialog-centered`
- `state/error`
- `state/success`

输出重点：
- 表单分组
- 提交按钮
- dialog 打开条件
- 确认后的成功/失败反馈

### 组合 C：仪表盘 + 最近任务表

适用：
- 首页总览
- 运营监控
- 管理驾驶舱

模板组合：
- `layout/dashboard`
- `collection/table`
- `state/pending`
- `state/error`

输出重点：
- 卡片区、图表区、任务列表区
- 最近任务状态
- 异常指标提示

## 人审视角

人审时不要通读整个模板库，只检查当前组合是否回答了这些问题：

1. 页面主任务是什么
2. 布局主区怎么分
3. 用户下一步点哪里
4. 浮层从哪里出现、怎么关闭、回到哪里
5. 默认状态、空态、错误态是否交代
6. `data-node` 是否挂在用户真能看到的动作/反馈上

## AI 执行视角（3-Pass 最小上下文）

AI 按 pass 分步加载模板，每 pass 只加载当前阶段需要的模板：

**Pass 1（大块骨架）**：
- 当前页面对应的 `layout/*`（仅 1 个）

**Pass 2（小块填充）**：
- 当前页面需要的 `collection/*`（按需加载）
- 当前页面需要的 `overlay/*`（0~2 个）
- 当前页面需要的 `detail/*`（按需加载）

**Pass 3（细节契约）**：
- 当前页面需要的 `state/*`（至少判断 4 类状态）
- `component-library.md` 中涉及到的组件段落

禁止把所有模板一次全文塞进上下文。每 pass 只加载该阶段需要的模板类型。

## 反模式

以下做法会浪费 token，并降低设计质量：

- 把所有 `templates/` 文件一起塞给 AI
- 不区分列表页、详情页、仪表盘，统一从一个模板硬改
- 不做索引，靠长上下文让 AI"自己理解"
- 页面明明没有抽屉，却一并带入所有浮层模板
- 业务只需要列表 + 抽屉，却把 dashboard / sensor / form-detail 全部塞入
- **跨 Pass 跳步**：在 Pass 1 阶段加载 state/* 或 collection/* 模板
- **一次生成**：不经过 3-Pass 逐步精化，直接尝试生成完整的 wire.svg
- **Pass 内越界**：Pass 1 就开始画具体内容，或 Pass 2 已经加了 data-node 属性

## 最终目标

`Wire SVG` 不应该是模板堆，而应该是：

- 对人：可审查的页面契约
- 对 AI：可执行的结构化输入
- 对知识系统：可索引、可组合、可最小化加载的模板体系
