<template>
  <span class="wire-badge" :class="`wire-badge-${type}`">
    <slot />
  </span>
</template>

<script setup>
/**
 * WireBadge - 状态标签
 * @param {string} type - 标签类型: success | warning | danger | info
 * @example
 * <WireBadge type="success">已标注</WireBadge>
 */
defineProps({
  type: { type: String, default: 'info' }
})
</script>

<style scoped>
.wire-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  display: inline-block;
}
.wire-badge-success { background: #f0f9eb; color: #67c23a; }
.wire-badge-warning { background: #fdf6ec; color: #e6a23c; }
.wire-badge-danger { background: #fef0f0; color: #f56c6c; }
.wire-badge-info { background: #ecf5ff; color: #409eff; }
</style>
