---
name: mermaid-check
description: |
  [Internal] Mermaid 流程图渲染验证 — 验证项目级 project.flow.mermaid 文件能否通过 mermaid-cli (mmdc) 正确渲染。
  由 Shadow L1 AI-Flow 门禁（步骤 3）自动调用。
version: "1.0.0"
---

# Mermaid Check — 流程图渲染验证

## 用途

验证 `.shadow/L1-business/project.flow.mermaid` 能否通过 mermaid-cli (mmdc) 正确渲染为 SVG 图片。

## 前置条件

- 需要自行安装 Mermaid CLI（mmdc）客户端：`npm install -g @mermaid-js/mermaid-cli`
- 安装后可直接使用 `mmdc` 命令
- 或通过环境变量指定：`MMDC=/path/to/mmdc`

## 执行

运行以下命令：

```bash
bash skills/shadow-l1-flow/scripts/mmdc-check.sh [.shadow路径]
```

默认读取 `.shadow/` 目录。可通过第一个参数或 `SHADOW_DIR` 环境变量指定其他路径。

## 输出

```
=== Mermaid Render Validation (mmdc) ===

Checking project-level project.flow.mermaid...

  PASS mmdc: 'project.flow.mermaid' renders OK

=== Result: PASS=1 FAIL=0 ===
```

## 失败处理

- `mmdc not found` → 安装 mermaid-cli：`npm install -g @mermaid-js/mermaid-cli`
- `FAIL` → project.flow.mermaid 语法有错误，检查括号匹配、节点定义、箭头语法

## 在 Shadow L1 中的位置

L1 执行步骤 3（AI-Flow 门禁）必须运行此脚本验证流程图可渲染。

## 参考

- [Mermaid 官方文档](https://mermaid.js.org/)
- [mermaid-cli GitHub](https://github.com/mermaid-js/mermaid-cli)
