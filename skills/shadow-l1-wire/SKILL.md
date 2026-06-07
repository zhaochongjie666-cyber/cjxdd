---
name: shadow-l1-wire
alias: Shadow·L1-Wire
description: |
  Shadow L1 线框图设计（SVG 设计思维）。产出 wire.svg（SVG UI/UX 契约图），强调完整界面设计而非标签堆砌。
  设计核心驱动力是 research.md 的用户画像和旅程穷举——先枚举"谁在用"和"怎么用"，再推导页面、交互和状态。
  SVG 强制模型思考布局、尺寸、位置、视觉层次，而非 HTML 的堆砌行为。
  每个交互区域用 data-node/data-rule/data-action/data-target 标注，关联 flow 节点、spec 规则、用户动作和跳转目标。
  架构师和实现者通过 SVG 一眼看到所有页面、所有状态、所有可交互点以及代码实现传导边界。
  触发：线框、wire、UI、原型、SVG。
version: "4.4.0"
---

# Shadow L1 Wire — SVG 线框图

## 角色

把 spec 里的规则翻译成用户能看到、能操作、能实现的界面。**用 SVG 画图，而非 HTML 写代码。**

`wire.svg` 不是低保真占位图，而是 L1 向 L1.5/L5 传导的 **UI/UX 契约源**：
- 产品/业务从 SVG 看懂所有页面、状态、操作、反馈和跳转
- 架构师从 SVG 抽出路由、页面、组件、API 触发点和状态管理边界
- 测试从 SVG 抽出可交互点、空/加载/错误/成功状态和验收路径
- 实现从 SVG 对齐布局、组件层级、控件行为、反馈方式和页面流转

SVG 强制模型思考：
- **布局**：页面区域划分（header/sidebar/main/footer）
- **尺寸**：每个区域的大小、比例
- **位置**：元素的 x/y 坐标、对齐方式
- **视觉层次**：颜色区分、透明度、分组（`<g>`）
- **交互路径**：每个入口、按钮、链接、表单、菜单、弹窗、抽屉、分页、筛选、批量操作都有明确动作和目标
- **状态体验**：normal/loading/empty/error/success/disabled/selected 等状态在图中可见

HTML 的堆砌行为会导致：`<div><div><div>...` 无限嵌套，结构混乱，不思考设计。

纯后端项目跳过此步。

**关于 `templates/` 目录**：`templates/` 下的 HTML/Vue 文件是**布局和交互参考**，不是产出模板。agent 读这些文件理解布局模式（sidebar 宽度、表格列数、表单分组等），然后用 SVG 重新表达。产出永远是 `.svg` 文件，不得产出 `.html` 或 `.vue` 文件。

## 为什么选择 SVG 而非 HTML

| 格式 | 模型行为 | 结果 |
|------|---------|------|
| **SVG** | 画图思维 → 规划布局、尺寸、位置 | 清晰的设计图、视觉层次分明 |
| **HTML** | 写代码思维 → 堆砌标签 | 结构混乱、样式重复、不思考设计 |

## 怎么做

### 核心原则

**wire 设计的根本输入不是 spec 规则，不是 flow 节点，而是用户画像和旅程穷举。**

wire 是用户旅程的视觉化表达——每条旅程中的每个场景都对应一个页面/弹窗/抽屉，每个操作都对应一个交互点。spec 和 flow 只辅助查漏补缺，不能替代旅程作为设计源头。

### 渐进式精化 3-Pass 工作流（S 级项目可合并为 2-Pass）

如果 `.shadow/scale.md` 存在且 `wire_passes = 2`，Pass 2 和 Pass 3 合并为一步（内容填充 + data-* 标注 + 状态变体同时完成），产出最终的 `wire.svg`。否则走标准 3-Pass。

wire 生成必须遵循**大块 → 小块 → 细节**的渐进式精化。全流程一眼看完：

