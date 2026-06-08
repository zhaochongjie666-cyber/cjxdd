# Shadow Framework — 工作流总览 (Review 2026-06-08)

> **本文件目的**: 鸟瞰 Shadow framework 整体, 让 reviewer (你) 一眼看懂:
> 1. 流程怎么走 (30→31→31.5→Scaffold→32→33→35→36)
> 2. 信息怎么流 (用户模糊需求 → 生产部署)
> 3. 关键 guard 在哪 (R3/R5/R11 + 4 维 audit + zh-continue)
> 4. 最新机制怎么叠加 (L0 v2 / L5 v5 / v5.1 / v5.2 / L2 v9.2 / cjgoal v3)
> 5. 已知限制 + 未来工作
>
> 配套文档: `CLAUDE.md` (项目级工作流) / `README.md` (安装/快速开始) / `docs/architecture.mmd` (架构图).

---

## 1. 整体定位

**Shadow** 是 **meta-project**: 不是应用代码, 是 AI 驱动软件开发的**完整 framework**.

| 维度 | 值 |
|------|---|
| 形态 | AI agent + 工具箱 (skill 集合) |
| Agent | 1 个工匠型 `shadow-walker` (3 变体: CC/OC 共用 + pi + worker) |
| Skills | 26 个 (14 核心流水线 + 12 utility) |
| Harness | 3 个 (Claude Code / OpenCode / pi) |
| 用户 | 产品开发者 (用 Shadow 开发产品项目) |
| 自身 | Shadow 自身也是用 git + smoke 维护的代码库 |

**哲学**:
- 严苛工作流: 走 Shadow = 严丝不漏 (no-advisory)
- 工匠底线: no stub, no fake, no "DONE" 假完成
- 传导链追溯: 7 类 ID 从意图到代码全链

---

## 2. 4 层抽象 + 7 大阶段

```
┌─────────────────────────────────────────────────────────────────────┐
│ User task: "想做一个 XX 系统"                                        │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 30 发散调研      shadow-l0-research (v2 — brainstorm + L1 消费)    │
│                  产出: 9 份发散笔记本 + 00-l1-recap + 08-brainstorm  │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 31 业务层 (4 个 skill 串行)                                          │
│   • shadow-l1-research   DDD+EDD+IDDD → intent.md / BXX research.md │
│   • shadow-l1-flow       MDD → project.flow.mermaid (BXX-NYY)       │
│   • shadow-l1-spec       FDD → spec.md (RXX 规则)                   │
│   • shadow-l1-wire       SVG 线框图 (data-page / data-action)        │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 规模判定           .shadow/scale.md (S / M / L, strict=L by default)│
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 31.5 架构         shadow-l1p5-architecture (ADD+SDD+PDD)             │
│                  产出: architecture.md (D1..D20) + aggregate +       │
│                        event-contract (EDD 独立契约)                  │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 搭脚手架          shadow-scaffold (7 步 Docker 开发环境)            │
│                  产出: docker-compose + Hello API + smoke test       │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 32 验收         shadow-l2-e2e (v9.2 — Design-Conformance Gherkin)    │
│                  产出: e2e.md + 覆盖矩阵 + uat-script.md + 8 BXX     │
│                        Gherkin (业务约束翻译成可测试 step)            │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 33 韧性设计      shadow-l3-resilience (RDA, 8/9 维失败模式穷举)     │
│                  产出: failure-modes / failsafe-design / chaos-      │
│                        scenarios / resilience-test / runbook          │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 35 计划         shadow-l5-plan (v5.1 — plan 是入口+索引, @upstream)  │
│                  产出: harness-plan.md (逐文件指令 + @upstream 矩阵)  │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 35 实施         shadow-l5-impl (v5.2 — Pre-write Signoff)            │
│                  产出: 真实代码 + 测试 + 文件头 @implements RXX      │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 全链路审查      shadow-reviewer (chain, 必经, 不可跳过)              │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 36 部署验证      shadow-l6-deploy (Phase 0-9, 3 轮修复 cap, R11)     │
│                  产出: docker-compose 真实起 + 真实账号 + 真实链      │
│                        路 + 9/10 步真实验证 + chaos drill             │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
                   ✅ Production-Ready / SHIPPED
```

