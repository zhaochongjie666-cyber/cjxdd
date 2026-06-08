# OpenCode 插件开发指南

本指南介绍如何创建 OpenCode 插件来扩展其功能。

## 插件概述

OpenCode 插件允许你通过挂钩各种事件和自定义行为来扩展 OpenCode。你可以创建插件来：

- 添加新功能
- 集成外部服务
- 修改 OpenCode 的默认行为

插件分为两种类型：

1. **Server 插件** - 后端功能扩展，如自定义工具、认证、AI 提供商等
2. **TUI 插件** - 终端用户界面扩展，如自定义 UI 组件、路由、主题等

## 使用插件

### 从本地文件加载

将 JavaScript 或 TypeScript 文件放置在插件目录中：

- `.opencode/plugins/` - 项目级插件
- `~/.config/opencode/plugins/` - 全局插件

这些目录中的文件会在启动时自动加载。

### 从 npm 加载

在配置文件中指定 npm 包：

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-helicone-session", "opencode-wakatime", "@my-org/custom-plugin"]
}
```

### 插件加载顺序

插件从以下顺序加载：

1. 全局配置 (`~/.config/opencode/opencode.json`)
2. 项目配置 (`opencode.json`)
3. 全局插件目录 (`~/.config/opencode/plugins/`)
4. 项目插件目录 (`.opencode/plugins/`)

## 创建 Server 插件

### 基本结构

```ts title=".opencode/plugins/example.ts"
import type { Plugin } from "@opencode-ai/plugin"

export const MyPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  console.log("Plugin initialized!")

  return {
    // Hook implementations go here
  }
}

// 或作为默认导出对象的一部分
export default {
  server: MyPlugin,
  id: "my-plugin"  // 可选，用于文件插件
}
```

### 插件输入参数

| 参数 | 说明 |
|------|------|
| `project` | 当前项目信息 |
| `directory` | 当前工作目录 |
| `worktree` | git 工作树路径 |
| `client` | 用于与 AI 交互的 OpenCode SDK 客户端 |
| `$` | Bun 的 Shell API，用于执行命令 |
| `experimental_workspace` | 工作空间适配器注册 |
| `serverUrl` | 服务器 URL |

### 可用的 Hooks

#### 工具相关

- `tool` - 添加自定义工具
- `tool.execute.before` - 工具执行前
- `tool.execute.after` - 工具执行后
- `tool.definition` - 修改工具定义

#### 会话相关

- `chat.message` - 收到新消息时
- `chat.params` - 修改 LLM 参数
- `chat.headers` - 修改请求头
- `experimental.session.compacting` - 会话压缩前
- `experimental.compaction.autocontinue` - 压缩后
- `experimental.text.complete` - 文本完成时

#### 权限相关

- `permission.ask` - 权限询问时

#### Shell 相关

- `shell.env` - 注入环境变量

#### 事件相关

- `event` - 订阅各种事件（会话创建、更新、删除等）

#### 认证相关

- `auth` - 自定义认证提供程序

#### 提供商相关

- `provider` - 自定义 AI 模型提供商

#### 配置相关

- `config` - 配置更新时

## 创建 TUI 插件

TUI 插件用于扩展终端用户界面。

### 基本结构

```tsx title=".opencode/plugins/my-tui.tsx"
/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"

const tui: TuiPlugin = async (api, options, meta) => {
  // TUI plugin implementation
}

const plugin: TuiPluginModule = {
  id: "my-org.my-tui",
  tui,
}

export default plugin
```

### TUI API

TUI 插件 API 包含以下功能：

| API | 说明 |
|-----|------|
| `api.app` | 应用信息 |
| `api.command` | 命令注册 |
| `api.route` | 路由注册 |
| `api.ui` | UI 组件和对话框 |
| `api.keybind` | 键盘绑定 |
| `api.theme` | 主题管理 |
| `api.state` | 状态访问 |
| `api.client` | SDK 客户端 |
| `api.slots` | Slot 注册 |
| `api.plugins` | 插件控制 |

## 插件示例

### 1. 基本 Server 插件

```ts title=".opencode/plugins/example.ts"
export const MyPlugin = async ({ project, client, $, directory, worktree }) => {
  console.log("Plugin initialized!")

  return {
    "shell.env": async (input, output) => {
      output.env.MY_API_KEY = "secret"
    },
  }
}
```

### 2. 通知插件

```js title=".opencode/plugins/notification.js"
export const NotificationPlugin = async ({ project, client, $, directory, worktree }) => {
  return {
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        await $`osascript -e 'display notification "Session completed!" with title "opencode"'`
      }
    },
  }
}
```

### 3. .env 保护插件

```js title=".opencode/plugins/env-protection.js"
export const EnvProtection = async ({ project, client, $, directory, worktree }) => {
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool === "read" && output.args.filePath.includes(".env")) {
        throw new Error("Do not read .env files")
      }
    },
  }
}
```

### 4. 自定义工具插件

```ts title=".opencode/plugins/custom-tools.ts"
import { type Plugin, tool } from "@opencode-ai/plugin"

