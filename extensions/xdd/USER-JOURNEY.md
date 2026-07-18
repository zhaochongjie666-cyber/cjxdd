# xdd 用户旅途：端到端生产力手册

> xdd 是一套"从意图到交付"的结构化流程，作为 pi coding agent 的 inline extension 实现。
> 这份文档描绘**用户视角**的完整旅途：从输入什么，到获得什么；从 happy path 到所有分支、迂回、意外、探索。代表系统真实的生产力面。

---

## 0. 一句话总结

```
用户输入：/xdd <任务>
用户获得：经过 10 阶段、5 道硬 Gate、零异常退出的、可验证的代码变更 + .xdd/ 设计文档 + .xdd/archive/ 历史归档
系统承诺：没完成不退出，状态永远可恢复，agent 卡住自动升级策略，组级 Gate 自动推进（硬检查通过 = 产物达标 = 直接走）
```

**用户只需一句话。** 组级 Gate 不再暂停等人审 -- 硬检查通过就自动推进到下一组。想中途看进度随时 `/xdd-status`，想介入随时发消息打断。
```

---

## 1. 用户旅途的 5 层次（xdd 设计语言）

xdd 在 `stages.ts` 中明确要求 agent 梳理用户旅途时覆盖 5 个层次，这里用同一种结构来组织这份文档本身：

| 层次 | 含义 | 本文档章节 |
|------|------|------------|
| **主线** | 正常一路推到 verify 交付 | §3 |
| **分支** | 不在主流程上的辅助能力（brainstorm / polish / reverse）| §4 |
| **迂回** | 暂停 → 恢复（resume / status / continue）| §5 |
| **意外** | 失败处理（gate fail / diagnose / rollback）| §6 |
| **探索** | 调试、追溯、归档（trace / observe / archive）| §7 |

---

## 2. 输入面：用户能做的全部动作

### 2.1 Slash 命令（5 个）

| 命令 | 输入 | 输出 | 何时用 |
|------|------|------|--------|
| `/xdd <任务>` | 自然语言描述（中文/英文皆可） | 启动一个完整 10 阶段 run | 想做新功能、修复、改架构 |
| `/xdd-continue` | 无 | 手动推进（组级 Gate 已自动推进，此命令仅用于手动场景）| 极少用 -- 组级 Gate 现在自动推进 |
| `/xdd-resume` | 无 | 从 `.xdd/checkpoint.json` 恢复 run | pi 崩了 / 误关 / 隔天继续 |
| `/xdd-status` | 无 | 当前阶段 + 进度 + 剩余阶段 + 已完成产物 | 想看走到哪了 |
| `/xdd-archive [run]` | 可选 run 名 | 总结 runs/xdd_run/ 写到 `.xdd/archive/` + 删 runs/ | run 跑完不立刻归档、想清理时手动触发 |

### 2.2 工具（agent 内部用，不直接面向用户，但用户通过观察 prompt 看到它们在工作）

11 个：observe / desired_state / difference / next_task / submit_artifact / advance / rollback / diagnose / trace / list_skills / load_skill。agent 在每个阶段都按顺序调用：observe → desired_state → difference → 干活 → submit_artifact → advance。

### 2.3 Skills（按阶段自动装载，21 个）

每个 stage 有主 skill 自动注入 system prompt，agent 可显式调 `xdd_load_skill` 装载辅助 skill：

```
主 skill (10):
  init → xdd-init
  understand → xdd-brainstorm
  spec → xdd-spec
  architecture → xdd-architecture
  wire → xdd-wire
  resilience → xdd-resilience
  plan → xdd-plan
  execute → xdd-execute
  cleanup → xdd-cleanup
  verify → xdd-verify

辅助 skill (11):
  xdd-polish (事后批评) / xdd-reverse (逆向) / xdd-skill-creator / xdd-frontend /
  xdd-backend / xdd-gherkin-plus / xdd-mermaid-check / xdd-docker-helper /
  xdd-git-commit / xdd-reverse
