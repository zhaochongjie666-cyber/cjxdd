# Wire 状态变体完整指南

> 本文档从 SKILL.md 提取，是状态变体的完整参考。SKILL.md 中保留摘要和指针。

## 1. 状态变体总览

每个页面至少画 **4 类** 基础状态变体：`normal`、`loading`、`empty`、`error`。涉及提交/保存/审核的页面还必须画以下扩展状态中的至少 2 个：`success`、`disabled`、`pending`。

| 状态 | 必要性 | 适用页面 |
|------|--------|---------|
| `normal` | 必须 | 所有页面 |
| `loading` | 必须 | 所有页面 |
| `empty` | 必须 | 所有页面 |
| `error` | 必须 | 所有页面 |
| `success` | 条件必须 | 涉及提交/保存/审核的页面 |
| `disabled` | 条件必须 | 有条件触发操作的页面 |
| `pending` | 条件必须 | 涉及审批/等待的页面 |

## 2. 各状态详细要求

### 2.1 normal（正常态）

**定义**：页面数据加载成功，用户可正常浏览和操作。

**视觉要求**：
- 显示完整的页面内容（表格数据、表单字段、详情信息）
- 所有交互元素处于可操作状态
- 不加 `visibility="hidden"` 属性

**必须包含**：
- 完整的数据展示（表格 ≥1 行示意数据，表单有示意值）
- 所有可交互元素（按钮、链接、筛选器、分页）
- 导航高亮当前页面

```svg
<g id="page-task-list-normal" data-page="TaskList" data-state="normal">
  <rect x="240" y="160" width="740" height="440" fill="#fff" stroke="#eee"/>
  <text x="260" y="226" font-size="14" fill="#333">文本标注 - 正面情绪</text>
  <text x="480" y="226" font-size="13" fill="#666">文本</text>
  <text x="600" y="226" font-size="13" fill="#faad14">待处理</text>
  <rect x="740" y="207" width="70" height="30" rx="4" fill="#1890ff"/>
  <text x="775" y="227" font-size="13" fill="#fff" text-anchor="middle">开始标注</text>
</g>
```

### 2.2 loading（加载态）

**定义**：页面数据正在加载，用户等待中。

**视觉要求**：
- 保留页面骨架（header/sidebar/footer）
- 主内容区显示加载指示
- 加载文案具体化（"加载帧数据..."而非通用的"加载中..."）

**禁止**：
- 显示空白页面
- 显示假数据
- 使用通用的"加载中..."文案

```svg
<g id="page-task-list-loading" data-page="TaskList" data-state="loading" visibility="hidden">
  <rect x="240" y="160" width="740" height="440" fill="#fff" stroke="#eee"/>
  <text x="610" y="380" font-size="16" fill="#999" text-anchor="middle">加载中...</text>
</g>
```

### 2.3 empty（空态）

**定义**：页面数据为空或无匹配结果。

**视觉要求**：
- 保留页面骨架
- 主内容区显示空态提示 + 引导文案
- 引导文案必须告诉用户"为什么为空"和"下一步该做什么"

**文案规则**：
- 标题：描述空态原因（"暂无待处理任务"）
- 副标题：提供行动引导（"完成标注后，任务会自动出现在这里"）
- 禁止只写"暂无数据"而没有引导

```svg
<g id="page-task-list-empty" data-page="TaskList" data-state="empty" visibility="hidden">
  <rect x="240" y="160" width="740" height="440" fill="#fafafa" stroke="#eee"/>
  <text x="610" y="360" font-size="16" fill="#ccc" text-anchor="middle">暂无待处理任务</text>
  <text x="610" y="390" font-size="13" fill="#999" text-anchor="middle">完成标注后，任务会自动出现在这里</text>
</g>
```

### 2.4 error（错误态）

**定义**：数据加载失败或操作异常。

**视觉要求**：
- 保留页面骨架
- 主内容区显示错误信息 + 重试操作
- 错误背景用浅红色 `#fff2f0`，边框 `#ffccc7`
- 错误文字用红色 `#ff4d4f`

**文案规则**：
- 错误信息给人看，不说技术术语（"加载失败"而非"HTTP 500 Internal Server Error"）
- 必须提供重试操作按钮
- 如果有已知恢复方法，提供指引

```svg
<g id="page-task-list-error" data-page="TaskList" data-state="error" visibility="hidden">
  <rect x="240" y="160" width="740" height="440" fill="#fff2f0" stroke="#ffccc7"/>
  <text x="610" y="360" font-size="16" fill="#ff4d4f" text-anchor="middle">加载失败</text>
  <rect x="570" y="380" width="80" height="30" rx="4" fill="#ff4d4f"/>
  <text x="610" y="400" font-size="13" fill="#fff" text-anchor="middle">重试</text>
</g>
```

