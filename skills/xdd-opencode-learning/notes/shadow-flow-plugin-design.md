# 通过 Plugin 引导 Shadow Skill 流程 — 完整设计

> 目标：让 `shadow-hooks.ts` (或新加 `shadow-flow.ts`) 自动把 Walker 拉回 L0→L6 流程, 不依赖 agent 自觉。
> 关键产物对照表: `skills/shadow-l*/SKILL.md` 的"产出"段

## 1. Stage → 产出物 一览表

| Stage | Skill 名称 | 关键产出 (路径) | 状态钩子 (判定 stage done) |
|-------|-----------|------------------|---------------------------|
| L0-research | `shadow-l0-research` | `.shadow/L0-research/*.md` | 至少 1 个 .md 写入 |
| L1-research | `shadow-l1-research` | `.shadow/L1-business/{slug}/intent.md` + `business-landscape.md` + `BXX-*/research.md` | intent.md 存在 |
| L1-flow | `shadow-l1-flow` | `.shadow/L1-business/project.flow.mermaid` | project.flow.mermaid 存在 |
| L1-spec | `shadow-l1-spec` | `.shadow/L1-business/{slug}/spec.md` (含 RXX 规则) | spec.md 存在 |
| L1-wire | `shadow-l1-wire` | `.shadow/L1-business/{slug}/wireframes/*.svg` | 至少 1 个 .svg 写入 |
| L1.5-arch | `shadow-l1p5-architecture` | `.shadow/L1.5-architecture/{slug}/architecture.md` + `aggregate-landscape.md` + `event-contract.md` | architecture.md 存在 |
| Scaffold | `shadow-scaffold` | 项目目录树 + Dockerfile + Hello API | hello API 通过 smoke test |
| L2-e2e | `shadow-l2-e2e` | `.shadow/L2-e2e/{slug}/e2e.md` + `uat-script.md` | uat-script.md 存在 |
| L5-plan | `shadow-l5-plan` | `.shadow/L5-plan/{slug}/harness-plan.md` | harness-plan.md 存在 |
| L5-impl | `shadow-l5-impl` | 项目实现代码 + 测试代码 | 至少 1 个 impl + 1 个 test 文件 |
| Reviewer | `shadow-reviewer` | `.shadow/reviewer/{slug}/review-report.md` | review-report.md 存在 |
| L6-deploy | `shadow-l6-deploy` | 部署报告 + smoke 验证 | 部署成功 + smoke 通过 |

## 2. 状态机 (Stage State Machine)

```
                  ┌────────────┐
                  │   ⏳ TODO  │  (status.md 中标记)
                  └─────┬──────┘
                        │ skill 加载
                        ▼
                  ┌────────────┐
        ┌────────►│ 🔄 DOING   │  (运行时)
        │         └─────┬──────┘
        │               │ 预期产出文件出现
        │               ▼
        │         ┌────────────┐
        │         │   ✅ DONE  │  (auto-detected, 提示更新 status.md)
        │         └─────┬──────┘
        │               │ 用户明确说"重做" / 重新加载 skill
        │               ▼
        │         (回到 🔄 DOING)
        │
        │ stage 跳序 (skill 加载但非顺序)
        └──── ◀── ⛔ BLOCKED  (抛错, 强制回当前 stage)
```

## 3. Plugin Hook 在流程中的位置 (Wireframe)

