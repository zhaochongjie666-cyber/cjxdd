---
name: xdd-mermaid-check
description: |
  Mermaid 图表渲染验证 — 用 mermaid-cli (mmdc) 验证 .xdd/design/architecture/{bxx-slug}/flow.mermaid 能否正确渲染为 SVG。
  xdd-architecture 的结构锚配套验证工具（流程图画完必跑）。适用任何 Mermaid 语法验证场景。
  触发：检查 mermaid、验证流程图、mermaid 检查、mmdc 验证、mermaid 渲染检查、flow 渲染验证。
version: "1.2.0"
---

# Mermaid Check — 流程图渲染验证

## 角色职责

纯工具 skill，验证 `.xdd/design/architecture/{bxx-slug}/flow.mermaid` 能否通过 mermaid-cli (mmdc) 正确渲染为 SVG 图片。

不做业务设计、不修改任何文件，只输出 PASS/FAIL 验证结果。

## 前置条件

- 安装 mermaid-cli：`npm install -g @mermaid-js/mermaid-cli`
- 或通过环境变量指定：`MMDC=/path/to/mmdc`

## 怎么做

### 首次执行

1. **扫描文件** → 查找 `.xdd/design/architecture/*/flow.mermaid`（每个业务线 slug 一个）
2. **逐个验证** → 调用 `mmdc -i <file> -o /tmp/_mmdc_XXXXXX.svg`
3. **汇总结果** → 输出 PASS/FAIL 统计

### 修改模式

**触发条件**：某个 flow.mermaid 文件已更新，需要重新验证

**操作步骤**：
1. 运行验证脚本
2. 如有 FAIL，定位语法错误（括号匹配、节点定义、箭头语法）
3. 修正后重新验证

## 运行命令

### 直接执行

```bash
bash skills/xdd-mermaid-check/scripts/mmdc_check.sh [.xdd 路径]
```

默认从 `.xdd/design/architecture/` 扫描所有 `{bxx-slug}/flow.mermaid`。可通过第一个参数或 `XDD_DIR` 环境变量指定其他 `.xdd` 路径。

### 指定路径

```bash
# 检查当前目录的 .xdd
bash skills/xdd-mermaid-check/scripts/mmdc_check.sh

# 检查指定项目
bash skills/xdd-mermaid-check/scripts/mmdc_check.sh /path/to/project/.xdd

# 通过环境变量指定
export XDD_DIR=/path/to/project/.xdd
bash skills/xdd-mermaid-check/scripts/mmdc_check.sh
```

## 输出格式

```
=== Mermaid Render Validation (mmdc) ===

Checking flow.mermaid files under .xdd/design/architecture/...

  PASS mmdc: 'B01-auth/flow.mermaid' renders OK
  PASS mmdc: 'B02-order/flow.mermaid' renders OK

=== Result: PASS=2 FAIL=0 ===
```

退出码：0 = 全部通过，1 = 有失败。

## 失败处理

| 错误 | 原因 | 解决 |
|------|------|------|
| `mmdc not found` | 未安装 mermaid-cli | `npm install -g @mermaid-js/mermaid-cli` |
| `FAIL` | flow.mermaid 语法错误 | 检查括号匹配、节点定义、箭头语法 |
| 文件不存在 | 路径不正确 | 确认 `.xdd/design/architecture/{bxx-slug}/flow.mermaid` 路径 |

## 关键约束

- 纯工具 skill，不做业务设计
- 不修改任何文件
- xdd-architecture 画完 flow.mermaid 后建议跑此验证
- 可独立使用

## 与相关技能的关系

| 技能 | 边界说明 |
|------|----------|
| xdd-architecture | 产出 `flow.mermaid`；mermaid-check 是它的渲染验证工具，不做流程设计 |
| xdd-verify | 4 维一致性审计可调用本工具确认图表可渲染 |

## 参考文档

- [Mermaid 官方文档](https://mermaid.js.org/)
- [mermaid-cli GitHub](https://github.com/mermaid-js/mermaid-cli)
