// shadow-hooks.ts — OpenCode plugin: Shadow 体系的 OpenCode 端实现
// 行为对齐基线: hooks/*.sh (Claude Code). 详见 .claude/plans/eager-brewing-oasis.md.
//
// 5 个 hook 翻译自 hooks/*.sh:
//   L1 experimental.chat.system.transform ↔ SessionStart (session-start.sh)
//   L2 chat.message                        ↔ UserPromptSubmit (user-prompt-submit.sh)
//   L3 tool.execute.before (skill + task)  ↔ PreToolUse Skill/Task (pre-skill.sh + worker-dispatch-hint.sh)
//   L4 tool.execute.after (write/edit)     ↔ PostToolUse Write/Edit (post-write-stub-scan.sh)
//   L5 event (message.updated finish=stop) ↔ Stop (stop-gate.sh)
//
// 单一源真理: skills/shadow-init/templates/shadow-schema.json. 用 realpathSync
// 解开软链找真正位置, 这样 plugin 无论是直接调还是通过软链调都能找到 schema.
//
// 安装: install-to-opencode.sh 软链到 ~/.config/opencode/plugins/

import type { Plugin, Hooks } from "@opencode-ai/plugin"
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  realpathSync,
  appendFileSync,
  mkdirSync,
  unlinkSync,
} from "fs"
import { join, dirname, basename } from "path"
import { execSync } from "child_process"

// ════════════════════════════════════════════════════════════════════
// § 1 类型定义 (单一源真理来自 shadow-schema.json)
// ════════════════════════════════════════════════════════════════════

interface ShadowStage {
  id: string
  num: number
  display: string
  skill: string
  aliases: string[]
  output_patterns: string[]
}

interface StubPatterns {
  patterns: string[]
  ext_globs: string[]
  excluded_dirs: string[]
  min_file_size_bytes: number
  max_findings_per_file: number
}

interface LifecycleArtifact {
  id: string
  stage: string
  canonical_path: string
  role: "design_baseline" | "process_output" | "evidence_archive" | "control_marker" | "template_instance"
  aliases?: string[]
  note?: string
}

interface LifecycleRoles {
  design_baseline: string
  process_output: string
  evidence_archive: string
  control_marker: string
  template_instance: string
}

interface ShadowSchema {
  shadow_version: string
  stages: ShadowStage[]
  stub_patterns: StubPatterns
  scale_schema: { fields: Record<string, { type: string; default: unknown; enum?: string[]; min?: number; max?: number }> }
  status_md: { version: number; markers: Record<string, string>; stage_row_regex: string; bxx_section_regex: string; last_updated_field: string }
  shadow_init: { required_files: string[]; default_bizlines: string[]; status_md_template_header: string[]; status_md_template_table: string[] }
  lifecycle_artifacts?: { roles: LifecycleRoles; artifacts: LifecycleArtifact[] }
}

interface GateResult {
  ok: boolean
  exitCode: number
  output: string
  reason: "pass" | "r5-fail" | "script-missing" | "fatal"
}

// ════════════════════════════════════════════════════════════════════
// § 2 Schema & 路径解析
// ════════════════════════════════════════════════════════════════════

let _schemaCache: ShadowSchema | null = null
let _schemaPath = ""

// 实施 A5: CLI 入口强绕 Meta 旁路. CLI 进程跑 bun shadow-hooks.ts --run-stop-gate
// 时 set true, 真实 OpenCode event ctx 永不动 (默认 false).
// 这让用户能在 cjxdd 自身 (framework meta) 跑通 stop-gate 看真硬门禁.
let _forceRunStopGate = false

function resolveSchemaPath(): string {
  if (process.env.SHADOW_SCHEMA && existsSync(process.env.SHADOW_SCHEMA)) {
    return process.env.SHADOW_SCHEMA
  }
  let realDir = __dirname
  try {
    realDir = realpathSync(realDir)
  } catch {
    // fall through
  }
  const repoRoot = join(realDir, "..")
  const cwd = process.cwd()
  if (existsSync(join(cwd, ".shadow", "shadow-schema.json"))) return join(cwd, ".shadow", "shadow-schema.json")
  if (existsSync(join(repoRoot, ".shadow", "shadow-schema.json"))) return join(repoRoot, ".shadow", "shadow-schema.json")
  if (existsSync(join(repoRoot, "framework", "shadow-schema.json"))) return join(repoRoot, "framework", "shadow-schema.json")
  if (existsSync(join(repoRoot, "skills", "shadow-init", "templates", "shadow-schema.json"))) {
    return join(repoRoot, "skills", "shadow-init", "templates", "shadow-schema.json")
  }
  return join(cwd, ".shadow", "shadow-schema.json")
}

function loadShadowSchema(): ShadowSchema | null {
  if (_schemaCache) return _schemaCache
  _schemaPath = resolveSchemaPath()
  if (!existsSync(_schemaPath)) return null
  try {
    _schemaCache = JSON.parse(readFileSync(_schemaPath, "utf-8")) as ShadowSchema
    return _schemaCache
  } catch {
    return null
  }
}

function findProjectRoot(start: string = process.cwd()): string | null {
  let dir = start
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, ".shadow")) || existsSync(join(dir, ".git"))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

function findShadowDir(start: string = process.cwd()): string | null {
  let dir = start
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, ".shadow"))) return join(dir, ".shadow")
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

// ───────── Meta 任务检测 (P0-7 Round 1) ─────────
// 当项目根就是 Shadow framework 自身 (cjxdd) 时, hook 不应注入
// "build me X" → walker 引导, 不应注 stage 状态查询答案.
// 判定: 项目根同时存在 agents/shadow-walker.md + skills/shadow-init/SKILL.md
//       + hooks/lib.sh.
function isMetaProject(projectRoot: string | null): boolean {
  if (!projectRoot) return false
  return (
    existsSync(join(projectRoot, "agents/shadow-walker.md")) &&
    existsSync(join(projectRoot, "skills/shadow-init/SKILL.md")) &&
    existsSync(join(projectRoot, "hooks/lib.sh"))
  )
}

function resolveGateScriptPath(): string {
  let realDir = __dirname
  try {
    realDir = realpathSync(realDir)
  } catch {
    // fall through
  }
  return join(realDir, "..", "skills", "shadow-artifact-lifecycle", "scripts", "gate-check-lifecycle.sh")
}

// ════════════════════════════════════════════════════════════════════
// § 3 Iter & Status
// ════════════════════════════════════════════════════════════════════

function readCurrentIter(shadowDir: string): string | null {
  const f = join(shadowDir, "current-iteration")
  if (!existsSync(f)) return null
  return readFileSync(f, "utf-8").trim() || null
}

function readStatusMd(shadowDir: string, iter: string): string | null {
  if (!iter) return null
  const f = join(shadowDir, "iterations", iter, "pipeline", "status.md")
  if (!existsSync(f)) return null
  return readFileSync(f, "utf-8")
}

function detectPendingStage(statusMd: string | null): string | null {
  if (!statusMd) return null
  for (const line of statusMd.split("\n")) {
    if (!line.match(/^\|\s*L\d/)) continue
    const parts = line.split("|").map((p) => p.trim())
    if (parts.length < 3) continue
    if ((parts[2] || "").includes("⏳")) return parts[1] || null
  }
  return null
}

function detectDoingStage(statusMd: string | null): string | null {
  if (!statusMd) return null
  for (const line of statusMd.split("\n")) {
    if (!line.match(/^\|\s*L\d/)) continue
    const parts = line.split("|").map((p) => p.trim())
    if (parts.length < 3) continue
    if ((parts[2] || "").includes("🔄")) return parts[1] || null
  }
  return null
}

function updateStageStatus(statusPath: string, stageDisplay: string, newMark: string): boolean {
  if (!existsSync(statusPath)) return false
  const text = readFileSync(statusPath, "utf-8")
  const lines = text.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.match(/^\|/) || !line.includes("|")) continue
    if (!line.includes(stageDisplay)) continue
    const cellRe = /\s*[⏳🔄✅❌][^|]*\s*/
    const newLine = line.replace(cellRe, ` ${newMark} `)
    if (newLine !== line) {
      lines[i] = newLine
      writeFileSync(statusPath, lines.join("\n"))
      return true
    }
  }
  return false
}

// ════════════════════════════════════════════════════════════════════
// § 4 Stage 查询
// ════════════════════════════════════════════════════════════════════

function getStageBySkill(schema: ShadowSchema, skill: string): ShadowStage | null {
  return schema.stages.find((s) => s.skill === skill) || null
}
function getStageByAlias(schema: ShadowSchema, name: string): ShadowStage | null {
  return schema.stages.find((s) => s.aliases.includes(name)) || null
}
function getStageById(schema: ShadowSchema, id: string): ShadowStage | null {
  return schema.stages.find((s) => s.id === id) || null
}
function getStageByDisplay(schema: ShadowSchema, display: string): ShadowStage | null {
  return schema.stages.find((s) => s.display === display) || null
}
function nextStageId(schema: ShadowSchema, cur: string): string | null {
  const cs = getStageById(schema, cur)
  if (!cs) return null
  return schema.stages.find((s) => s.num === cs.num + 1)?.id || null
}
function nextStageSkill(schema: ShadowSchema, cur: string): string | null {
  const next = nextStageId(schema, cur)
  return next ? getStageById(schema, next)?.skill || null : null
}

