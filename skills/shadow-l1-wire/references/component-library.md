# Shadow L1 Wire Vue 组件库

参考 Element Plus 组件设计，提供 Vue 3 单文件组件 (.vue) 模板。

## 组件映射表

| Element Plus | Vue 组件 | 文件 | 用途 |
|-------------|---------|------|------|
| `el-container` | `WireContainer` | `components/WireContainer.vue` | 页面布局容器 |
| `el-aside` | `WireSidebar` | `components/WireSidebar.vue` | 侧边导航栏 |
| `el-header` | `WireHeader` | `components/WireHeader.vue` | 顶部标题栏 |
| `el-main` | `WireMain` | `components/WireMain.vue` | 主内容区 |
| `el-table` | `WireTable` | `components/WireTable.vue` | 数据表格 |
| `el-pagination` | `WirePagination` | `components/WirePagination.vue` | 分页器 |
| `el-form` | `WireForm` | `components/WireForm.vue` | 表单 |
| `el-input` | `WireInput` | `components/WireInput.vue` | 输入框 |
| `el-select` | `WireSelect` | `components/WireSelect.vue` | 下拉选择 |
| `el-button` | `WireButton` | `components/WireButton.vue` | 按钮 |
| `el-tag` | `WireBadge` | `components/WireBadge.vue` | 标签/状态 |
| `el-dialog` | `WireDialog` | `components/WireDialog.vue` | 对话框 |
| `el-drawer` | `WireDrawer` | `components/WireDrawer.vue` | 抽屉 |
| `el-tabs` | `WireTabs` | `components/WireTabs.vue` | 标签页 |
| `el-tree` | `WireTree` | `components/WireTree.vue` | 树形控件 |
| `el-card` | `WireCard` | `components/WireCard.vue` | 卡片容器 |
| `el-breadcrumb` | `WireBreadcrumb` | `components/WireBreadcrumb.vue` | 面包屑 |
| `el-filter` | `WireFilter` | `components/WireFilter.vue` | 筛选栏 |
| `el-upload` | `WireUpload` | `components/WireUpload.vue` | 上传组件 |
| `el-statistic` | `WireStatistic` | `components/WireStatistic.vue` | 统计数值 |
| `el-timeline` | `WireTimeline` | `components/WireTimeline.vue` | 时间线 |

## 页面模板

| 模板 | Vue 组件 | 文件 | 适用场景 |
|------|---------|------|---------|
| 数据列表页 | `DataListView` | `views/DataListView.vue` | 数据中台、标注数据管理 |
| 数据采集页 | `DataCollectionView` | `views/DataCollectionView.vue` | 数据采集网站 |
| 车辆管理页 | `VehicleManageView` | `views/VehicleManageView.vue` | 车辆管理系统 |
| 传感器标定页 | `SensorCalibrationView` | `views/SensorCalibrationView.vue` | 传感器标定参数管理 |
| 表单详情页 | `FormDetailView` | `views/FormDetailView.vue` | 数据详情、编辑页 |
| 仪表盘页 | `DashboardView` | `views/DashboardView.vue` | 数据中台首页 |

## 使用方式

```vue
<script setup>
import WireContainer from '@/components/WireContainer.vue'
import WireSidebar from '@/components/WireSidebar.vue'
import WireTable from '@/components/WireTable.vue'
import WireFilter from '@/components/WireFilter.vue'
</script>

<template>
  <WireContainer>
    <WireSidebar :menu-items="menuItems" />
    <WireFilter :fields="filterFields" @search="handleSearch" />
    <WireTable :columns="columns" :data="tableData" />
  </WireContainer>
</template>
```

## 三角链接标注

所有组件支持 `data-node` prop，用于 Shadow L1 三角链接：

```vue
<WireButton data-node="B01-N01">新增</WireButton>
<WireTable data-node="B01-N13" :columns="columns" :data="data" />
```

渲染后自动生成标注角标：
```html
<button class="wire-btn wire-btn-primary" data-node="B01-N01">
  新增
  <span class="wire-node-badge">B01-N01</span>
</button>
```

## 浮层语义约定

`WireDialog` / `WireDrawer` 建议除了 `data-node` 之外，再显式提供以下属性：

```vue
<WireDrawer
  data-node="B01-N03"
  title="编辑数据"
  placement="right"
  trigger="点击列表行“编辑”"
  close="右上角关闭 / 遮罩关闭 / ESC"
  afterClose="回到列表页，保留筛选条件和滚动位置"
/>
```

- `trigger`：由哪个页面动作打开浮层
- `close`：用户可用的关闭方式
- `afterClose`：关闭后页面回到哪里、是否保留上下文

## 列表页语义约定

若从组件模板迁移到 `wire.svg`，`WireFilter` / `WireTable` 的列表页语义必须转译为 SVG 分区、标签和 `data-node`：

```vue
<WireFilter
  :fields="filterFields"
  primary-goal="快速定位待处理数据并缩小结果集"
  search-hint="优先按名称、状态、时间范围组合筛选"
/>

<WireTable
  :columns="columns"
  :data="tableData"
  empty-text="当前筛选条件下暂无数据"
  bulk-hint="支持批量导入、导出、删除"
  default-sort="创建时间倒序"
/>
```

- `primaryGoal`：这块筛选区最主要帮助用户完成什么
- `searchHint`：建议的筛选路径或默认操作
- `emptyText`：空态时用户看到什么
- `bulkHint`：当前列表支持哪些批量动作
- `defaultSort`：默认排序方式，帮助审查列表初始状态
