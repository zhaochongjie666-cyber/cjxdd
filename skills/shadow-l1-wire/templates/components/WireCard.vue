<template>
  <div class="wire-card">
    <h3 v-if="title" class="wire-card-title">{{ title }}</h3>
    <slot />
  </div>
</template>

<script setup>
/**
 * WireCard - 卡片容器
 * @param {string} title - 卡片标题
 * @example
 * <WireCard title="统计信息">
 *   <WireStatistic :value="12458" label="总数据量" />
 * </WireCard>
 */
defineProps({
  title: { type: String, default: '' }
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
</style>
