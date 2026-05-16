<template>
  <div class="wire-filter">
    <div
      v-for="field in fields"
      :key="field.prop"
      class="wire-filter-item"
    >
      <label class="wire-filter-label">{{ field.label }}</label>
      <WireInput
        v-if="field.type === 'input'"
        :placeholder="field.placeholder"
        :model-value="filters[field.prop]"
        @update:model-value="updateFilter(field.prop, $event)"
      />
      <WireSelect
        v-else-if="field.type === 'select'"
        :options="field.options"
        :model-value="filters[field.prop]"
        @update:model-value="updateFilter(field.prop, $event)"
      />
      <WireInput
        v-else-if="field.type === 'date'"
        type="text"
        :placeholder="field.placeholder || '请选择日期'"
        :model-value="filters[field.prop]"
        @update:model-value="updateFilter(field.prop, $event)"
      />
    </div>
    <WireButton type="primary" @click="$emit('search', filters)">查询</WireButton>
    <WireButton @click="resetFilters">重置</WireButton>
  </div>
</template>

<script setup>
import { reactive } from 'vue'
import WireInput from './WireInput.vue'
import WireSelect from './WireSelect.vue'
import WireButton from './WireButton.vue'

/**
 * WireFilter - 筛选栏组件
 * @param {Array} fields - 筛选字段定义 [{ prop, label, type, options, placeholder }]
 * @emits search 搜索事件，传递 filters 对象
 * @example
 * <WireFilter
 *   :fields="[
 *     { prop: 'name', label: '名称', type: 'input', placeholder: '请输入名称' },
 *     { prop: 'status', label: '状态', type: 'select', options: ['全部', '已标注', '待标注'] },
 *     { prop: 'date', label: '日期', type: 'date' }
 *   ]"
 *   @search="handleSearch"
 * />
 */
const props = defineProps({
  fields: { type: Array, required: true },
  primaryGoal: { type: String, default: '' },
  searchHint: { type: String, default: '' }
})

const emit = defineEmits(['search'])

const filters = reactive({})

// 初始化 filters
props.fields.forEach(field => {
  filters[field.prop] = ''
})

const updateFilter = (prop, value) => {
  filters[prop] = value
}

const resetFilters = () => {
  props.fields.forEach(field => {
    filters[field.prop] = ''
  })
}
</script>

<style scoped>
.wire-filter {
  background: #fff;
  padding: 18px 20px;
  border-radius: 4px;
  margin-bottom: 16px;
  display: flex;
  gap: 16px;
  align-items: flex-end;
  flex-wrap: wrap;
}
.wire-filter-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wire-filter-label {
  font-size: 13px;
  color: #606266;
}
</style>
