# xdd — 工作流总览 (2026-06-08)

> **本文件目的**: 鸟瞰 xdd 框架整体, 让 reviewer 一眼看懂:
> 1. 流程怎么走 (Phase 0→1→2→2.5→2.7→3→4→5→6)
> 2. 信息怎么流 (用户模糊需求 → 生产部署)
> 3. 关键 gate 在哪 (5 段 hard-gate + 4 维 audit + zh-continue)
> 4. 设计原则
> 5. 已知限制 + 未来工作
>
> 配套文档: `CLAUDE.md` (项目级工作流) / `README.md` (安装/快速开始) / `docs/architecture.mmd` (架构图).

---

## 1. 整体定位

**xdd** 是 **meta-project**: 不是应用代码, 是 AI 驱动软件开发的**完整 framework**.

| 维度 | 值 |
|------|---|
| 形态 | AI agent + 工具箱 (skill 集合) |
| Agent | 1 个工匠型 `xdd-walker` (2 变体: CC/OC 共用 + pi) |
| Skills | 23 个 (14 核心流水线 + 9 utility) |
| Harness | 3 个 (Claude Code / OpenCode / pi) |
| 用户 | 产品开发者 (用 xdd 开发产品项目) |
| 自身 | xdd 自身也是用 git + smoke 维护的代码库 |

**哲学**:
- 严苛工作流: 走 xdd = 严丝不漏 (no-advisory)
- 工匠底线: no stub, no fake, no "DONE" 假完成
- 传导链追溯: 7 类 ID 从意图到代码全链

---

## 2. xdd 6 Phase

```
┌─────────────────────────────────────────────────────────────────────┐
│ User task: "想做一个 XX 系统"                                        │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Phase 0 INIT          xdd-init (按需)                                 │
│                       产出: .xdd/ + scale.md + status.md + iter-1/    │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Phase 1 RESEARCH      xdd-l0 (v2 — brainstorm + L1 消费 + 5 方向)    │
│                       产出: 9 份发散笔记本 + 00-l1-recap + 08-brainstorm│
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Phase 2 DESIGN        xdd-bdd / flow / add / wire / arch (串行)      │
│   • xdd-bdd       BDD/Gherkin 验收场景                              │
│   • xdd-flow      MDD → project.flow.mermaid (BXX-NYY)             │
│   • xdd-add       架构设计说明书 (状态机/时序/排障)                │
│   • xdd-wire      SVG 线框图 (data-page/data-action)                │
│   • xdd-arch      L1.5 (ADD+SDD+PDD)                                │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 规模判定           .xdd/scale.md (S / M / L, strict=L by default)    │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Phase 2.5 BDD          (含在 Phase 2 中)                              │
│                       Design-Conformance Gherkin 业务约束翻译         │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Phase 2.7 SCAFFOLD    xdd-scaffold (7 步 Docker 开发环境)            │
│                       产出: docker-compose + Hello API + smoke test  │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Phase 3 REVIEW        用户审查 gate (显式确认)                       │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Phase 4 PLAN          xdd-plan (v5 — plan 是入口+索引, @upstream)    │
│                       产出: plan.md (逐文件指令 + @upstream) │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Phase 5 EXECUTE       xdd-execute (v5.2 — Pre-write Signoff)         │
│                       产出: 真实代码 + 测试 + 文件头 @implements RXX  │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Phase 6 VERIFY        xdd-l6 (Phase 0-9, 3 轮修复 cap, R11)          │
│                       产出: docker-compose 真实起 + 真实账号 + 真实链 │
│                             路 + 9/10 步真实验证 + chaos drill         │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
                   ✅ Production-Ready / SHIPPED
```

---

## 3. 4 类核心抽象

| 层 | 抽象 | 解决什么问题 | 关键产物 |
|----|------|-------------|---------|
| **Phase 2 业务** | **业务是什么** | 业务理解 / 统一语言 / 事件风暴 | intent.md / business-landscape / BXX research.md / project.flow.mermaid / spec.md (RXX) / wire.svg |
| **Phase 2.5 架构** | **怎么实现** | 质量属性驱动决策 / 安全设计 / 性能设计 | architecture.md / aggregate-landscape.md / event-contract.md |
| **Phase 2.5 BDD** | **行为对不对** | 14 维覆盖矩阵 / 6 维画像 / 5 层旅程 / Design-Conformance 业务约束 | e2e.md / coverage-matrix.md / uat-script.md |
| **Phase 3 L3** | **失败怎么办** | 8/9 维失败模式 / 10/12 兜底机制 / 混沌场景 / 恢复剧本 | failure-modes.md / failsafe-design.md / chaos-scenarios.md / runbook |

