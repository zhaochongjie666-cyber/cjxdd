---
name: xdd-wire
description: |
  xdd 设计层 —— 前端锚。根据规则（RXX）生成页面清单，发散操作态，攻击式 self-review。
  三步：① 解析规格出页面清单 → ② 画主页面 + 6 操作态 → ③ 攻击式 review。
  核心原则：渲染出来的每个元素必须有存在的意义，无混淆。吸收旧 xdd-ux-design 的 UX 审查框架到 references/。
  产出 .xdd/design/wire/{page}/index.html + 6 操作态 + review.md（静态 HTML，浏览器直开）。
  纯后端项目跳过本 skill。
  触发：画页面、wire、线框图、UI 设计、前端设计稿、review 页面、原型、操作态、空状态。
---

# xdd-wire — 前端锚

## 我锚定什么 / 上游 / 下游

**我锚定的是「用户看到什么、怎么操作、每个状态长什么样」** —— 把业务规则变成可视的页面。每个页面的每个元素都要有存在的理由，每个状态（空/加载/错误/成功/确认/边界）都要画到，不留混淆。

| | |
|---|---|
| **上游** | `xdd-understand`(intent.md) + `xdd-spec`(RXX 规则 + Feature 里的页面名/交互/角色) |
| **我产出** | `.xdd/design/wire/{page}/index.html` + 6 操作态 + `review.md` |
| **下游消费者** | `xdd-architecture`（前端文件清单）、`xdd-plan`（前端 task）、`xdd-execute`（前端实现）、`xdd-verify`（页面渲染验收） |
| **回溯锚** | 页面里的交互回指 RXX 规则（HTML 注释标 `@covers-RXX`） |

## 怎么做

### Step 1 · 解析规格，产出页面清单

**输入优先级**（按顺序读）：

1. `.xdd/design/spec/{slug}/*.feature` — Feature/Scenario 里的页面名、交互、角色（语法/具体值写法 → 详见 `xdd-gherkin-plus` skill）
2. `.xdd/design/intent.md` — 业务目标
3. `.xdd/design/design.md` — 范围（in/out scope）
4. `.xdd/design/wire/` — 历史 wire（识别可复用组件）

**输出页面清单**：

```markdown
| # | 页面名 | 核心交互 | 角色 | 来源 RXX |
|---|--------|---------|------|---------|
| 1 | 任务列表页 | 展示/筛选/创建 | 普通用户 | R05,R06 |
| 2 | 登录页 | 账号密码登录 | 游客 | R01 |
```

**自检**：所有页面都有规格来源，无凭空出现；多角色页面标角色差异。

### Step 2 · 画主页面 + 6 操作态

每个页面一个目录，主页面 + 每个状态独立 HTML：

```
.xdd/design/wire/{page}/
├── index.html           # 主页面（desktop）
├── index.mobile.html    # 主页面（mobile）
├── empty.html           # 空状态
├── loading.html         # 加载态（骨架屏，匹配最终布局）
├── error.html           # 错误态（插图+信息+重试）
├── success.html         # 成功态
├── confirm-delete.html  # 确认态（破坏性操作前）
└── review.md            # Step 3 攻击式 review
```

**设计旋钮**（HTML 注释标注）：

| 旋钮 | 默认 | 场景预设 |
|------|------|---------|
| `DESIGN_VARIANCE` 1=对称保守 10=非对称艺术 | 7 | SaaS 7 / 运营后台 5 / 内部系统 4 |
| `MOTION_INTENSITY` 1=静态 10=动效丰富 | 6 | |
| `VISUAL_DENSITY` 1=留白 10=紧凑 | 4 | SaaS 4 / 运营后台 7 / 内部系统 8 |

**HTML 规范**：设计 token 抽成 CSS 变量（`--accent`/`--surface`/`--radius`/`--space-*`）；viewport meta 移动端适配；语义化标签（`<button>`/`<a>`/标题层级）；可见文字不用 em-dash（—）。

**多角色态**：每种角色视角单独 HTML，顶部注释标角色差异。

### Step 3 · 攻击式 review（自己打自己）

每个页面目录输出 `review.md`，逐条质疑：

- **Q1 这个按钮为什么要存在？** —— 用户不知道功能存在呢？有更自然的方式吗？→ 保留/修改/删除
- **Q2 这个数字是什么范围？** —— 用户能判断"今日/本周/累计"吗？没上下文就加时间范围标注
- **Q3 两个相似元素行为一致吗？** —— 外观像的，行为也得像；不像就区分外观
- **Q4 第一次用的用户看得懂吗？** —— 列出内部术语/缩写/黑话，翻译成用户语言
- **Q5 有没有"一次性"交互没告知？** —— 只该做一次的操作有没有明确引导

**深度 UX 审查**（复杂页面）走 4 级框架，见 `references/ux-review.md`：
- 🔴 L1 功能性（不通过则不可用：任务可完成/错误反馈/状态可见/防破坏/键盘可达）
- 🟡 L2 可用性（一致性/信息层次/认知负荷/反馈即时/撤销返回/移动端/文案）
- 🟢 L3 可达性 a11y（语义标签/ARIA/对比度/焦点可见/替代文本/减动效）
- 🔵 L4 体验质感（微交互/动效合理/空状态/加载体验/成功庆祝/品牌一致）

## Self-check · 混淆元素清单（交付前必扫）

四类混淆元素，有则必须消除（详见各 HTML）：

- **A 视觉混淆**：只有 icon 没 label 的按钮 / 两个外观像行为不同的元素 / 数字没时间范围 / 进度条没说明
- **B 语义混淆**：label 与输入不匹配 / 破坏性操作没确认 / 错误只有错误码 / 状态标签与实际不符
- **C 交互混淆**：点击区域不明 / 返回路径不清 / 多步骤没进度指示 / 提交没结果反馈
- **D 内容混淆**：术语没翻译 / 日期格式混用 / 数字没单位 / 列表没排序说明

## 产出

`.xdd/design/wire/{page}/` 每页：`index.html` + `index.mobile.html` + 6 操作态 + `review.md`。

## 自检（无平台 hook）

```
□ 每个页面有规格来源（RXX），无凭空页面？
□ 每页有 index.html + index.mobile.html？
□ 6 操作态全覆盖（空/加载/错误/成功/确认/边界）？
□ 每个按钮有 label 或 tooltip？
□ 混淆元素 A/B/C/D 四类全扫，零未处理项？
□ 设计 token 抽成 CSS 变量？
□ viewport meta 设了（移动端适配）？
□ 可见文字无 em-dash（—）？
□ 每页目录有一份 review.md？
□ 页面里的交互回指了 RXX 规则（HTML 注释 @covers-RXX）？
```