---

## 3. 4 类核心抽象 (每层解决不同问题)

| 层 | 抽象 | 解决什么问题 | 关键产物 |
|----|------|-------------|---------|
| **L1 业务** | **业务是什么** (DDD+EDD+IDDD 思维) | 业务理解 / 统一语言 / 事件风暴 | intent.md / business-landscape / BXX research.md / project.flow.mermaid / spec.md (RXX) / wire.svg |
| **L1.5 架构** | **怎么实现** (ADD+SDD+PDD 思维) | 质量属性驱动决策 / 安全设计 / 性能设计 | architecture.md (D1..D20 决策) / aggregate-landscape.md / event-contract.md |
| **L2 验收** | **行为对不对** (BDD+CM 思维) | 14 维覆盖矩阵 / 6 维画像 / 5 层旅程 / Design-Conformance 业务约束 | e2e.md / coverage-matrix.md / uat-script.md / 8 BXX Gherkin |
| **L3 韧性** | **失败怎么办** (RDA 思维) | 8/9 维失败模式 / 10/12 兜底机制 / 混沌场景 / 恢复剧本 | failure-modes.md / failsafe-design.md / chaos-scenarios.md / resilience-test-matrix.md / runbook |
| **L5 计划** | **怎么机械执行** (Harness 思维) | 入口 + 索引, @upstream 引用矩阵, Pre-write Signoff 准备 | harness-plan.md (逐文件 + @upstream) |
| **L5 实施** | **真的写代码** (TDD 思维) | Pre-write Signoff + @implements + 测试断言派生 | 真实代码 + 测试 + 文件头标注 |
| **L6 部署** | **真能用** (生产契约) | 真实持久化 / 真实认证 / 跨服务链路 / R11 4 层验证 | docker-compose 起的服务 + 9/10 步验证 + chaos drill |

**关键设计**: L1-L3 是"设计" (向后看: 业务 / 架构 / 行为 / 韧性), L5-L6 是"实现" (向前看: 机械执行 + 真实验证). L1.5 跨中间.

---

## 4. Walker: 工匠型 Agent (不是 Dispatcher)

`agents/shadow-walker.md` (641 行) 是 framework 的核心 agent. **不是 dispatcher** — 自己读文件、写代码、跑命令. 装一个 skill, 跟 SKI33.md 当执行脚本.

### 5 步节奏 (Walker 装 skill 后必走)

```
① 装 skill 工具 (shadow-l0-research)
② 写 checklist 到 status.md (本 stage 5-10 子任务)
③ 按 skill 流程干, 落到预期路径 (.shadow/...)
④ 自检 + 标 ✅ DONE (status.md 状态更新)
⑤ 加载下一 stage skill (shadow-l1-research)
```

### Meta 守卫 (本仓库禁用)

`agents/shadow-walker.md` / `shadow-worker.md` / `shadow-walker-pi.md` 顶部都加 "Meta 守卫" 段. CWD 命中 cjxdd 仓库自身 → 立即拒绝执行 + 提示用户直接改源码.

防御: `hooks/user-prompt-submit.sh` 加 Meta 旁路, CWD 在 cjxdd 时不触发 walker 加载引导.

### Walker frontmatter 工具名约定

故意**不写 `tools` 字段** — CC 跟 OC schema 互斥:
- CC: `tools: "Read, Write, Edit"` (逗号分隔字符串)
- OC: `tools: { read: true, write: true }` (对象映射)
- 省略 = 两边都默认"全工具开放" ✓

---

