// plugins/xdd-goal.tsx — xdd Goal 模式 (OpenCode TUI plugin)
//
// v3 修复 (2026-06-08, 用户报告):
//   1. 解析 newline 失败: 旧正则 \s+(.+) 不跨行, 改用 ^\s*\/(?:cjgoal|cj|g)(?:@[\w-]+)?\s*([\s\S]+)$ 跨行匹配
//   2. chain 持续: 实测 OpenCode 1.16.2 server 在 session.idle 之后调 client.session.prompt
//      server 接受但 model 不唤醒. 改回 v2 "user-driven continue" 模式: 评估 CONTINUE 时
//      toast 提示用户输 "继续" 推 AI 接着干. 链 loop 仍跑, 但每次推进需要 user 一次输入.
//   3. 整段文本全收: 理论 "开头斜杠 c j g o a l 之后的都是目标" — 不再受单 token 限制,
//      即使 TUI 把多行 paste 压成空格, 也按整段处理
//
// v2 修复 (历史):
//   - 解析项目根用 api.state.path.directory, 不是 worktree (worktree 在非 git 项目下是 "/")
//   - 评估走主 session 启发式 (不创建独立 eval session, 之前有 server bug)
//   - 加 4 条收尾路径: /cjgoal done / 隐式短答 / /cjgoal stop / 10 轮 cap
//
// 目标输入: inline (不弹 Dialog 收目标, 避免双输入).
// 过程信息: 走 api.ui.toast (右上角非模态弹窗), 不污染 chat 文本流.
// AI 把 /cjgoal {text} 当普通 user message 看到并执行 (TUI chat 流会显示 AI 的回复, 这是 OpenCode 架构).
// Claude Code 端等价 slash command 见 commands/cjgoal.md (prompt-based, 简化版).
//
// 多 session 隔离: 每个 session 独立目录 .xdd/goal-runs/{sessionID}/, 包含 diag.log / current.json / {runId}/goal.md.
/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { existsSync, mkdirSync, writeFileSync, unlinkSync, appendFileSync, readdirSync, readFileSync } from "fs"
import { join, dirname } from "path"

// Boot diag: 写到 stderr (OpenCode 会捕获到 stderr.log)
const bootLog = (msg: string): void => {
  try { process.stderr.write(`[xdd-goal] ${msg}\n`) } catch {}
}
bootLog(`module-import pid=${process.pid}`)

const MAX_ITER = 10
// 解析: 整段 text 以 /cjgoal (或 alias /cj, /g) 开头, 剥前缀, 剩下的都是 goal
// - 不用 .+ 改用 [\s\S]+ 跨行匹配
// - 不强制要求 \s+ 紧跟命令 (允许 /cjgoal 直接接换行)
// - 不 anchor 在 $ (允许 goal 后面有 trailing whitespace 让 part.text 看起来正常)
// 关键: 这是单一 prefix match, 不再要求后续必须是 "单 token" / "一句话"
const PREFIX_RE = /^\s*\/(?:cjgoal|cj|g)(?:@[\w-]+)?\s*([\s\S]*)$/i
// 子命令: 剥前缀后第一段 (非空白 token) 是 done/stop/status, 且后面只剩标点/空白
// 例: "/cjgoal done" → 剥前缀 "done" → 命中
// 例: "/cjgoal done 一些 goal 文字" → 剥前缀 "done 一些 goal 文字" → 不命中 (按 goal 处理)
const SUBCMD_RE = /^\s*(done|stop|status)\s*[.!]?\s*$/i
// 隐式完成信号: 用户在最近一条消息里短答 (不带问号) 标记完成
const USER_DONE_RE = /^(完成|完成了|done|ok|好了|可以|通过了|fin|finished|complete)[。！!.\s]*$/i
// v3 移除: NUDGE_TMPL — re-inject 走 client.session.prompt 在 OpenCode 1.16.2 idle session 不唤醒 model,
//  改回 v2 user-driven 模式 (toast 提示用户输 "继续" 推 AI 接着干).

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

