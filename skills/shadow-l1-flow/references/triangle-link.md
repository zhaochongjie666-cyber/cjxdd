# 三角链接（L1 内部）

## 1.1 三角链接规则

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
| **spec → wire** | spec 中 `需 Wire 承接=是` 的规则，wire 中有 `data-node="BXX-NYY"` 元素，且承接位置与 `UI 载体/方位` 一致 | spec R04 "提交注册" → wire `<WireButton data-node="B01-N03">` |
| **wire → flow** | wire 每个 `data-node` 元素，flow 中有对应 BXX-NYY 节点 | wire `data-node="B01-N03.01"` → flow 有 `N03_01["校验邮箱格式"]` |

## 1.2 坐标格式映射

| 场景 | 格式 | 示例 | 说明 |
|------|------|------|------|
| **Mermaid 节点 ID**（flow 内） | `NYY_ZZ`（下划线） | `N03_01` | Mermaid ID 不支持点号 |
| **坐标引用**（spec/wire/代码） | `BXX-NYY.ZZ`（点号） | `B01-N03.01` | 全局唯一坐标 |
| **映射规则** | Mermaid `NYY_ZZ` ↔ 坐标 `NYY.ZZ` | `N03_01` ↔ `B01-N03.01` | `_` 替换为 `.` |

> **铁律**：project.flow.mermaid 中用下划线（Mermaid 语法限制），其他所有文件用点号。任何读取 flow 生成其他文件时，必须将 `_` 替换为 `.`。

## 1.3 三角链接自检流程

```
1. 提取 project.flow.mermaid 中所有节点坐标（NYY / NYY_ZZ → 转换为 BXX-NYY / BXX-NYY.ZZ）
2. 提取 spec.md 规则表中"节点坐标"列的所有值
3. 提取 spec.md 规则表中 `需 Wire 承接=是` 的节点集合
4. 提取 `wire.svg` 中所有 `data-node` 属性值
4. 校验：
   - flow 节点集合 ⊆ spec 节点坐标集合（flow 的每个节点在 spec 有规则引用）
   - spec 中 `需 Wire 承接=是` 的规则节点 ⊆ wire data-node 集合
   - wire data-node 集合 ⊆ flow 节点集合
   - 任一不等 → 三角链接断裂 → L1 Gate FAIL
```