```

---

## 3. 主线：Happy Path 完整流程

### 3.1 总览（10 阶段 × 4 组 × 5 道 Gate）

```
                   ┌───────── Discovery (3 阶段 × 2 Gate) ─────────┐
                   │                                                │
   /xdd <任务> ──▶ init ──▶ understand ──▶ spec ──┐ GATE 1 (设计收敛)│
                   └──────────────────────────────│──────────────────┘
                                                  ▼
                   ┌───── Architecture (3 阶段 × 1 Gate) ───────────┐
                                                  │ GATE 2 (架构 + 韧性) │
                          architecture ──▶ wire ──▶ resilience ─────┤
                   └────────────────────────────────────────────────┘
                                                  ▼
                   ┌───── Implementation (3 阶段 × 1 Gate) ─────────┐
                                                  │ GATE 3 (计划)      │
                          plan ──▶ execute ──▶ cleanup ──────────────┤
                   └────────────────────────────────────────────────┘
                                                  ▼
                   ┌───── Verification (1 阶段 × 1 Gate) ───────────┐
                                                  │ GATE 4 (验证报告)  │
                          verify ──┐ DONE (runComplete = true)      │
                   └──────────────────────────────│──────────────────┘
                                                  ▼
                                       自动 /xdd-archive 归档
```

### 3.2 每阶段的"用户看到什么 / 获得什么"

| 阶段 | skill 注入 | 用户输入 | 用户获得（产物落盘） | Gate 检什么 |
|------|-----------|---------|------------------|------------|
| **init** | xdd-init | — | `.xdd/` 骨架（runs/ design/ archive/ checkpoint） | softPass（无硬交付）|
| **understand** | xdd-brainstorm | 任务描述（已在 /xdd 时给）| `.xdd/design/intent.md` `.xdd/design/design.md` `.xdd/design/notes/` | intent.md + design.md 含 4/5 关键词（Selected/Alternatives/Assumptions/Out of Scope/Open Questions）+ goals.md |
| **spec** | xdd-spec | — | `.xdd/design/spec/<BXX>/rules.md` `.feature` | rules.md ≥ 100 字符 + `.feature` 存在 + **BDD 不能含实现角色**（拒绝 调度器/线程池/重试/锁/CAS 等）|
| **architecture** | xdd-architecture | — | `.xdd/design/architecture/<BXX>/architecture.md` + `module-landscape.md` `event-contract.md` `aggregate-landscape.md` | 3 份全局文件 ≥ 100B + 每 BXX architecture.md 含 3/4 关键词（模块/依赖/数据流/失败）+ 失败模型有 retry |
| **wire** | xdd-wire | — | 仓库代码变化（CI 套件能跑的基础） | git 有变更（排除 .xdd/ 设计文档）|
| **resilience** | xdd-resilience | — | `.xdd/design/resilience/<BXX>/failure-modes.md` `failsafe.md` `test-plan.md` | 3 份文件 ≥ 100B + 含 RXX 覆盖 |
| **plan** | xdd-plan | — | `.xdd/runs/xdd_run/plan.md` | plan.md ≥ 100B + 含步骤 |
| **execute** | xdd-execute | — | 真实代码（每个 RXX 有对应实现，源码含 `@implements RXX` 标注） | 至少 1 处 `@implements R\d` 真实代码标注 |
| **cleanup** | xdd-cleanup | — | 删除临时脚本、调试 print、死代码 | softPass（无硬交付，质量由 verify 把关）|
| **verify** | xdd-verify | — | `.xdd/runs/xdd_run/verify-report.md` + 真实测试通过 | rules.md + verify-report.md ≥ 100B + **真实测试 exit 0**（npm test / go test / make test）|

### 3.3 完整一次主线：用户视角的时间线（示例任务："为 pingflow 加一个告警阈值功能"）

```
T+0    用户：/xdd 给 PingFlow 加告警阈值，超阈值时发 webhook
       系统：自动装载 xdd-init skill，agent 写出 .xdd/ 骨架
