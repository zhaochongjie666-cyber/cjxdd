<template>
  <aside class="wire-sidebar">
    <div class="wire-sidebar-logo">
      <slot name="logo">{{ title }}</slot>
    </div>
    <ul class="wire-menu">
      <li
        v-for="item in menuItems"
        :key="item.path"
        class="wire-menu-item"
        :class="{ active: item.path === activePath }"
        @click="handleMenuClick(item)"
      >
        <span v-if="item.icon" class="wire-menu-icon">{{ item.icon }}</span>
        <span>{{ item.label }}</span>
      </li>
    </ul>
  </aside>
</template>

<script setup>
/**
 * WireSidebar - 侧边导航栏
 * @param {string} title - 侧边栏标题
 * @param {Array} menuItems - 菜单项 [{ path, label, icon }]
 * @param {string} activePath - 当前激活路径
 * @emits menu-click 菜单点击事件
 * @example
 * <WireSidebar
 *   title="数据中台"
 *   :menu-items="menuItems"
 *   :active-path="activePath"
 *   @menu-click="handleMenuClick"
 * />
 */
const props = defineProps({
  title: { type: String, default: '系统名称' },
  menuItems: { type: Array, default: () => [] },
  activePath: { type: String, default: '' }
})

const emit = defineEmits(['menu-click'])

const handleMenuClick = (item) => {
  emit('menu-click', item)
}
</script>

<style scoped>
.wire-sidebar {
  width: 240px;
  background: #304156;
  color: #fff;
  flex-shrink: 0;
}
.wire-sidebar-logo {
  height: 60px;
  display: flex;
  align-items: center;
  padding: 0 20px;
  background: #263445;
  font-size: 16px;
  font-weight: 700;
}
.wire-menu {
  list-style: none;
  padding: 0;
  margin: 0;
}
.wire-menu-item {
  padding: 14px 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: #bfcbd9;
}
.wire-menu-item:hover,
.wire-menu-item.active {
  background: #263445;
  color: #409eff;
}
.wire-menu-icon {
  width: 18px;
  text-align: center;
}
</style>
