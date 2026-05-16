<template>
  <button
    class="wire-btn"
    :class="[`wire-btn-${type}`, { 'wire-btn-text': text }]"
    :disabled="disabled"
    @click="$emit('click', $event)"
  >
    <slot />
    <span v-if="dataNode" class="wire-node-badge">{{ dataNode }}</span>
  </button>
</template>

<script setup>
/**
 * WireButton - 按钮组件
 * @param {string} type - 按钮类型: primary | success | warning | danger | default
 * @param {boolean} text - 是否为文本按钮
 * @param {boolean} disabled - 是否禁用
 * @param {string} dataNode - Shadow L1 三角链接节点ID
 * @emits click 点击事件
 * @example
 * <WireButton type="primary" data-node="B01-N01">新增</WireButton>
 */
defineProps({
  type: { type: String, default: 'default' },
  text: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  dataNode: { type: String, default: '' }
})

defineEmits(['click'])
</script>

<style scoped>
.wire-btn {
  padding: 8px 16px;
  border-radius: 4px;
  font-size: 14px;
  border: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  position: relative;
}
.wire-btn-primary { background: #409eff; color: #fff; }
.wire-btn-success { background: #67c23a; color: #fff; }
.wire-btn-warning { background: #e6a23c; color: #fff; }
.wire-btn-danger { background: #f56c6c; color: #fff; }
.wire-btn-default { background: #fff; color: #606266; border: 1px solid #dcdfe6; }
.wire-btn-text { background: none; color: #409eff; padding: 4px 8px; }
.wire-btn-text.wire-btn-danger { color: #f56c6c; }
.wire-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.wire-node-badge {
  position: absolute;
  top: -8px;
  right: -8px;
  background: #409eff;
  color: #fff;
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
  opacity: 0.7;
}
</style>
