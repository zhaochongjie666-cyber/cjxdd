# L1 传导地图 — BXX-NYY 坐标系全链路传导指令

> **DEPRECATED**: 本文档描述的 L3（L1→骨架）/L4（独立测试层）已被 Harness 计划替代。
> L1→实现的唯一传导机制是 `shadow-l5-plan` 的 Harness 计划。
> 保留本文档仅作历史参考，不应用于新项目指导。

> **核心思想**：L1 的三份核心产出（project.flow.mermaid / spec.md / wire 线框）通过 BXX-NYY 坐标系三角链接，然后向下游 L5 Harness 逐文件传达。每层必须显式消费并转译 L1 的内容，而不是"大致理解后自由发挥"。

## 1. 三角链接（L1 内部）

### 1.1 三角链接规则

```
                    project.flow.mermaid
                   /             \
          flow→spec               wire→flow
                 /                   \
            spec.md ──spec→wire── wire.svg
```

| 链路 | 规则 | 示例 |
|------|------|------|
| **flow → spec** | flow 每个非触发源/非交付物节点，spec 中有 ≥1 条规则以 `BXX-NYY` 格式引用 | flow 有 `N03[提交注册]` → spec 规则 R04 标注 `B01-N03` |
| **spec → wire** | spec 中 `需 Wire 承接=是` 的规则，wire 中有 `data-node/data-rule/data-action/data-target` 元素，且与 `UI 载体/方位` 对齐 | spec R04 "提交注册" → wire `<g id="action-submit-registration" data-node="B01-N03" data-rule="R04" data-action="submit-registration" data-target="api.POST./api/register">` |
| **wire → flow** | wire 每个 `data-node` 元素，flow 中有对应 BXX-NYY 节点 | wire `data-node="B01-N03.01"` → flow 有 `N03_01["校验邮箱格式"]` |

### 1.2 坐标格式映射

| 场景 | 格式 | 示例 | 说明 |
|------|------|------|------|
| **Mermaid 节点 ID**（flow 内） | `NYY_ZZ`（下划线） | `N03_01` | Mermaid ID 不支持点号 |
| **坐标引用**（spec/wire/代码） | `BXX-NYY.ZZ`（点号） | `B01-N03.01` | 全局唯一坐标 |
| **映射规则** | Mermaid `NYY_ZZ` ↔ 坐标 `NYY.ZZ` | `N03_01` ↔ `B01-N03.01` | `_` 替换为 `.` |

> **铁律**：project.flow.mermaid 中用下划线（Mermaid 语法限制），其他所有文件用点号。任何读取 flow 生成其他文件时，必须将 `_` 替换为 `.`。

### 1.3 三角链接自检流程

```
1. 提取 project.flow.mermaid 中所有节点坐标（NYY / NYY_ZZ → 转换为 BXX-NYY / BXX-NYY.ZZ）
2. 提取 spec.md 规则表中"节点坐标"列的所有值
3. 提取 spec.md 规则表中 `需 Wire 承接=是` 的节点集合
4. 提取 `wire.svg` 中所有 `data-node/data-rule/data-action/data-target/data-state` 属性值
4. 校验：
   - flow 节点集合 ⊆ spec 节点坐标集合（flow 的每个节点在 spec 有规则引用）
   - spec 中 `需 Wire 承接=是` 的规则节点 ⊆ wire data-node 集合，且对应元素具备 data-rule/data-action/data-target
   - wire data-node 集合 ⊆ flow 节点集合
   - wire data-action/data-state 能向 L3/L4/L5 传导
   - 任一不等 → 三角链接断裂 → L1 Gate FAIL
```

## 2. L1 → L3 传导（骨架消费）

### 2.1 传导矩阵

| L1 产出 | L5 Plan 消费方式 | Harness 落点 | 强制度 |
|---------|------------|-----------|--------|
| spec 规则 (`slug-R01`) | `@implements: slug-R01 (BXX-NYY)` | 方法/接口声明 | **强制**：每个 @implements 必须带节点坐标 |
| spec 状态变化 (`S01→S02`) | `@transitions: slug-S01 → slug-S02` | 方法标注 | 强制 |
| spec 前置条件/数据约束 | `Invariants:` 声明 | 类/方法声明 | 强制 |
| spec 异常/错误码 | `Raises:` 声明 | 方法声明 | 强制 |
| spec 角色/权限 | 权限注释/约束声明 | 接口声明 | 强制 |
| spec 外部依赖 | `Dependencies:` 声明 | 类声明 | 强制 |
| wire 页面视图 | 前端页面组件骨架 | 前端 Harness 指令 | 强制 |
| wire 按钮/事件组件 + data-node/data-action/data-target | 事件处理器声明 + API/路由/store action | 接口声明 | 强制 |
| wire `data-state` + 状态文案 | 状态类型声明 + 渲染分支 | 类型定义 | 强制 |
| wire 输入组件 + placeholder | 表单字段类型 | 类型定义 | 强制 |
| wire 表格组件 + 列定义 | 列表接口声明 | 接口声明 | 强制 |
| wire 错误区域 + 文案 | 错误类型声明 | Raises 声明 | 强制 |
| flow 节点流程 | 方法调用顺序（注释级） | 方法注释 | 推荐 |

