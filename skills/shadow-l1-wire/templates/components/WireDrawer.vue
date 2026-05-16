<template>
  <div v-if="modelValue" class="wire-drawer">
    <div class="wire-drawer-mask" />
    <div class="wire-drawer-panel" :class="`wire-drawer-${placement}`" :style="panelStyle">
      <div class="wire-drawer-header">
        <div class="wire-drawer-title">
          {{ title }}
          <span v-if="dataNode" class="wire-node-badge">{{ dataNode }}</span>
        </div>
        <button class="wire-drawer-close" type="button" @click="$emit('update:modelValue', false)">×</button>
      </div>
      <div class="wire-drawer-body">
        <div v-if="trigger || close || afterClose" class="wire-drawer-meta">
          <div v-if="trigger"><strong>触发源：</strong>{{ trigger }}</div>
          <div v-if="close"><strong>关闭方式：</strong>{{ close }}</div>
          <div v-if="afterClose"><strong>关闭后：</strong>{{ afterClose }}</div>
        </div>
        <slot />
      </div>
      <div v-if="$slots.footer" class="wire-drawer-footer">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  modelValue: { type: Boolean, default: true },
  title: { type: String, default: '' },
  placement: { type: String, default: 'right' },
  size: { type: String, default: '480px' },
  dataNode: { type: String, default: '' },
  trigger: { type: String, default: '' },
  close: { type: String, default: '' },
  afterClose: { type: String, default: '' }
})

defineEmits(['update:modelValue'])

const panelStyle = computed(() => {
  if (props.placement === 'top' || props.placement === 'bottom') {
    return { height: props.size }
  }
  return { width: props.size }
})
</script>

<style scoped>
.wire-drawer {
  position: fixed;
  inset: 0;
  z-index: 1200;
}
.wire-drawer-mask {
  position: absolute;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
}
.wire-drawer-panel {
  position: absolute;
  background: #fff;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.22);
  display: flex;
  flex-direction: column;
}
.wire-drawer-right {
  top: 0;
  right: 0;
  bottom: 0;
}
.wire-drawer-left {
  top: 0;
  left: 0;
  bottom: 0;
}
.wire-drawer-top {
  top: 0;
  left: 0;
  right: 0;
}
.wire-drawer-bottom {
  left: 0;
  right: 0;
  bottom: 0;
}
.wire-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px;
  border-bottom: 1px solid #e5e7eb;
}
.wire-drawer-title {
  position: relative;
  font-size: 18px;
  font-weight: 700;
  color: #111827;
}
.wire-drawer-body {
  flex: 1;
  overflow: auto;
  padding: 20px;
}
.wire-drawer-meta {
  margin-bottom: 16px;
  padding: 12px 14px;
  border-radius: 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  color: #475569;
  font-size: 13px;
  line-height: 1.6;
}
.wire-drawer-meta strong {
  color: #0f172a;
}
.wire-drawer-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px 20px;
  border-top: 1px solid #e5e7eb;
}
.wire-drawer-close {
  border: 0;
  background: transparent;
  color: #64748b;
  font-size: 24px;
  cursor: pointer;
}
.wire-node-badge {
  position: absolute;
  top: -8px;
  right: -52px;
  background: #409eff;
  color: #fff;
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
  opacity: 0.75;
}
</style>