T+1m   agent：xdd_desired_state → 列出 init 的期望状态（基本空）
       agent：xdd_difference → 空 diff = 通过
       agent：xdd_submit_artifact → 写 .xdd/ 骨架 → softPass
       agent：xdd_advance → init 完成
       
T+2m   agent 自动推进到 understand（agent_end hook 发 "继续 understand 阶段"）
       装载 xdd-brainstorm
       agent：调 xdd_list_skills 看有什么 → 调 xdd_load_skill(xdd-spec) 预先了解下游
       agent：调 read 工具读 README / docs/
       agent：产出 intent.md + design.md + notes/user-journey.md
              用户看到一段：
                "已梳理用户旅途：
                 主线：探测→阈值检查→触发 webhook
                 分支：阈值关闭时跳过
                 迂回：webhook 失败时本地日志
                 意外：阈值配置缺失时降级到默认
                 探索：webhook 重试"
       agent：xdd_submit_artifact → Gate 检查 design.md 含 4/5 关键词 → 通过
       agent：xdd_advance → understand 完成
       
T+5m   spec 阶段
       装载 xdd-spec
       agent：写出 rules.md（13 条 RXX 规则）+ .feature（13 个文件，含异常 Scenario）
              用户看到 prompt 里：
                "R01 当采集周期到点，触发阈值检查
                 R02 当阈值超过 high_water，发 webhook
                 R03 当 webhook 失败，本地日志记录（异常路径）
                 ...
                 边界规则：
                 R11 不允许业务方直接调用 threshold-engine（实现细节泄漏）
                 R12 不允许同步阻塞 webhook 调用（性能约束）"
       Gate：rules.md ≥ 100B ✓ .feature 存在 ✓ 无实现角色 ✓
       agent：xdd_advance → spec 完成 → **GATE 1 触发**（组级 Gate）

T+6m   【用户旅途关键点：GATE 1 人工审】
       before_agent_start hook 检测 pendingGroupApproval：
         返回 "不要继续工作，等用户审"
       用户在 pi REPL 看到：
         ┌─────────────────────────────────────┐
         │ GATE 1 (Discovery) 通过              │
         │ - intent.md ✓ design.md ✓            │
         │ - 13 RXX 规则 ✓ 13 .feature ✓        │
         │ 输入 /xdd-continue 推进到架构组      │
         └─────────────────────────────────────┘
       用户：/xdd-continue
       系统：清 pendingGroupApproval → planIndex 移到 architecture 阶段
       
T+8m   architecture 阶段
       装载 xdd-architecture
       agent：写 3 份全局文件（module-landscape / event-contract / aggregate-landscape）
              写 3 份 BXX architecture.md（每份含 模块/依赖/数据流/失败 + retry）
              写 flow.mermaid
       Gate：3 全局文件 ≥ 100B ✓ 3 架构文件 3/4 关键词 ✓ 失败模型有 retry ✓
       agent：xdd_advance → architecture → wire → resilience 都通过 → **GATE 2**

T+15m  【用户旅途关键点：GATE 2 人工审】
       用户看到架构决策总览
       用户：/xdd-continue

T+18m  wire 阶段
       装载 xdd-wire
       agent：拉起 npm install / 初始化项目骨架
       Gate：git 有变更 ✓（.xdd/ 文档不算）
       agent：xdd_advance → wire 完成

T+25m  resilience 阶段 → 完成 → **GATE 2 已通过**（其实 wire/resilience 也走 GATE 2 边）

T+27m  【如果 GATE 3 在 plan 之前需要审，这里再停一次；当前 architecture 组是 GATE 2】
       用户：/xdd-continue

T+30m  plan 阶段
       装载 xdd-plan
       agent：把 13 个 RXX 拆成 30 个 TDD task
              写到 .xdd/runs/xdd_run/plan.md
       Gate：plan.md ≥ 100B ✓
       → **GATE 3**

