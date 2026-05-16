---
name: playwright-cli
description: |
  [Internal] 浏览器自动化工具 — 使用 @playwright/cli 进行 E2E 测试、截图、交互验证。由 shadow L6 部署验证调用。
version: 1.0.0
---

# Playwright CLI — 浏览器自动化/E2E 测试

## 前置条件

```bash
npm install -g @playwright/cli@latest
playwright-cli install-browser chromium
```

## 核心用法

### 打开浏览器

```bash
playwright-cli open https://example.com              # 无头模式
playwright-cli open https://example.com --headed      # 有头模式
playwright-cli open https://example.com --persistent  # 持久化会话
```

### 页面交互

```bash
playwright-cli snapshot                    # 获取页面快照和元素 ref
playwright-cli click e5                    # 点击元素
playwright-cli fill e10 "hello@example.com"
playwright-cli type "some text"
playwright-cli press Enter
playwright-cli select e8 "option1"
```

### 截图

```bash
playwright-cli screenshot                 # 页面截图
playwright-cli screenshot e5              # 元素截图
```

### 网络操作

```bash
playwright-cli requests                   # 查看所有网络请求
playwright-cli request 0                  # 查看具体请求详情
playwright-cli route "**/api/**"           # 拦截网络请求
```

### 存储 & Cookie

```bash
playwright-cli cookie-list
playwright-cli cookie-set name value
playwright-cli state-save auth-state.json
playwright-cli state-load auth-state.json
```

## Shadow L6 验证工作流

```bash
# 1. 启动应用
# 2. 打开浏览器
playwright-cli open http://localhost:${PORT}

# 3. 遍历关键页面截图
playwright-cli snapshot
playwright-cli screenshot

# 4. 测试关键交互
playwright-cli fill e1 "test@example.com"
playwright-cli click e2
playwright-cli requests

# 5. 关闭
playwright-cli close
```

## 常见问题

- `playwright-cli not found` → `npm install -g @playwright/cli@latest`
- 元素引用（如 `e5`）来自 `snapshot` 输出，页面变化后需重新 snapshot
- 无头模式适合 CI；`--headed` 适合调试

## 参考

- [Playwright 官方文档](https://playwright.dev/)