## 5. 信息流: 7 类 ID 全链追溯

```
intent.md (为什么做)            → @intent 段
  ↓
BXX research.md (业务领域)      → @business-context
  ↓
project.flow.mermaid (BXX-NYY)  → @flow 节点引用
  ↓
spec.md (RXX 规则)              → @implements 标注
  ↓
architecture.md (API 端点)      → @upstream: arch.md §API.X
  ↓
event-contract.md (事件契约)    → @upstream: event-contract.md §EventName
  ↓
failure-modes.md (FMEA)         → @upstream: failure-modes.md §F0N
  ↓
harness-plan.md (逐方法指令)    → @upstream 引用矩阵
  ↓
代码 (@implements RXX + @intent + @upstream)
```

**v5 修订**: 计划是"入口 + 索引", 上游是 "detail". 技术细节内联, 设计背景索引. Coder 写代码前**必读**上游 5 必读 (intent / spec / arch / wire / FMEA) + 按需 (event / aggregate / e2e).

---

## 6. Iter 模型: 多轮开发, 共享 vs 隔离

```
.shadow/
├── current-iteration          ← "iter-2"
├── iterations/
│   ├── iter-1/                ← 旧需求 (冻结, 不删作审计基线)
│   │   ├── pipeline/status.md
│   │   └── gate/
│   └── iter-2/                ← 当前活跃
├── 31-business/               ← 跨 iter 共享, in-place 编辑
├── 31.5-architecture/         ← 共享
├── 32-e2e/                    ← 共享
├── L3-resilience/             ← 共享
└── 35-plan/                   ← 共享
```

**iter-N 启动**:
1. 创建 `iterations/iter-N/`
2. 复制 iter-N-1 status.md (清零状态)
3. 走 L0 (v2 — 先读 L1 增量, brainstorm 引导问, 7 笔记本)
4. 走变更传播表 (改了什么 → 哪些 stage 重跑)
5. 不全跑 (增量跑下游)

**iter 间设计冲突保留正向 (v5.1 新机制)**:
- 旧 plan/code 跟新 spec/arch 冲突时, **保留正向** (新设计)
- 3 态标记: ⛔ 反向 (旧 code 改) / ✅ 正向 (新加) / 🔄 修改 (增量改)
- 4 机制: `@iter` 标记 / `plan-iter-check` / 变更记录 schema / `plan-iter-diff audit`

---

## 7. Scale 模型: 严苛默认值 (strict-default)

| scale | l3_extended_mode | 失败模式 | 兜底 | FMEA 字段 |
|-------|-----------------|---------|------|----------|
| **S** | false | 8 维 | 10 模式 | 5 字段 |
| **M** | false | 8 维 | 10 模式 | 5 字段 |
| **L** | **true** | 9 维 (+ 跨地域) | 12 模式 (+ 业务对账 + 业务幂等) | 8 字段 (+ Owner + SLO + 回滚时长) |

**Strict-default (用户偏好 `strict-mode-default`)**: 走 Shadow 默认按 L 规模 + 扩展模式跑, 5 个下游字段不读 scale 标签. 降级必须显式 (改 `.shadow/scale.md` 字段). 不重写老 demo.

**Scale 判定** (4 维度最大值): bizline count / total rule count / page count / external dependency count.

---

## 8. 门禁: 硬 vs 软