### 2.5 success（成功态）

**定义**：操作成功完成（提交、保存、审核通过等）。

**视觉要求**：
- 显示成功反馈（绿色 `#52c41a`）
- 可能显示结果摘要或跳转引导
- 成功后用户应清楚知道"接下来去哪"

**适用页面**：涉及提交/保存/审核的页面。

**触发场景**（从旅程提取）：
- 提交标注后 → "提交成功，等待质检"
- 保存表单后 → "保存成功"
- 审核通过后 → "审核通过"

```svg
<g id="page-annotator-success" data-page="Annotator" data-state="success" visibility="hidden">
  <rect x="240" y="160" width="740" height="440" fill="#f6ffed" stroke="#b7eb8f"/>
  <text x="610" y="360" font-size="16" fill="#52c41a" text-anchor="middle">提交成功</text>
  <text x="610" y="390" font-size="13" fill="#999" text-anchor="middle">标注已提交至质检队列</text>
</g>
```

### 2.6 disabled（禁用态）

**定义**：交互元素因条件未满足而不可操作。

**视觉要求**：
- 禁用元素用灰色（背景 `#f5f5f5`，文字 `#bbb`）
- 保留元素位置，不隐藏
- 可选：鼠标悬停提示禁用原因

**适用页面**：有条件触发操作的页面。

**触发场景**（从旅程提取）：
- 未选择任何标注时 → "创建标注"按钮可用，"删除"按钮禁用
- 表单必填项未完成时 → "提交"按钮禁用
- 无权限时 → 操作按钮禁用

```svg
<!-- 禁用态按钮 -->
<g data-action="submit-annotation" data-ux="disabled">
  <rect x="900" y="520" width="280" height="36" rx="4" fill="#f5f5f5"/>
  <text x="1040" y="544" font-size="14" fill="#bbb" text-anchor="middle">提交质检</text>
</g>
```

### 2.7 pending（等待态）

**定义**：操作已发起，等待外部结果（审批、异步处理等）。

**视觉要求**：
- 显示等待指示（黄色 `#faad14` 或蓝色 `#1890ff`）
- 显示当前状态描述
- 如果可预估等待时间，提供进度指示

**适用页面**：涉及审批/等待的页面。

**触发场景**（从旅程提取）：
- 提交质检后等待结果 → 任务状态显示"质检中"
- 审批流程中等待上级 → 显示"等待审批"

```svg
<g id="page-task-list-pending" data-page="TaskList" data-state="pending" visibility="hidden">
  <rect x="240" y="160" width="740" height="440" fill="#fffbe6" stroke="#ffe58f"/>
  <text x="610" y="360" font-size="16" fill="#faad14" text-anchor="middle">质检中</text>
  <text x="610" y="390" font-size="13" fill="#999" text-anchor="middle">您的标注正在等待质检审核</text>
</g>
```

## 3. 状态从旅程提取

每个页面的状态变体来自旅程中"用户看到的场景"描述：

```text
旅程 J-01（采集员，主线）:
  场景 1: 采集地图页（显示地图和新建采集按钮）        → normal
  场景 2: 采集详情页（显示任务状态为 DRAFT）           → normal (初始态)
  场景 3: 采集详情页（加载中...）                      → loading
  场景 4: 采集地图页（暂无采集任务）                    → empty

旅程 J-04（标注员，主线）:
  场景 1: 任务列表页（显示待处理任务）                  → normal
  场景 2: 任务列表页（暂无任务）                        → empty
  场景 3: 标注编辑器（提交成功）                        → success
  场景 4: 标注编辑器（提交失败）                        → error
```

**提取规则**：
- 从旅程的"用户看到的场景"列直接映射 `data-state` 值
- 显式提到"加载中"的场景 → `loading`
- 显式提到"暂无"或"没有"的场景 → `empty`
- 显式提到"失败"或"错误"的场景 → `error`
- 显式提到"成功"或"完成"的场景 → `success`
- 显式提到"等待"或"审批中"的场景 → `pending`
- 显式提到"不可点击"或"未满足条件"的场景 → `disabled`
- 默认场景 → `normal`

## 4. 状态变体检查清单

对每个页面，检查以下状态是否已绘制：

