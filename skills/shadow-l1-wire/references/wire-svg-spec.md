# Wire SVG 详细技术规格

> 本文档从 SKILL.md 提取，是 SVG 结构的完整参考。SKILL.md 中保留摘要和指针。

## 目录

- [1. SVG 根节点与 viewBox 规则](#1-svg-根节点与-viewbox-规则)
- [2. g 分组标签结构](#2-g-分组标签结构)
- [3. data-* 属性完整定义](#3-data--属性完整定义)
- [4. metadata 格式](#4-metadata-格式)
- [5. visibility 切换规则](#5-visibility-切换规则)
- [6. SVG 设计原则](#6-svg-设计原则)
- [7. 下游传导规则](#7-下游传导规则)
- [8. 完整示例：自动驾驶数据平台 — 标注编辑器](#8-完整示例自动驾驶数据平台-标注编辑器)

## 1. SVG 根节点与 viewBox 规则

### 根节点结构

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH} {HEIGHT}" width="{WIDTH}" height="{HEIGHT}">
```

### viewBox 规则

- **真实尺寸**：使用接近真实屏幕的尺寸，推荐 `1000x700`（数据列表页）或 `1200x800`（编辑器/复杂页面）
- **同一项目所有页面共用同一 viewBox**（品味约束："比例就是秩序"）
- **坐标从左上角 (0,0) 开始**，y 轴向下增长
- **不得使用随意数值**：每个 x/y/width/height 必须有设计意图

### 根节点属性

| 属性 | 值 | 说明 |
|------|-----|------|
| `xmlns` | `http://www.w3.org/2000/svg` | SVG 命名空间 |
| `viewBox` | `"0 0 W H"` | 画布尺寸 |
| `width` | 同 viewBox W | 显式宽度 |
| `height` | 同 viewBox H | 显式高度 |

## 2. `<g>` 分组标签结构

### 页面级分组

每个页面/弹窗/抽屉用独立 `<g>` 包裹：

```svg
<g id="page-{name}" data-page="{PageName}" data-route="/{path}" data-state="{state}">
  <!-- 页面内容 -->
</g>
```

### 区域级分组

页面内按业务分区：

```svg
<g id="header">...</g>    <!-- 导航栏 -->
<g id="sidebar">...</g>   <!-- 侧边栏 -->
<g id="main">...</g>      <!-- 主内容区 -->
<g id="footer">...</g>    <!-- 状态栏 -->
```

### 交互元素分组

每个可交互元素用 `<g>` 包裹，携带 data-* 属性：

```svg
<g id="action-{verb}-{object}"
   data-node="BXX-NYY"
   data-rule="{slug}-RXX"
   data-action="verb-object"
   data-target="page|dialog|api"
   data-ux="primary|secondary|danger|ghost">
  <rect .../>
  <text .../>
</g>
```

### 状态变体分组

每个状态用独立 `<g>` + `data-state` 区分：

```svg
<g id="page-{name}-normal" data-page="{PageName}" data-state="normal">
  <!-- 正常态内容 -->
</g>
<g id="page-{name}-loading" data-page="{PageName}" data-state="loading" visibility="hidden">
  <!-- 加载态内容 -->
</g>
```

### 分组 ID 命名规则

| 类型 | ID 格式 | 示例 |
|------|---------|------|
| 页面 | `page-{kebab-name}` | `page-task-list` |
| 弹窗 | `dialog-{kebab-name}` | `dialog-confirm-submit` |
| 抽屉 | `drawer-{position}-{name}` | `drawer-right-filters` |
| 交互 | `action-{verb}-{object}` | `action-create-annotation` |
| 状态变体 | `page-{name}-{state}` | `page-task-list-empty` |

## 3. data-* 属性完整定义

### 3.1 data-node

| 属性 | 来源 | 格式 | 示例 |
|------|------|------|------|
| `data-node` | project.flow.mermaid | `B{XX}-N{YY}` | `data-node="B02-N07"` |

- 每个可交互元素标注其在 flow 中对应的节点
- 必须在 flow 中有对应节点，否则标注无效

### 3.2 data-rule

| 属性 | 来源 | 格式 | 示例 |
|------|------|------|------|
| `data-rule` | spec.md | `{slug}-R{XX}` | `data-rule="annotation-R02"` |

- 关联 spec 中的用户交互类规则
- 纯后端规则不需要在 SVG 中标注

### 3.3 data-action

| 属性 | 来源 | 格式 | 示例 |
|------|------|------|------|
| `data-action` | §2 交互清单 | `{verb}-{object}` | `data-action="create-annotation"` |

- 描述用户执行的动作
- verb 推荐：create/submit/save/delete/approve/reject/open/close/filter/search/paginate/export

### 3.4 data-target

| 属性 | 来源 | 格式 | 示例 |
|------|------|------|------|
| `data-target` | 跳转/弹窗/API 目标 | `{type}.{detail}` | `data-target="api.POST./api/annotations"` |

**目标类型**：

| 前缀 | 含义 | 示例 |
|------|------|------|
| `page.` | 页面跳转 | `page.task-list` |
| `dialog.` | 弹窗打开 | `dialog.confirm-submit` |
| `drawer.` | 抽屉打开 | `drawer.right.filters` |
| `api.{METHOD}.{path}` | API 调用 | `api.POST./api/annotations` |
| `state.{state-name}` | 状态切换 | `state.loading` |

### 3.5 data-ux

| 属性 | 含义 | 视觉表现 | 使用场景 |
|------|------|---------|---------|
| `primary` | 主要操作 | 实色填充按钮 | 页面核心 CTA（创建、提交、保存） |
| `secondary` | 次要操作 | 描边按钮 | 辅助操作（取消、返回） |
| `danger` | 危险操作 | 红色按钮 | 删除、批量驳回 |
| `ghost` | 幽灵操作 | 纯文字/链接 | 导航链接、折叠按钮 |
| `disabled` | 禁用操作 | 灰色不可点击 | 条件未满足时的按钮 |

**约束**：`data-ux="danger"` 仅用于真正的危险操作（删除、批量驳回），不得滥用。

### 3.6 data-page / data-route / data-state

| 属性 | 含义 | 示例 |
|------|------|------|
| `data-page` | 页面组件名 | `data-page="TaskListPage"` |
| `data-route` | 路由路径 | `data-route="/tasks"` |
| `data-state` | 当前状态 | `data-state="normal"` |

- 每个页面必须有 `data-page` 或 `id="page-..."`
- 路由型页面必须有 `data-route`
- 状态变体用 `data-state` 区分

### 3.7 data-journey（可选）

| 属性 | 来源 | 格式 | 示例 |
|------|------|------|------|
| `data-journey` | research.md 旅程 | `J-{XX}` | `data-journey="J-01"` |

- 标注该交互元素关联的旅程编号
- 可选属性，用于辅助旅程覆盖追踪

## 4. metadata 格式

### 4.1 wire-contract（代码实现摘要）

放在 SVG 末尾，供下游 L1.5/L5 消费：

```svg
<metadata id="wire-contract">
pages:
  - id: page-{name}
    route: /{path}
    component: {ComponentName}
    states: [normal, loading, empty, error]
interactions:
  - id: action-{verb}-{object}
    node: BXX-NYY
    rule: {slug}-RXX
    action: verb-object
    target: {type}.{detail}
    implement: frontend/src/pages/{ComponentName}.tsx
</metadata>
```

### 4.2 wire-coverage（旅程覆盖摘要）

供 L2 覆盖矩阵验证、Agent Worker 审查：

```svg
<metadata id="wire-coverage">
journey_coverage:
  pages:
    - id: page-{name}
      journeys: [J-XX, J-YY]
      personas: [P-ZZ]
  uncovered_journeys: []
  coverage_report:
    total_journeys: N
    covered_journeys: N
    coverage: 100%
</metadata>
```

**约束**：
- `uncovered_journeys` 必须为空，不为空时 wire 不可进入下一层
- L1 Gate 会检查 `wire-coverage` 中的 `coverage` 是否为 100%

## 5. visibility 切换规则

状态变体用 `visibility` 属性控制显示/隐藏：

```svg
<!-- normal 状态：默认可见，不加 visibility 属性 -->
<g id="page-task-list-normal" data-state="normal">
  ...
</g>

<!-- 其他状态：默认 hidden -->
<g id="page-task-list-loading" data-state="loading" visibility="hidden">
  ...
</g>
<g id="page-task-list-empty" data-state="empty" visibility="hidden">
  ...
</g>
<g id="page-task-list-error" data-state="error" visibility="hidden">
  ...
</g>
```

**规则**：
- `normal` 状态不加 `visibility` 属性（默认可见）
- 所有非 normal 状态加 `visibility="hidden"`
- 下游通过 `visibility` 属性识别状态变体

## 6. SVG 设计原则

| 原则 | 说明 |
|------|------|
| **先规划布局** | 先划分页面区域（header/sidebar/main/footer），再画元素 |
| **先列全页面** | 所有页面、弹窗、抽屉、空状态页、错误页都必须在 SVG 中可见 |
| **用颜色区分层次** | 主内容 `#fff`、侧边栏 `#fafafa`、header `#f5f5f5` |
| **用分组组织元素** | `<g id="header">`、`<g id="main">` 分组便于理解 |
| **标注交互节点** | 每个可点击元素必须有 `data-node/data-rule/data-action/data-target` |
| **尺寸真实** | 用真实尺寸（如 1000x700），而非随意数值 |
| **状态变体分组** | 用 `<g id="main-normal">`、`<g id="main-empty">` 区分状态 |
| **传导到实现** | 关键页面/交互必须标注预期 route/component/api 或 implementation hint |

### 颜色规范

| 元素 | 颜色 | 说明 |
|------|------|------|
| 主内容区背景 | `#fff` | 白色 |
| 侧边栏背景 | `#fafafa` | 浅灰 |
| Header 背景 | `#f5f5f5` | 灰色 |
| Footer 背景 | `#f0f0f0` | 深灰 |
| 主操作按钮 | `#1890ff` | 蓝色 |
| 成功操作按钮 | `#52c41a` | 绿色 |
| 危险操作按钮 | `#ff4d4f` | 红色 |
| 错误态背景 | `#fff2f0` | 浅红 |
| 错误态边框 | `#ffccc7` | 红色边框 |
| 空态背景 | `#fafafa` | 浅灰 |
| 占位文字 | `#ccc` | 淡灰 |
| 辅助文字 | `#999` | 灰色 |
| 正文文字 | `#333` | 深灰 |
| 标题文字 | `#333` | 深灰加粗 |
| 次要文字 | `#666` | 灰色 |

## 7. 下游传导规则

下游必须按代码实现契约传导：

- **L1.5**：从 `data-page/data-route/data-action/data-target/data-state` 生成页面清单、组件清单、API 清单和状态管理边界
- **L5 Harness**：每个前端文件指令引用对应 SVG `id`，并声明 props/state/actions/events/ui-contract
- **L4**：每个 `data-action` 至少有一个交互测试或 E2E 场景覆盖
- **L5**：实现文件头必须引用 `L1-Wire` 区域或 `data-action`，UI 行为不能少于 SVG 契约

## 8. 完整示例：自动驾驶数据平台 — 标注编辑器

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800">
  <metadata id="wire-contract">
    project: 自动驾驶数据平台
    pages: page-collection-map, page-collection-detail, page-task-list, page-annotator, page-review, page-simulation-player, page-simulation-report
  </metadata>

  <!-- 标注编辑器主画面 -->
  <rect x="20" y="60" width="860" height="520" rx="4" fill="#1a1a2e" stroke="#333"/>
  <text x="450" y="320" font-size="14" fill="#666" text-anchor="middle">视频/点云画面区域</text>

  <!-- 标注工具栏 -->
  <g data-node="B02-N07" data-rule="annotation-R02" data-action="create-annotation">
    <rect x="900" y="60" width="280" height="36" rx="4" fill="#1890ff"/>
    <text x="1040" y="84" font-size="14" fill="#fff" text-anchor="middle">+ 创建标注</text>
  </g>

  <!-- 提交按钮 -->
  <g data-node="B02-N08" data-rule="annotation-R03" data-action="submit-annotation" data-target="dialog-confirm-submit" data-ux="primary">
    <rect x="900" y="520" width="280" height="36" rx="4" fill="#52c41a"/>
    <text x="1040" y="544" font-size="14" fill="#fff" text-anchor="middle">提交质检</text>
  </g>

  <!-- 帧导航 -->
  <g data-action="prev-frame" data-target="frame-viewer">
    <text x="920" y="620" font-size="20" fill="#1890ff">◀ 上一帧</text>
  </g>
  <g data-action="next-frame" data-target="frame-viewer">
    <text x="1100" y="620" font-size="20" fill="#1890ff">下一帧 ▶</text>
  </g>

  <!-- 空态 -->
  <g data-state="empty" visibility="hidden">
    <text x="450" y="320" font-size="16" fill="#999" text-anchor="middle">暂无标注</text>
    <text x="450" y="350" font-size="14" fill="#1890ff" text-anchor="middle">点击"+ 创建标注"开始标注</text>
  </g>

  <!-- 加载态 -->
  <g data-state="loading" visibility="hidden">
    <text x="450" y="320" font-size="14" fill="#999" text-anchor="middle">加载帧数据...</text>
  </g>

  <metadata id="wire-coverage">
    coverage: 100%
    total_journeys: 8
    covered_journeys: J-01, J-02, J-03, J-04, J-05, J-06, J-07, J-08
    uncovered_journeys: []
  </metadata>
</svg>
```