// per-session 目录: .xdd/goal-runs/{sessionID}/
function sessionDir(xddDir: string, sessionID: string): string {
  return join(xddDir, "goal-runs", sessionID)
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
  const xddDir = join(root, ".xdd")
  const hasxdd = existsSync(xddDir)
  if (!hasxdd) {
    bootLog(`no xdd dir at ${xddDir} (root=${root}); /cjgoal 会提示先跑 xdd-init`)
  } else {
    bootLog(`xdd dir OK at ${xddDir}`)
  }

  let run: Run | null = null
  let evaluating = false   // re-entrancy guard: 防止 session.idle 多次 fire 并发跑评估
  const seenParts = new Set<string>()

  // ---- /cjgoal slash command: 让 OpenCode input 输 /cjgoal 时有补全 ----
  api.command?.register(() => [{
    title: "/cjgoal {目标}",
    value: "xdd.cjgoal.start",
    description: "选 /cjgoal + 回车 = 补全到 input, 再输目标文字 + 回车 = 启动",
    category: "xdd",
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
    const sDir = sessionDir(xddDir, sessionID)
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
    seenParts.add(partId)

    // ---- 解析: 整段 text 以 /cjgoal 开头剥前缀, 剩下的都是 goal ----
    // v3 修复: 用 PREFIX_RE 跨行匹配, 不用 GOAL_PREFIX (.+ 不跨行)
    const m = PREFIX_RE.exec(part.text)
    if (!m) return
    const afterPrefix = (m[1] ?? "").trim()
    // 子命令: 剥前缀后整段 = "done" / "stop" / "status" (允许尾部 . !)
    // 例: "/cjgoal done" → 剥前缀 "done" → 命中
    // 例: "/cjgoal hello done" → 剥前缀 "hello done" → 不命中 (按 goal 处理)
    const subMatch = SUBCMD_RE.exec(afterPrefix)
    if (subMatch) {
      const sub = subMatch[1].toLowerCase()
      if (!hasxdd) {
        toast(api, "warning", "Goal ⚠", "项目无 .xdd/ 目录. 请先跑 xdd-init 初始化.", 6000)
        return
      }
      const sDir = initSession(sessionID)
      // 内存没有 run 但盘上有, 先恢复 (重启 / 跨 session 续接场景)
      if (!run) {
        const saved = loadRunState(sDir)
        if (saved && saved.iter < MAX_ITER) {
          run = { ...saved, runDir: join(sDir, saved.runId), sessionDir: sDir }
        }
      }
      if (sub === "done") {
        if (!run) {
          toast(api, "warning", "Goal ⚠", "无活跃 run, 无需 done.")
          return
        }
        const finalPath = join(run.runDir, "final.md")
        writeFileSync(finalPath,
          `# Final\n\n- run_id: ${run.runId}\n- status: ✅ COMPLETE\n- iters: ${run.iter}\n- ended_at: ${new Date().toISOString()}\n- ended_by: user_done\n- eval: 用户主动 /cjgoal done\n`)
        try { writeFileSync(finalPath, readFileSync(finalPath, "utf-8"), { mode: 0o444 }) } catch {}
        saveRunState(run.sessionDir, null)
        diag({ ev: "user-done", runId: run.runId, iter: run.iter, sessionID })
        toast(api, "success", "Goal ✅",
          `${run.iter === 0 ? "0 轮即收尾" : `${run.iter} 轮达成`} · ${run.goal.slice(0, 50)}${run.goal.length > 50 ? "..." : ""}`, 5000)
        run = null
        return
      }
      if (sub === "stop") {
        if (!run) {
          toast(api, "warning", "Goal ⚠", "无活跃 run, 无需 stop.")
          return
        }
        const finalPath = join(run.runDir, "final.md")
        writeFileSync(finalPath,
          `# Final\n\n- run_id: ${run.runId}\n- status: ❌ ABANDONED\n- iters: ${run.iter}\n- ended_at: ${new Date().toISOString()}\n- ended_by: user_stop\n- eval: 用户主动 /cjgoal stop\n`)
        try { writeFileSync(finalPath, readFileSync(finalPath, "utf-8"), { mode: 0o444 }) } catch {}
        saveRunState(run.sessionDir, null)
        diag({ ev: "user-stop", runId: run.runId, iter: run.iter, sessionID })
        toast(api, "warning", "Goal ⏹",
          `ABANDONED · ${run.goal.slice(0, 50)}${run.goal.length > 50 ? "..." : ""}`, 5000)
        run = null
        return
      }
      if (sub === "status") {
        if (!run) {
          toast(api, "info", "Goal ⏱", "无活跃 run.")
          return
        }
        // 扫 iter-N.md 数回合 + 抽最后一条 eval 原因
        let iterCount = 0
        let lastReason = "(无 iter-N.md)"
        try {
          const files = readdirSync(run.runDir).filter((f) => /^iter-\d+\.md$/.test(f))
          iterCount = files.length
          if (iterCount > 0) {
            const lastFile = files.sort().pop()!
            const content = readFileSync(join(run.runDir, lastFile), "utf-8")
            const m = /^- eval: (.+)$/m.exec(content)
            if (m && m[1]) lastReason = m[1].trim()
          }
        } catch (err) {
          diag({ ev: "status-err", err: String(err).slice(0, 200) })
        }
        toast(api, "info", "Goal ⏱",
          `${iterCount} 回合 · iter=${run.iter} · ${run.goal.slice(0, 40)}${run.goal.length > 40 ? "..." : ""}\n最后: ${lastReason.slice(0, 80)}`, 6000)
        return
      }
    }

    // ---- 新 goal 启动 (v3 修复: 用 PREFIX_RE 跨行匹配, 已剥前缀) ----
    const goal = afterPrefix
    if (!goal) {
      // 用户只输 /cjgoal 没 goal, 提示
      toast(api, "warning", "Goal ⚠", "用法: /cjgoal {目标} 或 /cjgoal done|stop|status", 5000)
      diag({ ev: "skip", reason: "empty-goal", messageID: part.messageID, sessionID })
      return
    }

    if (run) {
      diag({ ev: "skip", reason: "active-run-exists", runId: run.runId, sessionID })
      return
    }

    if (!hasxdd) {
      diag({ ev: "skip", reason: "no-xdd-dir", root, sessionID })
      toast(api, "warning", "Goal ⚠", "项目无 .xdd/ 目录. 请先跑 xdd-init 初始化.", 6000)
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

  // ---- 评估 (读主 session 的 last assistant + last user, 不创建独立 eval session) ----
  // 历史: 之前用 session.create + session.prompt 创建独立 evaluator session, 有 2 个问题:
  //   1. session.prompt 在独立 session 上有 OpenCode server bug (UnknownError ref=err_xxxxx)
  //   2. 改用 promptAsync 后, eval session 的 model 永远不响应 (prompt 进 messages 但无 assistant 回应)
  // 当前策略: 读主 session 最后产物, 启发式判断 + 接受用户显式 done 信号, 写 iter-N.md.
  // 返回协议: 首行是 verdict (COMPLETE|CONTINUE), 后续是 reason. handleDecision 拆首行作 verdict, 后续作 reason.
  async function evaluate(api: TuiPluginApi, run: Run): Promise<string> {
    let lastAssistant = ""
    let lastUserText = ""
    try {
      // v3 修复: 用 v1 SDK 风格的 sessionID 参数 (不是 path:{id}).
      // 实测 v3 path 风格在 OpenCode 1.16.2 server 触发 err "Expected a string starting with ses, got {sessionID}"
      // (server 期望 URL template 是 {sessionID}, SDK 发的是 {id} 不匹配)
      // v1 风格的 sessionID 参数 server 接受.
      const mainMsgsResp = await api.client.session.messages({ sessionID: run.sessionID } as any)
      const mainMsgs = (mainMsgsResp as any).data ?? mainMsgsResp
      if (Array.isArray(mainMsgs)) {
        for (let i = mainMsgs.length - 1; i >= 0; i--) {
          const m = mainMsgs[i]
          if (!m) continue
          if (!lastAssistant && m?.info?.role === "assistant") {
            for (const p of m.parts ?? []) {
              if (p?.type === "text" && typeof p.text === "string") lastAssistant += p.text
            }
          }
          if (!lastUserText && m?.info?.role === "user") {
            for (const p of m.parts ?? []) {
              if (p?.type === "text" && typeof p.text === "string") lastUserText += p.text
            }
          }
          if (lastAssistant && lastUserText) break
        }
      }
    } catch (err) {
      diag({ ev: "eval-err", err: String(err).slice(0, 200) })
    }

    // 启发式 0: 用户最近一条消息是短完成信号 (不带问号) → COMPLETE
    // 例子: "完成" / "done" / "ok" / "好了" / "可以" 单独成句
    const userTxt = lastUserText.trim()
    if (userTxt.length > 0 && userTxt.length <= 15 && !/[?]/.test(userTxt) && USER_DONE_RE.test(userTxt)) {
      return `COMPLETE: 用户短消息标记完成: ${userTxt.slice(0, 30)}`
    }

    // 启发式 1-3: 看 AI 最后产物形态
    const last = lastAssistant.trim()
    // v3 修复: 启发式只判"是否明显没干活", 不替用户判定完成.
    // back-cover 的 verify_completion 工具会拦"伪 done"声明, AI 真完成时会 verify → OK.
    // Goal 这里只判 looksEmpty (AI 还在想 / 卡死) 和 hasDialogue (AI 仅说话, 没动手)
    const looksEmpty = last.length < 30
    const hasDialogue = /^(好的|我会|让我|开始做|继续|我来做|让我先)/.test(last) && last.length < 100

    if (looksEmpty) {
      return `CONTINUE: AI 产物为空或太短 (${last.length} chars), 继续推: ${last.slice(0, 100)}`
    }
    if (hasDialogue) {
      return `CONTINUE: AI 仅对话性回复, 还没动手: ${last.slice(0, 200)}`
    }
    // AI 产物有实质内容 (>=30 chars, 不是纯对话开场) → 暂视为 CONTINUE,
    // 提示用户确认. 用户输 "完成" / "done" / "/cjgoal done" 主动收尾.
    return `CONTINUE: AI 产物 (${last.length} chars), 评估未达完成: ${last.slice(0, 200)}`
  }

  // ---- 决策处理 ----
  // evalResult 协议: 首行是 verdict (COMPLETE|CONTINUE), 后续是 reason.
  async function handleDecision(api: TuiPluginApi, run: Run, evalResult: string): Promise<boolean> {
    const firstLine = evalResult.split("\n")[0]
    const verdictMatch = /^(COMPLETE|CONTINUE)\b/i.exec(firstLine)
    const verdict = verdictMatch?.[1]?.toUpperCase() ?? "CONTINUE"
    const reason = (verdictMatch ? firstLine.slice(verdictMatch[0].length).replace(/^[:\s]+/, "") : firstLine).trim() || firstLine
    const complete = verdict === "COMPLETE"

    if (complete) {
      const finalPath = join(run.runDir, "final.md")
      writeFileSync(finalPath,
        `# Final\n\n- run_id: ${run.runId}\n- status: ✅ COMPLETE\n- iters: ${run.iter}\n- ended_at: ${new Date().toISOString()}\n- ended_by: auto_eval (heuristic)\n- eval: ${reason}\n`)
      try { writeFileSync(finalPath, readFileSync(finalPath, "utf-8"), { mode: 0o444 }) } catch {}
      saveRunState(run.sessionDir, null)
      diag({ ev: "complete", runId: run.runId, iter: run.iter, reason: reason.slice(0, 100) })
      toast(api, "success", "Goal ✅",
        `${run.iter === 0 ? "0 轮即收尾" : `${run.iter} 轮达成`} · ${run.goal.slice(0, 50)}${run.goal.length > 50 ? "..." : ""}`, 5000)
      return true
    }

    if (run.iter >= MAX_ITER) {
      const finalPath = join(run.runDir, "final.md")
      writeFileSync(finalPath,
        `# Final\n\n- run_id: ${run.runId}\n- status: ❌ FAI3URE-CAP (${MAX_ITER} 轮)\n- iters: ${run.iter}\n- ended_at: ${new Date().toISOString()}\n- ended_by: cap\n- last_eval: ${reason}\n`)
      try { writeFileSync(finalPath, readFileSync(finalPath, "utf-8"), { mode: 0o444 }) } catch {}
      saveRunState(run.sessionDir, null)
      diag({ ev: "cap", runId: run.runId, iter: run.iter })
      toast(api, "error", "Goal ❌ FAI3URE-CAP", `${MAX_ITER} 轮未达成 · ${reason.slice(0, 80)}`)
      return true
    }

    // CONTINUE 分支: v3 实测 — OpenCode 1.16.2 server 在 session.idle 之后调 client.session.prompt
    //   server 接受 (200), 但 model 不响应 (idle session 不被唤醒, server bug).
    //   v2 注释 "session.prompt 在 idle session 不可靠" 实际是 server 端限制, 不是 SDK 调用错.
    //   砍掉 re-inject 避免: 写 spurious prompt 进 message queue 干扰后续 user 消息.
    // 设计: 改回 v2 的 "user-driven continue" 模式 — 评估 CONTINUE 时, toast 提示用户
    //   输 "继续" / 任何 user 消息 → 触发新一轮 session.idle → 再次评估. 链 loop 仍跑,
    //   但每次推进需要 user 一次输入. 配合 back-cover 的 verify_completion 工具,
    //   AI 完成具体工作时会被 back-cover 拦截不能直接说 done, 必须 verify → OK 才放行.
    writeFileSync(
      join(run.runDir, `iter-${run.iter}.md`),
      `# Iter ${run.iter} (CONTINUE)\n\n- at: ${new Date().toISOString()}\n- eval: ${reason}\n- full: ${evalResult.slice(0, 1000)}\n\n_可输 \`继续\` 推 AI 接着干, 或 \`完成\` / \`done\` / \`/cjgoal done\` 收尾_\n`,
    )
    diag({ ev: "continue", runId: run.runId, iter: run.iter, reason: reason.slice(0, 100) })
    toast(api, "warning", `Goal ↻ iter ${run.iter}/${MAX_ITER}`,
      `${reason.slice(0, 50)} | 输 继续 推, 或 完成 / /cjgoal done 收尾`)
    return false
  }

  return  // plugin 返回 void
}

const mod: TuiPluginModule & { id: string } = { id: "xdd-goal", tui: plugin }
export default mod
