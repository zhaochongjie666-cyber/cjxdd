# OpenCode Serve HTTP API 参考

`opencode serve` 命令用于启动一个 headless OpenCode 服务器，提供 HTTP API 接口用于远程控制和自动化操作。

## 启动服务器

```bash
opencode serve
```

**环境变量**:
- `OPENCODE_SERVER_PASSWORD` - 设置服务器密码认证（未设置时服务器以不安全模式运行）
- `OPENCODE_EXPERIMENTAL_HTTPAPI` - 启用实验性 HTTP API

## API 概览

服务器基于 **Hono** 框架构建，支持：
- WebSocket（用于 PTY 连接）
- SSE（Server-Sent Events）事件流
- OpenAPI/Swagger 文档（访问 `/doc`）
- CORS、认证、压缩、日志等中间件

**基础 URL**: `http://<hostname>:<port>`

---

## API 端点列表

### 1. 全局路由 `/global/*`

| 端点 | 方法 | 描述 |
|------|------|------|
| `/global/health` | GET | 获取服务器健康状态 |
| `/global/event` | GET | 订阅全局事件流（SSE） |
| `/global/config` | GET | 获取全局配置 |
| `/global/config` | PATCH | 更新全局配置 |
| `/global/dispose` | POST | 释放所有实例 |
| `/global/upgrade` | POST | 升级 opencode |

### 2. 认证路由 `/auth/*`

| 端点 | 方法 | 描述 |
|------|------|------|
| `/auth/{providerID}` | PUT | 设置认证凭据 |
| `/auth/{providerID}` | DELETE | 移除认证凭据 |

### 3. 日志路由

| 端点 | 方法 | 描述 |
|------|------|------|
| `/log` | POST | 写入日志 |

### 4. 工作区路由 `/experimental/workspace/*`

| 端点 | 方法 | 描述 |
|------|------|------|
| `/experimental/workspace/adaptor` | GET | 列出工作区适配器 |
| `/experimental/workspace` | POST | 创建工作区 |
| `/experimental/workspace` | GET | 列出所有工作区 |
| `/experimental/workspace/status` | GET | 获取工作区连接状态 |
| `/experimental/workspace/{id}` | DELETE | 删除工作区 |
| `/experimental/workspace/{id}/session-restore` | POST | 恢复会话到工作区 |

### 5. 项目路由 `/project/*`

| 端点 | 方法 | 描述 |
|------|------|------|
| `/project` | GET | 列出所有项目 |
| `/project/current` | GET | 获取当前项目 |
| `/project/git/init` | POST | 初始化 Git 仓库 |
| `/project/{projectID}` | PATCH | 更新项目 |

### 6. PTY 终端路由 `/pty/*`

| 端点 | 方法 | 描述 |
|------|------|------|
| `/pty` | GET | 列出所有 PTY 会话 |
| `/pty` | POST | 创建 PTY 会话 |
| `/pty/{ptyID}` | GET | 获取 PTY 会话详情 |
| `/pty/{ptyID}` | PUT | 更新 PTY 会话 |
| `/pty/{ptyID}` | DELETE | 移除 PTY 会话 |
| `/pty/{ptyID}/connect` | GET | 连接 PTY 会话（WebSocket） |

### 7. 配置路由 `/config/*`

| 端点 | 方法 | 描述 |
|------|------|------|
| `/config` | GET | 获取配置 |
| `/config` | PATCH | 更新配置 |
| `/config/providers` | GET | 列出配置的 AI 提供商 |

### 8. 实验性功能路由 `/experimental/*`