```
Pre-work (§0-§3)  旅程分析 → 页面清单 → 交互清单 → 查漏补缺
     ↓
Pass 1 (大块骨架)  wire-skeleton.svg    分区 + 尺寸 + 结构        只引用 layout/*
     ↓ 检查：所有页面骨架完整
Pass 2 (小块填充)  wire-content.svg     内容 + 导航 + 表单/表格   引用 collection/overlay/detail/*
     ↓ 检查：所有 data-action 有 UI 占位
Pass 3 (细节契约)  wire.svg (最终)       data-* + 状态变体        引用 state/*
     ↓ 检查：L1 Gate（覆盖率 100%）
Pass 4 (品味检验)  去色 → 并列 → 新人   不产出文件
     ↓
wire.svg 进入 L1 Gate → 传导至 L1.5/L5
```

**S 级 2-Pass 简化路径**：
```
Pre-work → Pass 1（骨架）→ Pass 2+3 合并（内容+标注+状态）→ Pass 4（品味）→ wire.svg
```

**禁止跳步**。Pre-work 没做完不进 Pass 1，Pass 1 没做完不进 Pass 2，Pass 2 没做完不进 Pass 3。Pass 3 产出后必须过 Pass 4 品味检验才能进入 L1 Gate。每 pass 只加载该阶段需要的模板类型，禁止一次性把所有 templates/ 塞入上下文。

---

## Pre-work：分析准备（所有 pass 之前完成）

### §0. 读用户画像和旅程穷举（第一驱动源）

从 `research.md` 提取以下内容，作为 wire 设计的出发点：

**0.1 画像清单**

列出所有用户画像 P-XX，每个画像标注其可能访问的页面类型：

```text
| 画像 | 角色 | 核心目标 | 预期涉及页面类型 |
|------|------|---------|----------------|
| P-01 采集员 | 采集 | 外场采集、打点记录 | 采集地图页、采集详情页 |
| P-02 标注员 | 标注 | 完成任务、快速标注 | 任务列表、标注编辑器 |
| P-03 质检员 | 质检 | 审核标注、通过/驳回 | 质检列表、质检页面 |
| P-04 仿真操作员 | 仿真 | 回放验证、标记问题 | 仿真播放器、仿真报告页 |
```

**0.2 旅程场景和操作提取**

遍历每条旅程的"用户看到的场景"列和"用户操作"列，系统性地提取：

```text
旅程 J-01（采集员，主线）:
  场景 1: 采集地图页（显示地图和新建采集按钮）
    操作: 点击新建采集→填写路线→创建
  场景 2: 采集详情页（显示任务状态为 DRAFT）
    操作: 点击开始采集→状态变为 COLLECTING
  ...

旅程 J-04（标注员，主线）:
  场景 1: 任务列表页（显示待处理任务）
    操作: 点击任务→进入标注编辑器
  场景 2: 标注编辑器（显示视频/点云画面）
    操作: 创建标注→选择标签→保存
  ...
```

**0.3 构建页面×旅程覆盖表（先于画图）**

产出 wire 内部使用的覆盖表，便于 wire 设计时逐格验证：

```text
| 场景（页面） | P-01 旅程 | P-02 旅程 | P-03 旅程 | P-04 旅程 |
|-------------|-----------|-----------|-----------|-----------|
| 采集地图页   | J-01, J-02| —         | —         | —         |
| 采集详情页   | J-01, J-03| —         | —         | —         |
| 任务列表页   | —         | J-04, J-06| —         | —         |
| 标注编辑器   | —         | J-04, J-06| —         | —         |
| 质检页面     | —         | —         | J-05      | —         |
| 仿真播放器   | —         | —         | —         | J-07, J-08|
| 仿真报告页   | —         | —         | —         | J-07      |
```

**覆盖规则**：
- 每个页面至少被 ≥2 个不同画像的旅程覆盖（交叉验证，确保页面不是为单一角色设计）
- 如果某页面只有一个画像覆盖 → 标记为 WARN，可能存在设计偏差
- 如果旅程中的"用户看到的场景"找不到对应 wire 页面 → **必须补充 wire 页面，不允许遗漏**
- 如果多个旅程共享相同场景 → 合并为同一个页面，标注所有来源旅程

