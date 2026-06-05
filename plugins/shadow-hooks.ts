// shadow-hooks.ts — OpenCode plugin: Shadow 体系的 OpenCode 端实现
// 对应 CLAUDE.md 中"OpenCode uses plugins instead of shell hooks"的描述
// 5 个 hook 翻译自 hooks/*.sh 的等价行为
//
// 安装方式：被 install-to-opencode.sh 软链到 ~/.config/opencode/plugins/

import type { Plugin, Hooks } from "@opencode-ai/plugin"
import { existsSync, readFileSync, readdirSync, statSync } from "fs"
import { join, dirname } from "path"

const log = (msg: string) => console.log(`[shadow-hook] ${msg}`)

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
  // 简化: OpenCode 的 input.directory 通常就是项目根
  return process.cwd()
}

function scanStubsInFile(filePath: string): string[] {
  if (!existsSync(filePath)) return []
  const text = readFileSync(filePath, "utf-8")
  const patterns = [
    /\bpass\b\s*$/m,                          // Python: pass
    /\bTODO\b\s*[:(]/,                        // TODO:
    /throw\s+new\s+NotImplementedError/,      // TS/Java: NotImplementedError
    /class\s+\w+InMemoryRepository/,          // Java: InMemoryRepository stub
  ]
  return patterns.filter((p) => p.test(text)).map((p) => p.toString())
}

// 阶段顺序（来自 shadow-walker.md 的 L0→L6 流程）
const STAGE_ORDER = [
  "L0-research", "L1-research", "L1-flow", "L1-spec", "L1-wire",
  "L1.5-architecture", "scaffold", "L2-e2e", "L5-plan", "L5-impl",
  "reviewer", "L6-deploy",
]

// 检测当前阶段（从 status.md 找第一个 ⏳）
function detectCurrentStage(statusMd: string): string | null {
  for (const stage of STAGE_ORDER) {
    if (new RegExp(`\\|\\s*${stage}\\s*\\|\\s*⏳`).test(statusMd)) return stage
  }
  return null
}

// ---------- Plugin 工厂 ----------

export const ShadowHooksPlugin: Plugin = async (input) => {
  const projectRoot = input.directory
  const shadowDir = findShadowDir(projectRoot)

  log(`loaded for project=${projectRoot} shadowDir=${shadowDir ?? "(none)"}`)

  const hook: Hooks = {
    // === L1 hook (CLAUDE.md 里的 SessionStart) ===
    // 启动时打印 pipeline 上下文
    "experimental.chat.system.transform": async (_input, output) => {
      if (!shadowDir) return
      const iter = readCurrentIter(shadowDir)
      if (!iter) return
      const status = readStatusMd(shadowDir, iter)
      if (!status) return
      const stage = detectCurrentStage(status) ?? "unknown"
      const summary = status.split("\n").slice(0, 12).join("\n")
      output.system.push(
        `\n# Shadow 上下文\n当前 iter: ${iter}\n当前阶段: ${stage}\n\nstatus.md 摘要:\n${summary}\n`,
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

      console.log(`[shadow-hook] 5-step rhythm for skill="${skillName}":\n${rhythm}`)

      // 阶段顺序硬阻断
      if (shadowDir) {
        const iter = readCurrentIter(shadowDir)
        const status = iter ? readStatusMd(shadowDir, iter) : null
        const current = status ? detectCurrentStage(status) : null
        if (current) {
          const currentIdx = STAGE_ORDER.indexOf(current)
          // 把 skill 名映射到阶段
          const skillStage = STAGE_ORDER.find((s) =>
            skillName.toLowerCase().includes(s.toLowerCase().replace(/-/g, "").replace(".", "")),
          )
          if (skillStage) {
            const skillIdx = STAGE_ORDER.indexOf(skillStage)
            if (skillIdx > currentIdx + 1) {
              const err = `[shadow-hook] 阶段跳序！当前 ⏳=${current}, 但你试图加载 ${skillName} (${skillStage})。按顺序先完成 ${current}。`
              console.error(err)
              throw new Error(err)
            }
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
      const stubs = scanStubsInFile(filePath)
      if (stubs.length > 0) {
        log(`STUB DETECTED in ${filePath}: ${stubs.length} patterns`)
        console.warn(
          `[shadow-hook] ⚠️  ${filePath} 包含 ${stubs.length} 处存根模式:\n` +
            stubs.map((s) => `  - ${s}`).join("\n") +
            `\n工藤伦底线: 必须真实实现, 不允许 pass/TODO/NotImplementedError 顶包。`,
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
      // 简化: 监听 message.updated with finish=stop
      if (event?.type !== "message.updated") return
      const info = event?.properties?.info
      if (!info || info.role !== "assistant" || info.finish !== "stop") return

      // 异步扫存根 — 不阻塞
      setTimeout(() => {
        try {
          const files = walkProject(projectRoot, 50)
          let totalStubs = 0
          const stubFiles: string[] = []
          for (const f of files) {
            if (!f.endsWith((".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".java"))) continue
            const stubs = scanStubsInFile(f)
            if (stubs.length > 0) {
              totalStubs += stubs.length
              stubFiles.push(`${f} (${stubs.length})`)
            }
          }
          if (totalStubs > 0) {
            log(`SESSION END — 全项目扫到 ${totalStubs} 处存根:`)
            for (const sf of stubFiles.slice(0, 20)) console.warn(`  ⚠️  ${sf}`)
            if (stubFiles.length > 20) console.warn(`  ... 还有 ${stubFiles.length - 20} 个文件`)
          } else {
            log(`SESSION END — 干净, 无存根 ✓`)
          }
        } catch (err) {
          console.error(`[shadow-hook] session.idle scan failed:`, err)
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
