<template>
  <div class="wire-card">
    <div class="wire-card-title">{{ title }}</div>
    <div class="wire-desc-list">
      <div v-for="item in items" :key="item.prop" class="wire-desc-item">
        <span class="wire-desc-label">{{ item.label }}</span>
        <span class="wire-desc-value">
          <slot :name="item.prop" :value="data[item.prop]">
            {{ data[item.prop] }}
          </slot>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * WireDescList - 描述列表组件
 * @param {string} title - 标题
 * @param {Array} items - 描述项 [{ prop, label }]
 * @param {Object} data - 数据对象
 * @example
 * <WireDescList
 *   title="基本信息"
 *   :items="[
 *     { prop: 'id', label: '数据ID' },
 *     { prop: 'name', label: '数据名称' }
 *   ]"
 *   :data="recordData"
 * >
 *   <template #status="{ value }">
 *     <WireBadge :type="value === 'active' ? 'success' : 'warning'">{{ value }}</WireBadge>
 *   </template>
 * </WireDescList>
 */
defineProps({
  title: { type: String, default: '' },
  items: { type: Array, required: true },
  data: { type: Object, default: () => ({}) }
})
</script>

<style scoped>
.wire-card {
  background: #fff;
  border-radius: 4px;
  padding: 20px;
  margin-bottom: 16px;
}
.wire-card-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 16px;
}
.wire-desc-list {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}
.wire-desc-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.wire-desc-label {
  font-size: 13px;
  color: #909399;
}
.wire-desc-value {
  font-size: 14px;
  color: #303133;
}
</style>