### §1. 从旅程场景推导页面清单

基于步骤 0 的覆盖表，产出正式的页面清单：

```text
页面清单：
  page-collection-map:    采集地图页，入口 /collections
  page-collection-detail:  采集详情页，入口 /collections/:id
  page-task-list:          任务列表页，入口 /tasks
  page-annotator:          标注编辑器，入口 /tasks/:id/annotate
  ...

用户路径（从旅程串联提取）：
  采集线: collection-map → collection-detail → collection-map → ...
  标注线: task-list → annotator → submit → task-list
  质检线: review → approve/reject → review
```

**检查**：§0 覆盖表中的每个场景是否至少有 1 个页面？没有就补充。

### §2. 从旅程操作推导交互清单

遍历每条旅程的"用户操作"列，为每个操作分配一个 `data-action` 标识符：

```text
| data-action | 对应旅程操作 | 来源旅程 | 对应页面 |
|-------------|-------------|---------|---------|
| create-collection | 点击新建→填写路线→创建 | J-01 | page-collection-map |
| start-collection | 点击开始采集 | J-01 | page-collection-detail |
| open-task | 点击任务→进入编辑器 | J-04 | page-task-list |
| create-annotation | 创建标注→选择标签→保存 | J-04 | page-annotator |
| submit-annotation | 点击提交→确认弹窗→确认 | J-04 | page-annotator |
```

**检查**：每条旅程的每个操作是否都有 `data-action`？没有就补充。

### §3. 辅助参考：用 flow + spec 查漏补缺

前面两步以旅程为驱动源设计页面和交互后，再用 flow 和 spec 做辅助检查：

- flow 中是否有"用户可见"的节点未被任何旅程覆盖？→ 可能是系统自动触发的页面，新增
- spec 中是否有"用户交互类"规则未被任何旅程覆盖？→ 可能是 wire 漏了，补充
- 纯后台规则（如定时任务、事件处理）不需要在 wire 中体现

---

## Pass 1：大块骨架（Skeleton Layer）

**输入**：§1 的页面清单 + `template-index.md` 的 `layout/*` 模板

**目标**：画出每个页面的骨架分区（header/sidebar/main/footer）+ 尺寸比例 + 布局结构。**这一 pass 不填充内容，不画交互元素，不标注 data-*。**

**产出**：`wire-skeleton.svg`（仅在 Pass 1 使用的中间文件，Pass 2 叠加后丢弃）

### 4.1 为每个页面选择布局类型

从 `template-index.md` 的 `layout/*` 中选一个主型。三者选一：

| 页面主任务 | 选这个类型 |
|-----------|-----------|
| 查找/筛选/浏览多条记录 | `layout/data-list` |
| 看总览和统计 | `layout/dashboard` |
| 查看详情/编辑单条对象 | `layout/detail-form` |

**检查**：每个页面有且仅有 1 个布局类型。布局模式详情见 `template-index.md` §1。模板选择决策树和匹配算法见 `references/template-selector.md`，选择工作流见 `references/template-selection-workflow.md`、`references/selector-input-contract.md`、`references/selector-output-contract.md`。

### 4.2 绘制骨架 SVG

只画分区 `<g>` + 尺寸（`width`/`height`/`y` 坐标），不写交互元素和 data-*：

```text
page-task-list 骨架布局：
┌──────────────────────────────────────┐
│ Header (导航栏)                       │ y=0, height=60
├──────────────────────────────────────┤
│ Sidebar (侧边栏) │ Main (主内容区)    │ y=60
│ width=220        │ width=780          │
├──────────────────────────────────────┤
│ Footer (状态栏)                       │ y=660, height=40
└──────────────────────────────────────┘
```

> SVG `<g>` 分组结构、data-* 属性完整定义、metadata 格式、viewBox 规则、visibility 切换规则详见 **`references/wire-svg-spec.md`**。