function patternToRegex(pat: string): RegExp {
  return new RegExp(
    "^" +
      pat
        .replace(/\{slug\}|\{iter\}|\{component\}|\{layer\}|\{type\}|\{ts\}/g, "[^/]+")
        .replace(/\./g, "\\.")
        .replace(/\*\*/g, ".*")
        .replace(/\*/g, "[^/]*") +
      "$",
  )
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

// ════════════════════════════════════════════════════════════════════
// § 5 状态摘要
// ════════════════════════════════════════════════════════════════════

function readStatusSummary(statusMd: string | null, iter: string | null): string {
  if (!statusMd || !iter) return ""
  let done = 0, inprog = 0, pending = 0, failed = 0
  for (const line of statusMd.split("\n")) {
    if (!line.match(/^\|\s*L\d/)) continue
    const status = (line.split("|")[2] || "").trim()
    if (status.includes("✅")) done++
    else if (status.includes("🔄")) inprog++
    else if (status.includes("❌")) failed++
    else if (status.includes("⏳")) pending++
  }
  return `${iter} | done=${done} in_progress=${inprog} pending=${pending} failed=${failed}`
}

function readBxxBreakdown(statusMd: string | null): string {
  if (!statusMd) return ""
  const sections: { name: string; done: number; inprog: number; pending: number; failed: number }[] = []
  let current: { name: string; done: number; inprog: number; pending: number; failed: number } | null = null
  for (const line of statusMd.split("\n")) {
    const m = line.match(/^##\s+(B\d+\s+.*)/)
    if (m) {
      if (current && current.done + current.inprog + current.pending + current.failed > 0) sections.push(current)
      current = { name: m[1].trim(), done: 0, inprog: 0, pending: 0, failed: 0 }
      continue
    }
    if (!current || !line.match(/^\|\s*L\d/)) continue
    const status = (line.split("|")[2] || "").trim()
    if (status.includes("✅")) current.done++
    else if (status.includes("🔄")) current.inprog++
    else if (status.includes("❌")) current.failed++
    else if (status.includes("⏳")) current.pending++
  }
  if (current && current.done + current.inprog + current.pending + current.failed > 0) sections.push(current)
  return sections
    .map((s) => `  ${s.name} | done=${s.done} in_progress=${s.inprog} pending=${s.pending} failed=${s.failed}`)
    .join("\n")
}

function readPendingByBxx(statusMd: string | null): string {
  if (!statusMd) return ""
  const sections: { name: string; pending: string[] }[] = []
  let current: { name: string; pending: string[] } | null = null
  for (const line of statusMd.split("\n")) {
    const m = line.match(/^##\s+(B\d+\s+.*)/)
    if (m) {
      if (current && current.pending.length > 0) sections.push(current)
      current = { name: m[1].trim(), pending: [] }
      continue
    }
    if (!current || !line.match(/^\|\s*L\d/)) continue
    const parts = line.split("|").map((p) => p.trim())
    const status = parts[2] || ""
    if (status.includes("⏳") || status.includes("🔄")) current.pending.push(`${parts[1] || ""} ${status}`)
  }
  if (current && current.pending.length > 0) sections.push(current)
  const out: string[] = []
  for (const s of sections) {
    out.push(`  ${s.name}`)
    for (const p of s.pending) out.push(`    - ${p}`)
  }
  return out.join("\n")
}

function extractContextMap(statusMd: string | null): string {
  if (!statusMd) return ""
  const lines = statusMd.split("\n")
  const out: string[] = []
  let inSection = false
  for (const line of lines) {
    if (line.match(/^##\s+上下文地图/)) {
      inSection = true
      out.push(line)
      continue
    }
    if (inSection && line.match(/^##\s+/)) break
    if (inSection) out.push(line)
    if (out.length >= 42) break
  }
  return out.slice(0, 41).join("\n").trim()
}

// ════════════════════════════════════════════════════════════════════
// § 6 存根扫描
// ════════════════════════════════════════════════════════════════════

let _stubRegexes: RegExp[] | null = null
function getStubRegexes(schema: ShadowSchema): RegExp[] {
  if (_stubRegexes) return _stubRegexes
  _stubRegexes = schema.stub_patterns.patterns.map((p) => new RegExp(p))
  return _stubRegexes
}

function isSourceFile(filePath: string, schema: ShadowSchema): boolean {
  return schema.stub_patterns.ext_globs.some((g) => filePath.endsWith(g.replace("*", "")))
}

function scanStubsInFile(
  filePath: string,
  schema: ShadowSchema,
  cap: number = 10,
): { line: number; text: string }[] {
  if (!existsSync(filePath) || !isSourceFile(filePath, schema)) return []
  const text = readFileSync(filePath, "utf-8")
  if (text.length > 524288) return []
  if (text.length < (schema.stub_patterns.min_file_size_bytes || 300)) return []
  if (/_test\.|^.*\.test\.|^.*\.spec\.|[\\/]tests?[\\/]|[\\/]__tests__[\\/]/.test(filePath)) return []
  const excluded = schema.stub_patterns.excluded_dirs || []
  if (excluded.some((d) => filePath.includes(`/${d}/`) || filePath.endsWith(`/${d}`))) return []
  const lines = text.split("\n")
  const findings: { line: number; text: string }[] = []
  for (let i = 0; i < lines.length; i++) {
    for (const re of getStubRegexes(schema)) {
      if (re.test(lines[i])) {
        findings.push({ line: i + 1, text: lines[i].trim() })
        if (findings.length >= cap) return findings
        break
      }
    }
  }
  return findings
}

// ════════════════════════════════════════════════════════════════════
// § 6.5 L5 跨轮保活 (.l5-unresolved.json) — 实施 #6
// ════════════════════════════════════════════════════════════════════

interface L5Item {
  hash: string
  section: string
  content: string
  first_seen: string
  last_seen: string
  count: number
}

// djb2 哈希, 跨平台稳定 (不依赖 crypto)
function djb2(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) & 0xffffffff
  return (h >>> 0).toString(36)
}

function l5ItemHash(section: string, content: string): string {
  return djb2(`${section}::${content}`)
}

function l5UnresolvedPath(shadowDir: string, iter: string): string {
  return join(shadowDir, "iterations", iter, ".l5-unresolved.json")
}

function readL5Unresolved(shadowDir: string, iter: string): L5Item[] {
  const p = l5UnresolvedPath(shadowDir, iter)
  if (!existsSync(p)) return []
  try {
    const data = JSON.parse(readFileSync(p, "utf-8"))
    return Array.isArray(data?.items) ? data.items : []
  } catch {
    return []
  }
}

function writeL5Unresolved(shadowDir: string, iter: string, items: L5Item[]): void {
  const p = l5UnresolvedPath(shadowDir, iter)
  try {
    writeFileSync(p, JSON.stringify({
      iter,
      updated_at: new Date().toISOString(),
      count: items.length,
      items,
    }, null, 2))
  } catch (err) {
    diag({ ev: "l5-unresolved-write-err", err: String(err).slice(0, 200) })
  }
}

// 把当前 L5 跑的 warnings/errors 跟盘上 unresolved merge:
//   - 当前 run 出现的: 续期 (last_seen, count++), 或新增
//   - 当前 run 没出现: 自动消项 (resolved)
function syncL5Unresolved(
  shadowDir: string,
  iter: string,
  current: { section: string; content: string }[],
): L5Item[] {
  const existing = readL5Unresolved(shadowDir, iter)
  const now = new Date().toISOString()
  const currentByHash = new Map<string, { section: string; content: string }>()
  for (const c of current) {
    const h = l5ItemHash(c.section, c.content)
    currentByHash.set(h, c)
  }
  const merged: L5Item[] = []
  // 1) 现有项: 在当前 run 出现 → 续期, 否则丢弃 (resolved)
  for (const item of existing) {
    const cur = currentByHash.get(item.hash)
    if (cur) {
      merged.push({
        ...item,
        last_seen: now,
        count: item.count + 1,
      })
      currentByHash.delete(item.hash)
    }
    // 不在当前 run → 已修复, 丢弃
  }
  // 2) 当前 run 新出现的 → 新增
  for (const [hash, c] of currentByHash) {
    merged.push({
      hash,
      section: c.section,
      content: c.content,
      first_seen: now,
      last_seen: now,
      count: 1,
    })
  }
  merged.sort((a, b) => b.last_seen.localeCompare(a.last_seen))
  writeL5Unresolved(shadowDir, iter, merged)
  return merged
}

// ════════════════════════════════════════════════════════════════════
// § 6.6 Bypass 显式化 (bypass-shdw: 注释 + audit log) — 实施 #3
// ════════════════════════════════════════════════════════════════════

// 匹配: // bypass-shdw: <reason>  / # bypass-shdw: <reason>  / /* bypass-shdw: ... */
// 注释语言: js/ts/py/go/rust/sh 都要 cover
const BYPASS_PATTERN = /(?:^|\s)(?:\/\/|#|\/\*|--)\s*bypass-shdw\s*:\s*([^\n*]+?)\s*(?:\*\/)?\s*$/i
const BYPASS_FILE_EXTS = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|c|cc|cpp|h|hpp|sh|bash|zsh|sql|md|yaml|yml|toml|json|vue|svelte)$/i

function scanBypassInFile(filePath: string): { line: number; reason: string }[] {
  if (!existsSync(filePath)) return []
  if (!BYPASS_FILE_EXTS.test(filePath)) return []
  const text = readFileSync(filePath, "utf-8")
  if (text.length > 524288) return []
  if (text.length < 10) return []
  const lines = text.split("\n")
  const findings: { line: number; reason: string }[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = BYPASS_PATTERN.exec(lines[i])
    if (m && m[1]) {
      findings.push({ line: i + 1, reason: m[1].trim() })
    }
  }
  return findings
}

function scanBypassMarkers(projectRoot: string, sourceDirs: string[]): { file: string; line: number; reason: string }[] {
  const results: { file: string; line: number; reason: string }[] = []
  const skip = /node_modules|\.venv|__pycache__|dist|build|target|\.git|\.shadow/
  const visited = new Set<string>()
  for (const dir of sourceDirs) {
    if (!existsSync(dir)) continue
    const walk = (d: string): void => {
      if (visited.has(d)) return
      visited.add(d)
      let entries: import("fs").Dirent[]
      try {
        entries = readdirSync(d, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (e.name.startsWith(".") && e.name !== ".shadow") continue
        if (skip.test(e.name)) continue
        const p = join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.isFile()) {
          const findings = scanBypassInFile(p)
          for (const f of findings) {
            results.push({ file: p.replace(projectRoot + "/", ""), line: f.line, reason: f.reason })
          }
        }
      }
    }
    walk(dir)
  }
  return results
}

interface BypassLogEntry {
  hash: string
  file: string
  line: number
  reason: string
  first_seen: string
}

function bypassLogPath(shadowDir: string, iter: string): string {
  return join(shadowDir, "iterations", iter, "bypass-log.md")
}

function readBypassLog(shadowDir: string, iter: string): Map<string, BypassLogEntry> {
  const p = bypassLogPath(shadowDir, iter)
  const out = new Map<string, BypassLogEntry>()
  if (!existsSync(p)) return out
  try {
    const text = readFileSync(p, "utf-8")
    let cur: Partial<BypassLogEntry> | null = null
    for (const line of text.split("\n")) {
      const h = /^##\s+([0-9a-z]{6,})\s+\|\s+(.+?):(\d+)\s*$/.exec(line)
      if (h) {
        if (cur?.hash) out.set(cur.hash, cur as BypassLogEntry)
        cur = { hash: h[1], file: h[2], line: parseInt(h[3], 10), reason: "", first_seen: "" }
        continue
      }
      const r = /^- reason:\s*(.+)$/.exec(line)
      if (r && cur) cur.reason = r[1]
      const fs = /^- first_seen:\s*(.+)$/.exec(line)
      if (fs && cur) cur.first_seen = fs[1]
    }
    if (cur?.hash) out.set(cur.hash, cur as BypassLogEntry)
  } catch {}
  return out
}

function appendBypassLog(shadowDir: string, iter: string, newEntries: BypassLogEntry[]): { added: number; total: number } {
  const p = bypassLogPath(shadowDir, iter)
  const existing = readBypassLog(shadowDir, iter)
  const now = new Date().toISOString()
  let added = 0
  let newSection = ""
  for (const e of newEntries) {
    if (existing.has(e.hash)) continue
    existing.set(e.hash, { ...e, first_seen: now })
    newSection += `\n## ${e.hash} | ${e.file}:${e.line}\n- reason: ${e.reason}\n- first_seen: ${now}\n`
    added++
  }
  if (added > 0) {
    const header = `# Bypass Audit Log (iter=${iter})\n# 任何带 \`bypass-shdw: <reason>\` 注释的代码都会被 L5 stop-gate 收录.\n# L6 部署前 user 必须审 (在 status.md 标 \`bypass_reviewed: true\`).\n# 同一处多次出现只记首次 (按 file+line+reason hash 去重).\n`
    let body = ""
    if (existsSync(p)) {
      const cur = readFileSync(p, "utf-8")
      if (!cur.startsWith("# Bypass Audit Log")) {
        body = header + cur + newSection
      } else {
        // 在 header 之后插入新 entries
        const idx = cur.indexOf("\n## ")
        if (idx === -1) {
          body = header + newSection
        } else {
          body = cur.slice(0, idx) + newSection + cur.slice(idx)
        }
      }
    } else {
      body = header + newSection
    }
    try {
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, body)
    } catch (err) {
      diag({ ev: "bypass-log-write-err", err: String(err).slice(0, 200) })
    }
  }
  return { added, total: existing.size }
}

function findSourceDirs(projectRoot: string): string[] {
  const names = ["src", "lib", "app", "backend", "frontend", "server", "internal"]
  const skip = /node_modules|\.venv|__pycache__|dist|build|target/
  const results: string[] = []
  function walk(dir: string, depth: number) {
    if (depth > 4) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (!e.isDirectory() || skip.test(e.name)) continue
      const p = join(dir, e.name)
      if (names.includes(e.name)) results.push(p)
      else walk(p, depth + 1)
    }
  }
  walk(projectRoot, 0)
  return results
}

function scanSourceDirs(
  sourceDirs: string[],
  schema: ShadowSchema,
  cap: number = 25,
): { file: string; line: number; text: string }[] {
  const findings: { file: string; line: number; text: string }[] = []
  function walk(dir: string) {
    if (findings.length >= cap) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (findings.length >= cap) return
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        if (["node_modules", ".venv", "__pycache__", "dist", "build", "target", ".git"].includes(e.name)) continue
        walk(p)
      } else if (e.isFile()) {
        for (const s of scanStubsInFile(p, schema, cap - findings.length)) {
          findings.push({ file: p, line: s.line, text: s.text })
          if (findings.length >= cap) return
        }
      }
    }
  }
  for (const dir of sourceDirs) walk(dir)
  return findings
}

// ════════════════════════════════════════════════════════════════════
// § 7 Lifecycle
// ════════════════════════════════════════════════════════════════════

function templateToGlob(pat: string): string {
  return pat.replace(/\{iter\}|\{slug\}|\{component\}|\{layer\}|\{type\}|\{ts\}/g, "*")
}

function matchGlob(glob: string, target: string): boolean {
  return new RegExp(
    "^" + glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$",
  ).test(target)
}

function lifecycleRoleOf(
  schema: ShadowSchema | null,
  filePath: string,
  projectRoot: string,
): string {
  if (!schema || !schema.lifecycle_artifacts) return "unknown"
  const rel = filePath.startsWith(projectRoot + "/") ? filePath.slice(projectRoot.length + 1) : filePath
  for (const art of schema.lifecycle_artifacts.artifacts) {
    const glob = templateToGlob(art.canonical_path)
    const pat = glob.endsWith("/") ? `${glob}*` : glob
    if (matchGlob(pat, rel)) return art.role
    for (const alias of art.aliases || []) {
      const apat = templateToGlob(alias)
      if (matchGlob(apat.endsWith("/") ? `${apat}*` : apat, rel)) return art.role
    }
  }
  return "unknown"
}

function countRoleFiles(
  schema: ShadowSchema | null,
  projectRoot: string,
  role: string,
): number {
  if (!schema || !schema.lifecycle_artifacts) return 0
  let count = 0
  for (const art of schema.lifecycle_artifacts.artifacts) {
    if (art.role !== role) continue
    if (art.canonical_path.startsWith("skills/")) continue
    const rel = art.canonical_path.replace(/^\.\/+/, "").replace(/^\.shadow\//, "")
    const abs = join(projectRoot, rel)
    if (abs.endsWith("/*")) {
      const dir = abs.slice(0, -2)
      try { if (existsSync(dir)) count += readdirSync(dir).length } catch { /* ignore */ }
    } else {
      try {
        const parent = dirname(abs)
        const nameRe = new RegExp("^" + basename(abs).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, "[^/]*") + "$")
        if (existsSync(parent)) for (const f of readdirSync(parent)) if (nameRe.test(f)) count++
      } catch { /* ignore */ }
    }
  }
  return count
}

// ════════════════════════════════════════════════════════════════════
// § 8 业务逻辑: WO 统计 / 意图 / 压力 / stage 查询
// ════════════════════════════════════════════════════════════════════

function countWoReports(shadowDir: string, iter: string | null): string {
  if (!shadowDir || !iter) return "total=0"
  const woDir = join(shadowDir, "iterations", iter, "work-orders")
  if (!existsSync(woDir)) return "total=0"
  let done = 0, partial = 0, blocked = 0, failed = 0
  function walk(d: string) {
    let entries
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile() && e.name === "report.md" && p.includes("/work-orders/")) {
        try {
          const head = readFileSync(p, "utf-8").split("\n").slice(0, 10).join("\n")
          if (head.includes("🟢") && head.includes("done")) done++
          else if (head.includes("🟡") && head.includes("partial")) partial++
          else if (head.includes("🔴") && head.includes("blocked")) blocked++
          else if (head.includes("❌") && head.includes("failed")) failed++
        } catch { /* ignore */ }
      }
    }
  }
  walk(woDir)
  const total = done + partial + blocked + failed
  return `done=${done} partial=${partial} blocked=${blocked} failed=${failed} total=${total}`
}

