<template>
  <main class="wire-main">
    <WireBreadcrumb v-if="breadcrumbs.length" :items="breadcrumbs" />
    <slot />
  </main>
</template>

<script setup>
/**
 * WireMain - 主内容区
 * @param {Array} breadcrumbs - 面包屑导航 [{ label, path }]
 */
defineProps({
  breadcrumbs: { type: Array, default: () => [] }
})
</script>

<style scoped>
.wire-main {
  flex: 1;
  background: #f0f2f5;
  padding: 20px;
}
</style>
