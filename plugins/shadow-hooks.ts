// shadow-hooks.ts — OpenCode plugin: Shadow 体系的 OpenCode 端实现
// 对应 CLAUDE.md 中"OpenCode uses plugins instead of shell hooks"的描述
// 5 个 hook 翻译自 hooks/*.sh 的等价行为
//
// 安装方式：被 install-to-opencode.sh 软链到 ~/.config/opencode/plugins/
//
// 单一源真理: shadow-schema.json (仓库根). 用 fs.realpathSync 解开软链
// 找到真正位置, 这样 plugin 无论是直接调还是通过软链调都能找到 schema.

import type { Plugin, Hooks } from "@opencode-ai/plugin"
import { existsSync, readFileSync, readdirSync, statSync, realpathSync, appendFileSync } from "fs"
import { join, dirname } from "path"

// 内部 trace log. 默认不输出, 避免污染 TUI 文本流.
// 设 SHADOW_DEBUG=1 打开 console 输出 (仅开发者本地调试用).
const DEBUG = process.env.SHADOW_DEBUG === "1"
const log = (msg: string) => {
  if (DEBUG) console.log(`[shadow-hook] ${msg}`)
}

// 诊断日志: 写到 /tmp/shadow-hook.log, 不污染 TUI.
// 看 .showToast 是否被调到、是否 resolve/reject, 排查 toast 为何不弹.
// 永远开, 不需要 env. 一行一条 JSON, 方便 grep.
const DIAG_LOG = "/tmp/shadow-hook.log"
function diag(entry: Record<string, unknown>) {
  try {
    appendFileSync(DIAG_LOG, JSON.stringify({ ts: Date.now(), ...entry }) + "\n")
  } catch {
    // ignore
  }
}

// module 顶层 side-effect: OpenCode 只要 import 这个文件, 就会写一行.
// 用来区分 "plugin 完全没被 OpenCode 发现" vs "plugin 加载了但 hook 没触发".
diag({ ev: "module-import", pid: process.pid, argv: process.argv.slice(0, 3) })

// 把"用户应该看到"的消息发到 TUI 弹窗，而不是 console.
// OpenCode 的 TUI 会把 console.log/warn/error 当作 TUI 文本流写出来, 干扰输入框.
// 改走 client.tui.showToast → 服务端 Bus.publish(TuiEvent.ToastShow) → TUI 右上角弹窗,
// 不影响 TUI 主体, 用户看完自动消失.
// 失败静默: 弹窗只是辅助手段, hook 主流程不能因为 toast 失败而崩.
function notify(
  client: unknown,
  variant: "info" | "success" | "warning" | "error",
  title: string,
  message: string,
  duration?: number,
): void {
  if (!client) {
    diag({ ev: "notify", variant, title, skipped: "client undefined" })
    return
  }
  const c = client as { tui?: { showToast?: (opts: any) => Promise<unknown> } }
  if (!c.tui?.showToast) {
    diag({
      ev: "notify",
      variant,
      title,
      skipped: "client.tui.showToast missing",
      hasTui: Boolean(c.tui),
      tuiKeys: c.tui ? Object.keys(c.tui) : null,
    })
    return
  }
  // fire-and-forget; toast 不阻塞 hook 主流程
  diag({ ev: "notify-call", variant, title })
  c.tui
    .showToast({
      title,
      message,
      variant,
      duration: duration ?? (variant === "error" || variant === "warning" ? 6000 : 3000),
    })
    .then((res) => diag({ ev: "notify-ok", variant, title, res: typeof res }))
    .catch((err) => diag({ ev: "notify-err", variant, title, err: String(err) }))
}

// ---------- Schema 加载 (懒加载, 与 bash lib.sh 行为对齐) ----------

interface ShadowSchema {
  shadow_version: string
  stages: Array<{
    id: string
    num: number
    display: string
    skill: string
    aliases: string[]
    output_patterns: string[]
  }>
  stub_patterns: {
    patterns: string[]
    ext_globs: string[]
    excluded_dirs: string[]
    min_file_size_bytes: number
    max_findings_per_file: number
  }
  scale_schema: {
    fields: Record<string, { type: string; default: unknown; enum?: string[]; min?: number; max?: number }>
  }
  status_md: {
    version: number
    markers: Record<string, string>
    stage_row_regex: string
    bxx_section_regex: string
    last_updated_field: string
  }
  shadow_init: {
    required_files: string[]
    default_bizlines: string[]
    status_md_template_header: string[]
    status_md_template_table: string[]
  }
}

let _schemaCache: ShadowSchema | null = null
let _schemaPath = ""

