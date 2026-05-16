<template>
  <select
    class="wire-select"
    :value="modelValue"
    @change="$emit('update:modelValue', $event.target.value)"
  >
    <option v-for="opt in options" :key="opt" :value="opt">
      {{ opt }}
    </option>
  </select>
</template>

<script setup>
/**
 * WireSelect - 下拉选择组件
 * @param {Array} options - 选项列表
 * @param {string} modelValue - 选中值 (v-model)
 * @emits update:modelValue 值更新事件
 */
defineProps({
  options: { type: Array, default: () => [] },
  modelValue: { type: String, default: '' }
})

defineEmits(['update:modelValue'])
</script>

<style scoped>
.wire-select {
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 14px;
  background: #fff;
  min-width: 160px;
}
</style>
