# OpenCode Plugin API Reference

## Plugin Structure

```typescript
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { z } from "zod"

export const MyPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  return {
    // Event hooks
    "session.created": async ({ event }) => { ... },
    "session.idle": async ({ event }) => { ... },
    "message.updated": async ({ event }) => { ... },

    // Custom tools
    tool: {
      my_tool: tool({
        description: "What this tool does",
        args: {
          param: z.string().describe("Parameter description"),
        },
        async execute(args, context) {
          return {
            content: [{ type: "text", text: "Result" }],
          }
        },
      }),
    },
  }
}
```

## Available Events

### Session Events
- `session.created` - Session created
- `session.idle` - Session completed/idle
- `session.deleted` - Session deleted
- `session.compacted` - Session compacted
- `session.error` - Session error
- `session.updated` - Session updated
- `session.status` - Session status changed
- `session.diff` - Session file diff

### Message Events
- `message.updated` - Message updated
- `message.removed` - Message removed
- `message.part.updated` - Message part updated
- `message.part.removed` - Message part removed

### Tool Events
- `tool.execute.before` - Before tool execution
- `tool.execute.after` - After tool execution

### TUI Events
- `tui.prompt.append` - Prompt appended
- `tui.command.execute` - Command executed
- `tui.toast.show` - Toast shown

### Other Events
- `event` - Generic event (all events)
- `shell.env` - Shell environment
- `permission.asked` - Permission asked
- `permission.replied` - Permission replied
- `file.edited` - File edited
- `file.watcher.updated` - File watcher updated
- `lsp.client.diagnostics` - LSP diagnostics
- `lsp.updated` - LSP updated
- `command.executed` - Command executed
- `todo.updated` - Todo updated
- `server.connected` - Server connected
- `installation.updated` - Installation updated

## Tool Helper

```typescript
tool({
  description: string,
  args: ZodSchema,
  execute: (args, context) => Promise<{ content: Array<{type: string, text: string}>, isError?: boolean }>
})
```

## Context Object

```typescript
interface ToolContext {
  directory: string      // Current working directory
  worktree: string       // Git worktree path
  session?: { id: string }  // Current session info
}
```