| 门禁 | 抓什么 | 力度 | 实施位置 |
|------|--------|------|---------|
| **R3 evidence_archive** | 关键证据是否写了 (L6 wander/chaos/issues.json) | 软警告 | `post-write-stub-scan.sh:89-155` |
| **R5 hard-gate** | 5 角色 lifecycle 一致 | **hard** | `stop-gate.sh:216-240` |
| **R10 自动归档** | iter 完成时归档 | 自动 | `stop-gate.sh:255+` |
| **R11 真实烟雾测试** (v6.2) | 4 层验证 (marker / 解析 / 测试 / hash) | **新项目 hard, 老项目 advisory** | `plugins/shadow-hooks.ts:§9` + `gate-check-lifecycle.sh:307-412` |
| **L0 重做门禁** (P0-Y) | per-iter 14 天 mtime | Round 1 软警告, Round 2 计划 hard | `pre-skill.sh:114-140` |
| **L5 Consistency Audit** (§13) | 4 维 (spec↔code / wire↔code / arch↔code / l3↔code) ≥ 0.9 coverage | **hard** | `plugins/shadow-hooks.ts:auditL5Consistency` |
| **L5 5 段 stop-gate** | stub / pending / drift / lifecycle / R5 | **全 hard (v15 no-advisory)** | `stop-gate.sh` 5 段编排器 |
| **L5 unresolved 跨轮保活** (§11.1) | L5 warning 跨轮可见 | 软压力, 3 试升 hard | `plugins/shadow-hooks.ts:§11` |
| **3 试 HALT** (§15) | unresolved.count > 3 升级 HALT | **hard** | `.l5-halt.json` + L1 system 注入 |
| **bypass-shdw: 显式化** (§11.2) | 显式 bypass 必带 reason | audit log | L5 stop-gate 段 1.5 |
| **zh-continue schema 拒收** | 模糊词触发 hook hint → server 拒收 message | **hard (fix)** | `user-prompt-submit.sh:134-144` 静默 |
| **5 段压力信号** (RUSH/TIME/SKIP/SIMPLIFY/WORKLOAD) | AI 加速跳过意图 | 软提醒 | `hooks/lib.sh:check_pressure_signals` |
| **§14 模型 API error 兜底** | 内容过滤 / 限流 / 鉴权 / 5xx 等 | warning/error toast | `plugins/shadow-hooks.ts:§14` |

**Bypass 约定**: 真不需要的 resilience 写 `# bypass-shdw: <具体原因>`, 走 audit log, L6 部署前 user 必审.

**5 段 stop-gate 编排器 (v15 no-advisory 升 hard)**:
- 段 1: stub scan → ERROR (存根必删)
- 段 2: pending stages → ERROR (⏳ 必先完成)
- 段 3: L5 drift → ERROR (status ↔ 产物一致)
- 段 4: lifecycle drift → ERROR (5 角色一致)
- 段 5: R5 hard-gate → ERROR (已是 hard)
- 段 5.5: L5 consistency → ERROR (4 维 ≥ 0.9)
- 段 1.5: Bypass log → info (audit, 不是 violation)
- 段 6: API error → warning/error (分类已合理)

---

## 9. v3.0 增量 (8 commits 链, 2026-06-08)

| 版本 | 机制 | 实施位置 | 解决什么 |
|------|------|---------|---------|
| **L0 v2** | brainstorm + L1 消费 + 5 方向 web search | `shadow-l0-research/SKILL.md` (v2.0) | 用户需求模糊时引导问 + iter-2+ 不重发明 + 5 方向搜索 (含安全 / 用户反馈) |
| **L5 v5** | plan 是入口+索引 + @upstream 引用矩阵 | `shadow-l5-plan/SKILL.md` (v5) + template | coder 必读上游 5 必读, 防止"参数对但语义错" |
| **L5 v5.1** | iter 间 3 态 + plan-iter-check + @iter 标记 | `shadow-l5-impl/SKILL.md` (v5.1) + walker 变更记录段 | iter 间设计冲突保留正向 (反向改 / 正向加 / 修改调) |
| **L5 v5.2** | Pre-write Signoff (写前 sign-off block) | `shadow-l5-impl/SKILL.md` (v5.2) + template | coder 写下"读了 / 理解 / 假设", L5 reviewer hard error 抓 |
| **L2 v9.2** | Design-Conformance Gherkin | `shadow-l2-e2e/SKILL.md` (v9.2) | 业务约束翻译成可测试 Gherkin step (Given 必引 spec.md §RXX line) |
| **cjgoal v3** | 整段文本全收 + user-driven continue | `plugins/goal-mode.tsx` (v3) | PREFIX_RE `[\s\S]+` 跨行; OpenCode 1.16.2 idle session 不唤醒, 改 user-driven |
| **zh-continue 修** | zh-continue 静默 | `hooks/user-prompt-submit.sh:134-144` | "继续" / "接着" 不再误触 hook hint → server 拒收 user message |
| **CLAUDE.md v3** | 反映最新 framework 状态 | `CLAUDE.md` (329 行) | 18 主题设计规范指针 (替代 v1 12 主题) |

