---
name: opencode-learning
description: |
  OpenCode 源码学习技能。当用户想了解 OpenCode 的架构、模块实现、API 设计、配置机制、工作流程或任何源码相关问题时，使用此技能遍历代码仓库并解答。
  适用于：理解项目架构、查找核心模块、学习特定功能的实现原理、阅读源码、了解构建系统、贡献代码等场景。
  当用户说"学习 opencode"、"了解 opencode"、"opencode 源码"、"opencode 架构"、"opencode 怎么实现的"时触发此技能。
---

# OpenCode 源码学习技能

探索和学习 OpenCode 源码库，解答关于架构、实现原理、模块设计等问题。

## 仓库路径

默认路径: `~/ws/opencode`

**前置检查**: 使用前先确认仓库是否存在，若不存在则自动克隆：

```bash
if [ ! -d ~/ws/opencode ]; then
  git clone https://github.com/anomalyco/opencode ~/ws/opencode
fi
```

## 官方文档

- 文档地址: https://opencode.ai/docs/zh-cn/tools/

回答用户问题时，可结合官方文档辅助说明。

## 代码库结构

| 目录/文件 | 说明 |
|-----------|------|
| `packages/` | 核心包目录（主要业务逻辑） |
| `sdks/` | SDK 相关代码 |
| `specs/` | 规范/规格文档 |
| `.opencode/` | OpenCode 自身配置 |
| `AGENTS.md` | Agent 相关文档 |
| `CONTRIBUTING.md` | 贡献指南 |

## 使用方式

1. 先读取 `~/ws/opencode/AGENTS.md` 了解项目整体架构和约定
2. 根据用户问题，使用 Glob、Grep、Read 等工具在仓库中搜索和阅读相关代码
3. 总结实现原理，输出 Markdown 文档给用户

## 参考文档

- **[插件开发指南](./PLUGINS.md)** - 如何创建 OpenCode 插件，包括 Server 插件和 TUI 插件的详细说明

## 示例问题

- "Open Code 的架构是怎样的？"
- "如何贡献代码？"
- "核心模块在哪里？"
- "这个项目的构建系统是什么？"
- "Session 管理是怎么实现的？"
- "消息处理流程是怎样的？"

> 本技能为通用工具，与 Shadow 项目兼容（不干扰 .shadow/ 工作区，不生成需要溯源的业务产物）。
