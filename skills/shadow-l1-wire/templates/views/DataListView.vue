<template>
  <WireContainer>
    <WireSidebar
      title="数据中台"
      :menu-items="menuItems"
      active-path="/data-list"
      @menu-click="handleMenuClick"
    />

    <div class="content-wrapper">
      <WireHeader title="数据列表">
        <WireBadge type="info">通知 3</WireBadge>
      </WireHeader>

      <WireMain :breadcrumbs="breadcrumbs">
        <!-- 统计卡片 -->
        <WireCard>
          <div class="wire-card-stats">
            <div v-for="stat in stats" :key="stat.label" class="wire-stat">
              <div class="wire-stat-value" :style="{ color: stat.color }">{{ stat.value }}</div>
              <div class="wire-stat-label">{{ stat.label }}</div>
            </div>
          </div>
        </WireCard>

        <!-- 筛选栏 -->
        <WireFilter
          :fields="filterFields"
          primary-goal="快速定位待处理数据并缩小结果集"
          search-hint="优先按数据名称、状态、时间范围交叉筛选"
          @search="handleSearch"
        />

        <!-- 操作栏 -->
        <WireCard class="action-bar">
          <WireButton type="primary" data-node="B01-N09">+ 新增数据</WireButton>
          <WireButton>批量导入</WireButton>
          <WireButton>批量导出</WireButton>
          <WireButton type="danger">批量删除</WireButton>
        </WireCard>

        <!-- 数据表格 -->
        <WireCard class="no-padding">
          <WireTable
            :columns="columns"
            :data="tableData"
            show-selection
            empty-text="当前筛选条件下暂无数据"
            bulk-hint="支持批量导入、导出、删除"
            default-sort="创建时间倒序"
            @select="handleSelect"
          >
            <template #status="{ row }">
              <WireBadge :type="getStatusType(row.status)">{{ row.status }}</WireBadge>
            </template>
            <template #actions="{ row }">
              <WireButton text type="primary" data-node="B01-N14">查看</WireButton>
              <WireButton text type="primary" data-node="B01-N15">编辑</WireButton>
              <WireButton text type="danger" data-node="B01-N16">删除</WireButton>
            </template>
          </WireTable>
        </WireCard>

        <!-- 分页 -->
        <WirePagination
          :total="total"
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
        />

        <WireDrawer
          title="编辑数据"
          placement="right"
          data-node="B01-N15"
          trigger="点击表格行“编辑”"
          close="右上角关闭 / 遮罩关闭"
          afterClose="回到列表页并保留当前筛选与分页"
        >
          <WireBadge type="info">编辑表单承接详情修改</WireBadge>
        </WireDrawer>
      </WireMain>
    </div>
  </WireContainer>
</template>

<script setup>
import { ref } from 'vue'
import WireContainer from '../components/WireContainer.vue'
import WireSidebar from '../components/WireSidebar.vue'
import WireHeader from '../components/WireHeader.vue'
import WireMain from '../components/WireMain.vue'
import WireCard from '../components/WireCard.vue'
import WireFilter from '../components/WireFilter.vue'
import WireButton from '../components/WireButton.vue'
import WireTable from '../components/WireTable.vue'
import WireBadge from '../components/WireBadge.vue'
import WirePagination from '../components/WirePagination.vue'
import WireDrawer from '../components/WireDrawer.vue'

/**
 * DataListView - 数据列表页模板
 * @description 适用于数据中台、标注数据管理等场景
 * 包含: 侧边栏 + 统计卡片 + Filter筛选栏 + Table表格 + Pagination分页
 */

const menuItems = [
  { path: '/dashboard', label: '仪表盘', icon: '📊' },
  { path: '/data-list', label: '数据管理', icon: '📋' },
  { path: '/collection', label: '数据采集', icon: '📡' },
  { path: '/vehicle', label: '车辆管理', icon: '🚗' }
]

const breadcrumbs = [
  { label: '首页', path: '/' },
  { label: '数据管理', path: '/data' },
  { label: '数据列表', path: '/data-list' }
]

const stats = [
  { label: '总数据量', value: '12,458', color: '#303133' },
  { label: '已标注', value: '11,200', color: '#67c23a' },
  { label: '待标注', value: '1,058', color: '#e6a23c' },
  { label: '标注异常', value: '200', color: '#f56c6c' }
]

const filterFields = [
  { prop: 'name', label: '数据名称', type: 'input', placeholder: '请输入数据名称' },
  { prop: 'type', label: '数据类型', type: 'select', options: ['全部', '图像', '点云', '视频'] },
  { prop: 'status', label: '标注状态', type: 'select', options: ['全部', '已标注', '待标注', '审核中'] },
  { prop: 'date', label: '创建时间', type: 'date', placeholder: '请选择日期范围' }
]

const columns = [
  { prop: 'id', label: '数据ID' },
  { prop: 'name', label: '数据名称' },
  { prop: 'type', label: '数据类型' },
  { prop: 'status', label: '标注状态' },
  { prop: 'annotator', label: '标注员' },
  { prop: 'createTime', label: '创建时间' }
]

const tableData = [
  { id: 'DATA-001', name: '城市道路场景_001', type: '点云', status: '已标注', annotator: '张三', createTime: '2024-01-15 10:30' },
  { id: 'DATA-002', name: '高速公路场景_002', type: '图像', status: '待标注', annotator: '-', createTime: '2024-01-15 11:20' },
  { id: 'DATA-003', name: '停车场场景_003', type: '视频', status: '审核中', annotator: '李四', createTime: '2024-01-15 14:00' }
]

const total = ref(12458)
const currentPage = ref(1)
const pageSize = ref(10)

const handleMenuClick = (item) => console.log('Menu clicked:', item)
const handleSearch = (filters) => console.log('Search:', filters)
const handleSelect = (row, selected) => console.log('Select:', row, selected)
const getStatusType = (status) => {
  const map = { '已标注': 'success', '待标注': 'warning', '审核中': 'info', '异常': 'danger' }
  return map[status] || 'info'
}
</script>

<style scoped>
.content-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.wire-card-stats {
  display: flex;
  gap: 24px;
}
.wire-stat {
  text-align: center;
}
.wire-stat-value {
  font-size: 28px;
  font-weight: 700;
  color: #303133;
}
.wire-stat-label {
  font-size: 13px;
  color: #909399;
  margin-top: 4px;
}
.action-bar {
  padding: 12px 20px;
  display: flex;
  gap: 12px;
  align-items: center;
}
.no-padding {
  padding: 0;
}
</style>
