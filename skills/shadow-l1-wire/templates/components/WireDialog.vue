<template>
  <div v-if="modelValue" class="wire-dialog">
    <div class="wire-dialog-mask" />
    <div class="wire-dialog-panel" :style="{ width }">
      <div class="wire-dialog-header">
        <div class="wire-dialog-title">
          {{ title }}
          <span v-if="dataNode" class="wire-node-badge">{{ dataNode }}</span>
        </div>
        <button class="wire-dialog-close" type="button" @click="$emit('update:modelValue', false)">×</button>
      </div>
      <div class="wire-dialog-body">
        <div v-if="trigger || close || afterClose" class="wire-dialog-meta">
          <div v-if="trigger"><strong>触发源：</strong>{{ trigger }}</div>
          <div v-if="close"><strong>关闭方式：</strong>{{ close }}</div>
          <div v-if="afterClose"><strong>关闭后：</strong>{{ afterClose }}</div>
        </div>
        <slot />
      </div>
      <div v-if="$slots.footer" class="wire-dialog-footer">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  modelValue: { type: Boolean, default: true },
  title: { type: String, default: '' },
  width: { type: String, default: '640px' },
  dataNode: { type: String, default: '' },
  trigger: { type: String, default: '' },
  close: { type: String, default: '' },
  afterClose: { type: String, default: '' }
})

defineEmits(['update:modelValue'])
</script>

<style scoped>
.wire-dialog {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
}
.wire-dialog-mask {
  position: absolute;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
}
.wire-dialog-panel {
  position: relative;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.25);
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 48px);
  overflow: auto;
}
.wire-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px;
  border-bottom: 1px solid #e5e7eb;
}
.wire-dialog-title {
  position: relative;
  font-size: 18px;
  font-weight: 700;
  color: #111827;
}
.wire-dialog-body {
  padding: 20px;
}
.wire-dialog-meta {
  margin-bottom: 16px;
  padding: 12px 14px;
  border-radius: 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  color: #475569;
  font-size: 13px;
  line-height: 1.6;
}
.wire-dialog-meta strong {
  color: #0f172a;
}
.wire-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px 20px;
  border-top: 1px solid #e5e7eb;
}
.wire-dialog-close {
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
