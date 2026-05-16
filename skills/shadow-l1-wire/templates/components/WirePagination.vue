<template>
  <div class="wire-pagination">
    <span>共 {{ total }} 条</span>
    <button
      class="wire-page-btn"
      :disabled="currentPage === 1"
      @click="$emit('update:currentPage', currentPage - 1)"
    >
      上一页
    </button>
    <button
      v-for="page in visiblePages"
      :key="page"
      class="wire-page-btn"
      :class="{ active: page === currentPage }"
      @click="$emit('update:currentPage', page)"
    >
      {{ page }}
    </button>
    <button
      class="wire-page-btn"
      :disabled="currentPage === totalPages"
      @click="$emit('update:currentPage', currentPage + 1)"
    >
      下一页
    </button>
    <select
      class="wire-select"
      :value="pageSize"
      @change="$emit('update:pageSize', Number($event.target.value))"
    >
      <option :value="10">10条/页</option>
      <option :value="20">20条/页</option>
      <option :value="50">50条/页</option>
    </select>
  </div>
</template>

<script setup>
import { computed } from 'vue'

/**
 * WirePagination - 分页器
 * @param {number} total - 总记录数
 * @param {number} currentPage - 当前页码 (v-model)
 * @param {number} pageSize - 每页条数 (v-model)
 * @emits update:currentPage 页码更新
 * @emits update:pageSize 每页条数更新
 * @example
 * <WirePagination
 *   :total="12458"
 *   v-model:current-page="currentPage"
 *   v-model:page-size="pageSize"
 * />
 */
const props = defineProps({
  total: { type: Number, default: 0 },
  currentPage: { type: Number, default: 1 },
  pageSize: { type: Number, default: 10 }
})

defineEmits(['update:currentPage', 'update:pageSize'])

const totalPages = computed(() => Math.ceil(props.total / props.pageSize))

const visiblePages = computed(() => {
  const pages = []
  const maxVisible = 5
  let start = Math.max(1, props.currentPage - Math.floor(maxVisible / 2))
  let end = Math.min(totalPages.value, start + maxVisible - 1)
  if (end - start < maxVisible - 1) {
    start = Math.max(1, end - maxVisible + 1)
  }
  for (let i = start; i <= end; i++) {
    pages.push(i)
  }
  return pages
})
</script>

<style scoped>
.wire-pagination {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  font-size: 14px;
  color: #606266;
}
.wire-page-btn {
  padding: 6px 12px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
}
.wire-page-btn.active {
  background: #409eff;
  color: #fff;
  border-color: #409eff;
}
.wire-page-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.wire-select {
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  padding: 6px 12px;
  font-size: 14px;
  background: #fff;
  min-width: 100px;
}
</style>