布局模板参考：
- `layout/data-list`：Header + Sidebar + (Filter + Table + Pagination)
- `layout/dashboard`：Header + (CardGrid + Chart + RecentList)
- `layout/detail-form`：Header + (Form + ActionBar)

### 4.3 Pass 1 检查点

- [ ] 所有页面清单中的页面都有骨架 SVG
- [ ] 每个页面骨架包含 header/sidebar/main/footer（或等价业务分区）
- [ ] 每个骨架的尺寸一致（见品味引导 — "比例就是秩序"）
- [ ] 骨架不含任何业务内容、交互元素、data-*
- [ ] 弹窗/抽屉有独立的骨架占位

---

## Pass 2：小块填充（Content Layer）

**输入**：§2 的交互清单 + `template-index.md` 的 `collection/*` `detail/*` `overlay/*` 模板

**目标**：在每个骨架上填充内容区域。这一 pass 只关注"有什么内容块"，不画状态变体，不标注 data-*。

**产出**：`wire-content.svg`（仅在 Pass 2 使用的中间文件，Pass 3 叠加后丢弃）

### 5.1 按页面类型加载内容模板

从 `template-index.md` 按需加载。只加载当前页面真正需要的模板：

| 模板类 | 按需选 |
|--------|--------|
| `collection/*` | filter / table / pagination / bulk-actions |
| `detail/*` | form-section / desc-list / tabs |
| `overlay/*` | dialog-centered / drawer-right / drawer-left |

### 5.2 在骨架上填充内容

在 Pass 1 的每个 `<g>` 分区内，添加内容区域（导航链接、筛选区、表格表头+数据行、分页、表单字段、弹窗内容结构等）。

**内容填充规则**：
- 只写示意文本（"任务名称"、"查询"、"1 2 3..."），不追求精确数据
- 不添加 data-* 属性
- 不画状态变体
- 业务标签（"待处理"、"已提交"等）已经可以出现，为 Pass 3 的状态变体做铺垫

### 5.3 Pass 2 检查点

- [ ] §2 交互清单中的每个 data-action 都有对应的 UI 元素占位（按钮/表单/链接等）
- [ ] 表单字段有示意标签和输入区
- [ ] 表格有表头和≥1 行示意数据
- [ ] 弹窗/抽屉有内容结构
- [ ] 不包含 data-* 标注、不画状态变体

---

## Pass 3：细节契约（Contract Layer）

**输入**：project.flow.mermaid + spec.md + §2 交互清单

**目标**：在 wire-content.svg 上叠加 data-* 标注、状态变体、metadata。这是最终 wire.svg。

**产出**：`wire.svg`（最终产物，L1 Gate 检查对象）

### 6.1 标注 UI/UX 传导属性

每个核心交互元素必须标注以下属性，供下游 L1.5/L5 消费：

| 属性 | 来源 | 示例 |
|------|------|------|
| `data-node="BXX-NYY"` | project.flow.mermaid | `data-node="B02-N07"` |
| `data-rule="{slug}-RXX"` | spec.md | `data-rule="annotation-R02"` |
| `data-action="verb-object"` | §2 交互清单 | `data-action="save-annotation"` |
| `data-target="page\|dialog\|api"` | 跳转/弹窗/API 目标 | `data-target="api.POST./api/annotations"` |
| `data-ux="primary\|secondary\|..."` | 交互角色语义 | `data-ux="primary"` |
| `data-journey="J-XX"` | 旅程编号（可选） | `data-journey="J-01"` |

> data-* 属性完整定义（格式、目标类型前缀、data-ux 语义、data-page/route/state）、metadata 格式、visibility 切换规则详见 **`references/wire-svg-spec.md`**。

### 6.2 添加状态变体

每个页面的状态变体在单独的 `<g>` 中绘制，用 `data-state` 区分。从旅程的"用户看到的场景"列中提取。

