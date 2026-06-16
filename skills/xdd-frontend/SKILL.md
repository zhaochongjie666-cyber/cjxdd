---
name: xdd-frontend
description: |
  xdd 代码层专项 —— 前端实现锚。被 xdd-execute 按 task 的 Stack=frontend 派发装入。
  从 architecture.md §技术栈 读前端栈，加载 .xdd/rules/frontend.rules + ui-ux.rules，按 wire 线框 + plan task 实现。
  execute 是通用 TDD 主流程；本 skill 补前端栈特定的约定与检查（对照 wire 6 操作态 / 组件结构 / 设计 token / 单文件≤600行）。
  触发：前端实现、写前端代码、frontend、页面实现、组件、Vue 实现、React 实现、对照线框。
---

# xdd-frontend — 前端实现锚

> 代码层专项：不取代 xdd-execute 的 TDD 主流程，只补前端栈特定的约定与检查。
> 由 execute 读 task 的 `**Stack:** frontend` 字段后装入。纯后端项目（无 wire）不装。

## 我锚定什么 / 上游 / 下游

| | |
|---|---|
| **上游** | `xdd-execute`（派发装入）+ `architecture.md §技术栈`（前端框架/组件库/构建工具）+ `wire/{page}/`（线框 + 6 操作态）+ `.xdd/rules/frontend.rules`（命名/文件结构/600行/组件）+ `ui-ux.rules`（a11y/动效/设计 token） |
| **我产出** | 前端代码（`@implements RXX`）+ 栈特定检查通过 |
| **下游消费者** | `xdd-verify`（页面渲染验收 + wire↔code 一致性） |
| **回溯锚** | 组件/页面 `@implements RXX` ← plan task ← spec 规则 ← design 意图 |

## 怎么做

```
work():
  1. 读栈     -> architecture.md §技术栈：前端框架/组件库/构建（如 Vue3+Element Plus+Vite）
  2. 读约定   -> .xdd/rules/frontend.rules（命名/文件结构/600行）+ ui-ux.rules（a11y/动效/设计 token）
  3. 实现     -> 按 wire 线框 + plan task：组件→方法→样式→配置拆分（TDD，commit 含 @implements RXX）
  4. 栈检查   -> 页面渲染对照 wire 6 操作态（空/载/错/成/删/边界）/ 组件复用 / 设计 token 走 CSS 变量
  5. 行数     -> 单文件 ≤600 行；超限按 组件 / 方法 / 样式 / 配置 拆
```

## 前端特定关注点

- **对照 wire 验渲染**：每个 wire 页面的 6 操作态（空/加载/错误/成功/确认删除/边界）都要实现到，无白屏
- **组件结构**：`.vue` 顺序 script→template→style；弹窗严禁与主页面同文件；父子组件父名前缀
- **设计 token**：颜色/圆角/间距走 CSS 变量（`--accent`/`--radius`/`--space-*`），对照 ui-ux.rules
- **6 态完整**：空状态、错误态、加载态不能漏（对照 wire review.md 的混淆元素 A/B/C/D 扫零）
- **a11y**：语义化标签、可见文字不用 em-dash、按钮/链接可键盘操作（对照 ui-ux.rules L1-L4）

## 自检

```
□ frontend.rules 的命名/文件结构/600行都遵守了？
□ 单文件 ≤600 行（超限已按 组件/方法/样式/配置 拆）？
□ 每个 wire 页面 6 操作态（空/载/错/成/删/边界）都实现到，无白屏？
□ 设计 token 走 CSS 变量，对照 ui-ux.rules？
□ a11y：语义化标签、无 em-dash、可键盘操作？
□ 组件/页面 @implements RXX，对照 wire 无混淆元素？
```

---

本 skill 只管「前端怎么实现得对照设计」；通用 TDD 流程（任务调度 / 阻塞处理 / 卡住升级）在 `xdd-execute`。