| 端点 | 方法 | 描述 |
|------|------|------|
| `/experimental/console` | GET | 获取 Console 提供商元数据 |
| `/experimental/console/orgs` | GET | 列出可切换的 Console 组织 |
| `/experimental/console/switch` | POST | 切换 Console 组织 |
| `/experimental/tool/ids` | GET | 列出工具 ID |
| `/experimental/tool` | GET | 列出工具详情 |
| `/experimental/worktree` | POST | 创建工作区 |
| `/experimental/worktree` | GET | 列出工作区 |
| `/experimental/worktree` | DELETE | 移除工作区 |
| `/experimental/worktree/reset` | POST | 重置工作区 |
| `/experimental/session` | GET | 列出所有会话（跨项目） |
| `/experimental/resource` | GET | 获取 MCP 资源 |

### 9. 会话路由 `/session/*`

| 端点 | 方法 | 描述 |
|------|------|------|
| `/session` | GET | 列出会话 |
| `/session/status` | GET | 获取会话状态 |
| `/session` | POST | 创建会话 |
| `/session/{sessionID}` | GET | 获取会话详情 |
| `/session/{sessionID}` | PATCH | 更新会话 |
| `/session/{sessionID}` | DELETE | 删除会话 |
| `/session/{sessionID}/children` | GET | 获取子会话 |
| `/session/{sessionID}/todo` | GET | 获取会话待办事项 |
| `/session/{sessionID}/init` | POST | 初始化会话 |
| `/session/{sessionID}/fork` | POST | 分叉会话 |
| `/session/{sessionID}/abort` | POST | 中止会话 |
| `/session/{sessionID}/share` | POST | 分享会话 |
| `/session/{sessionID}/share` | DELETE | 取消分享 |
| `/session/{sessionID}/summarize` | POST | 总结会话 |
| `/session/{sessionID}/diff` | GET | 获取消息差异 |
| `/session/{sessionID}/message` | GET | 获取会话消息 |
| `/session/{sessionID}/message` | POST | 发送消息 |
| `/session/{sessionID}/message/{messageID}` | GET | 获取特定消息 |
| `/session/{sessionID}/message/{messageID}` | DELETE | 删除消息 |
| `/session/{sessionID}/message/{messageID}/part/{partID}` | PATCH | 更新消息部分 |
| `/session/{sessionID}/message/{messageID}/part/{partID}` | DELETE | 删除消息部分 |
| `/session/{sessionID}/prompt_async` | POST | 异步发送消息 |
| `/session/{sessionID}/command` | POST | 发送命令 |
| `/session/{sessionID}/shell` | POST | 运行 Shell 命令 |
| `/session/{sessionID}/revert` | POST | 恢复消息 |
| `/session/{sessionID}/unrevert` | POST | 撤销恢复 |
| `/session/{sessionID}/permissions/{permissionID}` | POST | 响应权限（已弃用） |

### 10. 提供商路由 `/provider/*`

| 端点 | 方法 | 描述 |
|------|------|------|
| `/provider` | GET | 列出所有 AI 提供商 |
| `/provider/auth` | GET | 获取提供商认证方法 |
| `/provider/{providerID}/oauth/authorize` | POST | OAuth 授权 |
| `/provider/{providerID}/oauth/callback` | POST | OAuth 回调 |

### 11. MCP 服务器路由 `/mcp/*`

| 端点 | 方法 | 描述 |
|------|------|------|
| `/mcp` | GET | 获取 MCP 服务器状态 |
| `/mcp` | POST | 添加 MCP 服务器 |
| `/mcp/{name}/auth` | POST | 启动 MCP OAuth |
| `/mcp/{name}/auth/callback` | POST | 完成 MCP OAuth |
| `/mcp/{name}/auth/authenticate` | POST | 认证 MCP OAuth |
| `/mcp/{name}/auth` | DELETE | 移除 MCP OAuth |
| `/mcp/{name}/connect` | POST | 连接 MCP 服务器 |
| `/mcp/{name}/disconnect` | POST | 断开 MCP 服务器 |

### 12. 问题路由 `/question/*`

| 端点 | 方法 | 描述 |
|------|------|------|
| `/question` | GET | 列出待处理问题 |
| `/question/{requestID}/reply` | POST | 回复问题 |
| `/question/{requestID}/reject` | POST | 拒绝问题 |