每个页面至少画 4 类状态变体：`normal`、`loading`、`empty`、`error`。涉及提交/保存/审核的页面还必须画 `success`、`disabled` 或 `pending`。

> 各状态（normal/loading/empty/error/success/disabled/pending）的详细视觉要求、文案规则、SVG 示例详见 **`references/wire-state-guide.md`**。

### 6.3 写入 metadata（代码实现摘要 + 旅程覆盖摘要）

在 SVG 末尾用 `<metadata>` 写入两份内容：

1. **`wire-contract`**：代码实现摘要（下游 L1.5/L5 消费）— 包含页面清单（id/route/component/states）和交互清单（id/node/rule/action/target/implement）
2. **`wire-coverage`**：旅程覆盖摘要（供 L2 覆盖矩阵验证）— 包含每个页面的关联旅程和画像

**约束**：
- `uncovered_journeys` 必须为空。不为空时 wire 不可进入下一层
- L1 Gate 会检查 `wire-coverage` 中的 `coverage` 是否为 100%

> metadata 完整格式和字段定义详见 **`references/wire-svg-spec.md`** §4。

### 6.4 Pass 3 检查点

- [ ] 所有可交互元素有 data-node/data-rule/data-action/data-target/data-ux
- [ ] 每个页面有 ≥4 个状态变体（normal/loading/empty/error）
- [ ] `metadata#wire-coverage` 覆盖率 100%
- [ ] `metadata#wire-contract` 包含所有页面和交互
- [ ] **viewBox 密度 ≥ 30%** — 跑 `bash skills/shadow-l1-wire/scripts/check-density.sh wire.svg`, exit 0 才算 Pass 3 完成 (实施 A4 双保险第一层)

### 6.5 viewBox 密度自检 (实施 A4)

跑 `bash skills/shadow-l1-wire/scripts/check-density.sh <wire.svg>` (或 `SHADOW_DIR=... bash .../check-density.sh` 不带参数), 检查项:

1. **viewBox 不能过大** — `<g transform="translate(x,y)">` 的 min/max x/y 算 bbox, 跟 viewBox 面积比 < 30% 必 fail. 修了 spec 报 9600x7200 内容只占 800x430 这种"画布巨大 内容挤角"反模式.
2. **节点不能过少** — `<rect>/<text>/<g>/<line>/<path>/<circle>/...` 总节点 < 5 也 fail.
3. **修复指引** — 脚本打印 `viewBox="0 0 used_w used_h"` 建议值, 直接复制.

**双保险**: 第一层 (本脚本, 写时立即检) + 第二层 (L5 段 5.8 跑 `plugins/shadow-hooks.ts:checkWireSvgDensity`, 写完事后审计). 两层都用同一算法, 保证 0% 漏判.

### 3-Pass 全流程示例

```text
Pre-work:
  §0-§3: 完成旅程分析 → 页面清单 → 交互清单 → flow+spec 校验

Pass 1（大块骨架）:
  选型: page-task-list → layout/data-list
  画出骨架 SVG（仅 header/sidebar/main/footer 分区）
  ✅ 检查：所有页面骨架完整

Pass 2（小块填充）:
  加载: collection/filter + collection/table + collection/pagination
  在骨架中填入筛选区、表格头+数据行、分页区
  ✅ 检查：每个 data-action 有 UI 占位

Pass 3（细节契约）:
  标注: 给"创建标注"按钮加 data-node="B02-N07" data-rule="annotation-R02" data-action="create-annotation"
  状态: 添加 loading/empty/error 状态变体
  metadata: 写入 wire-contract + wire-coverage
  ✅ 检查：L1 Gate 全部通过 → 产出最终 wire.svg
```

下游传导：L1.5 从 data-* 生成页面/组件/API 清单；L5 引用 SVG id 声明契约；L4 覆盖每个 data-action；L5 实现不能少于 SVG 契约。详见 **`references/wire-svg-spec.md`** §7。

### 品味引导：有视觉分寸的线框图