**3 重门禁协同** (coder 真按设计实现):
- **v5.2 Pre-write Signoff** (写前) — 写下"读了 / 理解 / 假设"
- **§13 L5 Consistency Audit** (写中) — 4 维 (spec↔code / wire↔code / arch↔code / l3↔code) ≥ 0.9
- **v9.2 Design-Conformance Gherkin** (写后测试) — 业务约束翻译成 Gherkin step, 测试通过 = 业务对齐

---

## 10. Hooks vs Plugins: CC 端 vs OpenCode 端

### 6 个 hook 1:1 对齐 (e2e 16/16 PASS)

| 事件 | Claude Code | OpenCode |
|------|------------|----------|
| `SessionStart` | `session-start.sh` | `experimental.chat.system.transform` |
| `UserPromptSubmit` | `user-prompt-submit.sh` | `chat.message` |
| `PreToolUse(Skill)` | `pre-skill.sh` | `tool.execute.before` (Skill) |
| `PreToolUse(Task)` | `worker-dispatch-hint.sh` | 同上 (Task 也匹配) |
| `PostToolUse(Write\|Edit)` | `post-write-stub-scan.sh` | `tool.execute.after` |
| `Stop` | `stop-gate.sh` | `event(message.updated finish=stop)` |

### 3 个 OpenCode 插件 (3069 + 229 + 432 行)

- `plugins/shadow-hooks.ts` (3069 行) — 5 hook body + 30 helper, 行为对齐 `hooks/*.sh`. **唯一源真理** (跟 `hooks/lib.sh` 共 schema).
- `plugins/back-cover.ts` (229 行) — 防"伪完成"硬锁 + `verify_completion` 工具. AI 任何 done 宣言前必调此工具, 验"本 turn 是否有真工作 (写代码 / 跑命令 / 验证)".
- `plugins/goal-mode.tsx` (432 行) — `/cjgoal` 自驱循环 (v3 修复).

### 软链路径 (避免踩 README 的坑)

- `~/.claude/hooks/` → 仓库根 `hooks/` (软链, 单一源真理)
- `~/.claude/skills/` → 仓库根 `skills/`
- 编辑 `hooks/*.sh` 立即生效, **不要去 `~/.claude/hooks/` 找**

---

## 11. 设计原则 (跟 user 偏好协同)

1. **渐进式披露** — `SKI33.md` < 500 行 quickstart, 详细内容在 `references/`, 触发时 in-context.
2. **传导链追溯** — 7 类 ID (intent / research / BXX-NYY / RXX / D-decision / API / FMEA) 全链.
3. **全局约束** — 多租户 / auth / 错误格式 / 事件 / 分页 / 事务边界统一, 在 35 Harness plan "global constraints" 段.
4. **规模驱动** — scale.md 字段控制 5 下游, strict-default L 级.
5. **工匠底线** — no stub / no fake / no skipped / no "DONE" 假完成. 4 试失败写 `FAI3URE-3OG.md`.
6. **3 试 HALT** — 35/36 不无限 loop, 3 轮未修 → 退 L1.5 / L1 / wire 设计层.
7. **No-advisory** — 走 Shadow = 严丝不漏 (用户偏好 `no-advisory-policy`).
8. **5 步节奏** — 装 skill → 写 checklist → 干 → 自检 + 标 ✅ → 装下一 stage.
9. **入口+索引** (v5) — plan 是索引, 上游是 detail. 5 必读上游 + @upstream 引用.
10. **保留正向** (v5.1) — iter 间设计冲突 3 态 (反向 / 正向 / 修改), plan-iter-diff audit.

