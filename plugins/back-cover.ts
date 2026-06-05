// back-cover.ts — OpenCode plugin: 防"伪完成"硬锁
// 简化版: 只用 Node.js 内置 + Hooks 类型, 不依赖 zod/@opencode-ai/plugin
// 设计: /home/zhaocj/.claude/skills/opencode-learning/notes/back-cover-pure-plugin.md

import type { Plugin, Hooks } from "@opencode-ai/plugin"
import { appendFileSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"

const log = (msg: string) => {
  // 写文件 + stderr — TUI 拦截 console, 必须用 stderr 或文件
  process.stderr.write(`[back-cover] ${msg}\n`)
  try {
    const f = join(homedir(), ".back-cover.log")
    appendFileSync(f, `[${new Date().toISOString()}] ${msg}\n`)
  } catch {}
}

// ───────────────── 判定常量 ─────────────────

const READONLY_TOOLS = new Set([
  "read", "glob", "grep", "list",
  "webfetch", "websearch", "codesearch",
  "skill", "question",
])
const TODO_TOOLS = new Set(["todowrite", "todo"])
const VERIFY_TOOLS = new Set(["bash", "lsp", "verify_completion"])
const HARD_DONE_RE = [
  /^\s*(任务完成|已完成|done\.?|complete\.?|finished\.?|搞定|收工)\s*\.?\s*$/im,
  /^\s*✅\s*$/m,
]

// ───────────────── L0 状态 ─────────────────

interface Guard {
  injected: number
  lastInject: number
}
const guards = new Map<string, Guard>()
const MAX_INJECTS = 3
const COOLDOWN_MS = 30_000

function getGuard(sessionID: string): Guard {
  let g = guards.get(sessionID)
  if (!g) {
    g = { injected: 0, lastInject: 0 }
    guards.set(sessionID, g)
  }
  return g
}

// ───────────────── 审计 ─────────────────

function auditAssistant(parts: any[]): { fake: boolean; reason?: string; detail?: string } {
  const toolCalls = parts.filter((p: any) => p.type === "tool").map((p: any) => p.tool)
  const patches = parts.filter((p: any) => p.type === "patch")
  const text = parts
    .filter((p: any) => p.type === "text" && !p.synthetic)
    .map((p: any) => p.text)
    .join("\n")

  const allTodo = toolCalls.length > 0 && toolCalls.every((t) => TODO_TOOLS.has(t))
  const allReadonly = toolCalls.length > 0 && toolCalls.every((t) => READONLY_TOOLS.has(t))
  const verified = toolCalls.some((t) => VERIFY_TOOLS.has(t))
  const hardDone = HARD_DONE_RE.some((p) => p.test(text))

  if (toolCalls.length === 0 && hardDone) {
    return { fake: true, reason: "纯文字完成宣言", detail: text.slice(0, 80) }
  }
  if (allTodo && hardDone) {
    return { fake: true, reason: "只调 todo", detail: toolCalls.join(",") }
  }
  if (allReadonly && hardDone) {
    return { fake: true, reason: "只调只读", detail: toolCalls.join(",") }
  }
  if (patches.length > 0 && !verified && hardDone) {
    return { fake: true, reason: "改了文件没验证", detail: `patches=${patches.length}` }
  }
  return { fake: false }
}

function lastAssistant(messages: any[]): any | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].info?.role === "assistant" && !messages[i].info?.synthetic) {
      return messages[i]
    }
  }
  return null
}

// ───────────────── Plugin 工厂 ─────────────────