**好的线框图一眼就能看出"这是一个有设计的系统"——所有页面共用同一套视觉语言，安静但不简陋。**

**比例就是秩序。** 同一项目中，所有页面的 Header 高度必须一致（±2px 偏差），Sidebar 宽度一致，按钮高度一致，行间距一致。不一致会让人"感觉不对劲"——而"感觉不对劲"就是没有品味：

```
无品味（各自为政）:
  page-login:    Header height=60
  page-task-list: Header height=64
  page-reviewer:  Header height=58
  （看起来像三个不同项目拼凑的）

有品味（系统一致）:
  所有页面: Header height=60, Sidebar width=220, footer height=40
  所有按钮: height=32, border-radius=6
  所有表单标签: font-size=14, margin-bottom=8
```

**克制比丰富更难。** 一个按钮解决的问题，不要用三个。留白不是浪费，是告诉用户"这里可以呼吸"。

**不要骗眼睛。** 线框图里的尺寸应该和最终实现一致。真实尺寸本身就是品味的一部分。

**Pass 内的品味检查点**：

```
Pass 1（骨架）：
  □ 所有页面 Header/Sidebar/Main 比例一致

Pass 2（内容）：
  □ 按钮文字统一、表单项间距一致
  □ 弹窗/抽屉不遮挡核心内容

Pass 3（契约）：
  □ data-ux="danger" 给真正的危险操作
  □ 状态变体覆盖用户真正遇到的场景
  □ metadata 中 component 命名风格统一
```

### Pass 4：品味检验（Mental Check）

不产生新文件，整体品味审视。AI 审查契约和评分标准见 `references/ai-review-contract.md` 和 `references/ai-review-rubric.md`，审查 prompt 见 `references/ai-review-prompt.md`，各页面类型审查示例见 `references/ai-review-example-*.md`。通过标准：

1. **去色**：去掉所有颜色后布局层次仍清晰。不能 → 在用颜色掩盖结构问题。
2. **并列**：任意两页并列像同一系统。不像 → 视觉语言分裂。
3. **新人**：没参与设计的开发者 5 分钟能说清页面结构。不能 → 视觉噪音过多。

不通过 → 回到 Pass 2 减法。

## 产出

`.shadow/L1-business/wire.svg`(项目级单张大图,Pass 1/2 中间产物 `wire-skeleton.svg` / `wire-content.svg` 完成后丢弃)

**生命周期角色**:`design_baseline` 设计基线(`wire.svg` + `data-*` 标注是 L1.5 / L5 UI 契约源) + `process_output` 过程产物(`wire-skeleton.svg` / `wire-content.svg`,Pass 3 完成后删除)。详见 `.shadow/shadow-schema.json:lifecycle_artifacts` → `wire-svg` / `wire-skeleton`。

这是项目级唯一线框图。与 project.flow.mermaid 一致，不按业务线拆分。所有业务线的页面、交互、状态都在同一张 wire.svg 中。

一个 SVG 文件，包含：完整页面清单 + 布局规划 + UI/UX 设计 + 交互元素 + 状态变体 + data-* 标注 + `metadata#wire-coverage`（旅程覆盖率 100%）+ `metadata#wire-contract`（代码实现摘要）。

## 约束

### 设计驱动链（优先级从高到低）

1. **旅程驱动**：wire 首要输入是 `research.md` 的用户画像和旅程穷举，不是 spec 或 flow
2. **页面从场景推导**：每个"用户看到的场景"对应一个 SVG 页面或交互区域
3. **交互从操作推导**：每个"用户操作"对应一个 `data-action` 标注
4. **画面从布局开始**：先划分页面区域，再画元素
5. **辅助查漏**：spec + flow 仅用于校验旅程驱动有无遗漏，不可替代旅程作为设计源

### 覆盖规则