### 13. 权限路由 `/permission/*`

| 端点 | 方法 | 描述 |
|------|------|------|
| `/permission` | GET | 列出待处理权限请求 |
| `/permission/{requestID}/reply` | POST | 响应权限请求 |

### 14. 文件路由

| 端点 | 方法 | 描述 |
|------|------|------|
| `/find` | GET | 搜索文本 |
| `/find/file` | GET | 查找文件 |
| `/find/symbol` | GET | 查找符号 |
| `/file` | GET | 列出文件 |
| `/file/content` | GET | 读取文件内容 |
| `/file/status` | GET | 获取文件状态 |

### 15. 实例路由

| 端点 | 方法 | 描述 |
|------|------|------|
| `/instance/dispose` | POST | 释放实例 |
| `/path` | GET | 获取路径信息 |
| `/vcs` | GET | 获取版本控制信息 |
| `/vcs/diff` | GET | 获取 VCS 差异 |
| `/command` | GET | 列出可用命令 |
| `/agent` | GET | 列出可用代理 |
| `/skill` | GET | 列出可用技能 |
| `/lsp` | GET | 获取 LSP 状态 |
| `/formatter` | GET | 获取格式化器状态 |
| `/event` | GET | 订阅事件流（SSE） |

### 16. 同步路由 `/sync/*`

| 端点 | 方法 | 描述 |
|------|------|------|
| `/sync/start` | POST | 启动工作区同步 |
| `/sync/replay` | POST | 重放同步事件 |
| `/sync/history` | POST | 列出同步事件 |

### 17. TUI 路由 `/tui/*`

| 端点 | 方法 | 描述 |
|------|------|------|
| `/tui` | GET | 获取 TUI 状态 |
| `/tui` | POST | 发送 TUI 事件 |

---

## 相关源代码文件

| 文件路径 | 描述 |
|----------|------|
| `packages/opencode/src/cli/cmd/serve.ts` | `serve` 命令入口 |
| `packages/opencode/src/server/server.ts` | 服务器主逻辑 |
| `packages/opencode/src/server/routes/global.ts` | 全局路由 |
| `packages/opencode/src/server/routes/control/index.ts` | 控制平面路由 |
| `packages/opencode/src/server/routes/control/workspace.ts` | 工作区路由 |
| `packages/opencode/src/server/routes/instance/index.ts` | 实例主路由 |
| `packages/opencode/src/server/routes/instance/project.ts` | 项目路由 |
| `packages/opencode/src/server/routes/instance/session.ts` | 会话路由 |
| `packages/opencode/src/server/routes/instance/config.ts` | 配置路由 |
| `packages/opencode/src/server/routes/instance/provider.ts` | 提供商路由 |
| `packages/opencode/src/server/routes/instance/mcp.ts` | MCP 路由 |
| `packages/opencode/src/server/routes/instance/file.ts` | 文件路由 |
| `packages/opencode/src/server/routes/instance/pty.ts` | PTY 终端路由 |
| `packages/opencode/src/server/routes/instance/question.ts` | 问题路由 |
| `packages/opencode/src/server/routes/instance/permission.ts` | 权限路由 |
| `packages/opencode/src/server/routes/instance/event.ts` | 事件路由 |
| `packages/opencode/src/server/routes/instance/sync.ts` | 同步路由 |
| `packages/opencode/src/server/routes/instance/experimental.ts` | 实验性功能路由 |
| `packages/opencode/src/server/routes/ui.ts` | UI 静态资源路由 |
| `packages/sdk/openapi.json` | OpenAPI 规范文档 |

---

## 认证

服务器支持通过 `OPENCODE_SERVER_PASSWORD` 环境变量设置密码认证。如果没有设置密码，服务器会以不安全模式运行并输出警告信息。

---

## OpenAPI 文档

服务器支持通过 `/doc` 端点动态生成 OpenAPI 3.1.1 规范的 API 文档。完整规范参考 `packages/sdk/openapi.json`。