```
       USER                 AGENT LOOP                OPENCODE              PLUGIN (shadow-flow)
         │                       │                       │                          │
         │  "做一个 XX 系统"       │                       │                          │
         ├──────────────────────►│                       │                          │
         │                       │ 启动 instance         │                          │
         │                       ├──────────────────────►│                          │
         │                       │                       │ Bootstrap fires          │
         │                       │                       ├─────────────────────────►│
         │                       │                       │                          │ L1 (system.transform):
         │                       │                       │                          │   inject status.md 摘要 +
         │                       │                       │                          │   当前 stage + 允许的 skill 列表
         │                       │                       │◀─────────────────────────┤
         │                       │ LLM call (system 含提示)                       │
         │                       │◀──────────────────────┤                          │
         │                       │                       │                          │
         │                       │ 调 skill 工具:        │                          │
         │                       │ shadow-l1-research   │                          │
         │                       ├──────────────────────►│                          │
         │                       │                       │ tool.execute.before      │
         │                       │                       ├─────────────────────────►│
         │                       │                       │                          │ L3 (pre-skill):
         │                       │                       │                          │   - 校验 stage 顺序
         │                       │                       │                          │   - 标 stage DOING
         │                       │                       │                          │   - 注入当前 stage 关键提示
         │                       │                       │◀─────────────────────────┤
         │                       │ 注入 context 继续      │                          │
         │                       │ 模型跑 skill 内容      │                          │
         │                       │                       │                          │
         │                       │ write /Users/.../intent.md                       │
         │                       ├──────────────────────►│                          │
         │                       │                       │ tool.execute.after       │
         │                       │                       ├─────────────────────────►│
         │                       │                       │                          │ L4 (post-write):
         │                       │                       │                          │   - 检查文件路径 → 哪个 stage 的产出
         │                       │                       │                          │   - 如匹配 → 标 stage DONE
         │                       │                       │                          │   - 提示 agent 更新 status.md
         │                       │                       │                          │   - 注入下一 stage 的预告
         │                       │                       │◀─────────────────────────┤
         │                       │                       │                          │
         │                       │ agent 调 edit status.md (标 ✅)                  │
         │                       │ ... 继续 ...          │                          │
         │                       │                       │                          │
         │  (idle 后)            │                       │  session.idle event      │
         │                       │                       ├─────────────────────────►│
         │                       │                       │                          │ L5 (idle scan):
         │                       │                       │                          │   - 扫描所有预期产出文件
         │                       │                       │                          │   - 对比 status.md 标记
         │                       │                       │                          │   - 输出 "未标记但已产出" 警告
         │                       │                       │◀─────────────────────────┤
         ▼                       ▼                       ▼                          ▼
```

## 4. 5 个 Hook 的具体职责

### 4.1 L1: `experimental.chat.system.transform`

```ts
"experimental.chat.system.transform": async (_input, output) => {
  const stage = detectCurrentStage(statusMd)  // 从 status.md 读
  output.system.push(`

# Shadow Pipeline 状态
当前 iter: ${iter}
当前 stage: ${stage} (${STAGE_DESC[stage]})
${statusSummary}

## 允许加载的 skill
${ALLOWED_SKILLS_NEXT[stage]}

## 本 stage 必须产出
${EXPECTED_OUTPUTS[stage]}

## 跳序硬规则
- 当前 stage 未标 ✅ 之前, 不允许加载下一 stage 的 skill
- 加载下一 stage 的 skill → 抛错
`)
}
```

### 4.2 L2: `chat.message` (检测用户意图)

```ts
"chat.message": async (_input, output) => {
  const text = userMessageText(output.parts)

  if (/从 (L0|L1|L2|L5|L6).*开始|重新跑/.test(text)) {
    // 提示 agent 加载 shadow-trace-init
    injectHint(output, "用户想重启 pipeline, 先调 shadow-trace-init 重置 status.md")
  }
  if (/下一 (个 )?stage|下一步/.test(text)) {
    const next = nextStage(currentStage)
    injectHint(output, `下一 stage 是 ${next}, 加载 ${SKILL_FOR_STAGE[next]} skill`)
  }
  if (/当前 (在哪个 )?stage|状态/.test(text)) {
    injectHint(output, "当前在 stage X, 详见 status.md 摘要")
  }
}
```

### 4.3 L3: `tool.execute.before` (Skill 工具)

