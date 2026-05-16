<template>
  <div class="wire-form">
    <h3 v-if="title" class="wire-card-title">{{ title }}</h3>
    <div v-for="row in rows" :key="row.id" class="wire-form-row">
      <div
        v-for="field in row.fields"
        :key="field.prop"
        class="wire-form-item"
        :style="field.span ? { flex: field.span } : {}"
      >
        <label class="wire-form-label">
          {{ field.label }}
          <span v-if="field.required" style="color: #f56c6c;">*</span>
        </label>
        <WireInput
          v-if="field.type === 'input'"
          :placeholder="field.placeholder"
          :model-value="model[field.prop]"
          @update:model-value="updateField(field.prop, $event)"
        />
        <WireSelect
          v-else-if="field.type === 'select'"
          :options="field.options"
          :model-value="model[field.prop]"
          @update:model-value="updateField(field.prop, $event)"
        />
        <textarea
          v-else-if="field.type === 'textarea'"
          class="wire-textarea"
          :placeholder="field.placeholder"
          :value="model[field.prop]"
          @input="updateField(field.prop, $event.target.value)"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import WireInput from './WireInput.vue'
import WireSelect from './WireSelect.vue'

/**
 * WireForm - 表单组件
 * @param {string} title - 表单标题
 * @param {Array} rows - 表单行定义 [{ id, fields: [{ prop, label, type, required, options, placeholder, span }] }]
 * @param {Object} model - 表单数据对象 (v-model)
 * @emits update:model 表单数据更新
 * @example
 * <WireForm
 *   title="基本信息"
 *   :rows="formRows"
 *   v-model="formData"
 * />
 */
const props = defineProps({
  title: { type: String, default: '' },
  rows: { type: Array, required: true },
  model: { type: Object, default: () => ({}) }
})

const emit = defineEmits(['update:model'])

const updateField = (prop, value) => {
  emit('update:model', { ...props.model, [prop]: value })
}
</script>

<style scoped>
.wire-form {
  background: #fff;
  padding: 24px;
  border-radius: 4px;
}
.wire-card-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 16px;
}
.wire-form-row {
  display: flex;
  gap: 16px;
  margin-bottom: 18px;
}
.wire-form-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wire-form-label {
  font-size: 14px;
  color: #606266;
}
.wire-textarea {
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 14px;
  min-height: 80px;
  font-family: inherit;
}
</style>