T+32m  【GATE 3 审】用户：/xdd-continue

T+35m  execute 阶段（最长）
       装载 xdd-execute
       agent：一轮调 xdd_next_task 拿下一个 RXX
              写测试 + 写实现（带 `@implements RXX` 标注）
              调 xdd_submit_artifact（Gate 检查源码有 `@implements R\d`）
              调 xdd_advance → next task
              ...重复 30 轮...
       用户在这一阶段最常见的是：看到 agent 在工作，可能需要滚动去看产物。
       如果某个 RXX 失败：
         → xdd_diagnose（诊断哪一层根因）
         → xdd_rollback 回退到上一个干净状态
         → 重做

T+90m  cleanup 阶段
       装载 xdd-cleanup
       agent：删调试 print、删未用 import、整理 import 顺序
       softPass → 不需要审

T+92m  verify 阶段
       装载 xdd-verify
       agent：跑 npm test（requireTestsPass 检测）→ exit 0 ✓
              写 verify-report.md
       Gate：rules.md ✓ verify-report.md ≥ 100B ✓ npm test exit 0 ✓
       → **GATE 4**

T+95m  【GATE 4 审】用户：/xdd-continue

T+96m  【runComplete = true】
       agent_end hook 检测到 runComplete → 不再自动推进
       session_before_tree hook 写阶段摘要到 pi 的 session tree
       自动调 archiveXdd → 总结 runs/xdd_run/ → 写 .xdd/archive/xdd_run.md → 删 runs/xdd_run/
       用户看到：
         ┌─────────────────────────────────────────────┐
         │ xdd run 完成                                 │
         │ - 13 RXX 全部实现（@implements 标注齐全）      │
         │ - 30 测试全过                                  │
         │ - 归档：.xdd/archive/xdd_run.md 已写入          │
         │ - design/ 完整保留（13 .feature + 3 架构文件）  │
         └─────────────────────────────────────────────┘
```

---

## 4. 分支：辅助流程

### 4.1 `/xdd-brainstorm`（不进 run，仅思考）

不启动完整 10 阶段，只装载 xdd-brainstorm skill。agent 跟用户对话，把意图写到 `.xdd/design/notes/brainstorm.md`。适合：

- "我想做 X 但还没想清楚"
- "帮我列一下可能的方向"
- 输出：脑暴笔记 + 推荐的方向（但不动手）

### 4.2 `/xdd-polish`（事后批评）

xdd run 完成后，调 xdd-polish skill，对交付物做对抗性审视：

- 设计是否过度工程？
- 是否有更简单的方案？
- 失败模式覆盖够不够？
- 输出：批评清单 + 建议改动（但不自动改）

### 4.3 `/xdd-reverse`（逆向）

从现有代码反向生成设计文档：

- 给一段已存在的代码 → 产出 intent.md + design.md + RXX 规则
- 适合：接手 legacy 项目、补文档、把代码提升为有 spec 的项目

### 4.4 单 skill 装载（agent 在跑的过程中随时可调）

```typescript
xdd_list_skills      // 看所有 xdd skill
xdd_load_skill("xdd-frontend")  // 把前端规范注入当前阶段 prompt
```

适合：execute 阶段发现需要前端规范、调 gherkin-plus 深化 BDD、调 mermaid-check 校验架构图。

---

## 5. 迂回：暂停 / 恢复 / 状态查询

### 5.1 暂停场景

| 触发 | 现象 | 用户做什么 |
|------|------|----------|
| **组级 Gate 通过** | pendingGroupApproval 设了，agent 自动停 | `/xdd-continue` |
| **用户主动 `/xdd-status`** | 看到当前阶段 + 剩余 + 已完成 | `/xdd-continue` 推进 / `/xdd-archive` 归档 |
| **agent_end 3 轮无进展**（不会发生，新版改"升级策略"非"停止"）| n/a | n/a |
| **pi 误关** | checkpoint 在盘上 | 重新开 pi，`session_start` hook 自动通知 `/xdd-resume` |

### 5.2 恢复流程

```
场景 1：pi 在 GATE 1 之后误关（最常见）

  重新启动 pi
  session_start hook 检测到 checkpoint：
    "[xdd] 检测到未完成的 xdd run（run-1742-...）。输入 /xdd-resume 恢复"
  用户：/xdd-resume
  系统：
    读 .xdd/checkpoint.json
    恢复 state (planIndex / stage / 阶段已通过的 gate 状态)
    自动 sendUserMessage "[xdd resume] 当前阶段：architecture（组 2/4）"
  用户审一下当前在哪 → 继续