```ts
"tool.execute.before": async (input, output) => {
  if (input.tool !== "skill") return
  const skillName = output.args.name

  // 1. 阶段顺序校验
  const skillStage = skillToStage[skillName]
  const currentStage = detectCurrentStage(statusMd)
  if (skillStage && currentStage) {
    const curIdx = STAGE_ORDER.indexOf(currentStage)
    const skillIdx = STAGE_ORDER.indexOf(skillStage)
    if (skillIdx > curIdx + 1) {
      throw new Error(`⛔ 阶段跳序! 当前 ${currentStage}, 试图加载 ${skillName} (${skillStage})。先完成 ${currentStage}。`)
    }
  }

  // 2. 标 DOING
  if (skillStage) {
    updateStatusMd(skillStage, "🔄 DOING")
  }

  // 3. 注入 5 步节奏 + 本 stage 关键产出
  output.args.system = (output.args.system ?? "") + STAGE_PROMPTS[skillStage]
}
```

### 4.4 L4: `tool.execute.after` (Write/Edit)

```ts
"tool.execute.after": async (input, output) => {
  if (!["write", "edit", "apply_patch"].includes(input.tool)) return
  const filePath = input.args?.filePath ?? ""
  const matchedStage = matchStageByOutput(filePath)  // /L0-research/* → L0, /intent.md → L1-research, etc.

  if (matchedStage && currentStage === matchedStage) {
    // 标 stage DONE
    updateStatusMd(matchedStage, "✅ DONE")
    // 注入下一 stage 预告
    const next = nextStage(matchedStage)
    injectHint(output, `✅ ${matchedStage} 产物 ${filePath} 已写入。
       下一步: 更新 status.md 把 ${matchedStage} 标 ✅, 然后加载 ${SKILL_FOR_STAGE[next]}`)
  }

  // 原有 stub 扫描
  scanStubs(filePath)
}
```

### 4.5 L5: `event` (session.idle / message.updated finish=stop)

```ts
event: async ({ event }) => {
  if (event?.type !== "message.updated") return
  if (event.properties?.info?.finish !== "stop") return

  // 异步全项目扫描
  setTimeout(() => {
    const stages = scanAllStageOutputs()  // 检查每个 stage 的预期文件
    const drifted = stages.filter(s => s.fileExists && !s.markedDone)
    const pending = stages.filter(s => !s.fileExists && !s.markedDone)

    if (drifted.length > 0) {
      log(`WARN: 产物已写但 status.md 未标 ✅: ${drifted.map(d => d.stage).join(", ")}`)
    }
    if (pending.length > 0) {
      log(`INFO: 未完成的 stage: ${pending.map(p => p.stage).join(", ")}`)
    }
  }, 100)
}
```

## 5. 完整代码 (新文件 `plugins/shadow-flow.ts`)