function detectIntentPattern(text: string): string | null {
  if (!text) return null
  if (/做一个|开发一个|建一个|搭一个|从零开始|从零搭建|全新开发|新做一个|开发.*系统|开发.*应用|开发.*平台|开发.*服务|搭.*项目|搭.*脚手架|做一个.*系统|做一个.*应用|做一个.*平台|做一个.*网站|做一个.*服务/.test(text)) {
    return "zh-new-build"
  }
  if (/继续|接着|下一步|加个|补个|改一下|修改|调整|重构/.test(text)) return "zh-continue"
  if (/\b(build|create|make|develop|implement|design)\b[^.]*\b(system|app|service|platform|api|backend|frontend|fullstack|full-stack|saas|webapp)\b/i.test(text)) {
    return "en-new-build"
  }
  if (/\bfrom\s+scratch\b|\bnew\s+project\b|\bgreenfield\b|\bmvp\b|\bnew\s+build\b/i.test(text)) return "en-greenfield"
  return null
}

const PRESSURE_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "RUSH",     re: /加快节奏|加快速度|快点|赶紧|赶快|赶时间|赶进度|赶着|hurry|hurrying|hurried|rush|rushing|rushed|asap|as soon as possible|speed up|快一点|快点做/i },
  { name: "TIME",     re: /时间紧|时间不多|时间不够|时间有限|时间紧迫|没时间|没多少时间|deadline|due (in|by|tomorrow|next)|running out of time|out of time|no time left|tight (deadline|schedule)|时间不够用/i },
  { name: "SKIP",     re: /跳过|跳掉|跳过去|省略|省掉|省了|略过|不做了|不做这个|skip|skipping|skipped|omit|omitting|abbreviate|跳过这个|略过这步|省了这一步/i },
  { name: "SIMPLIFY", re: /简化|简单做|草草|随便搞搞|差不多|rough|rough cut|quick and dirty|minimal|just rough|简单来|随便弄/i },
  { name: "WORKLOAD", re: /工作量大|工作量很大|很多活|活多|huge workload|lots of work|many tasks|很多 task|太多 task/i },
]

const _pressureFingerprints = new Set<string>()
const PRESSURE_WINDOW_MS = 30_000

function clearPressureFingerprints(): void { _pressureFingerprints.clear() }

function simpleHash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h).toString(36)
}

function checkPressureSignals(text: string, source: string = "unknown"): string | null {
  if (!text) return null
  const matches: string[] = []
  for (const p of PRESSURE_PATTERNS) if (p.re.test(text)) matches.push(`${p.name}×1`)
  if (matches.length === 0) return null
  const fp = simpleHash(text.slice(0, 80) + matches[0])
  if (_pressureFingerprints.has(fp)) return null
  _pressureFingerprints.add(fp)
  setTimeout(() => _pressureFingerprints.delete(fp), PRESSURE_WINDOW_MS)
  return `🐢  压力信号检测 (source=${source}, 命中 ${matches.length} 类: ${matches.join(" ")})

Walker 3 步硬底线 (写死在 agents/shadow-walker.md):
  1. 不写存根    — pass / TODO / NotImplementedError 都不行
  2. 不用假实现  — InMemoryRepository / mock DB / 硬编码 current_user 都不行
  3. 说了完成就是真完成 — 功能必须跑过 + 有运行证据

5 步节奏 (写死在每个 skill 的 SKILL.md 顶部):
  ① 装 skill 工具
  ② 写 checklist 到 status.md (30-50 行)
  ③ 按工具流程干, 落到预期路径
  ④ 自检 + 标 ✅ DONE
  ⑤ 加载下一 stage

压力下特别容易犯的错:
  ✗  跳过 stage 直接写代码 → pre-skill.sh 硬阻断 (exit 2)
  ✗  跳过 self-check 直接 ✅ → post-write-stub-scan 实时扫存根
  ✗  简化 fixture 用 InMemoryRepository → stub scan 告警
  ✗  用 hardcoded user 假装登录 → stub scan 告警
  ✗  省略 status.md 标记 → 下一 stage 会被 pre-skill 阻断

若时间真的紧, 应该做的是:
  ✓  缩小 scope (砍 feature), 不是砍 quality
  ✓  跳过 L1 Wire (纯后端可省), 不是跳 L1 Spec
  ✓  跳过 33 L3 resilience (S 规模可省), 不是跳 32 e2e
  ✓  标 deferred 写在 status.md 末尾的 "## 变更记录" 段

收到, 继续。🐢`
}

function matchStageQuery(text: string): "current" | "next" | null {
  if (!text) return null
  if (/当前.{0,4}(stage|阶段|状态|在哪)|where am i|what stage|current stage|我在哪|现在在哪/i.test(text)) return "current"
  if (/下一.{0,4}(stage|阶段|步)|next stage|what.{0,3}next|下一步/i.test(text)) return "next"
  return null
}

function answerStageQuery(
  query: "current" | "next",
  shadowDir: string | null,
  iter: string | null,
  statusMd: string | null,
  schema: ShadowSchema | null,
): string {
  if (!schema) return "[shadow] Schema 未加载, 无法回答 stage 状态。"
  if (query === "current") {
    const pending = detectPendingStage(statusMd)
    const doing = detectDoingStage(statusMd)
    const current = pending || doing
    if (!current) return `[shadow] === Stage 状态查询 ===\n[shadow] iter: ${iter || "(无)"}\n[shadow] current: 全部 ✅ DONE`
    const stage = getStageByDisplay(schema, current) || getStageByAlias(schema, current)
    if (!stage) return `[shadow] === Stage 状态查询 ===\n[shadow] iter: ${iter || "(无)"}\n[shadow] current: ${current} (schema 未匹配)`
    return `[shadow] === Stage 状态查询 ===\n[shadow] iter: ${iter || "(无)"}\n[shadow] current: ${stage.display} (skill=${stage.skill})\n[shadow] expected output: ${stage.output_patterns[0] || ""}`
  } else {
    const pending = detectPendingStage(statusMd)
    if (!pending) return `[shadow] === 下一 Stage ===\n[shadow] 没有 pending stage (可能全部 ✅ DONE)`
    const stage = getStageByDisplay(schema, pending) || getStageByAlias(schema, pending)
    if (!stage) return `[shadow] === 下一 Stage ===\n[shadow] 当前 ⏳: ${pending}\n[shadow] 下一 stage: 未知 (schema 未匹配)`
    const nextId = nextStageId(schema, stage.id)
    const next = nextId ? getStageById(schema, nextId) : null
    if (!next) return `[shadow] === 下一 Stage ===\n[shadow] 当前 ⏳: ${pending}\n[shadow] 没有下一 stage (可能 pipeline 末尾)`
    return `[shadow] === 下一 Stage ===\n[shadow] 当前 ⏳: ${pending}\n[shadow] 下一 stage: ${next.display} (skill=${next.skill})`
  }
}

// ════════════════════════════════════════════════════════════════════
// § 9 门禁: P0-Y L0 重做 / P0-Z wire 变体 / 阶段顺序硬阻断
// ════════════════════════════════════════════════════════════════════

function checkL0RedoSoftWarn(shadowDir: string | null, iter: string | null): string | null {
  if (!shadowDir || !iter) return null
  if (!/^iter-([1-9]|[1-9][0-9]+)$/.test(iter)) return null
  const l0Dir = join(shadowDir, "iterations", iter, "L0-research")
  if (!existsSync(l0Dir)) return `L0 调研目录不存在 (期望: ${l0Dir}/)`
  const mdFiles = readdirSync(l0Dir).filter((f) => f.endsWith(".md"))
  if (mdFiles.length === 0) return `L0 调研目录为空 (无 .md 笔记本, 期望: ${l0Dir}/*.md)`
  const cutoff = Date.now() - 14 * 86400 * 1000
  const fresh = mdFiles.some((f) => {
    try { return statSync(join(l0Dir, f)).mtimeMs > cutoff } catch { return false }
  })
  if (!fresh) return `L0 调研 ≥ 14 天未重做 (期望: ${l0Dir}/ 存在 + 有 .md + mtime ≤ 14 天)`
  return null
}

function checkWireSvgVariants(skillName: string, shadowDir: string | null): string | null {
  if (skillName !== "shadow-l1-wire" || !shadowDir) return null
  const wireSvg = join(shadowDir, "L1-business", "wire.svg")
  if (!existsSync(wireSvg)) return null
  const text = readFileSync(wireSvg, "utf-8")
  const pages = new Set<string>()
  const states: string[] = []
  for (const m of text.matchAll(/data-page="([^"]+)"/g)) pages.add(m[1])
  for (const m of text.matchAll(/data-state="([^"]+)"/g)) states.push(m[1])
  const pageCount = pages.size
  const stateCount = states.length
  if (pageCount === 0) return null
  if (stateCount < pageCount * 3) {
    const avg = (stateCount / pageCount).toFixed(1)
    return `期望: ${pageCount} 页 × ≥4 状态变体 = ≥${pageCount * 4} 个 data-state\n` +
      `实际: 仅 ${stateCount} 个 data-state (平均 ${avg}/页, < 3 警戒值)\n` +
      `AI 报错时常说"状态变体可简化" / "主路径 N 页" — 这是偷工减料\n` +
      `处置: 把 normal/loading/empty/error 4 变体补全, 或在 status.md 标 deferred 注明砍了哪些\n` +
      `SKILL.md 约束: 每个页面有 ≥4 个状态变体 (normal/loading/empty/error)`
  }
  return null
}

function enforceStageOrder(
  skillName: string,
  shadowDir: string | null,
  iter: string | null,
  statusMd: string | null,
  schema: ShadowSchema,
): void {
  if (!shadowDir || !iter) return
  const pending = detectPendingStage(statusMd)
  if (!pending) return
  const pendingStage = getStageByDisplay(schema, pending) || getStageByAlias(schema, pending)
  const skillStage = getStageBySkill(schema, skillName)
  if (!pendingStage || !skillStage) return
  if (skillStage.num > pendingStage.num + 1) {
    throw new Error(
      `阶段跳序！当前 ⏳=${pendingStage.display}, 但你试图加载 ${skillName} (${skillStage.display})。按顺序先完成 ${pendingStage.display}。`,
    )
  }
}

// ════════════════════════════════════════════════════════════════════
// § 10 auto-mark DOING / DONE + R3 evidence_archive 检测
// ════════════════════════════════════════════════════════════════════

function autoMarkDoing(
  skillName: string,
  shadowDir: string | null,
  iter: string | null,
  schema: ShadowSchema,
): string | null {
  if (!shadowDir || !iter) return null
  const stage = getStageBySkill(schema, skillName)
  if (!stage) return null
  const statusPath = join(shadowDir, "iterations", iter, "pipeline", "status.md")
  if (!existsSync(statusPath)) return null
  for (const line of readFileSync(statusPath, "utf-8").split("\n")) {
    if (!line.includes(stage.display) || !line.match(/^\|/)) continue
    const status = (line.split("|")[2] || "").trim()
    if (status.includes("⏳")) {
      if (updateStageStatus(statusPath, stage.display, "🔄 DOING")) return `${stage.display}  ⏳ → 🔄 DOING`
    } else if (status.includes("✅")) return `${stage.display} (已 ✅ DONE, 重做 OK, 状态不变)`
    return null
  }
  return null
}

function autoMarkDone(
  filePath: string,
  shadowDir: string | null,
  iter: string | null,
  schema: ShadowSchema,
  projectRoot: string,
): string | null {
  if (!shadowDir || !iter) return null
  const stageId = matchStageByOutput(schema, filePath, projectRoot)
  if (!stageId) return null
  const stage = getStageById(schema, stageId)
  if (!stage) return null
  const statusPath = join(shadowDir, "iterations", iter, "pipeline", "status.md")
  if (!existsSync(statusPath)) return null
  for (const line of readFileSync(statusPath, "utf-8").split("\n")) {
    if (line.includes(stage.display) && line.match(/^\|/)) {
      const status = (line.split("|")[2] || "").trim()
      if (status.includes("⏳") || status.includes("🔄")) {
        if (updateStageStatus(statusPath, stage.display, "✅ DONE")) {
          const next = nextStageSkill(schema, stageId)
          return `${stage.display}  → ✅ DONE${next ? `\n下一 stage skill: ${next}` : ""}`
        }
      }
      return null
    }
  }
  return null
}

function evidenceArchiveWarn(
  schema: ShadowSchema | null,
  filePath: string,
  projectRoot: string,
): string | null {
  if (!schema) return null
  if (lifecycleRoleOf(schema, filePath, projectRoot) !== "evidence_archive") return null
  return `角色: evidence_archive (wander-evidence / chaos-drill-evidence / issues.json)\n` +
    `写入: ${filePath.replace(projectRoot + "/", "")}\n` +
    `提醒: 证据存档默认只读 (R10 iter 冻结时 + chmod 444).\n` +
    `第一次写入仅警告, 不阻断; 多次写入将由 gate-check-lifecycle 渐进 chmod.\n` +
    `若你确认要保留这次写入 (例如 L6 漫游新加截图),\n` +
    `请显式确认: '这个 evidence 写入是有意的' (让 Walker 不会反复警告).`
}

// ════════════════════════════════════════════════════════════════════
// § 11 R5 硬门禁 + L5 漂移 + Lifecycle 漂移
// ════════════════════════════════════════════════════════════════════