- **旅程覆盖率必须 100%**：`metadata#wire-coverage` 中 `uncovered_journeys` 必须为空
- **页面×旅程交叉覆盖**：每个页面至少被 ≥2 个不同画像的旅程覆盖（单画像页面标记为 WARN）
- **操作全覆盖**：每条旅程的每个操作都有 `data-action`
- **状态从旅程提取**：每个页面的状态变体来自旅程中"用户看到的场景"描述

### 3-Pass 生成约束

- **必须按 3-Pass 顺序生成**：禁止直接生成完整 wire.svg。Pass 1 先出骨架，Pass 2 再填内容，Pass 3 最后加标注和状态
- **每 pass 隔离**：每 pass 只做自己阶段的事。Pass 1 不填内容；Pass 2 不标 data-*；Pass 3 不改变 Pass 2 的布局和内容
- **每 pass 有检查点**：Pass 1 检查所有页面骨架完整；Pass 2 检查所有交互有 UI 占位；Pass 3 检查 L1 Gate 通过
- **同一项目所有页面的 Header/Sidebar/Footer 尺寸必须一致**（见品味引导 — "比例就是秩序"）
- 中间文件 `wire-skeleton.svg` 和 `wire-content.svg` 不在最终产出物中提交，仅 Pass 2/3 的生成输入
- 组件库参考见 `references/component-library.md`

### 技术约束

- **必须先列完整页面/弹窗/抽屉/状态清单**，不能只画当前主页面
- SVG 根节点必须存在，核心页面区域必须使用 `<g id="...">` 或等价分组表达
- 每个 `data-node` 必须在 flow 中有对应节点
- 用户交互类规则必须在 SVG 中有对应 `data-rule`、`data-action` 和 `data-target`
- 每个页面必须有 `data-page` 或 `id="page-..."`，路由型页面必须有 `data-route`
- 关键状态（normal/loading/empty/error/success/disabled/pending）必须画出来，不能只在文字里描述
- 关键交互必须能从 SVG 反推出代码实现位置：页面、组件、API 或状态管理边界
- 纯后端项目可跳过
- **用 SVG 画图，而非 HTML 写代码**
- **用真实尺寸和坐标，而非随意数值**
- **用颜色和分组表达层次，而非堆砌元素**
- 不得生成 `wire.html` 作为 L1 Wire 产物；如需预览也必须以 `wire.svg` 为源

## 品味约束

引用 `references/taste-criteria.md`。交付前通过致命三检：

- [ ] 减法：删 30% UI 元素后核心功能仍可达
- [ ] 人话：新人 5 分钟理解页面结构
- [ ] 一致：Header/Sidebar/按钮/字体/圆角全局统一（±2px）

Wire 特化：错误态文案给人看。空态有引导。按钮文案说清点击后发生什么。

## 简单项目示例：自动驾驶数据平台

### 页面清单（从旅程推导）

| 页面 ID | 页面名 | 覆盖旅程 | 核心交互 |
|---------|--------|---------|---------|
| page-collection-map | 采集地图页 | J-01, J-02, J-03 | 创建任务、开始采集、记录打点 |
| page-collection-detail | 采集详情页 | J-01, J-03 | 查看进度、结束采集、上传状态 |
| page-task-list | 标注任务列表 | J-04, J-06 | 领取任务、查看驳回通知 |
| page-annotator | 标注编辑器 | J-04, J-06 | 创建标注、提交、修改返工 |
| page-review | 质检页面 | J-05 | 逐帧审核、通过/驳回 |
| page-simulation-player | 仿真播放器 | J-07, J-08 | 播放回放、标记问题 |
| page-simulation-report | 仿真报告页 | J-07 | 查看问题列表、导出报告 |

### wire.svg 片段示例

标注编辑器核心区域 SVG 示例（含 data-* 标注、状态变体、metadata）详见 **`references/wire-svg-spec.md`** §8。

## 层内自检

完成后加载 `shadow-l1-flow` skill 执行 L1 门禁自检（只检查本 agent 产出物相关的检查项）。全部 L1 agent 完成后执行完整 L1 gate 检查。
