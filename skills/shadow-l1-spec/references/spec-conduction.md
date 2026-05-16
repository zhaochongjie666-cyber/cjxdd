# Spec 传导规则 — 规则如何映射到 BXX-NYY 节点并向下传导

## 1. Spec 与 Flow 的映射

### 1.1 flow → spec 映射规则

flow 每个非触发源/非交付物节点，spec 中必须有 ≥1 条规则以 `BXX-NYY` 格式引用。

示例：
- flow 有 `N03[提交注册]` → spec 规则 R04 标注 `B01-N03`
- flow 有 `N05_01[校验码]` → spec 规则标注 `B01-N05.01`

### 1.2 坐标格式

| 场景 | 格式 | 示例 |
|------|------|------|
| Mermaid 节点 ID（flow 内） | `NYY_ZZ`（下划线） | `N03_01` |
| 坐标引用（spec/wire/代码） | `BXX-NYY.ZZ`（点号） | `B01-N03.01` |
| 映射规则 | `_` ↔ `.` | `N03_01` ↔ `B01-N03.01` |

### 1.3 spec → wire 映射规则

spec 每条涉及 UI 的规则，wire 中必须有 `data-node="BXX-NYY"` 元素。

示例：
- spec R04 "提交注册" → wire `<span class="btn" data-node="B01-N03">`

## 2. Spec 向下游传导

### 2.1 Spec → L3（骨架消费）

| L1 产出 | L3 消费方式 | 强制度 |
|---------|------------|--------|
| spec 规则 (`slug-R01`) | `@implements: slug-R01 (BXX-NYY)` | **强制** |
| spec 状态变化 (`S01→S02`) | `@transitions: slug-S01 → slug-S02` | 强制 |
| spec 前置条件/数据约束 | `Invariants:` 声明 | 强制 |
| spec 异常/错误码 | `Raises:` 声明 | 强制 |
| spec 角色/权限 | 权限注释/约束声明 | 强制 |
| spec 外部依赖 | `Dependencies:` 声明 | 强制 |

### 2.2 Spec → L4（测试消费）

| L1 产出 | L4 消费方式 | 强制度 |
|---------|------------|--------|
| spec 规则（通过 L3 @implements） | `@covers: slug-R01 (BXX-NYY)` | **强制** |
| spec 异常路径 | 异常测试函数（含 assert） | 强制 |
| spec 状态变化（通过 L3） | 状态转换测试 | 强制 |
| spec 角色/权限 | 权限/越权测试 | 强制 |

### 2.3 Spec → L5（实现消费）

| L1 产出 | L5 消费方式 | 强制度 |
|---------|------------|--------|
| spec 规则 | 真实实现逻辑 + `@implements: slug-R01 (BXX-NYY)` | **强制** |
| spec 错误码/文案 | 可测试的返回值/异常/提示 | 强制 |
| spec 状态变化 | 可观察的状态机落地 | 强制 |
| spec 角色/权限 | 鉴权/授权逻辑 | 强制 |
| spec 外部依赖 | 调用路径、降级、重试/超时 | 强制 |
| spec 副作用 | 通知、审计、日志、事件、指标 | 强制 |

## 3. 传导断裂检测

| 断裂类型 | 检测方法 | 严重度 |
|---------|---------|--------|
| flow 节点无 spec 规则引用 | flow 节点集合 - spec 节点坐标集合 ≠ ∅ | 致命 |
| spec 规则无 L3 @implements | spec 规则 ID 全集 - L3 @implements 全集 ≠ ∅ | 高 |
| L3 @implements 无 L4 @covers | L3 @implements 全集 - L4 @covers 全集 ≠ ∅ | 高 |
| @implements 节点坐标无效 | BXX-NYY 不在 flow 节点集合中 | 高 |
| 跨线引用单向声明 | A→B 声明存在但 B 的 spec 无反向声明 | 中 |
| 子节点编号不连续 | N03 有 .01, .02, .04 但缺 .03 | 低 |