function runR5HardGate(gateScriptPath: string): GateResult {
  if (!existsSync(gateScriptPath)) return { ok: false, exitCode: -1, output: "", reason: "script-missing" }
  let stdout = ""
  let code = 0
  try {
    stdout = execSync(`bash "${gateScriptPath}"`, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" })
  } catch (e: any) {
    code = e.status ?? 1
    stdout = (e.stdout ?? "") + (e.stderr ?? "")
  }
  if (code === 0) return { ok: true, exitCode: 0, output: stdout, reason: "pass" }
  if (code === 1) return { ok: false, exitCode: 1, output: stdout, reason: "r5-fail" }
  return { ok: false, exitCode: code, output: stdout, reason: "fatal" }
}

function checkStageDrift(
  schema: ShadowSchema,
  statusMd: string | null,
  projectRoot: string,
): string {
  if (!statusMd) return ""
  const lines: string[] = []
  for (const stage of schema.stages) {
    const display = stage.display
    let curStatus = ""
    for (const line of statusMd.split("\n")) {
      if (line.includes(display) && line.match(/^\|/)) {
        curStatus = (line.split("|")[2] || "").trim()
        break
      }
    }
    let productExists = false
    for (const pat of stage.output_patterns) {
      const dir = pat.replace(/\/[^/]*\*?[^/]*$/, "").replace(/\{slug\}|\{iter\}|\{component\}|\{layer\}|\{type\}|\{ts\}/g, "")
      if (!dir || dir === ".") continue
      const abs = join(projectRoot, dir)
      if (existsSync(abs)) {
        try { if (readdirSync(abs).length > 0) { productExists = true; break } } catch { /* ignore */ }
      }
    }
    if (productExists && (curStatus.includes("⏳") || curStatus.includes("🔄"))) {
      lines.push(`DRIFT: ${display} 产物已存在, 但 status.md 标 '${curStatus}' (应自动标 ✅)`)
    } else if (curStatus.includes("🔄") && !productExists) {
      lines.push(`PENDING: ${display} 标 DOING 但预期产物尚未出现`)
    }
  }
  return lines.join("\n")
}

function checkLifecycleDrift(shadowDir: string | null): string {
  if (!shadowDir) return ""
  const lines: string[] = []
  // .skel files
  const skel: string[] = []
  function walkSkel(d: string) {
    try {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name)
        if (e.isDirectory()) walkSkel(p)
        else if (e.isFile() && e.name.endsWith(".skel")) skel.push(p)
      }
    } catch { /* ignore */ }
  }
  walkSkel(shadowDir)
  if (skel.length > 0) {
    lines.push(`.skel files found (L3-skeleton 已废, 由 harness-plan 替代):`)
    for (const s of skel.slice(0, 10)) lines.push(`  ${s}`)
  }
  // 老 L3 文件名
  const l3Dir = join(shadowDir, "L3-resilience")
  if (existsSync(l3Dir)) {
    const found: string[] = []
    for (const n of ["policies.md", "chaos-experiments.md", "resilience-test-matrix.md"]) {
      const p = join(l3Dir, n)
      if (existsSync(p)) found.push(p)
    }
    if (found.length > 0) {
      lines.push(`Old L3 aliases (canonical = failsafe-design / chaos-scenarios / resilience-test-plan):`)
      for (const f of found) lines.push(`  ${f}`)
    }
  }
  // deploy-report.md alias
  if (existsSync(join(shadowDir, "L6-deploy", "deploy-report.md"))) {
    lines.push(`Found .shadow/L6-deploy/deploy-report.md (alias). Canonical = deployment-report.md`)
  }
  if (existsSync(join(shadowDir, "reviewer"))) {
    lines.push(`Found .shadow/reviewer/ (schema-老路径). Canonical = .shadow/iterations/{iter}/reviews/`)
  }
  // feature-status 位置漂移
  if (existsSync(join(shadowDir, "feature-status"))) {
    lines.push(`Found .shadow/feature-status/ (top-level). Canonical = .shadow/iterations/{iter}/feature-status/{slug}/`)
  }
  const l5Dir = join(shadowDir, "L5-plan")
  if (existsSync(l5Dir)) {
    const fsInL5: string[] = []
    function walkFs(d: string) {
      try {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const p = join(d, e.name)
          if (e.isDirectory()) {
            if (e.name === "feature-status") fsInL5.push(p)
            else walkFs(p)
          }
        }
      } catch { /* ignore */ }
    }
    walkFs(l5Dir)
    if (fsInL5.length > 0) {
      lines.push(`Found L5-plan/{slug}/feature-status/. Canonical = .shadow/iterations/{iter}/feature-status/{slug}/`)
      for (const p of fsInL5) lines.push(`  ${p}`)
    }
  }
  // wire 老路径
  if (existsSync(join(shadowDir, "L1-business", "wireframes"))) {
    lines.push(`Found .shadow/L1-business/wireframes/. Canonical = .shadow/L1-business/wire.svg (项目级单张)`)
  }
  return lines.join("\n")
}

// ════════════════════════════════════════════════════════════════════
// § 12 Toast 通知 (OpenCode 独有: 右上角弹窗, 不污染 TUI 流)
// ════════════════════════════════════════════════════════════════════

const DEBUG = process.env.SHADOW_DEBUG === "1"
const log = (msg: string) => { if (DEBUG) console.log(`[shadow-hook] ${msg}`) }

const DIAG_LOG = "/tmp/shadow-hook.log"
function diag(entry: Record<string, unknown>): void {
  try { appendFileSync(DIAG_LOG, JSON.stringify({ ts: Date.now(), ...entry }) + "\n") } catch { /* ignore */ }
}

// module 顶层 side-effect: 区分"plugin 没被加载" vs "加载了 hook 没触发"
diag({ ev: "module-import", pid: process.pid, argv: process.argv.slice(0, 3) })

// 1500ms 去重: 同 key 短时间内不重复弹
const _toastLast = new Map<string, number>()
const TOAST_DEBOUNCE_MS = 1500

function notify(
  client: unknown,
  variant: "info" | "success" | "warning" | "error",
  title: string,
  message: string,
  duration?: number,
): void {
  const key = `${variant}:${title}`
  const now = Date.now()
  if ((_toastLast.get(key) ?? 0) > now - TOAST_DEBOUNCE_MS) {
    diag({ ev: "notify-skip", variant, title, reason: "debounce" })
    return
  }
  _toastLast.set(key, now)
  if (!client) { diag({ ev: "notify", variant, title, skipped: "client undefined" }); return }
  const c = client as { tui?: { showToast?: (opts: any) => Promise<unknown> } }
  if (!c.tui?.showToast) {
    diag({ ev: "notify", variant, title, skipped: "client.tui.showToast missing" })
    return
  }
  diag({ ev: "notify-call", variant, title })
  c.tui.showToast({
    title, message, variant,
    duration: duration ?? (variant === "error" || variant === "warning" ? 6000 : 3000),
  }).then((res) => diag({ ev: "notify-ok", variant, title, res: typeof res }))
    .catch((err) => diag({ ev: "notify-err", variant, title, err: String(err) }))
}

// ════════════════════════════════════════════════════════════════════
// § 14 session.error 兜底 — 实施 #15
// 模型 API 错误 (e.g., MiniMax `output new_sensitive 1027`) 弹清晰 toast 解释 + 3 步恢复指引
// ════════════════════════════════════════════════════════════════════

interface ApiErrorInfo {
  code: string              // e.g., "1027", "context_overflow"
  category: ApiErrorCategory
  title: string             // 用户友好标题
  reason: string            // 根因 (1 句话)
  recovery: string[]        // 3 步恢复指引
}

type ApiErrorCategory =
  | "content_filter"   // 输出被内容安全过滤 (new_sensitive 1027)
  | "context_overflow" // 上下文超限
  | "rate_limit"       // 限流
  | "auth"             // 鉴权失败
  | "model_unavailable"// 模型服务不可用
  | "unknown"          // 未知

function classifyApiError(rawError: unknown): ApiErrorInfo {
  // 把 payload 摊平找可能的错误信号
  const payload = typeof rawError === "string"
    ? rawError
    : rawError && typeof rawError === "object"
      ? JSON.stringify(rawError)
      : String(rawError)
  const lower = payload.toLowerCase()
  const codeMatch = /\((\d{3,5})\)|["'](\d{3,5})["']|code[:= ]+["']?(\d{3,5})/i.exec(payload)
  const code = codeMatch?.[1] || codeMatch?.[2] || codeMatch?.[3] || "?"

  // 1) 内容过滤 (sensitive / 1027 / filtered)
  if (/(new_?sensitive|content_?filter|content_?policy|safety|filtered.*output)/i.test(payload)
      || code === "1027") {
    return {
      code,
      category: "content_filter",
      title: "Shadow: 模型 API 内容过滤触发",
      reason: "模型输出被 provider 的安全过滤拒绝, 不是 Shadow 框架 bug.",
      recovery: [
        "1) 重发 \"继续\" 让 AI 重新生成, 大概率能过 (transient)",
        "2) 把上一步拆小步 (分多次写文件, 每次写一小段)",
        "3) 改写措辞 — 朴素工程语, 不演示对抗性/安全语境的 payload",
      ],
    }
  }

  // 2) 上下文超限
  if (/(context.{0,20}(overflow|exceeded|length|too long|max)|max.{0,5}token|token.{0,20}limit)/i.test(payload)) {
    return {
      code,
      category: "context_overflow",
      title: "Shadow: 上下文超限",
      reason: "对话历史超过模型 context 窗口, provider 拒绝.",
      recovery: [
        "1) 跑 /compact 压缩对话历史 (OpenCode 内置)",
        "2) 新开 session, 把状态写到 status.md 接力",
        "3) 调小 source code 范围 (e.g., 只 Read 单个文件, 别一次扫全 repo)",
      ],
    }
  }

  // 3) 限流
  if (/(rate.{0,5}limit|too many requests|429|throttl)/i.test(payload)) {
    return {
      code,
      category: "rate_limit",
      title: "Shadow: 模型 API 限流",
      reason: "短时间请求过多, provider 返回 429.",
      recovery: [
        "1) 等 30-60s 重发",
        "2) 切换到备用 provider (e.g., Anthropic ↔ MiniMax)",
        "3) 减少单次请求的 tools 数 (拆消息)",
      ],
    }
  }

  // 4) 鉴权
  if (/(unauthorized|invalid.{0,10}(api|token|key)|401|403|auth.*fail)/i.test(payload)) {
    return {
      code,
      category: "auth",
      title: "Shadow: API 鉴权失败",
      reason: "API key 无效 / 过期 / 配额用完.",
      recovery: [
        "1) 检查 OPENAI_API_KEY / ANTHROPIC_API_KEY / MiniMax token 等环境变量",
        "2) 跑 `claude auth login` 或 `opencode auth` 重新登",
        "3) 检查 provider 账户余额",
      ],
    }
  }

  // 5) 模型不可用
  if (/(model.{0,10}(unavailable|overload|down)|service.{0,10}(unavailable|down)|503|500|502)/i.test(payload)) {
    return {
      code,
      category: "model_unavailable",
      title: "Shadow: 模型服务不可用",
      reason: "Provider 端故障 (5xx), 不是 Shadow 也不是本地问题.",
      recovery: [
        "1) 等 1-2min 重试",
        "2) 切换 provider / 切换模型 (e.g., opus → sonnet)",
        "3) 查看 provider 状态页 (e.g., status.anthropic.com)",
      ],
    }
  }

  // 6) 未知
  return {
    code,
    category: "unknown",
    title: "Shadow: 模型 API error",
    reason: `未知错误, payload=${payload.slice(0, 200)}`,
    recovery: [
      "1) 把 error 完整信息 (含 code) 贴给 walker 帮忙看",
      "2) 重发 \"继续\" 大概率能过 (transient 错)",
      "3) 检查 ~/.local/share/opencode/stderr.log 看 provider 端详情",
    ],
  }
}

function handleSessionError(
  client: unknown,
  props: any,
  diag: (e: Record<string, unknown>) => void,
): void {
  if (!props) return
  // props 形态多变: { error: { message, code, type } } 或 { error: "string" } 或直接 string
  const rawError = props.error ?? props
  const info = classifyApiError(rawError)
  diag({
    ev: "session-error",
    code: info.code,
    category: info.category,
    title: info.title,
    reasonLen: info.reason.length,
  })
  const message = `${info.reason}\n\n恢复:\n${info.recovery.join("\n")}\n\n(error code: ${info.code})`
  const variant = info.category === "content_filter" || info.category === "auth"
    ? "warning"  // 用户可操作 (重发/换词) → warning 而非 error
    : "error"
  notify(client, variant, info.title, message, 12000)
}

function pushSyntheticPart(output: any, text: string): void {
  if (!output.parts) output.parts = []
  output.parts.push({ type: "text", text, synthetic: true } as any)
}

// ════════════════════════════════════════════════════════════════════
// § 13 Plugin 工厂 + 5 个 hook
// ════════════════════════════════════════════════════════════════════

