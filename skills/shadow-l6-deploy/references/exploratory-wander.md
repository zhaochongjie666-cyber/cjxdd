# Exploratory Wander Test — 系统漫游测试方法论

> 像真实用户第一次拿到系统一样，随便逛、随便点、随便输入。
> 脚本化测试验证的是"我们想验证的"，漫游测试发现的是"我们没想过的"。

## 目录

- [核心理念](#核心理念)
- [5 层漫游策略](#5-层漫游策略)
- [问题分级标准](#问题分级标准)
- [报告格式](#报告格式)
- [偷懒信号](#偷懒信号)

## 核心理念

漫游测试不是随机 monkey test。它是有目的的探索：

1. **验证完整性** — 系统每个角落都能到达，没有死胡同
2. **验证健壮性** — 随意操作不会让系统崩溃或进入不可恢复状态
3. **验证一致性** — 每个页面看起来像同一个系统，交互方式统一
4. **验证诚实度** — 用户看到的错误信息是可理解的，不是原始堆栈

## 5 层漫游策略

### 层 1：页面发现 + 全量截图

**做什么**：从首页（或登录后首页）出发，DFS 遍历所有可达页面。

**怎么做**：
1. 打开首页，`playwright-cli snapshot` 获取页面结构
2. 提取所有可交互元素：`<a href>`、`<button>`、`<nav>` 中的链接、tab 切换、下拉菜单
3. 逐个点击，每次点击后：
   - 等待页面稳定（`waitForLoadState('networkidle')` 或 2 秒）
   - `playwright-cli screenshot` 截图
   - `playwright-cli snapshot` 获取新页面结构
4. 如果到达新 URL（与已访问 URL 不同），递归进入
5. 防环：维护已访问 URL 集合，避免无限循环
6. 防深：最大深度 5 层（从首页开始计算）

**输出**：页面地图表（URL、标题、截图路径、父页面、深度）

**常见发现**：
| 现象 | 含义 |
|------|------|
| 点击链接后 URL 不变但页面变了 | SPA 路由，需检查 URL 是否同步 |
| 点击后页面完全空白 | 路由错误或组件加载失败 |
| 点击后出现 404 页面 | 死链接 |
| 某个 nav 链接始终无法到达 | 权限问题或路由配置错误 |

### 层 2：浏览器错误捕获

**做什么**：全程监控浏览器控制台和网络请求，捕获任何异常。

**怎么做**：
1. 漫游开始前，注入监听脚本：

```javascript
// 注入到浏览器的错误捕获脚本
const errors = [];
const networkErrors = [];

// 捕获 console.error
const origError = console.error;
console.error = (...args) => {
  errors.push({ type: 'console.error', message: args.join(' '), timestamp: Date.now() });
  origError.apply(console, args);
};

// 捕获未处理异常
window.addEventListener('error', (e) => {
  errors.push({ type: 'unhandled.error', message: e.message, file: e.filename, line: e.lineno, timestamp: Date.now() });
});

// 捕获未处理的 Promise rejection
window.addEventListener('unhandledrejection', (e) => {
  errors.push({ type: 'unhandled.rejection', message: e.reason?.message || String(e.reason), timestamp: Date.now() });
});

// 捕获网络错误
const origFetch = window.fetch;
window.fetch = async (...args) => {
  const response = await origFetch.apply(window, args);
  if (!response.ok) {
    networkErrors.push({ url: args[0], status: response.status, timestamp: Date.now() });
  }
  return response;
};

const origXhrOpen = XMLHttpRequest.prototype.open;
const origXhrSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open = function(method, url) {
  this._wanderUrl = url;
  this._wanderMethod = method;
  return origXhrOpen.apply(this, arguments);
};
XMLHttpRequest.prototype.send = function() {
  this.addEventListener('loadend', function() {
    if (this.status >= 400) {
      networkErrors.push({ method: this._wanderMethod, url: this._wanderUrl, status: this.status, timestamp: Date.now() });
    }
  });
  return origXhrSend.apply(this, arguments);
};
```

2. 每次页面切换后，查询累积的错误数量
3. 漫游结束时，导出完整错误日志

**输出**：每个页面的 console 错误数、HTTP 4xx/5xx 列表

**常见发现**：
| 现象 | 含义 |
|------|------|
| TypeError: Cannot read properties of undefined | 缺少 null check，组件未处理数据为空的情况 |
| 404 on /api/xxx | 前端调了不存在的 API 端点 |
| 500 on /api/xxx | 后端未处理异常，且错误信息可能暴露给前端 |
| CORS error | 前后端端口/域名配置不一致 |
| ChunkLoadError | 前端部署不完整，缺少 JS chunk 文件 |

### 层 3：表单胡搞

**做什么**：遇到表单时，尝试各种异常输入，验证前后端校验。

**怎么做**：
对页面上的每个 `<input>` `<textarea>` `<select>`：

1. **空值测试**：清空必填字段，提交
   - 预期：前端阻止提交或后端返回 400，用户看到明确的错误提示
2. **超长输入**：填入 10000 个字符
   - 预期：前端截断或后端限制，不会导致页面卡顿或数据库错误
3. **特殊字符**：`<script>alert('xss')</script>` `"';--` `\x00`
   - 预期：不执行脚本，不导致 SQL 注入，输入被正确转义
4. **类型错误**：在数字字段输入文字，在邮箱字段输入非邮箱
   - 预期：前端提示格式错误
5. **边界值**：0、-1、999999999、日期的 2月30日
   - 预期：合理处理，不崩溃

**Playwright 执行模式**：
```bash
# 识别表单元素
playwright-cli snapshot  # 获取元素 ref

# 空值测试
playwright-cli fill e5 ""
playwright-cli click e_submit
playwright-cli screenshot  # 截图看是否有错误提示

# 特殊字符测试
playwright-cli fill e5 "<script>alert(1)</script>"
playwright-cli click e_submit
playwright-cli screenshot

# 超长输入测试
playwright-cli fill e5 "$(python3 -c 'print("A"*10000)')"
playwright-cli click e_submit
playwright-cli screenshot
```

**输出**：每个表单的测试结果（通过/失败），失败时截图 + console 输出

**常见发现**：
| 现象 | 含义 |
|------|------|
| 提交空表单后 500 错误 | 后端缺少必填校验 |
| 输入 `<script>` 后页面出现弹窗 | XSS 漏洞 |
| 超长输入后页面卡死 | 前端未限制输入长度 |
| 输入特殊字符后数据损坏 | 后端未做输入清洗 |
| 提交后无任何反馈 | 缺少成功/失败提示 |

### 层 4：死胡同检测

**做什么**：检查是否存在到达后无法返回或无法继续操作的页面。

**怎么做**：
1. 遍历页面地图中的每个页面
2. 对每个页面检查：
   - 是否有返回/上一级导航（back button / 面包屑 / nav）
   - 是否有至少一个可点击的导航元素指向其他页面
   - 如果页面是"结果页"（创建成功、提交完成），是否有"返回列表"或"继续操作"入口
   - 如果页面是"错误页"（404、权限不足），是否有"返回首页"入口
3. 浏览器后退测试：`playwright-cli press Alt+LeftArrow`，验证是否能回到上一页

**输出**：死胡同页面列表（URL、如何到达、缺少什么导航）

**常见发现**：
| 现象 | 含义 |
|------|------|
| 创建成功后停在结果页，无下一步入口 | 缺少"返回列表"或"查看详情"链接 |
| 404 页面只有错误文字 | 缺少"返回首页"链接 |
| 深层详情页无法返回列表 | 面包屑或返回按钮缺失 |
| 浏览器后退后页面状态丢失 | SPA 路由状态管理问题 |

### 层 5：视觉一致性扫描

**做什么**：对比不同页面的视觉元素，确保体验一致。

**怎么做**：
1. **导航一致性**：检查每个页面的 header/nav/footer 是否存在且内容一致
2. **空状态**：对列表类页面，检查数据为空时是否有友好提示（而非空白页面）
3. **Loading 状态**：在页面切换时检查是否有 loading 指示器
4. **响应式**：至少在桌面（1920x1080）和平板（768x1024）两种视口下截图

```bash
# 桌面视口截图
playwright-cli screenshot --viewport="1920,1080"

# 平板视口截图
playwright-cli screenshot --viewport="768,1024"
```

**输出**：视觉一致性检查表

**常见发现**：
| 现象 | 含义 |
|------|------|
| 某个页面缺少 header | 路由配置错误，该页面未使用公共 layout |
| 空列表页显示空白 | 缺少 empty state 组件 |
| 页面切换时无 loading | 用户体验差，不知道系统在工作 |
| 平板视口下布局错乱 | 响应式 CSS 缺失或不完整 |
| 不同页面按钮样式不同 | 未统一使用设计系统组件 |

## 问题分级标准

### P0 — 阻塞（必须修复才能 L6 PASS）

| 类型 | 判定标准 |
|------|----------|
| JS 崩溃白屏 | 页面完全无法渲染，console 有未捕获异常 |
| 核心流程中断 | 用户无法完成主要操作（如无法登录、无法提交表单） |
| 数据丢失 | 操作后数据消失或不一致 |
| 安全漏洞 | XSS 执行、敏感信息暴露、认证绕过 |
| 死胡同导致卡死 | 用户到达某页面后完全无法离开（包括浏览器后退失效） |

### P1 — 记录 + 修复建议（不阻塞但必须报告）

| 类型 | 判定标准 |
|------|----------|
| 样式不一致 | 不同页面 header/footer/nav 样式差异明显 |
| 空状态无提示 | 列表为空时显示空白而非友好提示 |
| Loading 缺失 | 操作无反馈，用户不知道系统在工作 |
| 表单验证不完整 | 某些字段没有前端验证但后端会拒绝 |
| 小交互问题 | tooltip 不消失、dropdown 位置错、焦点管理异常 |
| 响应式瑕疵 | 平板/手机视口下局部布局错乱 |

### P2 — 必须修复（不阻塞 L6 但必须修复交付）

| 类型 | 判定标准 |
|------|----------|
| 性能偏慢 | 页面加载 > 3 秒但可用 |
| 文案不统一 | 同一概念不同页面用不同名称 |
| 响应式小瑕疵 | 某个元素在小屏幕上略偏 |

## 报告格式

漫游测试产出保存在 `{迭代作用域}/L6-deploy/{slug}/wander-evidence/`：

```
wander-evidence/
  page-map.json          # 页面地图（URL、标题、深度、截图路径）
  screenshots/
    wander-01-home.png
    wander-02-dashboard.png
    wander-03-form-error.png
    ...
  console-errors.json    # 所有 console 错误（按页面分组）
  network-errors.json    # 所有 HTTP 4xx/5xx（按页面分组）
  issues.json            # 发现的问题（级别、页面、截图、根因、修复建议）
  wander-report.md       # 人类可读的汇总报告
```

### wander-report.md 格式

```markdown
# 系统漫游测试报告

## 漫游概况

| 指标 | 值 |
|------|-----|
| 起始页 | {url} |
| 漫游深度 | {n} 层 |
| 发现页面数 | {n}（去重后） |
| 截图数 | {n} |
| Console 错误 | {n} 条 |
| HTTP 4xx/5xx | {n} 条 |
| P0 问题 | {n} 个 |
| P1 问题 | {n} 个 |
| P2 必修 | {n} 个 |

## 页面地图

| # | 页面标题 | URL | 深度 | 截图 | Console 错误 | HTTP 错误 | 状态 |
|---|---------|-----|:----:|------|:-----------:|:---------:|:----:|
| 1 | 首页 | / | 0 | wander-01.png | 0 | 0 | OK |
| 2 | 仪表盘 | /dashboard | 1 | wander-02.png | 1 (TypeError) | 0 | WARN |
| 3 | 设置 | /settings | 1 | wander-03.png | 0 | 1 (404) | WARN |

## 发现的问题

### P0-1: {简短标题}

- **页面**: {URL}
- **操作**: {具体点击了什么 / 输入了什么}
- **现象**: {用户看到了什么}
- **截图**: `wander-XX.png`
- **Console 输出**: `{错误原文}`
- **Network 错误**: `{method} {url} → {status}`
- **根因分析**: {定位到代码的哪一层 / 哪个组件 / 哪个 API}
- **修复建议**: {具体的代码修改方案，精确到文件和行}

### P1-1: {简短标题}

（同上格式）

## 表单测试汇总

| 表单所在页面 | 字段数 | 空值测试 | 特殊字符 | 超长输入 | 类型错误 |
|-------------|:------:|:--------:|:--------:|:--------:|:--------:|
| /login | 2 | PASS | PASS | PASS | N/A |
| /settings | 5 | FAIL | PASS | FAIL | PASS |

## 死胡同检测

| 页面 | URL | 到达路径 | 问题 | 建议 |
|------|-----|---------|------|------|
| 无 | — | — | 未发现死胡同 | — |

## 视觉一致性

| 检查项 | 状态 | 说明 |
|--------|:----:|------|
| Header 一致性 | OK | 所有页面 header 相同 |
| Footer 一致性 | WARN | /settings 缺少 footer |
| 空状态处理 | FAIL | /tasks 列表为空时无提示 |
| Loading 指示 | OK | 页面切换有 loading spinner |
| 响应式（桌面） | OK | 1920x1080 布局正常 |
| 响应式（平板） | WARN | /dashboard 侧栏遮挡内容 |
```

## 偷懒信号

| 偷懒信号 | 处理 |
|---------|------|
| "漫游发现无明显问题" 但没有页面地图 | 打回 — 没有页面地图说明没有真的漫游 |
| 只截了 2-3 张截图就说漫游完成 | 打回 — 正常系统至少 5+ 页面 |
| P0 问题没有根因分析和修复建议 | 打回 — "有问题"不是报告，"为什么有问题"和"怎么修"才是 |
| console 错误数为 0 但页面有白屏 | 打回 — 错误捕获没有正确注入 |
| 表单测试全是 PASS 但没有测试细节 | 打回 — 没有实际尝试异常输入 |
| 页面地图只有一级深度 | 打回 — DFS 至少要深入 3 层 |
| "由于时间关系只测试了部分页面" | 打回 — 全量遍历是强制要求 |