// 解析 schema 路径 (解软链 → 仓库根 → shadow-schema.json)
function resolveSchemaPath(): string {
  if (process.env.SHADOW_SCHEMA) return process.env.SHADOW_SCHEMA
  // import.meta.dirname 指向 plugins/ (可能是软链), realpathSync 解开
  let realDir = import.meta.dirname
  try {
    realDir = realpathSync(realDir)
  } catch {
    // fall through
  }
  return join(realDir, "..", "framework", "shadow-schema.json")
}

function loadSchema(): ShadowSchema | null {
  if (_schemaCache) return _schemaCache
  _schemaPath = resolveSchemaPath()
  if (!existsSync(_schemaPath)) {
    log(`schema not found at ${_schemaPath} — hook behavior degraded`)
    return null
  }
  try {
    _schemaCache = JSON.parse(readFileSync(_schemaPath, "utf-8")) as ShadowSchema
    log(`loaded schema v${_schemaCache.shadow_version} from ${_schemaPath}`)
    return _schemaCache
  } catch (err) {
    log(`failed to parse schema at ${_schemaPath}: ${err}`)
    return null
  }
}

// ---------- Stage 查询 ----------

function getStageBySkill(schema: ShadowSchema, skill: string) {
  return schema.stages.find((s) => s.skill === skill)
}

function getStageByAlias(schema: ShadowSchema, name: string) {
  return schema.stages.find((s) => s.aliases.includes(name))
}

function getStageById(schema: ShadowSchema, id: string) {
  return schema.stages.find((s) => s.id === id)
}

// 把 output_patterns 编译成 regex (用于文件路径反查 stage)
function patternToRegex(pat: string): RegExp {
  // .shadow/L1-business/{slug}/spec.md → .shadow/L1-business/[^/]+/spec.md
  const re = pat
    .replace(/\{slug\}/g, "[^/]+")
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
  return new RegExp(`^${re}$`)
}

function matchStageByOutput(schema: ShadowSchema, absFilePath: string, projectRoot: string): string | null {
  const rel = absFilePath.startsWith(projectRoot + "/")
    ? absFilePath.slice(projectRoot.length + 1)
    : absFilePath
  for (const stage of schema.stages) {
    for (const pat of stage.output_patterns) {
      if (patternToRegex(pat).test(rel)) return stage.id
    }
  }
  return null
}

// ---------- 工具函数 ----------

function findShadowDir(start: string): string | null {
  let dir = start
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, ".shadow"))) return join(dir, ".shadow")
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

function readCurrentIter(shadowDir: string): string | null {
  const f = join(shadowDir, "current-iteration")
  return existsSync(f) ? readFileSync(f, "utf-8").trim() : null
}

function readStatusMd(shadowDir: string, iter: string): string | null {
  const f = join(shadowDir, "iterations", iter, "pipeline", "status.md")
  return existsSync(f) ? readFileSync(f, "utf-8") : null
}

function getProjectRoot(): string {
  return process.cwd()
}

// 从 schema 编译存根检测 regex. 一次性, 之后纯 regex 测试.
let _stubRegexes: RegExp[] | null = null
function getStubRegexes(schema: ShadowSchema): RegExp[] {
  if (_stubRegexes) return _stubRegexes
  _stubRegexes = schema.stub_patterns.patterns.map((p) => new RegExp(p))
  return _stubRegexes
}

function isSourceFile(filePath: string, schema: ShadowSchema): boolean {
  return schema.stub_patterns.ext_globs.some((g) => {
    // "*.py" → /\.py$/
    const ext = g.replace("*", "")
    return filePath.endsWith(ext)
  })
}

function scanStubsInFile(filePath: string, schema: ShadowSchema): string[] {
  if (!existsSync(filePath)) return []
  if (!isSourceFile(filePath, schema)) return []
  const text = readFileSync(filePath, "utf-8")
  const matches: string[] = []
  for (const re of getStubRegexes(schema)) {
    if (re.test(text)) matches.push(re.toString())
  }
  return matches
}