export const ShadowHooksPlugin: Plugin = async (input) => {
  const projectRoot = input.directory
  const client = input.client
  const shadowDir = findShadowDir(projectRoot)
  const meta = isMetaProject(projectRoot)
  const schema = loadShadowSchema()
  const schemaPath = resolveSchemaPath()

  log(`loaded for project=${projectRoot} shadowDir=${shadowDir ?? "(none)"} meta=${meta} schema=${schema ? "v" + schema.shadow_version : "(missing)"}`)
  diag({
    ev: "plugin-load", project: projectRoot, shadowDir: shadowDir ?? null,
    meta, schema: schema ? schema.shadow_version : null, schemaPath,
    clientType: typeof client, hasTui: client ? Boolean((client as any).tui) : null,
  })

  // ────────────────────────────────────────────────────────────
  // P0-7 Meta 旁路
  // 当 CWD 是 cjxdd 仓库本身 (framework 自身) 时, 5 个 hook 都走 bypass 模式:
  //   L1 SessionStart: 跳过 status.md / pipeline 摘要注入 (framework 自身的 status
  //                    是内部状态, 不应混入 AI context)
  //   L2 chat.message: 跳过 "build me X" → walker 引导, 跳过 stage 查询
  //                    (但仍跑压力信号检测 — 跟 framework 质量也相关)
  //   L3 tool.execute.before: 跳过 L0/L1+ 阶段硬阻断, 跳过 auto-mark DOING
  //                          (framework 修改不写 status.md)
  //   L4 tool.execute.after: 跳过 stub scan + auto-mark DONE (同上)
  //   L5 Stop: 跳过 R5/lifecycle 漂移检查 (不适用 framework)
  // 用户在 cjxdd 仓库里通常是想直接改 skills/agents/hooks/plugins 源码.
  // ────────────────────────────────────────────────────────────

  // ────────────────────────────────────────────────────────────
  // L1: experimental.chat.system.transform (SessionStart)
  // 翻译自 session-start.sh + lib.sh:60-668
  // ────────────────────────────────────────────────────────────
  const hook: Hooks = {
    "experimental.chat.system.transform": async (_input, output) => {
      // P0-7 Meta 旁路: 在 cjxdd 仓库自身不注入 status.md 摘要
      if (meta) return
      if (!shadowDir || !schema) return
      const iter = readCurrentIter(shadowDir)
      if (!iter) return
      const status = readStatusMd(shadowDir, iter)
      if (!status) return

      const lines: string[] = []
      lines.push(`# Shadow 上下文`)
      lines.push(`project_root = ${projectRoot}`)
      lines.push(`shadow_dir   = ${shadowDir}`)
      lines.push(`active_iter  = ${iter}`)
      lines.push("")

      const summary = readStatusSummary(status, iter)
      if (summary) lines.push(`pipeline = ${summary}`)

      const breakdown = readBxxBreakdown(status)
      if (breakdown) {
        lines.push("pipeline (per-bizline):")
        lines.push(breakdown)
      }
      lines.push("")

      const woCounts = countWoReports(shadowDir, iter)
      const woTotal = parseInt(woCounts.match(/total=(\d+)/)?.[1] || "0", 10)
      if (woTotal > 0) {
        lines.push(`work_orders: ${woCounts}`)
        lines.push(`(reports in .shadow/iterations/${iter}/work-orders/<WO>/report.md)`)
        lines.push("")
      }

      lines.push(`lifecycle (artifact role distribution, 5 classes from .shadow/shadow-schema.json):`)
      for (const role of ["design_baseline", "process_output", "evidence_archive", "control_marker"] as const) {
        const count = countRoleFiles(schema, projectRoot, role)
        const label = role === "design_baseline" ? "设计基线  "
          : role === "process_output" ? "过程产物  "
          : role === "evidence_archive" ? "证据存档  "
          : "控制标记  "
        lines.push(`  ${label} (${role}): ${count} file(s)`)
      }
      lines.push("")

      const pending = detectPendingStage(status)
      const doing = detectDoingStage(status)
      const current = pending || doing
      if (current) {
        const stage = getStageByDisplay(schema, current) || getStageByAlias(schema, current)
        if (stage) {
          const curSkill = stage.skill
          const curOutput = stage.output_patterns[0] || ""
          const nextId = nextStageId(schema, stage.id)
          const next = nextId ? getStageById(schema, nextId) : null
          const nextSkill = next?.skill || ""
          lines.push(`=== Current Stage ===`)
          lines.push(`stage: ${stage.display}`)
          lines.push(`skill: ${curSkill}`)
          lines.push(`expected output: ${curOutput}`)
          if (nextSkill) lines.push(`next stage skill: ${nextSkill}`)
          lines.push("")
          lines.push(`5-step rhythm (Walker discipline):`)
          lines.push(`  ① 装 skill 工具 (${curSkill})`)
          lines.push(`  ② 写 checklist 到 status.md`)
          lines.push(`  ③ 按 skill 流程干, 落到预期路径`)
          lines.push(`  ④ 自检 + 标 ✅ DONE`)
          if (nextSkill) lines.push(`  ⑤ 加载下一 stage (${nextSkill})`)
          lines.push("")

          // 实施 #15 (事前): 提示 AI 避免触发模型 API 内容过滤
          // ⚠️ 严禁列出具体 trigger 词 — 列出反而 priming, 让 model 更可能用这些词.
          //    教学悖论: 教避开 = 让它记住. 用抽象描述代替.
          lines.push(`=== 内容过滤规避 (实施 #15, 事前防线) ===`)
          lines.push(`provider 的安全过滤 (新触发机制) 可能拒收你的输出, 触发 session.error.`)
          lines.push(`策略:`)
          lines.push(`  - 写朴素的工程措辞, 避免涉及安全/对抗性/恶意语境的词汇 (哪些是"安全语境"具体由 provider 定义)`)
          lines.push(`  - 写示例代码时, 不要演示攻击/注入/绕过的具体 payload — 用抽象描述代替 ("一段输入" 即可)`)
          lines.push(`  - 注释里要避开的, 用阴影/Shadow 自有约定 (bypass-shdw:) 替代, 而不是直接写"绕过"`)
          lines.push(`  - 触发后: 用户看到的 toast 会有 3 步恢复指引, 直接照做`)
          lines.push(`  - 不确定时: 拆小步写, 错了用户说"继续"让 AI 重写`)
          lines.push(``)
          lines.push(`(本段故意不列具体 trigger 词 — 列了反而让 model 记住这些词, 触发率上升. 这是经典的 priming 反效果.)`)
          lines.push("")
        }
      }

      const ctxMap = extractContextMap(status)
      if (ctxMap) {
        lines.push(`context_map (from status.md):`)
        for (const l of ctxMap.split("\n").slice(0, 40)) lines.push(`  ${l}`)
      }

      // 实施 #6: L5 跨轮保活 — 注入 .l5-unresolved.json 内容, 强制 AI 看到未解决警告
      const unresolved = readL5Unresolved(shadowDir, iter)
      // 实施 #16 (no-advisory): halt 优先 — 任何项 count > 3 注入 HALT 信号
      const haltItems = unresolved.filter((it) => it.count > 3)
      if (haltItems.length > 0) {
        lines.push("")
        lines.push(`🛑🛑🛑 HALT (实施 #16 no-advisory) — ${haltItems.length} 项持续 > 3 轮未修复 ╳${"".repeat(3)}`)
        lines.push(`严苛模式: 走 Shadow = 严丝不漏, 没 advisory 灰色地带. 下面这些不是 "warning 你可以忽略",`)
        lines.push(`是连续 3 轮没修掉的 hard fail. 你必须停下, 不要继续埋头改代码.`)
        lines.push("")
        lines.push(`强制处置 (按优先级):`)
        lines.push(`  1) **回退上游 design**: 这条 fail 可能是 spec 写得不合理, 改 spec/arch, 别让代码硬撑`)
        lines.push(`  2) **调 scale 字段**: 写 .shadow/scale.md 把对应字段调到 L 级 (默认已经 L 级, 误报才改)`)
        lines.push(`  3) **走变更令**: 这是 design 跟实现脱节, 不是代码 bug, 走 shadow-walker 重新协调`)
        lines.push(`  4) **写 \`bypass-shdw: <具体原因>\` 注释**: 真要绕过, 必须带 reason 进 audit log`)
        lines.push(``)
        lines.push(`不要做的事: 删 unresolved.json / 改 stub_patterns 配 schema 躲检查 / 装作没看见`)
        lines.push(``)
        for (const item of haltItems.slice(0, 5)) {
          const firstLine = item.content.split("\n")[0].slice(0, 100)
          lines.push(`  • [${item.section}] ${firstLine}  _(×${item.count}, since=${item.first_seen.slice(0, 10)})_`)
        }
        if (haltItems.length > 5) {
          lines.push(`  ... 还有 ${haltItems.length - 5} 项, 查 ${shadowDir}/iterations/${iter}/.l5-halt.json`)
        }
        lines.push("")
        lines.push(`这是 halt, 不是 warning. 停下, 问 user.`)
      }
      if (unresolved.length > 0) {
        lines.push("")
        lines.push(`=== L5 跨轮未解决警告 (实施 #6) — ${unresolved.length} 项, .l5-unresolved.json ===`)
        lines.push(`AI 必须看到这些 (system prompt 强制注入). 处置:`)
        lines.push(`  - 修代码/写产物: 让下次 L5 跑不到这条 → 自动消项 (3 轮还没消 → 进上方 HALT 段)`)
        lines.push(`  - 改 schema: 如果是误报, 修 stub_patterns / lifecycle_role_of`)
        for (const item of unresolved.slice(0, 8)) {
          const firstLine = item.content.split("\n")[0].slice(0, 100)
          const mark = item.count > 3 ? "🛑" : "  •"
          lines.push(`  ${mark} [${item.section}] ${firstLine} _(×${item.count}, first=${item.first_seen.slice(0, 10)})_`)
        }
        if (unresolved.length > 8) {
          lines.push(`  ... 还有 ${unresolved.length - 8} 项, 查 ${shadowDir}/iterations/${iter}/.l5-unresolved.json`)
        }
      }

      // 实施 #3: Bypass audit log 也注入, 跟 unresolved 一起被 AI 看见
      const bypassLog = bypassLogPath(shadowDir, iter)
      if (existsSync(bypassLog)) {
        try {
          const text = readFileSync(bypassLog, "utf-8")
          const entries = (text.match(/^##\s+\S+\s+\|/gm) || []).length
          if (entries > 0) {
            lines.push("")
            lines.push(`=== Bypass Audit Log (实施 #3) — ${entries} 条 \`bypass-shdw:\` 标注 (${shadowDir}/iterations/${iter}/bypass-log.md) ===`)
            lines.push(`AI 显式标记的 "绕过" 段都在这里. L6 部署前 user 必审.`)
            lines.push(`前 ${Math.min(5, entries)} 条:`)
            const entryRe = /^##\s+(\S+)\s+\|\s+(.+?):(\d+)\n- reason:\s*(.+)$/gm
            let m: RegExpExecArray | null
            let shown = 0
            while ((m = entryRe.exec(text)) !== null && shown < 5) {
              lines.push(`  • ${m[2]}:${m[3]} — ${m[4].slice(0, 60)}`)
              shown++
            }
            if (entries > 5) lines.push(`  ... 还有 ${entries - 5} 条`)
          }
        } catch {}
      }

      output.system.push(lines.join("\n"))
    },

    // ────────────────────────────────────────────────────────────
    // L2: chat.message (UserPromptSubmit)
    // 4 段流水线: stage 查询 (短路) → 压力信号 → 意图识别 → 意图路由
    // ────────────────────────────────────────────────────────────
    "chat.message": async (_input, output) => {
      if (!shadowDir || !schema) return
      const text = (output.parts ?? [])
        .filter((p: any) => p.type === "text" && !p.synthetic)
        .map((p: any) => p.text)
        .join("\n")
      if (!text) return
      const iter = readCurrentIter(shadowDir)
      const status = iter ? readStatusMd(shadowDir, iter) : null

      // P0-7 Meta 旁路: 在 cjxdd 仓库自身不触发"build me X" → walker 引导,
      // 也不响应"当前 stage"查询 (framework 自身的 status.md 不是产品项目).
      // 但压力信号仍跑 — 跟 framework 质量也相关.
      if (meta) {
        const pressure = checkPressureSignals(text, "user-prompt")
        if (pressure) {
          pushSyntheticPart(output, pressure)
          diag({ ev: "pressure-detect", source: "user-prompt", meta: true })
        }
        return
      }

      // 1) stage 状态查询 (优先, 短路)
      const query = matchStageQuery(text)
      if (query) {
        pushSyntheticPart(output, answerStageQuery(query, shadowDir, iter, status, schema))
        diag({ ev: "stage-query", query, iter })
        return
      }

      // 2) 压力信号检测 (永远跑)
      const pressure = checkPressureSignals(text, "user-prompt")
      if (pressure) {
        pushSyntheticPart(output, pressure)
        diag({ ev: "pressure-detect", source: "user-prompt" })
      }

      // 3) 意图识别
      const hintKind = detectIntentPattern(text)
      if (!hintKind) return

      // 4) 意图路由
      if (shadowDir) {
        const stage = detectPendingStage(status) || detectDoingStage(status)
        const cur = stage ? `当前阶段: ${stage}` : "全部 ✅ DONE"
        if (hintKind === "zh-new-build" || hintKind === "en-new-build" || hintKind === "en-greenfield") {
          pushSyntheticPart(output,
            `[shadow] 检测到新做意图, 但 .shadow/ 已存在 (iter=${iter}).\n` +
            `[shadow] ${cur}\n` +
            `[shadow] → 若扩展: 加载下一 stage skill (查 status.md 5 步节奏).\n` +
            `[shadow] → 若 "从零重写": 启动新 iter — "shadow walker, start iter-2".`)
        } else if (hintKind === "zh-continue") {
          pushSyntheticPart(output,
            `[shadow] 检测到继续/扩展意图. Walker 在跑 (iter=${iter}).\n` +
            `[shadow] ${cur}\n` +
            `[shadow] → 继续从当前 status.md 阶段推进; 需要时加载下一 skill.`)
        }
      } else if (hintKind === "zh-new-build") {
        pushSyntheticPart(output,
          `[shadow] 检测到"从零开发"意图, 但 .shadow/ 尚未初始化。\n` +
          `[shadow] 建议两步走: 1) 跑 shadow-init 生成骨架; 2) 加载 shadow-walker subagent`)
      } else if (hintKind === "en-new-build" || hintKind === "en-greenfield") {
        pushSyntheticPart(output,
          `[shadow] Detected new-build / greenfield intent, but .shadow/ is not initialized.\n` +
          `[shadow] Recommended two-step: 1) run shadow-init; 2) load shadow-walker subagent.`)
      }
      diag({ ev: "intent-detect", hintKind, hasShadow: Boolean(shadowDir), iter })
    },

    // ────────────────────────────────────────────────────────────
    // L3: tool.execute.before (PreToolUse Skill + Task)
    // ────────────────────────────────────────────────────────────
    "tool.execute.before": async (input, output) => {
      // P0-7 Meta 旁路: 在 cjxdd 仓库自身, 5 步节奏 / 阶段硬阻断 / auto-mark DOING
      // 都不适用. 仅保留 task worker WO 校验 (轻量, 仍然有用).
      // 但若想完全静默, 改成 `if (meta) return`.
      if (meta && input.tool !== "task") return
      // Task 分支: 派 worker 校验 WO
      if (input.tool === "task") {
        const args = (output as any).args ?? {}
        const agentName = String(args.agent ?? args.subagent_type ?? "")
        if (/worker/i.test(agentName)) {
          const prompt = String(args.prompt ?? args.description ?? "")
          const woMatch = prompt.match(/WO-\d+/)
          const woPathMatch = prompt.match(/\.shadow\/iterations\/iter-\d+\/work-orders\/WO-\d+[^\s]*\.md/)
          if (!woMatch && !woPathMatch) {
            notify(client, "warning", "Shadow: WO 缺失",
              `派了 ${agentName} 但 prompt 里没找到 WO-NNN 引用. 建议先写 work order.`)
          } else if (woPathMatch) {
            const woPath = woPathMatch[0]
            if (!existsSync(woPath)) {
              notify(client, "error", "Shadow: WO 不存在",
                `${woMatch?.[0]} 引用了 WO 文件但不存在: ${woPath}`)
            } else {
              notify(client, "info", "Shadow: 派单",
                `派 ${woMatch?.[0]} 给 ${agentName}`, 2500)
            }
          }
        }
        return
      }

      if (input.tool !== "skill" || !shadowDir || !schema) return
      const args = (output as any).args ?? {}
      const skillName = args.name ?? ""
      log(`loading skill: ${skillName}`)
      const iter = readCurrentIter(shadowDir)
      const status = iter ? readStatusMd(shadowDir, iter) : null

      // 1) 压力信号
      const pressure = checkPressureSignals(JSON.stringify(args) + " " + skillName, "tool-args")
      if (pressure) {
        pushSyntheticPart(output, pressure)
        diag({ ev: "pressure-detect", source: "tool-args", skill: skillName })
      }

      // 2) auto-mark DOING
      if (iter) {
        const doingHint = autoMarkDoing(skillName, shadowDir, iter, schema)
        if (doingHint) {
          diag({ ev: "auto-mark-doing", skill: skillName, hint: doingHint })
          pushSyntheticPart(output, `[shadow] → status.md 自动更新: ${doingHint}`)
        }
      }

      // 3) 阶段顺序硬阻断
      try {
        enforceStageOrder(skillName, shadowDir, iter, status, schema)
      } catch (e: any) {
        const errMsg = e?.message || String(e)
        diag({ ev: "stage-order-block", skill: skillName, err: errMsg })
        notify(client, "error", "Shadow: 阶段跳序",
          `当前 ⏳=${detectPendingStage(status) || "(无)"}\n` +
          `你试图加载 ${skillName}\n按顺序先完成当前 ⏳ 阶段`, 8000)
        throw new Error(errMsg)
      }

      // 4) P0-Y L0 重做门禁 (软警告)
      const l0Warn = checkL0RedoSoftWarn(shadowDir, iter)
      if (l0Warn) {
        diag({ ev: "p0y-l0-redo-warn", iter, reason: l0Warn })
        notify(client, "warning", "Shadow: L0 调研过期 (P0-Y Round 1)",
          `原因: ${l0Warn}\n处置: 调 shadow-l0-research skill 重新做调研`, 6000)
      }

      // 5) P0-Z wire.svg 状态变体门禁 (软警告)
      const wireWarn = checkWireSvgVariants(skillName, shadowDir)
      if (wireWarn) {
        diag({ ev: "p0z-wire-warn", skill: skillName, reason: wireWarn })
        notify(client, "warning", "Shadow: wire.svg 状态变体被简化 (P0-Z Round 1)", wireWarn, 8000)
      }

      // 6) 5 步节奏
      const rhythm = [
        `1. 读 SKILL.md 全文 (<500 行)`,
        `2. 读 references/* 中对应文件`,
        `3. 按 SKILL.md 流程一步步做, 不要跳步`,
        `4. 完成后更新 .shadow/iterations/${iter || "iter-N"}/pipeline/status.md`,
        `5. 用 "node-walker-final" commit 类型或类似方式标记阶段完成`,
      ].join("\n")
      notify(client, "info", `Shadow: 5 步节奏 · ${skillName}`, rhythm, 5000)
    },

    // ────────────────────────────────────────────────────────────
    // L4: tool.execute.after (PostToolUse Write/Edit)
    // 5 段: auto-mark DONE → R3 evidence → stub scan
    // ────────────────────────────────────────────────────────────
    "tool.execute.after": async (input, output) => {
      // P0-7 Meta 旁路: 在 cjxdd 仓库自身不扫存根, 不 auto-mark DONE
      // (framework 自身的源码当然有 TODO/NotImplementedError — 那是有意为之的
      //  模板代码, 不是 stub)
      if (meta) return
      if (!["write", "edit", "apply_patch"].includes(input.tool) || !schema) return
      const args = (input as any).args ?? {}
      const filePath = args.filePath ?? args.path ?? args.file ?? ""
      if (!filePath || !existsSync(filePath)) return

      // 1) auto-mark DONE
      if (shadowDir) {
        const iter = readCurrentIter(shadowDir)
        if (iter) {
          const doneHint = autoMarkDone(filePath, shadowDir, iter, schema, projectRoot)
          if (doneHint) {
            diag({ ev: "auto-mark-done", file: filePath, hint: doneHint })
            pushSyntheticPart(output, `[shadow] → status.md 自动更新: ${doneHint}`)
          }
        }
      }

      // 2) R3 evidence_archive 写入检测 (合并 bash 重复块)
      const r3Warn = evidenceArchiveWarn(schema, filePath, projectRoot)
      if (r3Warn) {
        diag({ ev: "r3-evidence-warn", file: filePath })
        notify(client, "warning", "Shadow: R3 evidence_archive 写入", r3Warn, 6000)
      }

      // 3) stub scan
      const stubs = scanStubsInFile(filePath, schema)
      if (stubs.length > 0) {
        const stubList = stubs.map((s) => `  L${s.line}: ${s.text}`).join("\n")
        log(`STUB DETECTED in ${filePath}: ${stubs.length} patterns`)
        diag({ ev: "stub-detect", file: filePath, count: stubs.length })
        notify(client, "warning", "Shadow: 存根警告",
          `${filePath}\n含 ${stubs.length} 处存根模式:\n${stubList}\n` +
          `工藤伦底线: 必须真实实现, 不允许 pass/TODO/NotImplementedError 顶包。`, 6000)
        output.metadata = {
          ...(output.metadata ?? {}),
          shadowStubWarning: true,
          shadowStubCount: stubs.length,
        }
      }
    },

    // ────────────────────────────────────────────────────────────
    // L5: event (Stop / session.idle / session.error)
    // 5 段编排: stub scan → pending → L5 漂移 → lifecycle 漂移 → R5 硬门禁
    // ────────────────────────────────────────────────────────────
    event: async ({ event }: any) => {
      // 实施 #15: session.error 兜底 — 弹清晰 toast 解释 + 3 步恢复指引
      if (event?.type === "session.error") {
        handleSessionError(client, event?.properties, diag)
        return
      }

      if (event?.type !== "message.updated") return
      const info = event?.properties?.info
      if (!info || info.role !== "assistant" || info.finish !== "stop") return
      if (!shadowDir || !schema) return

      // P0-7 Meta 旁路: 在 cjxdd 仓库自身不跑 stop-gate (R5/lifecycle 漂移
      // 检查不适用 framework 自身)
      // 实施 A5 例外: CLI 入口 set _forceRunStopGate=true 时强绕, 真实 OpenCode
      // session 永不动此 flag (event ctx 不会触发 CLI 路径).
      if (meta && !_forceRunStopGate) {
        _toastLast.clear()
        clearPressureFingerprints()
        return
      }

      setTimeout(() => {
        try {
          runStopGate({ projectRoot, shadowDir, schema, client, diag, skipMetaBypass: _forceRunStopGate })
          _toastLast.clear()
          clearPressureFingerprints()
        } catch (err) {
          diag({ ev: "stop-gate-fail", err: String(err) })
          notify(client, "error", "Shadow: 漫游 stop-gate 异常", String(err), 6000)
        }
      }, 100)
    },
  }

  return hook
}

// L5 stop-gate 编排器
// ════════════════════════════════════════════════════════════════════
// § 13 L5 Consistency Audit (跟上游设计一致) — 实施 #14
// ════════════════════════════════════════════════════════════════════

interface ConsistencyRow {
  dimension: "spec" | "wire" | "arch" | "l3"
  designed: number
  implemented: number
  coverage: number  // 0-1
  missing: string[]  // 列出未实现的设计项
  note: string
}

interface ConsistencyReport {
  rows: ConsistencyRow[]
  overallCoverage: number
  // 阈值: 4 维都 ≥ 0.9 才算 PASS; 任一 < 0.9 → hard error
  threshold: number
}

// RXX 提取: 匹配 `R\d+` 短码 (e.g., R05, R12)
const RXX_RE = /\bR(\d{1,3})\b/g
const FMEA_RE = /^#{1,3}\s+(?:F(?:ailure\s*Mode)?\s*)?F?0*(\d{1,3})\b/gm
const IMPL_RE = /@implements\s+([A-Z]{1,3}\d{1,3}(?:\s*[,、]\s*[A-Z]{1,3}\d{1,3})*)/g
// 兜底机制代码痕迹: retry / circuitBreaker / circuit_breaker / fallback / degrade / timeout
const FAILSAFE_RE = /\b(retry|circuitBreaker|circuit_breaker|fallback|degrade|timeout|backoff|bulkhead|rateLimit|throttle|hystrix|resilience4j)\b/i

// 找所有 spec.md (L1)
function findSpecFiles(shadowDir: string): string[] {
  const out: string[] = []
  // 1) per-BXX
  const l1Dir = join(shadowDir, "L1-business")
  if (existsSync(l1Dir)) {
    try {
      for (const e of readdirSync(l1Dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
          const spec = join(l1Dir, e.name, "spec.md")
          if (existsSync(spec)) out.push(spec)
        }
      }
    } catch {}
  }
  // 2) 老路径: L1-business 顶层 spec.md
  const topSpec = join(l1Dir, "spec.md")
  if (existsSync(topSpec) && !out.includes(topSpec)) out.push(topSpec)
  return out
}

function findArchFiles(shadowDir: string): string[] {
  const out: string[] = []
  const archDir = join(shadowDir, "L1.5-architecture")
  if (!existsSync(archDir)) return out
  try {
    // per-BXX architecture.md
    for (const e of readdirSync(archDir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        const arch = join(archDir, e.name, "architecture.md")
        if (existsSync(arch)) out.push(arch)
      }
    }
  } catch {}
  // 单文件 architecture.md
  const top = join(archDir, "architecture.md")
  if (existsSync(top) && !out.includes(top)) out.push(top)
  return out
}

function findFailureModesFiles(shadowDir: string): string[] {
  const out: string[] = []
  const l3Dir = join(shadowDir, "L3-resilience")
  if (!existsSync(l3Dir)) return out
  try {
    for (const e of readdirSync(l3Dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        const f = join(l3Dir, e.name, "failure-modes.md")
        if (existsSync(f)) out.push(f)
      }
    }
  } catch {}
  return out
}

function findWireFiles(shadowDir: string): string[] {
  const out: string[] = []
  const l1Dir = join(shadowDir, "L1-business")
  if (!existsSync(l1Dir)) return out
  // 项目级 wire.svg
  const top = join(l1Dir, "wire.svg")
  if (existsSync(top)) out.push(top)
  // 老路径: wireframes/*.svg
  const wireframesDir = join(l1Dir, "wireframes")
  if (existsSync(wireframesDir)) {
    try {
      for (const e of readdirSync(wireframesDir)) {
        if (e.endsWith(".svg")) out.push(join(wireframesDir, e))
      }
    } catch {}
  }
  return out
}

// 在文本里抽 RXX 短码 (dedup)
function extractRxxIds(text: string): Set<string> {
  const out = new Set<string>()
  // 优先匹配 "RXX-NN" 完整 (per-BXX rule id), 也接受 "RNN" 短码
  const re1 = /\b([A-Z]{1,3}\d{1,3})\b/g
  let m: RegExpExecArray | null
  while ((m = re1.exec(text)) !== null) {
    const id = m[1]
    // 排除明显非 rule id 的 (e.g., FS01 兜底模式, F0N 失败模式, BXX 业务线)
    if (/^FS\d/.test(id)) continue
    if (/^F\d/.test(id)) continue
    if (/^B\d/.test(id)) continue
    // 至少 1 数字
    if (/\d/.test(id)) out.add(id)
  }
  return out
}

function extractFmeaIds(text: string): Set<string> {
  const out = new Set<string>()
  let m: RegExpExecArray | null
  const re = /^#{1,3}\s+(?:F(?:ailure\s*Mode)?\s*)?(F0*\d{1,3})\b/gim
  while ((m = re.exec(text)) !== null) {
    out.add(m[1])
  }
  return out
}

// 走 source dirs 找 @implements 标记
function scanImplements(sourceDirs: string[]): Set<string> {
  const out = new Set<string>()
  if (sourceDirs.length === 0) return out
  const skip = /node_modules|\.venv|__pycache__|dist|build|target|\.git|\.shadow/
  const visited = new Set<string>()
  for (const dir of sourceDirs) {
    if (!existsSync(dir)) continue
    const walk = (d: string): void => {
      if (visited.has(d)) return
      visited.add(d)
      let entries: import("fs").Dirent[]
      try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        if (skip.test(e.name)) continue
        const p = join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.isFile()) {
          // 只扫合理大小的源文件
          if (p.length > 4096) continue
          let text: string
          try {
            const stat = statSync(p)
            if (stat.size > 524288 || stat.size < 10) continue
            text = readFileSync(p, "utf-8")
          } catch { continue }
          let m: RegExpExecArray | null
          const re = /@implements\s+([A-Z]{1,3}\d{1,3}(?:\s*[,、]\s*[A-Z]{1,3}\d{1,3})*)/g
          while ((m = re.exec(text)) !== null) {
            // m[1] 可能是 "R05, R06" 或 "R05-R11" 区间
            const part = m[1]
            for (const id of part.split(/[,、\s]+/)) {
              const trimmed = id.trim()
              if (trimmed) out.add(trimmed)
            }
          }
        }
      }
    }
    walk(dir)
  }
  return out
}

