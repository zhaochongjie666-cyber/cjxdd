<template>
  <div class="wire-tabs">
    <div
      v-for="tab in tabs"
      :key="tab.name"
      class="wire-tab-item"
      :class="{ active: tab.name === activeName }"
      @click="$emit('update:activeName', tab.name)"
    >
      {{ tab.label }}
    </div>
  </div>
  <div class="wire-tab-content">
    <slot />
  </div>
</template>

<script setup>
/**
 * WireTabs - 标签页组件
 * @param {Array} tabs - 标签定义 [{ name, label }]
 * @param {string} activeName - 当前激活标签 (v-model)
 * @emits update:activeName 标签切换事件
 * @example
 * <WireTabs
 *   :tabs="[
 *     { name: 'basic', label: '基本信息' },
 *     { name: 'config', label: '配置' }
 *   ]"
 *   v-model:active-name="activeTab"
 * />
 */
defineProps({
  tabs: { type: Array, required: true },
  activeName: { type: String, default: '' }
})

defineEmits(['update:activeName'])
</script>

<style scoped>
.wire-tabs {
  display: flex;
  border-bottom: 2px solid #e4e7ed;
  margin-bottom: 16px;
}
.wire-tab-item {
  padding: 12px 20px;
  cursor: pointer;
  font-size: 14px;
  color: #606266;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
}
.wire-tab-item.active {
  color: #409eff;
  border-bottom-color: #409eff;
}
.wire-tab-content {
  padding: 8px 0;
}
</style>