export const CustomToolsPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      mytool: tool({
        description: "This is a custom tool",
        args: {
          foo: tool.schema.string(),
        },
        async execute(args, context) {
          const { directory, worktree } = context
          return `Hello ${args.foo} from ${directory} (worktree: ${worktree})`
        },
      }),
    },
  }
}
```

### 5. 注入环境变量插件

```javascript title=".opencode/plugins/inject-env.js"
export const InjectEnvPlugin = async () => {
  return {
    "shell.env": async (input, output) => {
      output.env.MY_API_KEY = "secret"
      output.env.PROJECT_ROOT = input.cwd
    },
  }
}
```

### 6. 会话压缩钩子

```ts title=".opencode/plugins/compaction.ts"
import type { Plugin } from "@opencode-ai/plugin"

export const CompactionPlugin: Plugin = async (ctx) => {
  return {
    "experimental.session.compacting": async (input, output) => {
      // Inject additional context into the compaction prompt
      output.context.push(`
## Custom Context

Include any state that should persist across compaction:
- Current task status
- Important decisions made
- Files being actively worked on
`)
    },
  }
}
```

## 插件配置

### Server 插件配置 (opencode.json)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-wakatime",
    ["./plugins/my-plugin.ts", { "enabled": true, "customOption": "value" }]
  ]
}
```

### TUI 插件配置 (tui.json)

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "theme": "smoke-theme",
  "plugin": ["@acme/opencode-plugin@1.2.3", ["./plugins/demo.tsx", { "label": "demo" }]],
  "plugin_enabled": {
    "acme.demo": false
  }
}
```

## 插件依赖

本地插件和自定义工具可以使用外部 npm 包。在配置目录中添加 `package.json`：

```json title=".opencode/package.json"
{
  "dependencies": {
    "shescape": "^2.1.0"
  }
}
```

OpenCode 会在启动时运行 `bun install` 来安装这些依赖项。

## 可用事件

以下是所有可用事件的列表：

### 命令事件

- `command.executed`

### 文件事件

- `file.edited`
- `file.watcher.updated`

### 安装事件

- `installation.updated`

### LSP 事件

- `lsp.client.diagnostics`
- `lsp.updated`

### 消息事件

- `message.part.removed`
- `message.part.updated`
- `message.removed`
- `message.updated`

### 权限事件

- `permission.asked`
- `permission.replied`

### 服务器事件

- `server.connected`

### 会话事件

- `session.created`
- `session.compacted`
- `session.deleted`
- `session.diff`
- `session.error`
- `session.idle`
- `session.status`
- `session.updated`

### 待办事项事件

- `todo.updated`

### Shell 事件

- `shell.env`

### 工具事件

- `tool.execute.after`
- `tool.execute.before`

### TUI 事件

- `tui.prompt.append`
- `tui.command.execute`
- `tui.toast.show`

## 参考链接

- [官方插件文档](https://opencode.ai/docs/zh-cn/plugins/)
- [插件类型定义](/home/zhaocj/ws/opencode/packages/plugin/src/index.ts)
- [TUI 插件类型定义](/home/zhaocj/ws/opencode/packages/plugin/src/tui.ts)
- [TUI 插件示例](/home/zhaocj/ws/opencode/.opencode/plugins/tui-smoke.tsx)
- [TUI 插件技术规范](/home/zhaocj/ws/opencode/packages/opencode/specs/tui-plugins.md)

## 版本兼容性

npm 插件可以在 `package.json` 中声明版本兼容性：

```json
{
  "engines": {
    "opencode": "^1.0.0"
  }
}
```