---

## 4. Walker: 工匠型 Agent

`agents/xdd-walker.md` (~500 行) 是 framework 的核心 agent. **不是 dispatcher** — 自己读文件、写代码、跑命令. 装一个 skill, 跟 SKILL.md 当执行脚本.

### 5 步节奏 (Walker 装 skill 后必走)

```
① 装 skill 工具 (xdd-l0)
② 写 checklist 到 status.md (本 stage 5-10 子任务)
③ 按 skill 流程干, 落到预期路径 (.xdd/...)
④ 自检 + 标 ✅ DONE (status.md 状态更新)
⑤ 加载下一 stage skill (xdd-bdd)
```

### Meta 守卫 (本仓库禁用)

`agents/xdd-walker.md` / `xdd-walker-pi.md` 顶部都加 "Meta 守卫" 段. CWD 命中 cjxdd 仓库自身 → 立即拒绝执行 + 提示用户直接改源码.

防御: `hooks/xdd-gate-user-prompt-submit.sh` 加 Meta 旁路.

### Walker frontmatter 工具名约定

故意**不写 `tools` 字段** — CC 跟 OC schema 互斥. 省略 = 两边都默认"全工具开放" ✓

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
plan.md (逐方法指令)    → @upstream 引用矩阵
  ↓
代码 (@implements RXX + @intent + @upstream)
```

---

## 6. Iter 模型

```
.xdd/
├── current-iteration          ← "iter-2"
├── iterations/
│   ├── iter-1/                ← 旧需求 (冻结, 不删作审计基线)
│   │   ├── pipeline/status.md
│   │   └── gate/
│   └── iter-2/                ← 当前活跃
├── research/               ← 跨 iter 共享
├── business/               ← 跨 iter 共享
├── arch/         ← 跨 iter 共享
├── L1-bdd/                    ← 跨 iter 共享
└── resilience/             ← 跨 iter 共享
```

**iter-N 启动**:
1. 创建 `iterations/iter-N/`
2. 复制 iter-N-1 status.md (清零状态)
3. 走 Phase 1 (v2 — 先读 L1 增量, brainstorm 引导问, 9 笔记本)
4. 走变更传播表 (改了什么 → 哪些 stage 重跑)
5. 不全跑 (增量跑下游)

---

## 7. Scale 模型

| scale | l3_extended_mode | 失败模式 | 兜底 | FMEA 字段 |
|-------|-----------------|---------|------|----------|
| **S** | false | 8 维 | 10 模式 | 5 字段 |
| **M** | false | 8 维 | 10 模式 | 5 字段 |
| **L** | **true** | 9 维 (+ 跨地域) | 12 模式 (+ 业务对账 + 业务幂等) | 8 字段 (+ Owner + SLO + 回滚时长) |

**Strict-default**: scale.md 字段 `strict_mode: true` 默认. 5 个下游字段不读 scale 标签. 降级必须显式 (改 `.xdd/scale.md` 字段).

---

## 8. 门禁: 硬 vs 软

| 门禁 | 抓什么 | 力度 | 实施位置 |
|------|--------|------|---------|
| **R3 evidence_archive** | 关键证据是否写了 | 软警告 | `xdd-gate-stub-scan.sh` |
| **R5 hard-gate** | 5 角色 lifecycle 一致 | **hard** | `xdd-gate-stop.sh` |
| **R10 自动归档** | iter 完成时归档 | 自动 | `xdd-gate-stop.sh` |
| **R11 真实烟雾测试** | 4 层验证 (marker / 解析 / 测试 / hash) | **新项目 hard, 老项目 advisory** | `plugins/xdd-gates.ts:§9` + `gate-check-lifecycle.sh:307-412` |
| **L0 重做门禁** | per-iter 14 天 mtime | Round 1 软警告, Round 2 计划 hard | `xdd-gate-pre-skill.sh:114-140` |
| **L5 Consistency Audit** | 4 维 (spec↔code / wire↔code / arch↔code / l3↔code) ≥ 0.9 coverage | **hard** | `plugins/xdd-gates.ts:auditL5Consistency` |
| **L5 5 段 stop-gate** | stub / pending / drift / lifecycle / R5 | **全 hard (no-advisory)** | `xdd-gate-stop.sh` 5 段编排器 |
| **L5 unresolved 跨轮保活** | L5 warning 跨轮可见 | 软压力, 3 试升 hard | `plugins/xdd-gates.ts:§11` |
| **3 试 HALT** | unresolved.count > 3 升级 HALT | **hard** | `.xdd-halt.json` + L1 system 注入 |
| **bypass-shdw: 显式化** | 显式 bypass 必带 reason | audit log | L5 stop-gate 段 1.5 |
| **zh-continue schema 拒收** | 模糊词触发 hook hint → server 拒收 message | **hard (fix)** | `xdd-gate-user-prompt-submit.sh:134-144` 静默 |
| **5 段压力信号** (RUSH/TIME/SKIP/SIMPLIFY/WORKLOAD) | AI 加速跳过意图 | 软提醒 | `hooks/xdd-gate-lib.sh:check_pressure_signals` |
| **API error 兜底** | 内容过滤 / 限流 / 鉴权 / 5xx 等 | warning/error toast | `plugins/xdd-gates.ts:§14` |

---

## 9. 设计原则

1. **渐进式披露** — `SKILL.md` < 500 行 quickstart
2. **传导链追溯** — 7 类 ID 全链
3. **全局约束** — 多租户 / auth / 错误格式 / 事件 / 分页 / 事务边界统一
4. **规模驱动** — scale.md 字段控制 5 下游, strict-default L 级
5. **工匠底线** — no stub / no fake / no "DONE" 假完成
6. **3 试 HALT** — 36 不无限 loop
7. **No-advisory** — 走 xdd = 严丝不漏
8. **5 步节奏** — 装 skill → 写 checklist → 干 → 自检 + 标 ✅ → 装下一 stage
9. **入口+索引** (v5) — plan 是索引, 上游是 detail
10. **保留正向** (v5.1) — iter 间设计冲突 3 态 (反向/正向/修改)

---

## 10. Hooks vs Plugins: CC 端 vs OpenCode 端

### 6 个 hook 1:1 对齐

| 事件 | Claude Code | OpenCode |
|------|------------|----------|
| `SessionStart` | `xdd-gate-session-start.sh` | `experimental.chat.system.transform` |
| `UserPromptSubmit` | `xdd-gate-user-prompt-submit.sh` | `chat.message` |
| `PreToolUse(Skill)` | `xdd-gate-pre-skill.sh` | `tool.execute.before` (Skill) |
| `PreToolUse(Task)` | `xdd-gate-team-dispatch.sh` | 同上 (Task 也匹配) |
| `PostToolUse(Write\|Edit)` | `xdd-gate-stub-scan.sh` | `tool.execute.after` |
| `Stop` | `xdd-gate-stop.sh` | `event(message.updated finish=stop)` |

### 3 个 OpenCode 插件

- `plugins/xdd-gates.ts` (3000+ 行, 合并 shadow-hooks.ts + back-cover.ts)
- `plugins/xdd-cover.ts` (~230 行, 防"伪完成"硬锁)
- `plugins/xdd-goal.tsx` (~430 行, /xdd-goal 自驱循环)

### 软链路径

- `~/.claude/hooks/` → 仓库根 `hooks/` (软链, 单一源真理)
- `~/.claude/skills/` → 仓库根 `skills/`
- 编辑 `hooks/xdd-gate-*.sh` 立即生效

---

## 11. Meta 项目边界 (本仓库怎么改 framework 自身)

### 严禁
- ❌ 加载 walker / agent 来开发本仓库
- ❌ 跑 xdd 流水线
- ❌ 在本仓库创建 `.xdd/`
- ❌ 用 `xdd-init` / `xdd-l0` 等 skill "调研" framework 自身
- ❌ 调 `/xdd-goal` 推到生产可用
- ❌ 被 `xdd-gate-user-prompt-submit.sh` 引导"加载 walker 给我做一个 XX 系统"

### ✅ 正确
- 直接读 `agents/` / `skills/` / `hooks/` / `plugins/` / `commands/` 源码
- 改完跑对应 smoke 验证
- 直接 commit (Conventional Commits, 末尾 Co-Authored-By)
- 想"用 framework 验证 framework" → 仓库外另起产品项目

### 防御式 hook 旁路

`hooks/xdd-gate-user-prompt-submit.sh` 加 Meta 旁路: CWD 在 cjxdd 时, **不触发** "build me X" → walker 引导.

---

## 12. 已知限制 + 待办

### 已知限制
1. **OpenCode 1.16.2 server 限制**: `client.session.prompt` 在 `session.idle` 之后 server 接受但 model 不唤醒. `/xdd-goal` v3 改 user-driven continue 模式兜底.
2. **L0 重做门禁 Round 1 软警告**: 新项目硬阻断待 Round 2 启用
3. **§13 4 维 audit 业务一致性弱**: 当前只验 RXX 编号存在 + 端点/FMEA 跟代码 regex 匹配. v5.2 Pre-write Signoff + v9.2 Design-Conformance Gherkin 补 coder 端
4. **`bypass-shdw:` 累积**: audit log 写盘, 但没自动汇总 / 没 UI 查
5. **Plugin (TS) 跟 Hook (Bash) 两套实现**: 行为对齐 PASS, 但代码不能 100% 复用. 任何新功能要在两边各实现一次

### 待办
| 优先级 | 待办 | 描述 |
|--------|------|------|
| P0 | L0 Round 2 硬门禁 | 跟 R3/R5 同等力度, 新项目强制 |
| P1 | /xdd-goal re-inject 增强 | OpenCode server 修后重新启用 |
| P1 | §13 业务关键词 audit | 抽 spec.md 业务关键词 + 扫 code |
| P2 | 跨 BXX 一致性 audit | BXX-A 跟 BXX-B 共享类型 / 命名一致 |
| P2 | wire state variant 实现检查 | `data-state="loading/empty/error"` 必须 code 实现 |
| P2 | arch event contract 实现 | arch 写的事件名必须 code publish/subscribe |
| P3 | UI 化 bypass audit | 给 user 一个 dashboard 看所有 `bypass-shdw:` |
| P3 | hook + plugin 代码生成 | 从 schema 自动生成两边代码 |

---

## 13. 关键决策点 (Review 时必看)

| 决策 | 选了 | 理由 |
|------|------|------|
| Agent 数量 | 1 个 walker (CC/OC) + 1 个 walker-pi | 工匠型 (不是 dispatcher) |
| Skill 数量 | 14 核心 + 9 utility | 跟流水线 1:1, 工具箱足够 |
| Harness | CC / OC / pi 3 个 | 用户多平台偏好 |
| Phase 0 哲学 | 自由发散 + brainstorm | 不评判, 多重场景 |
| Phase 4 计划 | plan 是入口+索引 | 既有自包含, 又鼓励读上游 |
| Iter 模型 | 共享 + 隔离混合 | 大部分产物 iter 间复用, 状态 per-iter |
| Scale 默认 | strict L | 用户偏好 strict-mode-default |
| 门禁哲学 | 严苛 (no advisory) | 工匠底线 + 用户偏好 no-advisory-policy |
| 跨 iter 冲突 | 保留正向 | 新设计胜旧设计 |
| 中文输入 | 静默 hook hint | OpenCode schema 严格 + 模糊词误触 |

---

**Reviewer checklist** (review 时按顺序过):

- [ ] 流水线 6 Phase 清楚 (0→1→2→2.5→2.7→3→4→5→6)
- [ ] 4 类核心抽象 (业务 / 架构 / 验收 / 韧性) 边界清楚
- [ ] Walker 5 步节奏 + Meta 守卫清楚
- [ ] 7 类 ID 全链追溯清楚 (intent → RXX → D → API → FMEA → code)
- [ ] Iter 模型清楚
- [ ] Scale 模型 + strict-default 清楚
- [ ] 13 类门禁力度 (hard vs soft) 清楚
- [ ] Hooks (CC) vs Plugins (OC) 1:1 对齐清楚
- [ ] 10 设计原则 + 5 已知限制 + 8 待办清楚
- [ ] Meta 项目边界清楚
- [ ] 关键决策点 + 替代方案清楚