### 2.2 L3 传导校验

```
对每个文件：
  1. 提取所有 @implements 规则 ID → 与 L1 spec 规则全集对比 → 差集为空
  2. 提取所有 @implements 中的 (BXX-NYY) 节点坐标 → 与 flow 节点全集对比 → 差集为空
  3. 提取所有 @transitions → 与 spec 状态变化对比 → 每个状态变化有落点
  4. 提取所有 Raises → 与 spec 异常处理表对比 → 每个错误码有落点
  5. 提取 wire 相关骨架 → 与 wire 产物元素对比 → 每个交互元素有骨架
```

## 3. L1 → L4 传导（测试消费）

### 3.1 传导矩阵

| L1 产出 | L4 消费方式 | 测试代码落点 | 强制度 |
|---------|------------|-----------|--------|
| spec 规则（通过 L3 @implements） | `@covers: slug-R01 (BXX-NYY)` | 测试函数 | **强制**：每个 @covers 必须带节点坐标 |
| spec 异常路径 | 异常测试函数（含 assert） | 异常测试 | 强制 |
| spec 状态变化（通过 L3） | 状态转换测试 | 状态测试 | 强制 |
| spec 角色/权限 | 权限/越权测试 | 权限测试 | 强制 |
| wire 输入组件 + placeholder | 输入校验测试（正常/边界/异常） | 边界测试 | 强制 |
| wire `WireBadge` + 状态文案 | 状态转换测试 | 状态测试 | 强制 |
| wire 按钮/事件组件 + data-node | 操作测试（点击/提交/取消） | 操作测试 | 强制 |
| wire 错误区域 + 文案 | 错误处理测试（每个错误码） | 异常测试 | 强制 |
| wire 表格组件 + 列定义 | 列表渲染测试（空/有数据/排序） | 边界测试 | 强制 |
| wire 空状态占位 | 空数据边界测试 | 边界测试 | 强制 |
| flow 异常分支 | 边界/异常测试 | 异常测试 | 强制 |

### 3.2 L4 传导校验

```
对每个测试文件：
  1. 提取所有 @covers 规则 ID → 与 L3 @implements 全集对比 → 差集为空
  2. 提取所有 @covers 中的 (BXX-NYY) 节点坐标 → 与 flow 节点全集对比 → 覆盖完整
  3. 提取 wire 相关测试场景 → 与 wire 产物交互元素对比 → 每个交互元素有测试
```

## 4. L1 → L5 传导（实现消费）

### 4.1 传导矩阵

| L1 产出 | L5 消费方式 | 代码落点 | 强制度 |
|---------|------------|---------|--------|
| spec 规则 | 真实实现逻辑 + `@implements: slug-R01 (BXX-NYY)` | 函数/方法体 | **强制**：每个 @implements 必须带节点坐标 |
| spec 错误码/文案 | 可测试的返回值/异常/提示 | 异常处理代码 | 强制 |
| spec 状态变化 | 可观察的状态机落地 | 状态管理代码 | 强制 |
| spec 角色/权限 | 鉴权/授权逻辑 | 中间件/守卫代码 | 强制 |
| spec 外部依赖 | 调用路径、降级、重试/超时 | 外部调用代码 | 强制 |
| spec 副作用 | 通知、审计、日志、事件、指标 | 副作用代码 | 强制 |
| wire 页面视图 | 前端页面/路由实现 | 页面组件代码 | 强制 |
| wire 按钮/事件组件 + data-node | 事件处理实现 | onClick/submit 代码 | 强制 |
| wire `WireBadge` + 文案 | 条件渲染实现 | 状态判断 + 渲染代码 | 强制 |
| wire 输入组件 + placeholder | 表单字段实现 | 表单组件代码 | 强制 |
| wire 表格组件 + 列定义 | 列表组件实现 | 数据展示代码 | 强制 |
| wire 错误区域 + 文案 | 错误处理实现 | 错误提示组件代码 | 强制 |
| wire `.sidebar` + 可见项 | 路由守卫实现 | 权限控制代码 | 强制 |
| wire 空状态占位 | 空状态组件实现 | 空状态展示代码 | 强制 |
| flow 节点流程 | 代码结构（调用顺序、分支逻辑） | 控制流代码 | 推荐 |