---

## 12. Meta 项目边界 (本仓库怎么改 framework 自身)

### 严禁

- ❌ 加载 walker / worker / walker-pi agent 来开发本仓库 (会污染 `.shadow/`)
- ❌ 跑 Shadow 流水线 (L0→L6) — 流水线是给产品项目用的
- ❌ 在本仓库创建 `.shadow/` — 是产品项目工作区, framework 状态在 git 里
- ❌ 用 `shadow-init` / `shadow-l0-research` skill "调研" framework 自身 (输出 schema 不适用)
- ❌ 调 `/cjgoal` 推到生产可用 (goal mode 走产品 pipeline)
- ❌ 被 `user-prompt-submit.sh` 引导"加载 walker 给我做一个 XX 系统" (CWD 在 cjxdd 时旁路)

### ✅ 正确

- 直接读 `agents/` / `skills/` / `hooks/` / `plugins/` / `commands/` 源码, 跟改普通代码一样
- 改完跑 smoke (`bash skills/smoke-*.sh`)
- 直接 commit (Conventional Commits, 末尾 Co-Authored-By)
- 想"用 framework 验证 framework" → 仓库外 `/tmp/test-product/` 起产品项目, 走完整 walker pipeline

### 防御式 hook 旁路

`hooks/user-prompt-submit.sh` 已加旁路: CWD 命中 cjxdd 时, **不触发** "build me X" → walker 引导. 详见 `hooks/lib.sh:detect_meta_project()`.

3 个 agent 顶部都加 "Meta 守卫" 段, 加载时先检测 project root.

---

## 13. 已知限制 + 待办

### 已知限制

1. **OpenCode 1.16.2 server 限制**: `client.session.prompt` 在 `session.idle` 之后 server 接受但 model 不唤醒. `/cjgoal` v3 改 user-driven continue 模式兜底. 等 OpenCode 修后可重新启用 re-inject.

2. **L0 重做门禁 Round 1 软警告**: 怕改了之后老项目 (cjxdd-demo 等 7+) 突然被卡, 破坏零迁移. Round 2 计划: 新项目 (有 `.shadow/LIFECYCLE.md`) → 硬阻断; 老项目 → 仍 advisory.

3. **§13 4 维 audit 业务一致性弱**: 当前只验 RXX 编号存在 + 端点/FMEA 跟代码 regex 匹配, **不验业务关键词** (e.g. spec 写 ">=2 标注", code 写 `count >= 2`). v5.2 Pre-write Signoff + v9.2 Design-Conformance Gherkin 补了 coder 端, audit 端仍需改进.

4. **`bypass-shdw:` 累积**: audit log 写盘, 但没自动汇总 / 没 UI 查. 需要 L6 部署前 user 必审.

5. **Plugin (TS) 跟 Hook (Bash) 两套实现**: 行为对齐 16/16 PASS, 但代码不能 100% 复用. 任何新功能要在两边各实现一次.

### 待办 (Roadmap)

| 优先级 | 待办 | 描述 |
|--------|------|------|
| P0 | L0 Round 2 硬门禁 | 跟 R3/R5 同等力度, 新项目强制 |
| P1 | /cjgoal re-inject 增强 | OpenCode server 修后重新启用 |
| P1 | §13 业务关键词 audit | 抽 spec.md 业务关键词 + 扫 code |
| P2 | 跨 BXX 一致性 audit | BXX-A 跟 BXX-B 共享类型 / 命名一致 |
| P2 | wire state variant 实现检查 | `data-state="loading/empty/error"` 必须 code 实现 |
| P2 | arch event contract 实现 | arch 写的事件名必须 code publish/subscribe |
| P3 | UI 化 bypass audit | 给 user 一个 dashboard 看所有 `bypass-shdw:` |
| P3 | hook + plugin 代码生成 | 从 schema 自动生成两边代码, 消维护负担 |