```text
基础 4 态（所有页面必须有）：
  [ ] normal   — 完整数据展示 + 所有交互元素
  [ ] loading  — 加载指示 + 具体化文案
  [ ] empty    — 空态原因 + 行动引导
  [ ] error    — 错误信息（给人看）+ 重试操作

扩展态（条件必须）：
  [ ] success  — 涉及提交/保存/审核的页面
  [ ] disabled — 有条件触发操作的页面
  [ ] pending  — 涉及审批/等待的页面

通用检查：
  [ ] 非 normal 状态都有 visibility="hidden"
  [ ] 所有状态保留页面骨架（header/sidebar/footer）
  [ ] 状态变体不是"为了凑 4 个而编造"，都来自真实旅程场景
  [ ] 错误态文案不含技术术语
  [ ] 空态有明确的行动引导
```

## 5. 状态变体示例汇总

### 数据列表页（如 task-list）

```svg
<!-- normal -->
<g id="page-task-list-normal" data-page="TaskList" data-state="normal">
  <rect x="240" y="160" width="740" height="440" fill="#fff" stroke="#eee"/>
  <rect x="240" y="160" width="740" height="40" fill="#fafafa" stroke="#eee"/>
  <text x="260" y="185" font-size="13" fill="#666" font-weight="bold">任务名称</text>
  <text x="480" y="185" font-size="13" fill="#666" font-weight="bold">类型</text>
  <text x="600" y="185" font-size="13" fill="#666" font-weight="bold">状态</text>
  <text x="780" y="185" font-size="13" fill="#666" font-weight="bold">操作</text>
  <rect x="240" y="200" width="740" height="45" fill="#fff" stroke="#f0f0f0"/>
  <text x="260" y="226" font-size="14" fill="#333">文本标注 - 正面情绪</text>
  <text x="480" y="226" font-size="13" fill="#666">文本</text>
  <text x="600" y="226" font-size="13" fill="#faad14">待处理</text>
  <rect x="740" y="207" width="70" height="30" rx="4" fill="#1890ff"/>
  <text x="775" y="227" font-size="13" fill="#fff" text-anchor="middle">开始标注</text>
</g>

<!-- loading -->
<g id="page-task-list-loading" data-page="TaskList" data-state="loading" visibility="hidden">
  <rect x="240" y="160" width="740" height="440" fill="#fff" stroke="#eee"/>
  <text x="610" y="380" font-size="16" fill="#999" text-anchor="middle">加载中...</text>
</g>

<!-- empty -->
<g id="page-task-list-empty" data-page="TaskList" data-state="empty" visibility="hidden">
  <rect x="240" y="160" width="740" height="440" fill="#fafafa" stroke="#eee"/>
  <text x="610" y="360" font-size="16" fill="#ccc" text-anchor="middle">暂无待处理任务</text>
  <text x="610" y="390" font-size="13" fill="#999" text-anchor="middle">完成标注后，任务会自动出现在这里</text>
</g>

<!-- error -->
<g id="page-task-list-error" data-page="TaskList" data-state="error" visibility="hidden">
  <rect x="240" y="160" width="740" height="440" fill="#fff2f0" stroke="#ffccc7"/>
  <text x="610" y="360" font-size="16" fill="#ff4d4f" text-anchor="middle">加载失败</text>
  <rect x="570" y="380" width="80" height="30" rx="4" fill="#ff4d4f"/>
  <text x="610" y="400" font-size="13" fill="#fff" text-anchor="middle">重试</text>
</g>
```

### 编辑器页（如 annotator）

```svg
<!-- success（提交成功） -->
<g id="page-annotator-success" data-page="Annotator" data-state="success" visibility="hidden">
  <rect x="240" y="160" width="740" height="440" fill="#f6ffed" stroke="#b7eb8f"/>
  <text x="610" y="360" font-size="16" fill="#52c41a" text-anchor="middle">提交成功</text>
  <text x="610" y="390" font-size="13" fill="#999" text-anchor="middle">标注已提交至质检队列</text>
</g>

<!-- empty（无标注） -->
<g id="page-annotator-empty" data-page="Annotator" data-state="empty" visibility="hidden">
  <text x="450" y="320" font-size="16" fill="#999" text-anchor="middle">暂无标注</text>
  <text x="450" y="350" font-size="14" fill="#1890ff" text-anchor="middle">点击"+ 创建标注"开始标注</text>
</g>

<!-- loading（加载帧数据） -->
<g id="page-annotator-loading" data-page="Annotator" data-state="loading" visibility="hidden">
  <text x="450" y="320" font-size="14" fill="#999" text-anchor="middle">加载帧数据...</text>
</g>
```
