// plugins/goal-mode.tsx — Shadow Goal 模式 (OpenCode TUI plugin)
// 用户在 input 直接输 /cjgoal {目标} 回车, plugin 监听 message.part.updated 抓 user text,
// 匹配 /^\/cjgoal .../ 前缀, 剥出 goal, 写盘 + 监听 session.idle 评估, 最多 10 轮.
// 目标输入: inline (不弹 Dialog 收目标, 避免双输入).
// 过程信息: 走 api.ui.toast (右上角非模态弹窗), 不污染 chat 文本流.
// AI 把 /cjgoal {text} 当普通 user message 看到并执行 (TUI chat 流会显示 AI 的回复, 这是 OpenCode 架构).
// Claude Code 端等价 slash command 见 commands/cjgoal.md (prompt-based, 简化版).
//
// 多 session 隔离: 每个 session 独立目录 .shadow/goal-runs/{sessionID}/, 包含 diag.log / current.json / {runId}/goal.md.
// 不同 session 可并发跑 /cjgoal 不冲突; 同 session 同时只允许一个活跃 run.
//
// 关键 fix (v2): 解析项目根用 api.state.path.directory, 不是 worktree. worktree 在非 git 项目下是 "/",
// 会导致 shadowDir = "/.shadow" 不存在 → plugin 早退, /cjgoal 静默失效.
/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { existsSync, mkdirSync, writeFileSync, unlinkSync, appendFileSync } from "fs"
import { join, dirname } from "path"

// Boot diag: 写到 stderr (OpenCode 会捕获到 stderr.log)
const bootLog = (msg: string): void => {
  try { process.stderr.write(`[shadow-goal] ${msg}\n`) } catch {}
}
bootLog(`module-import pid=${process.pid}`)

const MAX_ITER = 10
const GOAL_PREFIX = /^\/cjgoal(?:@[\w-]+)?\s+(.+)/i

// diag log 路径: 延迟到 plugin load 时确定 (per-session).
// plugin load 之前 (module-import) 调 diag 是 silent.
let _diagPath: string | null = null
const diag = (e: Record<string, unknown>): void => {
  if (!_diagPath) return
  try {
    appendFileSync(_diagPath, JSON.stringify({ ts: Date.now(), ...e }) + "\n")
  } catch {}
}

// Promise timeout: 超时返回 fallback, 避免 evaluator 卡死
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T, ev: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => {
      diag({ ev: `${ev}-timeout`, ms })
      resolve(fallback)
    }, ms)),
  ])
}

interface Run {
  runId: string
  goal: string
  sessionID: string
  iter: number
  runDir: string
  sessionDir: string
}

const makeRunId = (): string => {
  const d = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)
  const h = Math.random().toString(36).slice(2, 8)
  return `goal-${d}-${h}`
}

// 解析项目根: 优先用 api.state.path.directory (实际项目目录, OpenCode 启动时的工作目录),
// 回退到 worktree (git worktree 路径, 非 git 仓库时为 /), 最后 process.cwd().
function resolveProjectRoot(api: TuiPluginApi): string {
  const p = api.state.path
  return p.directory || p.worktree || process.cwd()
}

// per-session 目录: .shadow/goal-runs/{sessionID}/
function sessionDir(shadowDir: string, sessionID: string): string {
  return join(shadowDir, "goal-runs", sessionID)
}

// per-session current state: {sessionDir}/current.json
function statePath(sessionDirPath: string): string {
  return join(sessionDirPath, "current.json")
}

// 持久化 / 恢复 run 状态 (per-session)
function saveRunState(sDir: string, run: Run | null): void {
  const p = statePath(sDir)
  if (!run) {
    try { unlinkSync(p) } catch {}
    return
  }
  try {
    mkdirSync(sDir, { recursive: true })
    writeFileSync(p, JSON.stringify({
      runId: run.runId, goal: run.goal, sessionID: run.sessionID,
      iter: run.iter, updatedAt: Date.now(),
    }, null, 2))
  } catch (err) {
    diag({ ev: "save-state-err", err: String(err) })
  }
}

function loadRunState(sDir: string): { runId: string; goal: string; sessionID: string; iter: number } | null {
  const p = statePath(sDir)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(require("fs").readFileSync(p, "utf-8"))
  } catch {
    return null
  }
}

// 过程 info/warning 走 TUI toast, 不进 chat 文本流.
function toast(
  api: TuiPluginApi,
  variant: "info" | "success" | "warning" | "error",
  title: string,
  message: string,
  duration?: number,
): void {
  try {
    api.ui.toast({
      variant,
      title,
      message,
      duration: duration ?? (variant === "error" ? 8000 : 4000),
    })
  } catch (err) {
    diag({ ev: "toast-err", variant, title, err: String(err) })
  }
}

