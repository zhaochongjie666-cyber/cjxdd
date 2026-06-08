---
name: xdd-mermaid-check
description: |
  Mermaid 图表渲染验证 — 用 mermaid-cli (mmdc) 验证 project.flow.mermaid 能否正确渲染为 SVG.
  Shadow L1 AI-Flow 门禁 (步骤 3) 必通过此技能. 适用任何 Mermaid 语法验证场景.
  触发: 检查 mermaid、验证流程图、mermaid 检查、mmdc 验证、mermaid 渲染检查、flow 渲染验证.
version: "1.1.0"
---

# Mermaid Check — 流程图渲染验证

## 角色职责

纯工具 skill，验证 `.shadow/L1-business/project.flow.mermaid` 能否通过 mermaid-cli (mmdc) 正确渲染为 SVG 图片。

不做业务设计、不修改任何文件，只输出 PASS/FAIL 验证结果。

## 前置条件

- 安装 mermaid-cli：`npm install -g @mermaid-js/mermaid-cli`
- 或通过环境变量指定：`MMDC=/path/to/mmdc`

## 执行步骤

### 首次执行

1. **扫描文件** → 查找 `.shadow/L1-business/project.flow.mermaid`
2. **验证总图** → 调用 `mmdc -i <file> -o /tmp/_mmdc_XXXXXX.svg`
3. **汇总结果** → 输出 PASS/FAIL 统计

### 修改模式

**触发条件**：project.flow.mermaid 文件已更新，需要重新验证

**操作步骤**：
1. 运行验证脚本
2. 如有 FAIL，定位语法错误（括号匹配、节点定义、箭头语法）
3. 修正后重新验证

## 运行命令

### 直接执行

```bash
bash skills/mermaid-check/scripts/mmdc_check.sh [.shadow路径]
```

默认读取 `.shadow/` 目录。可通过第一个参数或 `SHADOW_DIR` 环境变量指定其他路径。

### Subagent 调用方式

```bash
# 检查当前目录下的 Shadow 项目
bash skills/mermaid-check/scripts/mmdc_check.sh

# 检查指定路径
bash skills/mermaid-check/scripts/mmdc_check.sh /path/to/project/.shadow

# 通过环境变量指定
export SHADOW_DIR=/path/to/project/.shadow
bash skills/mermaid-check/scripts/mmdc_check.sh
```

## 输出格式

```
=== Mermaid Render Validation (mmdc) ===

Checking project-level project.flow.mermaid...

  PASS mmdc: 'project.flow.mermaid' renders OK

=== Result: PASS=1 FAIL=0 ===
```

退出码：0 = 全部通过，1 = 有失败。

## 失败处理

| 错误 | 原因 | 解决 |
|------|------|------|
| `mmdc not found` | 未安装 mermaid-cli | `npm install -g @mermaid-js/mermaid-cli` |
| `FAIL` | project.flow.mermaid 语法错误 | 检查括号匹配、节点定义、箭头语法 |
| 文件不存在 | 路径不正确 | 确认 `.shadow/L1-business/` 路径 |

## 关键约束

- 纯工具 skill，不做业务设计
- 不修改任何文件
- 由 Shadow L1 AI-Flow 门禁（步骤 3）自动调用
- 可独立使用

## 与相关技能的关系

| 技能 | 边界说明 |
|------|----------|
| shadow-l1-flow | mermaid-check 是 flow 的验证工具，不做流程设计 |
| shadow-reviewer | reviewer 做质量审查，mermaid-check 只做语法验证 |

## 参考文档

- [Mermaid 官方文档](https://mermaid.js.org/)
- [mermaid-cli GitHub](https://github.com/mermaid-js/mermaid-cli)