### 4.2 L5 传导校验

```
对每个实现文件：
  1. 提取文件头 @implements 规则 ID → 与 L3 @implements 对比 → 一致
  2. 提取文件头 @implements 中的 (BXX-NYY) 节点坐标 → 与 flow 节点对比 → 有效
  3. 检查 L1 关键错误码 → 在代码中有对应返回值/异常
  4. 检查 L1 状态变化 → 在代码中有对应状态管理
  5. 检查 wire 交互元素 → 在前端代码中有对应实现
```

## 5. 跨层传导链路总图

```
L1 (flow + spec + wire)
│
│  BXX-NYY 坐标 + slug-RXX 规则 ID + slug-SXX 状态 ID
│  + wire data-node + wire badge + wire 交互元素
│
├──→ L1.5 (architecture + file-list + quality)
│    │   file-list 每行标注"对应 L1 规则"
│    │   quality 补充 wire 状态约定
│    │   L1.5 Checker 校验规则 ID + 节点坐标全覆盖
│    │
│    ├──→ L5 (harness-plan.md)
│    │    │   @implements: slug-R01 (BXX-NYY)  ← 强制带节点坐标
│    │    │   @transitions: S01 → S02
│    │    │   Invariants / Raises / Dependencies
│    │    │   wire → 前端骨架 / 类型声明 / 事件接口
│    │    │
│    │    └──→ L5 (实现)
│    │         │   @implements: slug-R01 (BXX-NYY)  ← 强制带节点坐标
│    │         │   真实实现逻辑
│    │         │   错误码/状态机/权限/依赖/副作用
│    │         │   wire → 前端组件/事件处理/条件渲染
│    │         │
│    │         └──→ L6 (部署)
│    │              部署报告引用 slug + 规则数
│    │
│    ├──→ L2 (e2e.md)
│    │    │   验收场景引用 BXX-NYY 节点坐标
│    │    │   wire UI 验证点
│    │    │
│    │    └──→ L4 (测试代码 — 放项目目录)
│    │         │   @covers: slug-R01 (BXX-NYY)  ← 强制带节点坐标
│    │         │   实际可运行的测试函数（含 assert）
│    │         │   wire → 输入校验/状态转换/操作/错误测试
│    │         │
│    │         └──→ L6 (部署)
│    │              测试执行报告
│    │
│    └──→ conduction.md（传导索引）
│         节点索引表：BXX-NYY → flow行号 / spec规则 / wire元素 / L3行号 / L4行号 / L5行号
│         跨线引用表：本方节点 ↔ 对方节点
│         状态索引表：状态 → 节点 → 规则 → wire badge
```

## 6. 传导断裂检测规则

| 断裂类型 | 检测方法 | 严重度 |
|---------|---------|--------|
| flow 节点无 spec 规则引用 | flow 节点集合 - spec 节点坐标集合 ≠ ∅ | 致命 |
| spec UI 规则无 wire 元素 | spec UI 规则节点集合 - wire data-node 集合 ≠ ∅ | 致命 |
| wire 元素无 flow 节点 | wire data-node 集合 - flow 节点集合 ≠ ∅ | 致命 |
| spec 规则无 L3 @implements | spec 规则 ID 全集 - L3 @implements 全集 ≠ ∅ | 高 |
| L3 @implements 无 L4 @covers | L3 @implements 全集 - L4 @covers 全集 ≠ ∅ | 高 |
| L3 @implements 节点坐标无效 | @implements 中 BXX-NYY 不在 flow 节点集合中 | 高 |
| L4 @covers 节点坐标无效 | @covers 中 BXX-NYY 不在 flow 节点集合中 | 高 |
| wire 交互元素无 Harness 指令 | wire 元素未在 harness-plan.md 中出现 | 中 |
| wire 交互元素无 L4 测试 | wire 元素未在测试代码中出现 | 中 |
| wire 交互元素无 L5 实现 | wire 元素未在实现代码中出现 | 中 |
| 跨线引用单向声明 | A→B 声明存在但 B 的 spec 无反向声明 | 中 |
| 子节点编号不连续 | N03 有 .01, .02, .04 但缺 .03 | 低 |
| conduction.md 过期 | conduction.md 行号与实际文件不匹配 | 低 |