```

```
场景 2：昨天开了 run，今天接着做

  /xdd-status
    "run-1742-... │ architecture │ 5/10 阶段 │ 通过 Gate 1，停在 Gate 2 前"
  /xdd-resume
    重新激活 state
```

### 5.3 状态查询（`/xdd-status`）的真实输出

```
┌─ xdd run 状态 ─────────────────────────────┐
│ runId      run-1742700000000-abc123        │
│ cwd        /home/u/proj                    │
│ planIndex  5 / 10 (architecture)          │
│ runComplete false                          │
│ pendingApproval { group: 'architecture' }  │
│ archived   false                           │
│                                             │
│ 阶段进度:                                    │
│   init ✓      understand ✓   spec ✓        │
│   architecture [doing]                      │
│   wire ⬜     resilience ⬜   plan ⬜       │
│   execute ⬜  cleanup ⬜      verify ⬜     │
│                                             │
│ 产物:                                        │
│   .xdd/design/intent.md ✓                   │
│   .xdd/design/design.md ✓ (4/5 关键词)       │
│   .xdd/design/spec/B01/rules.md ✓           │
│   ...                                       │
│                                             │
│ ledger (this stage):                        │
│   attempt 1: gate_pass                      │
│                                             │
│ 输入 /xdd-continue 推进                     │
└─────────────────────────────────────────────┘
```

---

## 6. 意外：失败处理

### 6.1 Gate 失败的恢复路径

```
agent 写完产物 → xdd_submit_artifact
  └─ Gate 跑真实检查（exit code / glob / 关键词 / pattern）
       │
       ├─ Gate 通过 → 写信号 + advance
       │
       └─ Gate 失败 → agent 看到错误文本
              │
              ├─ 自愈预算剩 (默认 3 次)
              │   agent 重做 → 重提 → 仍可继续
              │
              └─ 自愈预算耗尽 → 强制走 diagnose + rollback
                     agent 调 xdd_diagnose 记根因层（intent/spec/arch/...）
                     agent 调 xdd_rollback 回退到上一个干净阶段
                     agent 重做该阶段 → 再提
```

**示例：spec 阶段 rules.md Gate 失败**

```
attempt 1: rules.md 只有 80B → Gate 要求 ≥ 100B → FAIL
  self-heal budget: 3 → 还剩 3
attempt 2: agent 补充规则到 130B → Gate ✓ → PASS
```

**示例：verify 阶段 requireTestsPass 失败**

```
attempt 1: npm test exit 1 → FAIL（5 测试失败）
  budget 3 → 还剩 3
  agent 调 xdd_diagnose → 根因层 "test-gap"