export const BackCoverPlugin: Plugin = async (input) => {
  log(`LOADED — directory=${input.directory}`)
  const client: any = input.client

  // L3: 注册 verify_completion 工具 (手动构造, 不用 zod)
  // OpenCode 的 tool schema 由 effect-zod 转换, 这里用最简形式
  // 实际生产环境用 @opencode-ai/plugin 的 tool() 辅助, 但它需要外部依赖
  const verifyCompletionTool = {
    description: "校验本 turn 是否满足'真完成'条件。**任何 done 宣言前必须先调用本工具。**",
    args: {
      claim: { type: "string", describe: "你准备声明的完成内容" } as any,
    },
    async execute(args: any, ctx: any) {
      log(`L3 verify_completion called: claim="${args.claim}"`)
      if (!ctx?.sessionID || !client) {
        return "verify_completion: 工具初始化异常, 暂时放行。"
      }
      try {
        const res = await client.session.messages({ path: { id: ctx.sessionID }, query: { limit: 5 } })
        const msgs = (res.data ?? []) as any[]
        const self = msgs.find((m: any) => m.info?.id === ctx.messageID) ?? msgs[msgs.length - 1]
        if (!self) return "找不到当前 turn 的消息。"
        const parts = self.parts ?? []
        const toolCalls = parts.filter((p: any) => p.type === "tool").map((p: any) => p.tool)
        const patches = parts.filter((p: any) => p.type === "patch")
        const text = parts.filter((p: any) => p.type === "text" && !p.synthetic)
          .map((p: any) => p.text).join("\n")
        const allTodo = toolCalls.length > 0 && toolCalls.every((t: string) => TODO_TOOLS.has(t))
        const allReadonly = toolCalls.length > 0 && toolCalls.every((t: string) => READONLY_TOOLS.has(t))
        const verified = toolCalls.some((t: string) => VERIFY_TOOLS.has(t))
        const hardDone = HARD_DONE_RE.some((p) => p.test(text))

        if (toolCalls.length === 0 && hardDone) return `BLOCKED: claim "${args.claim}" 是纯文字完成宣言, 没调任何工具。`
        if (allTodo && hardDone) return `BLOCKED: 本 turn 只调了 todo (${toolCalls.join(",")})。`
        if (allReadonly && hardDone) return `BLOCKED: 本 turn 只调了只读工具 (${toolCalls.join(",")})。`
        if (patches.length > 0 && !verified && hardDone) return `BLOCKED: 改了 ${patches.length} 个文件但没跑过验证。`
        return `OK: 本 turn 满足完成条件。claim="${args.claim}"。可以宣告 done。 (tools=${toolCalls.length}, patches=${patches.length})`
      } catch (err) {
        return `verify_completion 异常 (${String(err)}), 放行。`
      }
    },
  }

  const hook: Hooks = {
    // === L0: event hook ===
    event: async ({ event }: any) => {
      if (event?.type !== "message.updated") return
      const info = event?.properties?.info
      if (!info || info.role !== "assistant") return
      if (!info.finish || info.finish === "tool-calls") return
      if (info.error || info.summary) return

      const sessionID = info.sessionID
      const messageID = info.id
      const guard = getGuard(sessionID)
      if (guard.injected >= MAX_INJECTS) return
      if (Date.now() - guard.lastInject < COOLDOWN_MS) return

      // 异步审计 (不等)
      setTimeout(async () => {
        try {
          const res = await client.session.messages({ path: { id: sessionID }, query: { limit: 5 } })
          const msgs = (res.data ?? []) as any[]
          const self = msgs.find((m: any) => m.info?.id === messageID) ?? msgs[msgs.length - 1]
          if (!self) return
          const verdict = auditAssistant(self.parts ?? [])
          if (!verdict.fake) return

          const nudge = `[back-cover auto-injected #${guard.injected + 1}]\n` +
            `你上一轮被审计为"伪完成": ${verdict.reason} (${verdict.detail})\n` +
            `请继续做具体工作, 然后调 verify_completion 工具确认。`

          await client.session.prompt({
            path: { id: sessionID },
            body: { agent: self.info?.agent ?? "build", parts: [{ type: "text", text: nudge }] },
          })
          guard.injected++
          guard.lastInject = Date.now()
          log(`L0 INJECTED for session=${sessionID.slice(0, 8)} reason=${verdict.reason}`)
        } catch (err) {
          log(`L0 audit failed: ${String(err)}`)
        }
      }, 50)
    },

    // === L1: system prompt 注入 ===
    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(`# BACK COVER (硬规则 · 不可跳过)
在宣告"任务完成 / done / complete / finished / ✅"之前,你必须先调用 verify_completion 工具(它会检查你本 turn 是否产生了文件改动 / 跑过验证 / 没用只读/纯 todo 收尾) 并得到 "OK:" 开头的响应。`)
    },

    // === L3: register verify_completion tool ===
    tool: {
      verify_completion: verifyCompletionTool as any,
    },

    // === L2: messages 末尾追加 nudge ===
    "experimental.chat.messages.transform": async (_input, output) => {
      const last = lastAssistant(output.messages)
      if (!last) return
      const verdict = auditAssistant(last.parts ?? [])
      if (!verdict.fake) return
      log(`L2 nudge for ${verdict.reason}`)
      output.messages.push({
        info: {
          id: `back-cover-nudge-${Date.now()}`,
          sessionID: "synthetic",
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          synthetic: true,
        },
        parts: [
          {
            type: "text",
            text: `[back-cover L2] 上一轮未通过: ${verdict.reason} · ${verdict.detail}\n请继续。`,
            synthetic: true,
          },
        ],
      } as any)
    },

    // === L4: metadata hint ===
    "tool.execute.after": async (input, output) => {
      const t = input.tool
      if (TODO_TOOLS.has(t)) {
        log(`L4 hint: todowrite 不是完成证明 (tool=${t})`)
        output.metadata = { ...(output.metadata ?? {}), backCoverHint: "todowrite 不是完成证明" }
      } else if (READONLY_TOOLS.has(t)) {
        output.metadata = { ...(output.metadata ?? {}), backCoverHint: "只读工具不算完成" }
      }
    },
  }
  return hook
}

export default BackCoverPlugin
