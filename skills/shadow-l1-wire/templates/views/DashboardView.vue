<template>
  <WireContainer>
    <WireSidebar
      title="数据中台"
      :menu-items="menuItems"
      active-path="/dashboard"
      @menu-click="handleMenuClick"
    />

    <div class="content-wrapper">
      <WireHeader title="数据中台仪表盘">
        <WireBadge type="info">刷新</WireBadge>
      </WireHeader>

      <WireMain :breadcrumbs="breadcrumbs">
        <!-- 统计卡片 -->
        <WireCard>
          <div class="wire-card-stats">
            <div v-for="stat in stats" :key="stat.label" class="wire-stat">
              <div class="wire-stat-value" :style="{ color: stat.color }">{{ stat.value }}</div>
              <div class="wire-stat-label">{{ stat.label }}</div>
              <div class="wire-stat-trend" :class="stat.trendClass">{{ stat.trend }}</div>
            </div>
          </div>
        </WireCard>

        <!-- 图表区域 -->
        <div class="wire-grid">
          <WireCard v-for="chart in charts" :key="chart.title">
            <div class="wire-card-title">{{ chart.title }}</div>
            <div class="wire-chart-placeholder">{{ chart.icon }} {{ chart.type }}</div>
          </WireCard>
        </div>

        <!-- 最近任务 -->
        <WireCard title="最近采集任务">
          <WireTable :columns="taskColumns" :data="taskData">
            <template #status="{ row }">
              <WireBadge :type="getStatusType(row.status)">{{ row.status }}</WireBadge>
            </template>
            <template #actions="{ row }">
              <WireButton text type="primary">查看</WireButton>
            </template>
          </WireTable>
        </WireCard>
      </WireMain>
    </div>
  </WireContainer>
</template>

<script setup>
import WireContainer from '../components/WireContainer.vue'
import WireSidebar from '../components/WireSidebar.vue'
import WireHeader from '../components/WireHeader.vue'
import WireMain from '../components/WireMain.vue'
import WireCard from '../components/WireCard.vue'
import WireBadge from '../components/WireBadge.vue'
import WireTable from '../components/WireTable.vue'
import WireButton from '../components/WireButton.vue'

/**
 * DashboardView - 仪表盘页模板
 * @description 适用于数据中台首页、管理后台首页
 * 包含: 统计卡片(含趋势) + 图表占位(2×2网格) + 最近任务表格
 */

const menuItems = [
  { path: '/dashboard', label: '仪表盘', icon: '📊' },
  { path: '/data-list', label: '数据管理', icon: '📋' },
  { path: '/collection', label: '数据采集', icon: '📡' },
  { path: '/vehicle', label: '车辆管理', icon: '🚗' }
]

const breadcrumbs = [
  { label: '首页', path: '/' },
  { label: '仪表盘', path: '/dashboard' }
]

const stats = [
  { label: '总数据量', value: '125,458', color: '#303133', trend: '↑ 12.5% 较上周', trendClass: 'wire-stat-trend-up' },
  { label: '标注完成率', value: '98.2%', color: '#67c23a', trend: '↑ 3.2% 较上周', trendClass: 'wire-stat-trend-up' },
  { label: '运行中车辆', value: '18', color: '#409eff', trend: '- 持平', trendClass: '' },
  { label: '待处理任务', value: '42', color: '#e6a23c', trend: '↑ 8 较昨日', trendClass: 'wire-stat-trend-down' }
]

const charts = [
  { title: '数据采集趋势', icon: '📈', type: '折线图占位符' },
  { title: '数据类型分布', icon: '🥧', type: '饼图占位符' },
  { title: '标注质量趋势', icon: '📊', type: '柱状图占位符' },
  { title: '车辆运行状态', icon: '🗺️', type: '地图占位符' }
]

const taskColumns = [
  { prop: 'name', label: '任务名称' },
  { prop: 'type', label: '类型' },
  { prop: 'vehicle', label: '车辆' },
  { prop: 'size', label: '数据量' },
  { prop: 'status', label: '状态' }
]

const taskData = [
  { name: '城市道路_0115', type: '点云+图像', vehicle: '沪A12345', size: '2.4 GB', status: '已完成' },
  { name: '高速公路_0115', type: '视频', vehicle: '沪B67890', size: '1.8 GB', status: '采集中' },
  { name: '停车场_0114', type: '点云', vehicle: '沪C11111', size: '856 MB', status: '待标注' }
]

const handleMenuClick = (item) => console.log('Menu clicked:', item)
const getStatusType = (status) => {
  const map = { '已完成': 'success', '采集中': 'warning', '待标注': 'info' }
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
  gap: 16px;
}
.wire-stat {
  flex: 1;
  text-align: center;
  padding: 16px;
  background: #fafafa;
  border-radius: 8px;
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
.wire-stat-trend {
  font-size: 12px;
  margin-top: 4px;
}
.wire-stat-trend-up { color: #67c23a; }
.wire-stat-trend-down { color: #f56c6c; }
.wire-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}
.wire-chart-placeholder {
  height: 280px;
  background: #fafafa;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #909399;
  font-size: 14px;
}
</style>