attempt 2: agent 修了 3 个实现 bug → 重提 → exit 0 → PASS
```

### 6.2 agent 卡住（3+ 轮无进展）

xdd 的 `agent_end` hook 现在**不会停**（"升级策略"非"停止"）：

| stalls 计数 | 行为 |
|------------|------|
| 0-2 | 发 "继续 ${stage} 阶段" |
| 3-5 | 发 "已连续 N 轮无进展。请改变策略：调 xdd_diagnose 诊断，或 xdd_rollback 回退。不要重复。" |
| 6+ | 发 "严重卡住。必须 xdd_rollback 回退，或向用户提问求助。" |

**关键设计**：永不退出 run。agent 永远收到一条新指令，强制换思路而非重复。

### 6.3 pi 崩溃

- checkpoint.json 每阶段写一次（在 `.xdd/runs/xdd_run/checkpoint.json` 或项目根 `.xdd/checkpoint.json`）
- session_start hook 启动时检测 → 通知用户 → 用户调 `/xdd-resume`
- run 状态完全可恢复（planIndex / stage / 通过的 gate / signal / pendingGroupApproval）

### 6.4 阶段跑过头（execute 太多轮）

xdd 不硬限执行轮数，但 agent 在 execute 阶段每轮调 `xdd_next_task` 拿下一个 RXX。如果 RXX 跑完，next_task 返回"no more tasks"，agent 自然提交，verify 自然跑。

---

## 7. 探索：调试、追溯、归档

### 7.1 `xdd_trace`：追溯覆盖健康度

```
xdd_trace
  spec/RXX vs 代码 @implements 双向比对
  输出：
    RXX→code 覆盖率: 12/13 (92%)
    code→RXX 孤儿标注: 2 处（@implements R99 但 R99 不存在）
    双向闭环健康度: ✓ 覆盖 / ⚠ 孤儿
```

用户在 verify 阶段看到 `xdd_trace` 报告，发现实现遗漏或多余标注，回去补 RXX。

### 7.2 `xdd_observe`：当前状态（内存 + 磁盘真值）

```
xdd_observe
  内存簿记（state）+ 真实磁盘扫描（.xdd/ 全树）
  不一致时磁盘为准（设计原则：磁盘是 SSOT）
  输出当前 stage / gate 状态 / 已写文件 / 待写文件
