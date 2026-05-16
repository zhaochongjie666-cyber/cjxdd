<template>
  <table class="wire-table">
    <thead>
      <tr>
        <th v-if="showSelection" style="width: 50px;">
          <input type="checkbox" :checked="allSelected" @change="$emit('select-all', $event.target.checked)" />
        </th>
        <th
          v-for="col in columns"
          :key="col.prop"
          :style="col.width ? { width: col.width } : {}"
        >
          {{ col.label }}
        </th>
        <th v-if="$slots.actions">操作</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="(row, index) in data" :key="index">
        <td v-if="showSelection">
          <input type="checkbox" :checked="row._selected" @change="$emit('select', row, $event.target.checked)" />
        </td>
        <td v-for="col in columns" :key="col.prop">
          <slot :name="col.prop" :row="row" :value="row[col.prop]">
            {{ row[col.prop] }}
          </slot>
        </td>
        <td v-if="$slots.actions">
          <slot name="actions" :row="row" />
        </td>
      </tr>
    </tbody>
  </table>
</template>

<script setup>
/**
 * WireTable - 数据表格
 * @param {Array} columns - 列定义 [{ prop, label, width }]
 * @param {Array} data - 表格数据
 * @param {boolean} showSelection - 是否显示选择列
 * @emits select 行选择事件
 * @emits select-all 全选事件
 * @example
 * <WireTable
 *   :columns="columns"
 *   :data="tableData"
 *   @select="handleSelect"
 * >
 *   <template #status="{ row }">
 *     <WireBadge :type="row.status === 'active' ? 'success' : 'warning'">
 *       {{ row.statusText }}
 *     </WireBadge>
 *   </template>
 *   <template #actions="{ row }">
 *     <WireButton text type="primary">编辑</WireButton>
 *   </template>
 * </WireTable>
 */
defineProps({
  columns: { type: Array, required: true },
  data: { type: Array, default: () => [] },
  showSelection: { type: Boolean, default: false },
  emptyText: { type: String, default: '' },
  bulkHint: { type: String, default: '' },
  defaultSort: { type: String, default: '' }
})

defineEmits(['select', 'select-all'])
</script>

<style scoped>
.wire-table {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
  border-radius: 4px;
  overflow: hidden;
}
.wire-table th {
  background: #fafafa;
  padding: 12px 16px;
  text-align: left;
  font-size: 14px;
  color: #606266;
  font-weight: 600;
  border-bottom: 1px solid #ebeef5;
}
.wire-table td {
  padding: 12px 16px;
  font-size: 14px;
  color: #303133;
  border-bottom: 1px solid #ebeef5;
}
.wire-table tr:hover td {
  background: #f5f7fa;
}
</style>