const plugin: TuiPlugin = async (api) => {
  bootLog("tui called")
  const root = resolveProjectRoot(api)
  const shadowDir = join(root, ".shadow")
  const hasShadow = existsSync(shadowDir)
  if (!hasShadow) {
    bootLog(`no shadow dir at ${shadowDir} (root=${root}); /cjgoal 会提示先跑 shadow-init`)
  } else {
    bootLog(`shadow dir OK at ${shadowDir}`)
  }

  let run: Run | null = null
  let evaluating = false   // re-entrancy guard: 防止 session.idle 多次 fire 并发跑评估
  const seenParts = new Set<string>()

  // ---- /cjgoal slash command: 让 OpenCode input 输 /cjgoal 时有补全 ----
  api.command?.register(() => [{
    title: "/cjgoal {目标}",
    value: "shadow.cjgoal.start",
    description: "选 /cjgoal + 回车 = 补全到 input, 再输目标文字 + 回车 = 启动",
    category: "Shadow",
    slash: { name: "cjgoal", aliases: ["cj", "g"] },
    onSelect: () => {
      try {
        api.client.tui.appendPrompt({ text: "/cjgoal " })
      } catch (err) {
        diag({ ev: "append-prompt-err", err: String(err) })
      }
    },
  }])

  // ---- helper: 拿到 sessionID 后初始化 per-session diag + 尝试恢复 run ----
  function initSession(sessionID: string): string {
    const sDir = sessionDir(shadowDir, sessionID)
    mkdirSync(sDir, { recursive: true })
    _diagPath = join(sDir, "diag.log")
    return sDir
  }

  // ---- message.part.updated 监听: 抓 user message 中 /cjgoal {text} ----
  api.event.on("message.part.updated", async (event) => {
    const props = (event as any).properties
    if (!props) return
    const part = props.part
    // sessionID 来自 part.sessionID (不在 properties 顶层!)
    const sessionID = part?.sessionID as string | undefined
    if (!part || part.type !== "text" || !part.text || !sessionID) return
    if (part.synthetic || part.ignored) return
    const partId = `${part.messageID}:${part.id}`
    if (seenParts.has(partId)) return
    const m = GOAL_PREFIX.exec(part.text)
    if (!m) return
    const goal = m[1].trim()
    if (!goal) return
    seenParts.add(partId)

    if (run) {
      diag({ ev: "skip", reason: "active-run-exists", runId: run.runId, sessionID })
      return
    }

    if (!hasShadow) {
      diag({ ev: "skip", reason: "no-shadow-dir", root, sessionID })
      toast(api, "warning", "Goal ⚠", "项目无 .shadow/ 目录. 请先跑 shadow-init 初始化.", 6000)
      return
    }

    // 初始化 per-session 目录
    const sDir = initSession(sessionID)
    const saved = loadRunState(sDir)
    if (saved && saved.iter < MAX_ITER) {
      run = { ...saved, runDir: join(sDir, saved.runId), sessionDir: sDir }
      diag({ ev: "restore", runId: run.runId, iter: run.iter, sessionID })
      toast(api, "info", "Goal ↻", `恢复 run ${run.runId.slice(-6)} iter ${run.iter}`, 3000)
      return
    }

    const runId = makeRunId()
    const runDir = join(sDir, runId)
    mkdirSync(runDir, { recursive: true })
    writeFileSync(join(runDir, "goal.md"), `# Goal\n\n${goal}\n\n_created: ${new Date().toISOString()}_\n`)
    run = { runId, goal, sessionID, iter: 0, runDir, sessionDir: sDir }
    saveRunState(sDir, run)
    diag({ ev: "start", runId, sessionID, goalLen: goal.length, messageID: part.messageID, sDir })
    toast(api, "info", "Goal ▶", `启动 ${runId.slice(-6)}: ${goal.length > 60 ? goal.slice(0, 57) + "..." : goal}`, 5000)
  })

  // ---- session.idle 监听: 核心自驱循环 ----
  api.event.on("session.idle", async (event) => {
    if (!run) return
    const sessionID = (event as any).properties?.sessionID
    if (!sessionID || sessionID !== run.sessionID) return
    if (evaluating) {
      diag({ ev: "skip-eval", reason: "re-entrancy", iter: run.iter, sessionID })
      return
    }
    evaluating = true
    try {
      run.iter += 1
      diag({ ev: "loop-iter-start", iter: run.iter, runId: run.runId })
      const evalResult = await evaluate(api, run)
      diag({ ev: "eval-returned", iter: run.iter, evalResultPreview: evalResult.slice(0, 80) })
      const done = await handleDecision(api, run, evalResult)
      if (done) {
        run = null
      } else if (run) {
        saveRunState(run.sessionDir, run)
      }
    } catch (err) {
      diag({ ev: "loop-err", iter: run.iter, err: String(err).slice(0, 200) })
    } finally {
      evaluating = false
    }
  })

  // ---- 评估 (读主 session 的 last assistant, 不创建独立 eval session) ----
  // 历史: 之前用 session.create + session.prompt 创建独立 evaluator session, 有 2 个问题:
  //   1. session.prompt 在独立 session 上有 OpenCode server bug (UnknownError ref=err_xxxxx)
  //   2. 改用 promptAsync 后, eval session 的 model 永远不响应 (prompt 进 messages 但无 assistant 回应)
  // 当前策略: 跳过独立 evaluator, 直接看主 session 最后产物, 写 iter-N.md 让用户人工审查.
  async function evaluate(api: TuiPluginApi, run: Run): Promise<string> {
    let lastAssistant = ""
    try {
      const mainMsgsResp = await api.client.session.messages({ sessionID: run.sessionID })
      const mainMsgs = (mainMsgsResp as any).data ?? mainMsgsResp
      if (Array.isArray(mainMsgs)) {
        for (let i = mainMsgs.length - 1; i >= 0; i--) {
          const m = mainMsgs[i]
          if (m?.info?.role === "assistant") {
            for (const p of m.parts ?? []) {
              if (p?.type === "text" && typeof p.text === "string") lastAssistant += p.text
            }
            break
          }
        }
      }
    } catch (err) {
      diag({ ev: "eval-err", err: String(err).slice(0, 200) })
    }

    // 启发式判断: 主 session 的产物是否有具体内容
    const last = lastAssistant.trim()
    const hasConcreteOutput = /\b(done|pending|完成|结果|输出|✅|错误|error|✓|success)\b/i.test(last)
    const hasDialogue = /^(好的|我会|让我|开始做|继续|我来做|让我先)/.test(last)
    const looksEmpty = last.length < 30

    if (looksEmpty) {
      return `CONTINUE: 主 session 产物为空或太短 (${last.length} chars): ${last.slice(0, 100)}`
    }
    if (hasDialogue && !hasConcreteOutput) {
      return `CONTINUE: 主 session 仅对话性回复, 无具体产物: ${last.slice(0, 200)}`
    }
    if (hasConcreteOutput) {
      // 含具体产物 (done/pending/✅/完成 等), 仍 CONTINUE 但让用户确认
      return `CONTINUE: 主 session 产物含具体输出, 请人工确认是否完成: ${last.slice(0, 300)}`
    }
    // 既不像对话也不像具体产物
    return `CONTINUE: 主 session 产物 (${last.length} chars): ${last.slice(0, 200)}`
  }

  // ---- 决策处理 ----
  async function handleDecision(api: TuiPluginApi, run: Run, evalResult: string): Promise<boolean> {
    const firstLine = evalResult.split("\n")[0]
    const reason = firstLine.slice(0, 200)
    const complete = /^COMPLETE\s*$/i.test(firstLine)

    if (complete) {
      writeFileSync(join(run.runDir, "final.md"),
        `# Final\n\n- run_id: ${run.runId}\n- status: ✅ COMPLETE\n- iters: ${run.iter}\n- ended_at: ${new Date().toISOString()}\n- eval: ${reason}\n`)
      saveRunState(run.sessionDir, null)
      diag({ ev: "complete", runId: run.runId, iter: run.iter })
      toast(api, "success", "Goal ✅", `${run.iter === 1 ? "1 轮达成" : `${run.iter} 轮达成`} · ${run.goal.slice(0, 50)}${run.goal.length > 50 ? "..." : ""}`, 5000)
      return true
    }

    if (run.iter >= MAX_ITER) {
      writeFileSync(join(run.runDir, "final.md"),
        `# Final\n\n- run_id: ${run.runId}\n- status: ❌ FAI3URE-CAP (${MAX_ITER} 轮)\n- iters: ${run.iter}\n- ended_at: ${new Date().toISOString()}\n- last_eval: ${reason}\n`)
      saveRunState(run.sessionDir, null)
      diag({ ev: "cap", runId: run.runId, iter: run.iter })
      toast(api, "error", "Goal ❌ FAI3URE-CAP", `${MAX_ITER} 轮未达成 · ${reason.slice(0, 80)}`)
      return true
    }

    // CONTINUE 分支: 不再尝试自动 re-inject (api.client.session.prompt 在 idle session 不可靠, 30s 超时).
    // 改为: 写 iter-N.md 评估结果, toast 通知用户, 让用户手动继续 (在 TUI 中继续对话即可).
    // 下次 session.idle fire (用户接着对话后 AI 再次走完一轮) 触发下一轮评估.
    writeFileSync(
      join(run.runDir, `iter-${run.iter}.md`),
      `# Iter ${run.iter} (CONTINUE)\n\n- at: ${new Date().toISOString()}\n- eval: ${reason}\n- full: ${evalResult.slice(0, 1000)}\n`,
    )
    diag({ ev: "continue", runId: run.runId, iter: run.iter, reason: reason.slice(0, 100) })
    toast(api, "warning", `Goal ↻ iter ${run.iter}/${MAX_ITER}`, `${reason.slice(0, 80)} (手动继续对话触发下一轮)`)
    return false
  }

  return  // plugin 返回 void
}

const mod: TuiPluginModule & { id: string } = { id: "shadow-goal", tui: plugin }
export default mod