```ts
// plugins/shadow-flow.ts — Shadow 流程引导 plugin
// 把 Walker 拉回 L0→L6 流程, 不依赖 agent 自觉

import type { Plugin, Hooks } from "@opencode-ai/plugin"
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "fs"
import { join, dirname, relative } from "path"

// ─────────── 常量: stage 顺序 + 技能名 + 预期产出 ───────────

const STAGES = [
  "L0-research", "L1-research", "L1-flow", "L1-spec", "L1-wire",
  "L1.5-architecture", "scaffold", "L2-e2e",
  "L5-plan", "L5-impl", "reviewer", "L6-deploy",
] as const
type Stage = (typeof STAGES)[number]

const SKILL_FOR_STAGE: Record<Stage, string> = {
  "L0-research": "shadow-l0-research",
  "L1-research": "shadow-l1-research",
  "L1-flow": "shadow-l1-flow",
  "L1-spec": "shadow-l1-spec",
  "L1-wire": "shadow-l1-wire",
  "L1.5-architecture": "shadow-l1p5-architecture",
  "scaffold": "shadow-scaffold",
  "L2-e2e": "shadow-l2-e2e",
  "L5-plan": "shadow-l5-plan",
  "L5-impl": "shadow-l5-impl",
  "reviewer": "shadow-reviewer",
  "L6-deploy": "shadow-l6-deploy",
}

// 预期产出: stage → 路径模式 (glob)
const EXPECTED_OUTPUTS: Record<Stage, string[]> = {
  "L0-research":        [".shadow/L0-research/*.md"],
  "L1-research":        [".shadow/L1-business/{slug}/intent.md",
                          ".shadow/L1-business/{slug}/business-landscape.md",
                          ".shadow/L1-business/{slug}/BXX-*/research.md"],
  "L1-flow":            [".shadow/L1-business/project.flow.mermaid"],
  "L1-spec":            [".shadow/L1-business/{slug}/spec.md"],
  "L1-wire":            [".shadow/L1-business/{slug}/wireframes/*.svg"],
  "L1.5-architecture":  [".shadow/L1.5-architecture/{slug}/architecture.md",
                          ".shadow/L1.5-architecture/{slug}/aggregate-landscape.md",
                          ".shadow/L1.5-architecture/{slug}/event-contract.md"],
  "scaffold":           ["Dockerfile", "src/**/main.*", "tests/**/test_*.py"],
  "L2-e2e":             [".shadow/L2-e2e/{slug}/e2e.md",
                          ".shadow/L2-e2e/{slug}/uat-script.md"],
  "L5-plan":            [".shadow/L5-plan/{slug}/harness-plan.md"],
  "L5-impl":            ["src/**/*.{ts,py,go,java}",
                          "tests/**/*.{ts,py,go,java}"],
  "reviewer":           [".shadow/reviewer/{slug}/review-report.md"],
  "L6-deploy":          [".shadow/L6-deploy/{slug}/deploy-report.md"],
}

// ─────────── 辅助函数 ───────────

function findShadowDir(start: string): string | null {
  let d = start
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(d, ".shadow"))) return join(d, ".shadow")
    const p = dirname(d)
    if (p === d) break
    d = p
  }
  return null
}

function readStatusMd(shadowDir: string, iter: string): string | null {
  const f = join(shadowDir, "iterations", iter, "pipeline", "status.md")
  return existsSync(f) ? readFileSync(f, "utf-8") : null
}

function readCurrentIter(shadowDir: string): string | null {
  const f = join(shadowDir, "current-iteration")
  return existsSync(f) ? readFileSync(f, "utf-8").trim() : null
}

function detectCurrentStage(statusMd: string | null): Stage | null {
  if (!statusMd) return null
  for (const s of STAGES) {
    if (new RegExp(`\\|\\s*${s}\\s*\\|\\s*⏳`).test(statusMd)) return s
  }
  return null
}

function updateStatusMd(shadowDir: string, iter: string, stage: Stage, mark: "🔄 DOING" | "✅ DONE" | "⏳ TODO"): void {
  const f = join(shadowDir, "iterations", iter, "pipeline", "status.md")
  if (!existsSync(f)) return
  let md = readFileSync(f, "utf-8")
  // 替换 | stage | <old> | 为新 mark
  const re = new RegExp(`(\\|\\s*${stage}\\s*\\|)\\s*[^|]+(\\s*\\|)`)
  md = md.replace(re, `$1 ${mark}$2`)
  writeFileSync(f, md, "utf-8")
  log(`status.md updated: ${stage} → ${mark}`)
}

function matchStageByOutput(filePath: string, projectRoot: string): Stage | null {
  const rel = relative(projectRoot, filePath)
  for (const stage of STAGES) {
    for (const pattern of EXPECTED_OUTPUTS[stage]) {
      const re = new RegExp("^" + pattern
        .replace(/\{slug\}/g, "[^/]+")
        .replace(/[*]/g, ".*")
        .replace(/\./g, "\\."))
      if (re.test(rel)) return stage
    }
  }
  return null
}

const log = (msg: string) => process.stderr.write(`[shadow-flow] ${msg}\n`)

// ─────────── Plugin 工厂 ───────────

export const ShadowFlowPlugin: Plugin = async (input) => {
  const projectRoot = input.directory
  const shadowDir = findShadowDir(projectRoot)
  log(`loaded for project=${projectRoot} shadowDir=${shadowDir ?? "(none)"}`)

  const hook: Hooks = {
    // === L1: 注入 stage 上下文 ===
    "experimental.chat.system.transform": async (_input, output) => {
      if (!shadowDir) return
      const iter = readCurrentIter(shadowDir)
      if (!iter) return
      const md = readStatusMd(shadowDir, iter)
      const stage = detectCurrentStage(md)
      if (!stage) return

      const stageIdx = STAGES.indexOf(stage)
      const nextStages = STAGES.slice(stageIdx, stageIdx + 3)
      const allowedSkills = nextStages.map(s => SKILL_FOR_STAGE[s]).join(", ")
      const expectedOutput = EXPECTED_OUTPUTS[stage][0]  // 第一个作为代表

      output.system.push(`
