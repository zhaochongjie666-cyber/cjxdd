<template>
  <header class="wire-header">
    <span class="wire-header-title">{{ title }}</span>
    <div class="wire-header-actions">
      <slot />
    </div>
  </header>
</template>

<script setup>
/**
 * WireHeader - 顶部标题栏
 * @param {string} title - 标题文字
 * @example
 * <WireHeader title="数据列表">
 *   <WireBadge type="info">通知 3</WireBadge>
 * </WireHeader>
 */
defineProps({
  title: { type: String, default: '' }
})
</script>

<style scoped>
.wire-header {
  height: 60px;
  background: #fff;
  border-bottom: 1px solid #e6e6e6;
  display: flex;
  align-items: center;
  padding: 0 20px;
}
.wire-header-title {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
}
.wire-header-actions {
  margin-left: auto;
  display: flex;
  gap: 12px;
  align-items: center;
}
</style>
