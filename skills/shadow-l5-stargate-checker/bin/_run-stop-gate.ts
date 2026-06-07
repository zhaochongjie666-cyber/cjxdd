#!/usr/bin/env bun
// 实施 A5 wrapper — 加载 shadow-hooks.ts 默认 export (避免多 named export 触发
// bun "paths[0] undefined" 错), 调挂载的 .runStopGate. 透传 CLI args.
import { resolve } from "path"

const args = process.argv.slice(2)
const argVal = (flag: string, dflt?: string): string | undefined => {
  const i = args.indexOf(flag)
  if (i < 0) return dflt
  return args[i + 1]
}

const projectRoot = argVal("--project-root", process.cwd())!
const iterOverride = argVal("--iter")
const schemaPath = argVal("--schema")

// 1. 强绕 Meta 旁路
;(globalThis as any).__SHADOW_FORCE_RUN__ = true
process.env.SHADOW_FORCE_RUN_STOP_GATE = "1"
if (schemaPath) process.env.SHADOW_SCHEMA = schemaPath

// 2. 动态 import default export (不触发多 named export 路径问题)
const pluginPath = resolve(import.meta.dir, "..", "..", "..", "plugins", "shadow-hooks.ts")
const mod = await import(pluginPath)
const ShadowHooks: any = mod.default
if (!ShadowHooks?.runStopGate) {
  console.error(`[cli] shadow-hooks.ts 没挂 .runStopGate (default export = ${typeof ShadowHooks})`)
  process.exit(2)
}

// 3. iter 临时覆盖
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs"
import { join } from "path"
const shadowDir = join(projectRoot, ".shadow")
const curIterFile = join(shadowDir, "current-iteration")
let origIter: string | null = null
if (iterOverride) {
  try {
    origIter = existsSync(curIterFile) ? readFileSync(curIterFile, "utf-8").trim() : null
    writeFileSync(curIterFile, iterOverride)
  } catch (err) {
    console.error(`[cli] 写 current-iteration 失败: ${err}`)
    process.exit(3)
  }
}

// 4. 装 schema (跟 shadow-hooks.ts 同样的 resolveSchemaPath 逻辑)
function resolveSchemaPath(): string {
  if (process.env.SHADOW_SCHEMA && existsSync(process.env.SHADOW_SCHEMA)) {
    return process.env.SHADOW_SCHEMA
  }
  const repoRoot = resolve(import.meta.dir, "..", "..", "..")
  const candidates = [
    join(projectRoot, ".shadow", "shadow-schema.json"),
    join(repoRoot, ".shadow", "shadow-schema.json"),
    join(repoRoot, "framework", "shadow-schema.json"),
    join(repoRoot, "skills", "shadow-init", "templates", "shadow-schema.json"),
  ]
  for (const c of candidates) if (existsSync(c)) return c
  return candidates[3]
}
const resolvedSchema = resolveSchemaPath()
if (!existsSync(resolvedSchema)) {
  console.error(`[cli] 没找到 schema: ${resolvedSchema}`)
  process.exit(2)
}
let schema: any
try { schema = JSON.parse(readFileSync(resolvedSchema, "utf-8")) } catch (err) {
  console.error(`[cli] 解析 schema 失败: ${err}`)
  process.exit(2)
}

// 5. 假 client + diag
const cliClient = {
  tui: {
    showToast: (t: { title: string; message: string; variant: string }) => {
      const icon = t.variant === "error" ? "❌" : t.variant === "warning" ? "⚠️" : t.variant === "success" ? "✅" : "ℹ️"
      process.stdout.write(`${icon} [${(t.variant || "info").toUpperCase()}] ${t.title}\n`)
      if (t.message) process.stdout.write(`${t.message}\n`)
      process.stdout.write("\n")
      return Promise.resolve()
    },
  },
}
const cliDiag = (e: Record<string, unknown>) => {
  process.stderr.write(`[diag] ${JSON.stringify(e)}\n`)
}

try {
  const result = ShadowHooks.runStopGate({
    projectRoot,
    shadowDir,
    schema,
    client: cliClient,
    diag: cliDiag,
    skipMetaBypass: true,
  })
  if (result && (result as any).halt > 0) process.exit(4)
  if (result && (result as any).errors > 0) process.exit(1)
  process.exit(0)
} catch (err) {
  console.error(`[cli] runStopGate 异常: ${err}`)
  process.exit(1)
} finally {
  if (iterOverride) {
    try {
      if (origIter !== null) writeFileSync(curIterFile, origIter)
      else if (existsSync(curIterFile)) unlinkSync(curIterFile)
    } catch {}
  }
}