# Shadow 流程上下文
- 当前 iter: ${iter}
- 当前 stage (⏳): **${stage}**
- 下一 stage: ${STAGES[stageIdx + 1] ?? "(end)"}
- 本 stage 预期产出: \`${expectedOutput}\`
- 允许加载的 skill: ${allowedSkills}

## 硬规则
- 不要跳序加载 skill — plugin 会抛错
- 产出文件落到预期路径后, plugin 自动标 stage ✅ — 你只需把 status.md 同步一下
- session 结束后 plugin 会扫所有 stage 输出, 报告漂移
`)
    },

    // === L2: 用户意图 → 提示 ===
    "chat.message": async (_input, output) => {
      const text = (output.parts ?? [])
        .filter((p: any) => p.type === "text" && !p.synthetic)
        .map((p: any) => p.text)
        .join("\n")

      if (!shadowDir) return
      const iter = readCurrentIter(shadowDir)
      const md = iter ? readStatusMd(shadowDir, iter) : null
      const stage = detectCurrentStage(md)

      if (/当前.{0,4}stage|当前.{0,4}状态|我在哪/.test(text)) {
        output.parts.push({
          type: "text",
          text: `\n[shadow-flow] 当前 stage: **${stage ?? "(未知, 没找到 .shadow/ 或 status.md)"}**`,
          synthetic: true,
        } as any)
      }
      if (/下一.{0,4}stage|下一步.{0,4}是什么/.test(text)) {
        const next = stage ? STAGES[STAGES.indexOf(stage) + 1] : null
        if (next) {
          output.parts.push({
            type: "text",
            text: `\n[shadow-flow] 下一 stage: **${next}** → 加载 skill \`${SKILL_FOR_STAGE[next]}\``,
            synthetic: true,
          } as any)
        }
      }
    },

    // === L3: Skill 加载前 — 阶段顺序校验 + 标 DOING + 注入 5 步节奏 ===
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "skill") return
      const args = (output as any).args ?? {}
      const skillName = args.name ?? ""

      if (!shadowDir) return
      const iter = readCurrentIter(shadowDir)
      const md = iter ? readStatusMd(shadowDir, iter) : null
      const currentStage = detectCurrentStage(md)

      // 找 skill 对应的 stage
      let skillStage: Stage | null = null
      for (const [s, sk] of Object.entries(SKILL_FOR_STAGE)) {
        if (skillName.toLowerCase().includes(sk.replace("shadow-", ""))) {
          skillStage = s as Stage
          break
        }
      }
      if (!skillStage) return  // 非 Shadow skill, 放行

      // 1. 阶段顺序硬校验
      if (currentStage) {
        const curIdx = STAGES.indexOf(currentStage)
        const skillIdx = STAGES.indexOf(skillStage)
        if (skillIdx > curIdx + 1) {
          const err = `[shadow-flow] ⛔ 阶段跳序! 当前 ${currentStage}, 试图加载 ${skillName} (${skillStage})。先完成 ${currentStage}。`
          log(err)
          throw new Error(err)
        }
        // 同 stage 反复 load 允许
        if (skillIdx < curIdx) {
          log(`WARN: ${skillName} (${skillStage}) 在当前 ${currentStage} 之前, 允许重做`)
        }
      }

      // 2. 标 DOING
      updateStatusMd(shadowDir, iter!, skillStage, "🔄 DOING")

      // 3. 注入 5 步节奏 + 本 stage 关键提示
      const rhythm = [
        `1. 读 skills/${SKILL_FOR_STAGE[skillStage]}/SKILL.md 全文`,
        `2. 按 SKILL.md 流程一步步做, 不要跳步`,
        `3. 产出落到预期路径: ${EXPECTED_OUTPUTS[skillStage].join(" / ")}`,
        `4. 完成后用 Edit 更新 status.md 把本 stage 标 ✅`,
        `5. 加载下一 stage 的 skill`,
      ].join("\n")
      log(`skill loaded: ${skillName} (${skillStage})\n5-step rhythm:\n${rhythm}`)
    },

    // === L4: 写文件后 — 检测 stage 产物 + 标 DONE ===
    "tool.execute.after": async (input, output) => {
      if (!["write", "edit", "apply_patch"].includes(input.tool)) return
      const args = (input as any).args ?? {}
      const filePath = args.filePath ?? args.path ?? args.file ?? ""
      if (!filePath) return

      // 1. 检测 stage 产物
      const matchedStage = matchStageByOutput(filePath, projectRoot)
      if (matchedStage && shadowDir) {
        const iter = readCurrentIter(shadowDir)
        if (iter) {
          updateStatusMd(shadowDir, iter, matchedStage, "✅ DONE")
          const next = STAGES[STAGES.indexOf(matchedStage) + 1]
          log(`✓ ${matchedStage} 产物已写入 ${filePath} (DONE)。下一 stage: ${next ?? "(end)"}`)
        }
      }

      // 2. 原有 stub 扫描
      const stubs = scanStubs(filePath)
      if (stubs.length > 0) {
        log(`STUB: ${filePath} 含 ${stubs.length} 处存根`)
        output.metadata = { ...(output.metadata ?? {}), shadowStubWarning: true }
      }
    },

    // === L5: session idle — 全 stage 漂移扫描 ===
    event: async ({ event }: any) => {
      if (event?.type !== "message.updated") return
      const info = event?.properties?.info
      if (!info || info.role !== "assistant" || info.finish !== "stop") return

      setTimeout(() => {
        if (!shadowDir) return
        const iter = readCurrentIter(shadowDir)
        if (!iter) return
        const md = readStatusMd(shadowDir, iter)
        if (!md) return

        const drifted: string[] = []
        const missing: string[] = []
        for (const stage of STAGES) {
          const output = EXPECTED_OUTPUTS[stage][0]
          // 简化: 不展开 {slug}, 只检查目录存在 + 至少 1 个文件
          const dirPath = join(projectRoot, dirname(output.replace(/\{slug\}/g, "x").replace(/\/\*[^/]*$/, "")))
          const exists = existsSync(dirPath) && output !== dirPath + "/*"
          const markedDone = new RegExp(`\\|\\s*${stage}\\s*\\|\\s*✅`).test(md)
          if (exists && !markedDone) drifted.push(stage)
          if (!exists && !markedDone && stage === detectCurrentStage(md)) missing.push(stage)
        }
        if (drifted.length > 0) log(`⚠ 产物已写但 status.md 未标: ${drifted.join(", ")}`)
        if (missing.length > 0) log(`? 当前 stage 预期产出未发现: ${missing.join(", ")}`)
      }, 100)
    },
  }
  return hook
}