// 从 status.md 找第一个 ⏳ 的 stage (display name)
function detectPendingStage(statusMd: string, schema: ShadowSchema): string | null {
  for (const stage of schema.stages) {
    const re = new RegExp(`\\|\\s*${escapeRegex(stage.display)}\\s*\\|\\s*[^|]*⏳`)
    if (re.test(statusMd)) return stage.display
  }
  return null
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// ---------- Plugin 工厂 ----------

export const ShadowHooksPlugin: Plugin = async (input) => {
  const projectRoot = input.directory
  const client = input.client
  const shadowDir = findShadowDir(projectRoot)

  // 加载 schema. 一次, 之后所有 hook 用 _schemaCache.
  const schema = loadSchema()

  log(`loaded for project=${projectRoot} shadowDir=${shadowDir ?? "(none)"} schema=${schema ? "v" + schema.shadow_version : "(missing)"}`)
  diag({
    ev: "plugin-load",
    project: projectRoot,
    shadowDir: shadowDir ?? null,
    schema: schema ? schema.shadow_version : null,
    clientType: typeof client,
    clientKeys: client ? Object.keys(client as object) : null,
    hasTui: client ? Boolean((client as any).tui) : null,
    tuiKeys: client && (client as any).tui ? Object.keys((client as any).tui) : null,
  })

  const hook: Hooks = {
    // === L1 hook (CLAUDE.md 里的 SessionStart) ===
    // 启动时打印 pipeline 上下文
    "experimental.chat.system.transform": async (_input, output) => {
      if (!shadowDir) return
      const iter = readCurrentIter(shadowDir)
      if (!iter) return
      const status = readStatusMd(shadowDir, iter)
      if (!status) return
      const stage = schema ? detectPendingStage(status, schema) : null
      const summary = status.split("\n").slice(0, 12).join("\n")
      output.system.push(
        `\n# Shadow 上下文\n当前 iter: ${iter}\n当前阶段: ${stage ?? "unknown"}\n\nstatus.md 摘要:\n${summary}\n`,
      )
    },

    // === L2 hook (UserPromptSubmit) ===
    // 检测"做一个系统" / "build me X" 意图, 提示加载 shadow-walker
    "chat.message": async (_input, output) => {
      const text = (output.parts ?? [])
        .filter((p: any) => p.type === "text" && !p.synthetic)
        .map((p: any) => p.text)
        .join("\n")
      if (!text) return
      const lower = text.toLowerCase()
      const trigger =
        /做一个.{0,20}系统/.test(text) ||
        /build\s+me\s+(an?\s+)?(app|system|tool)/.test(lower) ||
        /\bfrom\s+scratch\b/.test(lower) ||
        /(帮我|给我).{0,10}(开发|搭建|实现|写一个).{0,20}(系统|app|应用|网站|平台)/.test(text)
      if (trigger) {
        log(`detected system-build intent in user prompt`)
        // 注入一个提示 part 鼓励加载 shadow-walker
        output.parts.push({
          type: "text",
          text: "\n[shadow-hook] 检测到「做一个系统」类意图。建议优先加载 shadow-walker agent 走 L0→L6 完整流程。",
          synthetic: true,
        } as any)
      }
    },

    // === L3 hook (PreToolUse Skill) ===
    // 装 skill 前打印 5 步节奏 + 阶段顺序硬阻断
    "tool.execute.before": async (input, output) => {
      // === L3a: Task 工具派 shadow-worker 时, 提示写 work order ===
      if (input.tool === "task") {
        const args = (output as any).args ?? {}
        const agentName = String(args.agent ?? args.subagent_type ?? "")
        if (/worker/i.test(agentName)) {
          const prompt = String(args.prompt ?? args.description ?? "")
          const woMatch = prompt.match(/WO-\d+/)
          const woPathMatch = prompt.match(/\.shadow\/iterations\/iter-\d+\/work-orders\/WO-\d+[^\s]*\.md/)
          if (!woMatch && !woPathMatch) {
            notify(
              client,
              "warning",
              "Shadow: WO 缺失",
              `派了 ${agentName} 但 prompt 里没找到 WO-NNN 引用.\n` +
                `建议先写 work order 到 .shadow/iterations/iter-N/work-orders/WO-NNN-slug.md\n` +
                `模板: docs/work-order-template.md  契约: agents/shadow-worker.md`,
            )
          } else if (woPathMatch) {
            const woPath = woPathMatch[0]
            const exists = existsSync(woPath)
            if (!exists) {
              notify(
                client,
                "error",
                "Shadow: WO 不存在",
                `${woMatch?.[0]} 引用了 WO 文件但不存在: ${woPath}\n先写 work order, 再派 worker.`,
              )
            } else {
              notify(
                client,
                "info",
                "Shadow: 派单",
                `派 ${woMatch?.[0]} 给 ${agentName} (WO 文件: ${woPath})`,
                2500,
              )
            }
          }
        }
        return
      }

      if (input.tool !== "skill") return
      const args = (output as any).args ?? {}
      const skillName = args.name ?? ""
      log(`loading skill: ${skillName}`)

      // 5 步节奏
      const rhythm = [
        `1. 读 SKILL.md 全文（<500 行）`,
        `2. 读 references/* 中对应文件`,
        `3. 按 SKILL.md 流程一步步做，不要跳步`,
        `4. 完成后更新 .shadow/iterations/iter-N/pipeline/status.md`,
        `5. 用 "node-walker-final" commit 类型或类似方式标记阶段完成`,
      ].join("\n")

      notify(
        client,
        "info",
        `Shadow: 5 步节奏 · ${skillName}`,
        rhythm,
        5000,
      )

      // 阶段顺序硬阻断 (用 schema 而不是硬编码 STAGE_ORDER)
      if (shadowDir && schema) {
        const iter = readCurrentIter(shadowDir)
        const status = iter ? readStatusMd(shadowDir, iter) : null
        const pendingDisplay = status ? detectPendingStage(status, schema) : null
        const pendingStage = pendingDisplay ? getStageByAlias(schema, pendingDisplay) : null
        const skillStage = getStageBySkill(schema, skillName)
        if (pendingStage && skillStage) {
          if (skillStage.num > pendingStage.num + 1) {
            const err = `[shadow-hook] 阶段跳序！当前 ⏳=${pendingStage.display}, 但你试图加载 ${skillName} (${skillStage.display})。按顺序先完成 ${pendingStage.display}。`
            log(err)
            notify(
              client,
              "error",
              "Shadow: 阶段跳序",
              `当前 ⏳=${pendingStage.display}\n你试图加载 ${skillName} (${skillStage.display})\n按顺序先完成 ${pendingStage.display}`,
              8000,
            )
            throw new Error(err)
          }
        }
      }
    },

    // === L4 hook (PostToolUse Write/Edit) ===
    // 写完代码实时扫存根
    "tool.execute.after": async (input, output) => {
      if (!["write", "edit", "apply_patch"].includes(input.tool)) return
      const args = (input as any).args ?? {}
      const filePath = args.filePath ?? args.path ?? args.file ?? ""
      if (!filePath) return
      if (!schema) return
      const stubs = scanStubsInFile(filePath, schema)
      if (stubs.length > 0) {
        log(`STUB DETECTED in ${filePath}: ${stubs.length} patterns`)
        notify(
          client,
          "warning",
          "Shadow: 存根警告",
          `${filePath}\n含 ${stubs.length} 处存根模式:\n` +
            stubs.map((s) => `  - ${s}`).join("\n") +
            `\n工藤伦底线: 必须真实实现, 不允许 pass/TODO/NotImplementedError 顶包。`,
          6000,
        )
        output.metadata = {
          ...(output.metadata ?? {}),
          shadowStubWarning: true,
          shadowStubCount: stubs.length,
        }
      }
    },

    // === L5 hook (Stop / session.idle) ===
    // 全项目存根扫描 + pipeline 完成度检查
    event: async ({ event }: any) => {
      // session 结束的标志: message.updated 携带 finish=stop 且没有 tool calls
      if (event?.type !== "message.updated") return
      const info = event?.properties?.info
      if (!info || info.role !== "assistant" || info.finish !== "stop") return
      if (!schema) return

      // 异步扫存根 — 不阻塞
      setTimeout(() => {
        try {
          const files = walkProject(projectRoot, 50)
          let totalStubs = 0
          const stubFiles: string[] = []
          for (const f of files) {
            const stubs = scanStubsInFile(f, schema)
            if (stubs.length > 0) {
              totalStubs += stubs.length
              stubFiles.push(`${f} (${stubs.length})`)
            }
          }
          if (totalStubs > 0) {
            log(`SESSION END — 全项目扫到 ${totalStubs} 处存根:`)
            const listed = stubFiles.slice(0, 20).map((sf) => `  ⚠️  ${sf}`).join("\n")
            const more = stubFiles.length > 20 ? `\n  ... 还有 ${stubFiles.length - 20} 个文件` : ""
            notify(
              client,
              "warning",
              `Shadow: 存根扫描 · ${totalStubs} 处`,
              listed + more,
              8000,
            )
          } else {
            log(`SESSION END — 干净, 无存根 ✓`)
            notify(client, "success", "Shadow: 存根扫描", "SESSION END — 干净, 无存根 ✓", 2500)
          }
        } catch (err) {
          log(`session.idle scan failed: ${err}`)
          notify(client, "error", "Shadow: 扫描失败", `session.idle scan failed: ${err}`, 6000)
        }
      }, 100)
    },
  }

  return hook
}

function walkProject(root: string, maxFiles: number): string[] {
  const out: string[] = []
  const skip = ["node_modules", ".git", ".shadow", "dist", "build", ".next", "out"]
  const walk = (dir: string, depth: number) => {
    if (out.length >= maxFiles || depth > 6) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (out.length >= maxFiles) break
      if (e.name.startsWith(".") && e.name !== ".opencode") continue
      if (skip.includes(e.name)) continue
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p, depth + 1)
      else if (e.isFile()) out.push(p)
    }
  }
  walk(root, 0)
  return out
}

export default ShadowHooksPlugin
