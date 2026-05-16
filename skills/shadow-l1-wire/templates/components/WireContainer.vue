<template>
  <div class="wire-container">
    <slot />
  </div>
</template>

<script setup>
/**
 * WireContainer - 页面布局容器
 * @description Shadow L1 线框图基础容器组件
 * @example
 * <WireContainer>
 *   <WireSidebar />
 *   <WireMain />
 * </WireContainer>
 */
</script>

<style scoped>
.wire-container {
  display: flex;
  min-height: 1080px;
  font-family: system-ui, -apple-system, sans-serif;
}
</style>