function scanStubs(filePath: string): string[] {
  if (!existsSync(filePath)) return []
  const text = readFileSync(filePath, "utf-8")
  const patterns = [/\bpass\b\s*$/m, /\bTODO\b/, /NotImplementedError/, /InMemoryRepository/]
  return patterns.filter((p) => p.test(text))
}

export default ShadowFlowPlugin
```

## 6. 5 步节奏 vs stage 5 步: 对照

| 通用 5 步节奏 (L3 注入) | Stage 5 步 (来自各 SKILL.md) |
|--------------------------|-------------------------------|
| 1. 读 SKILL.md 全文 | 1. 准备: 读 status.md, 读上游产物 |
| 2. 按 SKILL.md 流程一步步做 | 2. 执行: 按 SKILL.md 主体做 |
| 3. 落到预期路径 | 3. 产出: 写到 SKILL.md 标注的路径 |
| 4. 更新 status.md 标 ✅ | 4. 验证: 跑门禁检查 |
| 5. 加载下一 stage 的 skill | 5. 移交: 更新 status.md, 触发下一 stage |

## 7. 与 Walker 的关系

```
┌────────────────────────────────────────────────────────────────┐
│  Walker agent (shadow-walker.md)                              │
│  ──────────────────────────────                              │
│  • 不写死 pipeline 步骤, "按需加载 skill"                      │
│  • 信任 status.md 作为 state source                            │
│                                                                │
│  改造: 不再信任 Walker, 改为 plugin 强校验                      │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ Walker 调 skill → plugin 强校验                        │   │
│  │ Walker 跳过 stage → plugin 抛错                        │   │
│  │ Walker 写产物 → plugin 标 DONE (status.md 自动更新)    │   │
│  │ Walker 漏 status.md → L5 扫描告警                     │   │
│  └────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
```

## 8. 失败模式与降级

| 失败 | 表现 | 降级 |
|------|------|------|
| 找不到 .shadow/ | plugin 静默 (无 status.md 引导) | 提示用户 `mkdir -p .shadow/iterations/iter-1/pipeline` |
| status.md 不存在 | 跳序校验跳过 | L1 不注入 stage 上下文 |
| iter 为空 | 全部不工作 | 同上 |
| 用户改 slug | matchStageByOutput 失败 | L4 不标 DONE, 用户手动标 |
| skill 名字变了 | skillStage 解析失败 | plugin 静默放行, Walker 自己负责 |
| agent 用 Edit 而非 Write 改 status.md | plugin 检测不到 → 不标 DOING | 接受这个限制, status.md 标 DONE 由 agent 负责 |

## 9. 配置

```json
// opencode.json
{
  "plugin": [
    "shadow-flow",   // 不带 .ts, 走 auto-discovery
    "back-cover"     // 已有
  ]
}
```

或者在 plugin 调用时传 options:
```ts
ShadowFlowPlugin({
  // 暂未支持 options 透传
})
```

## 10. 测试方案 (用现有的 test-in-tmux 技能)

1. 初始化 `.shadow/iterations/iter-1/pipeline/status.md`, 第一行标 `| L0-research | ⏳ |`
2. 启动 OpenCode, 问"当前 stage" → L2 应输出 "L0-research"
3. 加载 `shadow-l1-spec` skill → L3 应抛错 "跳序, 先完成 L0/L1-research"
4. 加载 `shadow-l0-research` skill → L3 应标 DOING
5. 写入 `.shadow/L0-research/01-notes.md` → L4 应标 L0-research DONE
6. 加载 `shadow-l1-research` skill → L3 应允许 (上一 stage 已 DONE)
7. 写入 `intent.md` → L4 应标 L1-research DONE
8. 问"下一 stage" → L2 应输出 "L1-flow → shadow-l1-flow"

---

> 文档生成时间: 2026-06-05
> 关联文件: `plugins/shadow-hooks.ts` (已有 stage 顺序 + status.md 注入的雏形, 本设计是其超集)
> 设计思路: 把 Walker 的"自觉走流程"改为"plugin 强校验 + 自动标 DONE", 不再依赖 agent 内在善意。