// 走 source dirs 数兜底机制行数 (粗略统计)
function scanFailsafes(sourceDirs: string[]): { retry: number; circuitBreaker: number; fallback: number; timeout: number; total: number } {
  const out = { retry: 0, circuitBreaker: 0, fallback: 0, timeout: 0, total: 0 }
  if (sourceDirs.length === 0) return out
  const skip = /node_modules|\.venv|__pycache__|dist|build|target|\.git|\.shadow/
  const visited = new Set<string>()
  for (const dir of sourceDirs) {
    if (!existsSync(dir)) continue
    const walk = (d: string): void => {
      if (visited.has(d)) return
      visited.add(d)
      let entries: import("fs").Dirent[]
      try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        if (skip.test(e.name)) continue
        const p = join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.isFile()) {
          let text: string
          try {
            const stat = statSync(p)
            if (stat.size > 524288 || stat.size < 10) continue
            text = readFileSync(p, "utf-8")
          } catch { continue }
          // 数每种兜底机制出现次数 (粗略)
          for (const line of text.split("\n")) {
            if (/\bretry\b|@retry/i.test(line)) out.retry++
            else if (/circuit[_-]?breaker/i.test(line)) out.circuitBreaker++
            else if (/\bfallback\b/i.test(line)) out.fallback++
            else if (/\btimeout\b/i.test(line)) out.timeout++
          }
        }
      }
    }
    walk(dir)
  }
  out.total = out.retry + out.circuitBreaker + out.fallback + out.timeout
  return out
}

