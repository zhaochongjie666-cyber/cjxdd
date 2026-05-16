<template>
  <input
    class="wire-input"
    :type="type"
    :placeholder="placeholder"
    :value="modelValue"
    :disabled="disabled"
    @input="$emit('update:modelValue', $event.target.value)"
  />
</template>

<script setup>
/**
 * WireInput - 输入框组件
 * @param {string} type - 输入类型: text | password | number
 * @param {string} placeholder - 占位文字
 * @param {string} modelValue - 输入值 (v-model)
 * @param {boolean} disabled - 是否禁用
 * @emits update:modelValue 值更新事件
 */
defineProps({
  type: { type: String, default: 'text' },
  placeholder: { type: String, default: '' },
  modelValue: { type: String, default: '' },
  disabled: { type: Boolean, default: false }
})

defineEmits(['update:modelValue'])
</script>

<style scoped>
.wire-input {
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 14px;
  min-width: 180px;
}
.wire-input:disabled {
  background: #f5f7fa;
  cursor: not-allowed;
}
</style>
