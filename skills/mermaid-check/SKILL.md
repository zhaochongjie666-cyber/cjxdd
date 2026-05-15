---
name: mermaid-check
description: |
  Mermaid 图表渲染验证技能。使用 mermaid-cli (mmdc) 验证 .flow.mermaid 文件能否正确渲染为 SVG。
  当用户说"检查 mermaid"、"验证流程图"、"mermaid 检查"、"mmdc 验证"时触发。
  Shadow L1 的 AI-Flow 门禁（步骤 3）必须通过此技能验证。
version: 1.0.0
---

# Mermaid Check — 流程图渲染验证

## 用途

验证 `.shadow/L1-business/` 下的所有 `*.flow.mermaid` 文件能否通过 mermaid-cli (mmdc) 正确渲染为 SVG 图片。

## 前置条件

- 需要自行安装 Mermaid CLI（mmdc）客户端：`npm install -g @mermaid-js/mermaid-cli`
- 安装后可直接使用 `mmdc` 命令
- 或通过环境变量指定：`MMDC=/path/to/mmdc`

## 执行

加载此技能后，运行以下命令：

```bash
scripts/mmdc_check.sh [.shadow路径]
```

默认读取 `.shadow/` 目录。可通过第一个参数或 `SHADOW_DIR` 环境变量指定其他路径。

## 输出

```
=== Mermaid Render Validation (mmdc) ===

Checking 2 flow.mermaid files...

  PASS mmdc: 'user-registration' renders OK
  FAIL mmdc: 'payment-system' has parse errors

=== Result: PASS=1 FAIL=1 ===
```

## 失败处理

- `mmdc not found` → 安装 mermaid-cli：`npm install -g @mermaid-js/mermaid-cli`
- `FAIL` → flow.mermaid 语法有错误，检查括号匹配、节点定义、箭头语法

## 在 Shadow L1 中的位置

L1 执行步骤 3（AI-Flow 门禁）必须运行此脚本验证流程图可渲染。

## 参考

- [Mermaid 官方文档](https://mermaid.js.org/)
- [mermaid-cli GitHub](https://github.com/mermaid-js/mermaid-cli)