```

agent 用它做 Gate 前的预检；用户用 `/xdd-status` 看高层。

### 7.3 `xdd-archive`：归档清理

```
手动触发：/xdd-archive xdd_run
  → archiveRun(cwd, "xdd_run")
    读 runs/xdd_run/*（全读）+ design/*（仅读，永久保留）
    写 .xdd/archive/xdd_run.md（摘要）
    删 runs/xdd_run/*（不是搬走）
  自动触发：runComplete 后 agent_end hook 调
```

用户获得：仓库不被 runs/ 污染（git diff 干净），但归档在 `.xdd/archive/` 持久保留。

**design/ 字节级不变**（SHA256 验证过），runs/ 被总结 + 删除，避免越积越多。

---

## 8. 系统对用户的承诺

| 承诺 | 实现机制 |
|------|---------|
| **没完成不退出** | `agent_end` 自动推进 + 升级策略（永不停止）|
| **状态永远可恢复** | 每阶段 checkpoint + `session_start` 检测 + `/xdd-resume` |
| **不污染仓库** | runs/ 完成后自动归档 + 删除；design/ 永久保留 |
| **硬 Gate 真把门** | `requireTestsPass` 跑真实 `npm test`/`go test`/`make test`，exit code 判断 |
| **组级必有人审** | `pendingGroupApproval` + `before_agent_start` "do not continue" prompt |
| **5 层用户旅途覆盖** | stages.ts 把"主线/分支/迂回/意外/探索"写进 `understand` 期望状态 |
| **BDD 不泄露实现** | spec Gate 关键词 + skill GATE 文档禁止 When/Then 含实现角色 |
| **设计 ≠ 实施边界** | Phase 1/2 不许读源代码（noCodeReading prompt 约束）|

---

## 9. 真实生产力示例（end-to-end 工作流）

### 9.1 "我要做一个新功能"

```
T+0    用户：/xdd 给 web app 加 OAuth 登录
T+10m  Discovery 组完成，用户审 Gate 1
T+25m  Architecture 组完成，用户审 Gate 2
T+30m  Plan 完成，用户审 Gate 3
T+90m  Execute 完成（30 个 TDD task）
T+92m  Cleanup 自动跑
T+95m  Verify 全过，用户审 Gate 4
T+96m  自动归档，run 完成
总耗时：~1.5 小时，其中用户实际介入 ~10 分钟（4 次 Gate 审）
```

用户实际做的事：
1. 启动时输一句话（10 秒）
2. 4 次 `/xdd-continue`（每次 30 秒审一下 + 按回车）
3. 期间可能 `/xdd-status` 看几次（每次 5 秒）

**用户净投入**：~3 分钟。**系统净产出**：完整 spec + 架构 + 测试覆盖的实现 + 设计文档永久保留。

### 9.2 "我接手了一个 legacy 项目"

```
T+0    用户：/xdd-reverse 把 src/ 现有代码逆向为 spec
T+5m   自动产出 intent.md + design.md + RXX 规则
T+10m  用户：/xdd 给 legacy 加 OAuth（已有 design 跳过 Discovery）
       直接从 architecture 开始，省 30 分钟
```

### 9.3 "我昨天开了个 run，今天继续"

```
T+0    用户启动 pi
       session_start hook 自动通知 "/xdd-resume"
T+30s  用户：/xdd-resume
       状态恢复，继续昨天停在 architecture 的阶段
```

### 9.4 "agent 卡死了"

```
T+0    用户看到 agent 在 verify 阶段反复失败
T+3m   agent 自己触发 xdd_diagnose（"test-gap"）→ xdd_rollback → 重做
       （新版升级策略会在第 3/6 轮直接注入"换策略"提示）
```

---

## 10. 配置文件 + 文档资源

| 资源 | 路径 | 用户改不改 |
|------|------|----------|
| 主控循环文档 | `core.md` | 不改 |
| Stage + Gate 定义 | `extensions/xdd/stages.ts` | 不改 |
| Gate 实现（requireTestsPass 等）| `extensions/xdd/gate.ts` | 不改 |
| Skill 体系 | `skills/xdd-*/SKILL.md` | 不改（改也改 skill 内容，不是框架）|
| Agent 编排 | `agents/phase-*.md` `agents/xdd-*.md` | 不改 |
| 用户 run 产物 | `.xdd/runs/xdd_run/` | 改也无所谓（运行完会被归档）|
| 用户设计产物 | `.xdd/design/` | **不要手动改**，由 agent 写 |
| 归档 | `.xdd/archive/` | 只读 |

---

## 11. 故障排查速查

| 现象 | 原因 | 解决 |
|------|------|------|
| `pi` 启动报 "does not export a valid factory" | index.ts 缺 `export default` | 已修：加 `export default xddInlineExtension.factory` |
| `pi` 启动报 "registerEntryRenderer is not a function" | pi 版本 < 0.81 dev | 已修：guard `typeof pi.registerEntryRenderer === "function"` |
| agent 在某阶段反复失败 | Gate 不通过 + 自愈预算耗尽 | 看 xdd_diagnose 根因 → 手动调 xdd_rollback → 重做 |
| run 卡在 architecture 不动 | 可能是 pendingGroupApproval | `/xdd-continue` |
| 找不到归档 | run 未完成或已 runComplete 但未触发归档 | `/xdd-archive xdd_run` 手动归档 |
| verify 报 "requireTestsPass not found" | package.json 无 test 命令 | 加 `scripts.test` 或暂时跳过（soft pass）|

---

## 12. 给用户的 5 条心法

1. **信任 Gate** — 4 道组级 Gate 是真把门，不是装饰。审一下不亏。
2. **审而不写** — 用户在 Gate 处是 reviewer，不是 author。让 agent 干活。
3. **状态可恢复** — 任何中断（关 pi/断网/崩溃）都有 checkpoint，开了就接着跑。
4. **设计留底** — `.xdd/design/` 是项目永久设计，**不会被归档删掉**。
5. **runs 是临时** — `.xdd/runs/` 是当次 run 的草稿，run 完会被总结+删，不要在里面放永久内容。

---

**总投入产出比**：~3 分钟用户操作 → ~1.5 小时结构化产出的可验证代码 + 永久设计文档 + 归档历史。