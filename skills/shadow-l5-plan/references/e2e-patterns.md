# 通用 E2E 交互模式参考

非标注平台项目的 E2E 模式，从 SKILL.md §3.3 提取。

## 列表操作（拖拽排序、批量操作）

```typescript
import { test, expect } from '@playwright/test'

test('user drags card between columns', async ({ page }) => {
  await page.goto('/boards/b1')
  const todoColumn = page.locator('[data-state="column-todo"]')
  const doneColumn = page.locator('[data-state="column-done"]')
  const card = todoColumn.locator('[data-action="drag-card"]').first()
  await card.dragTo(doneColumn)
  await expect(doneColumn.locator('[data-action="drag-card"]')).toHaveCount(1)
})

test('user filters list and selects items', async ({ page }) => {
  await page.goto('/items')
  await page.selectOption('[data-action="filter-status"]', 'active')
  await page.click('[data-action="select-all"]')
  await page.click('[data-action="bulk-delete"]')
  await expect(page.locator('[data-state="empty"]')).toBeVisible()
})
```