---

## 14. 关键决策点 (Review 时必看)

| 决策 | 选了 | 理由 | 替代方案 |
|------|------|------|---------|
| Agent 数量 | 1 个 walker + 1 个 worker | 工匠型 (不是 dispatcher) | 多 agent orchestrator (维护复杂) |
| Skill 数量 | 14 核心 + 12 utility | 跟流水线 1:1, 工具箱足够 | 更细粒度 (30+ skill 难维护) |
| Harness | CC / OC / pi 3 个 | 用户多平台偏好 | 只 CC (OC 用户流失) |
| L0 哲学 | 自由发散 + brainstorm | 不评判, 多重场景 | 强制收敛 (失去发散价值) |
| L5 计划 | plan 是入口+索引 | 既有自包含, 又鼓励读上游 | 完全自包含 (coder 写"对但错"代码) |
| Iter 模型 | 共享 + 隔离混合 | 大部分产物 iter 间复用, 状态 per-iter | 全隔离 (磁盘爆炸) |
| Scale 默认 | strict L | 用户偏好 `strict-mode-default` | 允许降级 (用户会偷懒) |
| 门禁哲学 | 严苛 (no advisory) | 工匠底线 + 用户偏好 `no-advisory-policy` | 软警告 (AI 看完就忘) |
| 跨 iter 冲突 | 保留正向 (v5.1) | 新设计胜旧设计 | 警告保留 (老设计残留误导) |
| 中文输入 | 静默 hook hint | OpenCode schema 严格 + 模糊词误触 | 改 hook 输出格式 (server bug) |

---

## 15. Review 总结: 一句话

> **Shadow 是 1 个工匠型 agent + 26 个 skill + 严苛门禁的 AI 驱动开发 framework. 用户给模糊需求, walker 走 30→36 流水线, 用 7 类 ID 全链追溯, 写代码前 sign-off 业务理解, 写代码中 4 维 audit 跟上游对齐, 写代码后用 Design-Conformance Gherkin 验业务约束, 部署用真实账号 + 真实链路 + chaos drill 验证, 3 轮未修 HALT, iter 间设计冲突保留正向, no-advisory 严丝不漏, 走 Shadow = 严苛.**

---

**Reviewer checklist** (review 时按顺序过):

- [ ] 流水线 7 大阶段清楚 (30→31→31.5→Scaffold→32→33→35→36)
- [ ] 4 类核心抽象 (业务 / 架构 / 验收 / 韧性) 边界清楚
- [ ] Walker 5 步节奏 + Meta 守卫清楚
- [ ] 7 类 ID 全链追溯清楚 (intent → RXX → D → API → FMEA → code)
- [ ] Iter 模型 + 3 态 (反向/正向/修改) + plan-iter-check 清楚
- [ ] Scale 模型 + strict-default 清楚
- [ ] 13 类门禁力度 (hard vs soft) 清楚
- [ ] v3.0 8 个新机制 (L0 v2 / L5 v5/v5.1/v5.2 / L2 v9.2 / cjgoal v3 / zh-continue / CLAUDE.md v3) 清楚
- [ ] Hooks (CC) vs Plugins (OC) 1:1 对齐清楚
- [ ] 10 设计原则 + 3 已知限制 + 8 待办清楚
- [ ] Meta 项目边界清楚 (本仓库改 framework 自身禁用流程)
- [ ] 关键决策点 + 替代方案清楚

如对任何段有疑问, 直接问 Claude (本对话) 或开 issue.

EOF