// 主入口: 跑 4 维一致性审计
function auditL5Consistency(
  projectRoot: string,
  shadowDir: string,
  sourceDirs: string[],
  threshold: number = 0.9,
): ConsistencyReport {
  const rows: ConsistencyRow[] = []
  const implementedSet = scanImplements(sourceDirs)
  const failsafes = scanFailsafes(sourceDirs)

  // 1) spec ↔ code (RXX → @implements)
  const specFiles = findSpecFiles(shadowDir)
  if (specFiles.length > 0) {
    const designedSet = new Set<string>()
    for (const f of specFiles) {
      try {
        for (const id of extractRxxIds(readFileSync(f, "utf-8"))) designedSet.add(id)
      } catch {}
    }
    const designed = designedSet.size
    let implemented = 0
    const missing: string[] = []
    for (const id of designedSet) {
      if (implementedSet.has(id)) implemented++
      else missing.push(id)
    }
    rows.push({
      dimension: "spec",
      designed,
      implemented,
      coverage: designed > 0 ? implemented / designed : 1,
      missing: missing.slice(0, 20),
      note: `${specFiles.length} spec.md, 抽出 ${designed} RXX, @implements 命中 ${implemented}`,
    })
  } else {
    rows.push({
      dimension: "spec",
      designed: 0,
      implemented: 0,
      coverage: 1,
      missing: [],
      note: "(无 .shadow/L1-business/**/spec.md, 跳过)",
    })
  }

  // 2) wire ↔ code (data-page → page component)
  // 简化: 只数 wire.svg 数, 跟 source dirs 里 page component 数对比
  const wireFiles = findWireFiles(shadowDir)
  if (wireFiles.length > 0) {
    let dataPages = 0
    for (const f of wireFiles) {
      try {
        const text = readFileSync(f, "utf-8")
        const matches = text.match(/data-page\s*=\s*["']([^"']+)["']/g)
        if (matches) dataPages += matches.length
      } catch {}
    }
    // 估算实现: 数 src 下含 "page" / "Page" 的文件 (粗略)
    let pageComponents = 0
    const pageRe = /Page|page\./i
    for (const dir of sourceDirs) {
      if (!existsSync(dir)) continue
      try {
        const files = readdirSync(dir, { recursive: true }) as unknown as string[]
        for (const f of files) {
          if (typeof f === "string" && pageRe.test(f)) pageComponents++
        }
      } catch {}
    }
    rows.push({
      dimension: "wire",
      designed: dataPages,
      implemented: pageComponents,
      coverage: dataPages > 0 ? Math.min(1, pageComponents / dataPages) : 1,
      missing: dataPages > pageComponents ? [`${dataPages - pageComponents} 个 data-page 未实现`] : [],
      note: `${wireFiles.length} wire.svg, ${dataPages} data-page, 源码 ~${pageComponents} 个 page 组件 (粗略估计)`,
    })
  } else {
    rows.push({
      dimension: "wire",
      designed: 0,
      implemented: 0,
      coverage: 1,
      missing: [],
      note: "(无 wire.svg, 跳过)",
    })
  }

  // 3) arch ↔ code (API endpoint → route)
  const archFiles = findArchFiles(shadowDir)
  if (archFiles.length > 0) {
    let endpoints = 0
    for (const f of archFiles) {
      try {
        const text = readFileSync(f, "utf-8")
        // 粗略: 数 "GET /xxx" / "POST /xxx" / "PUT /xxx" / "DELETE /xxx" 形式
        const m = text.match(/^\s*(GET|POST|PUT|DELETE|PATCH)\s+\/[\w\-/:{}*]+/gim)
        if (m) endpoints += m.length
      } catch {}
    }
    // 估算实现: 数 src 下含 "router" / "route" / "endpoint" / "@app.route" / "@router." 的行
    let routeRegs = 0
    for (const dir of sourceDirs) {
      if (!existsSync(dir)) continue
      try {
        const files = readdirSync(dir, { recursive: true }) as unknown as string[]
        for (const f of files) {
          if (typeof f !== "string") continue
          if (!/\.(ts|tsx|js|jsx|py|go|rs|java|kt)$/.test(f)) continue
          try {
            const text = readFileSync(f, "utf-8")
            const m = text.match(/@(app|router|route|get|post|put|delete|patch)\s*\(/gi)
            if (m) routeRegs += m.length
          } catch {}
        }
      } catch {}
    }
    rows.push({
      dimension: "arch",
      designed: endpoints,
      implemented: routeRegs,
      coverage: endpoints > 0 ? Math.min(1, routeRegs / endpoints) : 1,
      missing: endpoints > routeRegs ? [`${endpoints - routeRegs} 个 endpoint 未实现`] : [],
      note: `${archFiles.length} architecture.md, ${endpoints} endpoint, 源码 ~${routeRegs} 个 route 注册 (粗略估计)`,
    })
  } else {
    rows.push({
      dimension: "arch",
      designed: 0,
      implemented: 0,
      coverage: 1,
      missing: [],
      note: "(无 architecture.md, 跳过)",
    })
  }

  // 4) l3 ↔ code (failure-modes 跟兜底机制对应)
  const fmeaFiles = findFailureModesFiles(shadowDir)
  if (fmeaFiles.length > 0) {
    const designedSet = new Set<string>()
    for (const f of fmeaFiles) {
      try {
        for (const id of extractFmeaIds(readFileSync(f, "utf-8"))) designedSet.add(id)
      } catch {}
    }
    const designed = designedSet.size
    // 兜底机制实现估算: 4 种机制总行数 (粗略)
    // 经验值: 1 个失败模式至少 1 个兜底机制, 所以阈值 = designed
    const implemented = failsafes.total
    const coverage = designed > 0 ? Math.min(1, implemented / designed) : 1
    rows.push({
      dimension: "l3",
      designed,
      implemented,
      coverage,
      missing: designed > implemented ? [`${designed - implemented} 个失败模式缺兜底机制 (retry=${failsafes.retry}, cb=${failsafes.circuitBreaker}, fallback=${failsafes.fallback}, timeout=${failsafes.timeout})`] : [],
      note: `${fmeaFiles.length} failure-modes.md, ${designed} 失败模式, 兜底机制行数=${failsafes.total} (retry=${failsafes.retry}, cb=${failsafes.circuitBreaker}, fallback=${failsafes.fallback}, timeout=${failsafes.timeout})`,
    })
  } else {
    rows.push({
      dimension: "l3",
      designed: 0,
      implemented: 0,
      coverage: 1,
      missing: [],
      note: "(无 failure-modes.md, 跳过)",
    })
  }

  // overall: 4 维几何平均
  const validRows = rows.filter((r) => r.designed > 0)
  const overallCoverage = validRows.length > 0
    ? validRows.reduce((s, r) => s + r.coverage, 0) / validRows.length
    : 1

  return { rows, overallCoverage, threshold }
}

export function runStopGate(opts: {
  projectRoot: string
  shadowDir: string
  schema: ShadowSchema
  client: unknown
  diag: (e: Record<string, unknown>) => void
  skipMetaBypass?: boolean
}): { errors: number; warnings: number; sections: number; unresolved: number; halt: number } {
  const { projectRoot, shadowDir, schema, client, diag } = opts
  const iter = readCurrentIter(shadowDir)
  const status = iter ? readStatusMd(shadowDir, iter) : null
  const sections: string[] = []
  const errors: string[] = []
  const warnings: string[] = []
  // 实施 #6: 把每条 warning/error 跟 section 名一起记, 用于 .l5-unresolved.json 跨轮保活
  const tracked: { section: string; content: string; level: "warn" | "error" }[] = []

  // 1) stub scan
  const sourceDirs = findSourceDirs(projectRoot)
  if (sourceDirs.length > 0) {
    const stubs = scanSourceDirs(sourceDirs, schema, 25)
    if (stubs.length > 0) {
      const listed = stubs.slice(0, 15).map((s) => `  ⚠️  ${s.file}:${s.line}: ${s.text}`).join("\n")
      const more = stubs.length > 15 ? `\n  ... 还有 ${stubs.length - 15} 处` : ""
      // 实施 #16 (no-advisory): stub scan 升级 hard — 工藤伦底线, 没灰色地带
      const msg = `存根扫描 (源目录) — ${stubs.length} 处:\n${listed}${more}`
      errors.push(msg)
      tracked.push({ section: "stub-scan", content: msg, level: "error" })
    } else {
      sections.push(`✓ 存根扫描 (源目录): clean`)
    }
  } else {
    sections.push(`(无 src/lib/app/backend/frontend/server/internal 源码目录, 跳过存根扫描)`)
  }

  // 1.5) Bypass 显式化 — 实施 #3: 扫 bypass-shdw: 注释, 写 audit log
  // 保持 informational (它是 audit log, 不是 violation). 严苛 ≠ 阻 audit, 严苛 = 违规必 hard.
  if (sourceDirs.length > 0) {
    const markers = scanBypassMarkers(projectRoot, sourceDirs)
    if (markers.length > 0) {
      const listed = markers.slice(0, 10).map((m) => `  🔓 ${m.file}:${m.line} → ${m.reason}`).join("\n")
      const more = markers.length > 10 ? `\n  ... 还有 ${markers.length - 10} 处` : ""
      sections.push(`🔓 Bypass 显式标注: ${markers.length} 处 (audit log: bypass-log.md)\n${listed}${more}`)
      const newEntries: BypassLogEntry[] = markers.map((m) => ({
        hash: djb2(`${m.file}::${m.line}::${m.reason}`),
        file: m.file,
        line: m.line,
        reason: m.reason,
        first_seen: "",
      }))
      if (iter) {
        const { added, total } = appendBypassLog(shadowDir, iter, newEntries)
        if (added > 0) {
          sections.push(`  → 新增 ${added} 条到 bypass-log.md (累计 ${total} 条, L6 部署前 user 必审)`)
        }
      }
    } else {
      sections.push(`✓ Bypass 显式标注: 无 (零主动绕过)`)
    }
  }

  // 2) pending stages — 实施 #16 (no-advisory): hard
  if (status) {
    const bxxPending = readPendingByBxx(status)
    if (bxxPending) {
      const msg = `Pipeline 未完成 (按 BXX 分组):\n${bxxPending}`
      errors.push(msg)
      tracked.push({ section: "pending-stages", content: msg, level: "error" })
    } else {
      const flat: string[] = []
      for (const line of status.split("\n")) {
        if (!line.match(/^\|\s*L\d/)) continue
        const stage = (line.split("|")[1] || "").trim()
        const s = (line.split("|")[2] || "").trim()
        if (s.includes("⏳") || s.includes("🔄")) flat.push(stage)
      }
      if (flat.length > 0) {
        const msg = `Pipeline 未完成 (flat):\n${flat.map((s) => `  - ${s}`).join("\n")}`
        errors.push(msg)
        tracked.push({ section: "pending-stages-flat", content: msg, level: "error" })
      } else sections.push(`✓ Pipeline 全部 ✅`)
    }
  }

  // 3) L5 漂移检查 — 实施 #16 (no-advisory): hard
  if (status) {
    const drift = checkStageDrift(schema, status, projectRoot)
    if (drift) {
      const msg = `L5 Stage Drift:\n${drift.split("\n").map((l) => `  ${l}`).join("\n")}`
      errors.push(msg)
      tracked.push({ section: "stage-drift", content: msg, level: "error" })
    } else sections.push(`✓ L5 漂移检查: status.md 与产物状态一致`)
  }

  // 4) Lifecycle 漂移 — 实施 #16 (no-advisory): hard
  const lifecycle = checkLifecycleDrift(shadowDir)
  if (lifecycle) {
    const msg = `Lifecycle 漂移:\n${lifecycle.split("\n").map((l) => `  ${l}`).join("\n")}`
    errors.push(msg)
    tracked.push({ section: "lifecycle-drift", content: msg, level: "error" })
  } else sections.push(`✓ Lifecycle 漂移: 无`)

  // 5) R5 硬门禁 — 实施 #16 (no-advisory): R5 跳过也升 hard
  // 走 Shadow = 严丝不漏, R5 是核心关卡. 脚本不在 = framework setup 缺, 也是 hard fail.
  const gateScript = resolveGateScriptPath()
  if (existsSync(gateScript)) {
    const r5 = runR5HardGate(gateScript)
    if (r5.reason === "pass") sections.push(`✓ R5 硬门禁: 通过`)
    else if (r5.reason === "r5-fail") {
      const tail = r5.output.split("\n").slice(-30).join("\n")
      const msg = `R5 硬门禁失败:\n${tail}`
      errors.push(msg)
      tracked.push({ section: "r5-hard-gate", content: msg, level: "error" })
    } else if (r5.reason === "fatal") {
      const msg = `R5 内部错误 (exit=${r5.exitCode}):\n${r5.output.slice(-200)}`
      errors.push(msg)
      tracked.push({ section: "r5-internal", content: msg, level: "error" })
    } else {
      // "script-missing" 之类的非 pass/fail/fatal — 实施 #16 升 hard
      const msg = `R5 跳过: gate-check-lifecycle.sh 跑了但状态未知 (reason=${r5.reason})`
      errors.push(msg)
      tracked.push({ section: "r5-skip", content: msg, level: "error" })
    }
  } else {
    // 实施 #16 升 hard: 脚本不在 = framework 没装好, 不该静默跳过
    const msg = `R5 跳过: gate-check-lifecycle.sh 不存在 (${gateScript}). 检查 framework 安装.`
    errors.push(msg)
    tracked.push({ section: "r5-missing-script", content: msg, level: "error" })
  }

  // 5.5) L5 Consistency Audit (跟上游设计一致) — 实施 #14
  // 4 维: spec↔code (RXX→@implements) / wire↔code (data-page→component) /
  //       arch↔code (endpoint→route) / l3↔code (FMEA→兜底机制)
  // 阈值: 任一维 coverage < 0.9 → hard error (L5-impl 偷工)
  if (sourceDirs.length > 0) {
    const audit = auditL5Consistency(projectRoot, shadowDir, sourceDirs, 0.9)
    const auditedRows = audit.rows.filter((r) => r.designed > 0)
    if (auditedRows.length > 0) {
      const summary = auditedRows.map((r) => {
        const pct = (r.coverage * 100).toFixed(0)
        const mark = r.coverage >= audit.threshold ? "✓" : "✗"
        return `  ${mark} ${r.dimension}: ${r.implemented}/${r.designed} = ${pct}% — ${r.note}`
      }).join("\n")
      const overallPct = (audit.overallCoverage * 100).toFixed(0)
      const failing = auditedRows.filter((r) => r.coverage < audit.threshold)
      if (failing.length > 0) {
        const detail = failing.map((r) => {
          const missingStr = r.missing.length > 0 ? `\n    缺: ${r.missing.join(", ")}` : ""
          return `  ✗ ${r.dimension} coverage ${(r.coverage * 100).toFixed(0)}% < ${audit.threshold * 100}%${{
            "spec": " (RXX 没 @implements 标记, L5-impl 偷工)",
            "wire": " (data-page 没对应 page 组件)",
            "arch": " (architecture endpoint 没 route 注册)",
            "l3": " (failure-mode 缺兜底机制, 韧性设计走过场)",
          }[r.dimension]}${missingStr}`
        }).join("\n")
        const msg = `L5 Consistency Audit 失败 (overall ${overallPct}%, threshold ${audit.threshold * 100}%):\n${detail}\n\nL5-impl 跟上游设计不一致, 必须补齐后才能标 iter 完成.\n修复指引:\n${failing.map((r) => `  - ${r.dimension}: 加 @implements 标记 / data-page 组件 / route 注册 / retry-cb-fallback 机制`).join("\n")}`
        errors.push(msg)
        tracked.push({ section: "l5-consistency-audit", content: msg, level: "error" })
      } else {
        sections.push(`✓ L5 Consistency Audit: ${auditedRows.length} 维全过 (overall ${overallPct}%)`)
      }
    } else {
      sections.push(`(L5 Consistency Audit: 无上游设计产物, 跳过 — 项目可能还在 L0/L1 阶段)`)
    }
  }

  // 实施 #6: 跨轮保活 — 把当前 run 的 tracked warnings/errors 跟盘上 unresolved merge
  // 实施 #16 (no-advisory): 3 试 halt — 任何 unresolved 项 count > 3 升级为 halt, 注入 L1 system 提示 AI 停下
  const HALT_THRESHOLD = 3
  let unresolvedCount = 0
  let haltItems: L5Item[] = []
  if (iter) {
    const merged = syncL5Unresolved(shadowDir, iter, tracked)
    unresolvedCount = merged.length
    haltItems = merged.filter((it) => it.count > HALT_THRESHOLD)
    if (haltItems.length > 0) {
      // 写 halt 标记文件 (control_marker), 供 L1 system transform 读
      const haltPath = join(shadowDir, "iterations", iter, ".l5-halt.json")
      try {
        writeFileSync(haltPath, JSON.stringify({
          iter,
          updated_at: new Date().toISOString(),
          count: haltItems.length,
          threshold: HALT_THRESHOLD,
          items: haltItems.map((it) => ({
            hash: it.hash,
            section: it.section,
            content: it.content.split("\n")[0].slice(0, 200),
            count: it.count,
            first_seen: it.first_seen,
            last_seen: it.last_seen,
          })),
        }, null, 2))
      } catch (err) {
        diag({ ev: "halt-write-err", err: String(err).slice(0, 200) })
      }
    }
  }

  diag({
    ev: "stop-gate-result",
    iter,
    sections: sections.length,
    warnings: warnings.length,
    errors: errors.length,
    unresolved: unresolvedCount,
    halt: haltItems.length,
  })

  const summaryLines: string[] = [`iter=${iter || "(无)"}`, ...sections]
  if (unresolvedCount > 0) {
    summaryLines.push(`\n─── 跨轮未解决 (L5 跨轮保活, .l5-unresolved.json) — ${unresolvedCount} 项 ───`)
  }
  if (haltItems.length > 0) {
    summaryLines.push(
      "",
      `🛑 3 试 HALT 触发 (实施 #16 no-advisory) — ${haltItems.length} 项持续 > ${HALT_THRESHOLD} 轮未修复:`,
      ...haltItems.map((it) => `  • [${it.section}] (×${it.count}) ${it.content.split("\n")[0].slice(0, 120)}`),
      "",
      'AI 必须停下, 跟 user 同步: 这条不是 "修修补补能过的 advisory warning",',
      "是连续 3 轮没修掉的 hard fail. 处置: 改 design / 改 scale / 走变更令, 别再死磕.",
    )
  }
  if (warnings.length > 0) {
    summaryLines.push("", "─── 警告 ───", ...warnings)
  }
  if (errors.length > 0) {
    summaryLines.push("", "─── 错误 ───", ...errors)
  }
  const summary = summaryLines.join("\n")
  // toast 调度: 实施 #16 — 没了 warning 灰色地带, 全是 error (12s 红) 或 success (3s 绿)
  const baseTitle = errors.length > 0
    ? `Shadow: 漫游 stop-gate · ${errors.length} 错误`
    : "Shadow: 漫游 stop-gate"
  const titleSuffix = unresolvedCount > 0 ? ` · ${unresolvedCount} 项跨轮未解决` : ""
  // 3 试 halt 优先级最高 — error 弹窗 + 强制 AI 看
  if (haltItems.length > 0) {
    notify(client, "error",
      `🛑 Shadow: 3 试 HALT · ${haltItems.length} 项持续未修复`,
      summary, 15000)
  } else if (errors.length > 0) {
    notify(client, "error", baseTitle + titleSuffix, summary, 12000)
  } else if (warnings.length > 0) {
    // 实施 #16: warnings 不会从 L5 5 段里产生 (已全 hard). 但保留这分支以备未来扩展.
    notify(client, "warning", baseTitle + titleSuffix, summary, 8000)
  } else {
    notify(client, "success", baseTitle, summary + (unresolvedCount > 0 ? `\n(${unresolvedCount} 项跨轮保活中)` : ""), 3000)
  }

  // 返回摘要 (CLI 用)
  return { errors: errors.length, warnings: warnings.length, sections: sections.length, unresolved: unresolvedCount, halt: haltItems.length }
}

// ════════════════════════════════════════════════════════════════════
// 实施 A5: stop-gate CLI 入口
// 用法: bun plugins/shadow-hooks.ts --run-stop-gate --project-root <dir> [--iter N]
// 强绕 Meta 旁路 (在 cjxdd 自身 / 任何 cwd 都能跑), 把 5 段 + 5.5 段 + 5.6+ 段
// 全部输出到 stdout. 让用户/AI 能直接验证硬门禁真 fire, 不必切到 demo session.
// ════════════════════════════════════════════════════════════════════

function runStopGateCli(): number {
  const args = process.argv.slice(2)
  if (!args.includes("--run-stop-gate")) return -1
  const argVal = (flag: string, dflt?: string): string | undefined => {
    const i = args.indexOf(flag)
    if (i < 0) return dflt
    return args[i + 1]
  }

  const projectRoot = argVal("--project-root", process.cwd())!
  const iterOverride = argVal("--iter")
  const schemaPath = argVal("--schema")

  // 1. 强制强绕 Meta 旁路 (关键)
  _forceRunStopGate = true

  // 2. 找 .shadow 目录
  const shadowDir = findShadowDir(projectRoot) ?? join(projectRoot, ".shadow")

  // 3. 装 schema (允许 CLI 临时指定, e.g. --schema ./skills/shadow-init/templates/shadow-schema.json)
  if (schemaPath) {
    _schemaCache = null
    _schemaPath = schemaPath
    process.env.SHADOW_SCHEMA = schemaPath
  }
  const schema = loadShadowSchema()
  if (!schema) {
    console.error(`[cli] 无法装 schema (path=${_schemaPath || "(默认)"})`)
    return 2
  }

  // 4. 写 stderr 的简易 diag
  const cliDiag = (e: Record<string, unknown>) => {
    process.stderr.write(`[diag] ${JSON.stringify(e)}\n`)
  }

  // 5. 假 client (把 toast 落 stdout)
  const cliClient = {
    tui: {
      showToast: (t: { title: string; message: string; variant: string; duration?: number }) => {
        const icon = t.variant === "error" ? "❌" : t.variant === "warning" ? "⚠️" : t.variant === "success" ? "✅" : "ℹ️"
        process.stdout.write(`${icon} [${(t.variant || "info").toUpperCase()}] ${t.title}\n`)
        if (t.message) process.stdout.write(`${t.message}\n`)
        process.stdout.write("\n")
        return Promise.resolve()
      },
    },
  }

  // 6. iter 覆盖 (status.md 走 readStatusMd 内部读 iter 目录, 但 iter 决定读哪段 status)
  //    如果 --iter 指定, 把 current-iteration 临时指向它 (写完恢复)
  const curIterFile = join(shadowDir, "current-iteration")
  let origIter: string | null = null
  if (iterOverride) {
    try {
      origIter = existsSync(curIterFile) ? readFileSync(curIterFile, "utf-8").trim() : null
      writeFileSync(curIterFile, iterOverride)
    } catch (err) {
      console.error(`[cli] 写 current-iteration 失败: ${err}`)
      return 3
    }
  }

  let result: { errors: number; warnings: number; sections: number; unresolved: number; halt: number } | null = null
  try {
    result = runStopGate({
      projectRoot, shadowDir, schema,
      client: cliClient, diag: cliDiag,
      skipMetaBypass: true,
    })
  } catch (err) {
    console.error(`[cli] runStopGate 异常: ${err}`)
    return 1
  } finally {
    // 恢复 current-iteration
    if (iterOverride) {
      try {
        if (origIter !== null) writeFileSync(curIterFile, origIter)
        else if (existsSync(curIterFile)) unlinkSync(curIterFile)
      } catch {}
    }
  }

  // 退出码映射:
  //   0 = clean / 仅有 success toast
  //   1 = errors > 0 (red toast, 必出)
  //   4 = HALT (更严重, 跟 errors 分开标记)
  if (result && result.halt > 0) return 4
  if (result && result.errors > 0) return 1
  return 0

  return 0
}

// CLI 入口 (Bun 跑 shadow-hooks.ts 时 main module 自身执行; OpenCode 加载时
// input.client 等存在, 走 plugin factory 路径, 不走 main 分支).
if (process.argv[1]?.endsWith("shadow-hooks.ts") || process.argv[1]?.endsWith("shadow-hooks")) {
  const ec = runStopGateCli()
  if (ec >= 0) process.exit(ec)
}

export default ShadowHooksPlugin
