# 工件位置规范 — 6 目录扁平结构 (2026-06-09)

**目的**: 阐明 `.xdd/` 根 vs `.xdd/iterations/iter-N/` 各自的工件归属, 避免"review/gate 报告污染根目录" + **11 目录过散**.

## 一句话原则

**`.xdd/` 根 = 2 目录**: `baseline/` (跨 iter design_baseline) + `gates/` (控制标记)
**`.xdd/iterations/iter-N/` = per-iter evidence_archive 全包, plan 也进**

## 6 目录总览

```
.xdd/                                      (3 顶层目录)
├── baseline/                              ← 跨 iter design_baseline (8 子目录)
│   ├── intent/intent.md
│   ├── research/{00-l1-recap,01-customer,...08-brainstorm}.md
│   ├── bdd/{slug}/{spec.md,*.feature}
│   ├── flow/{slug}.mermaid
│   ├── add/{slug}/add.md
│   ├── arch/
│   │   ├── {slug}/architecture.md
│   │   ├── aggregate-landscape.md
│   │   └── event-contract.md
│   ├── resilience/{slug}/{failure-modes,failsafe-design,chaos-scenarios,resilience-test-plan,recovery-runbook}.md
│   ├── wire/{page}/{index.html,index.mobile.html,error.html,loading.html,success.html,review.md}
│   └── business/{BXX-slug}.md              ← template_instance
│
├── gates/                                  ← 项目级 control_marker
│   ├── scale.md
│   ├── current-iteration
│   ├── xdd-version
│   ├── .xdd-halt.json
│   └── .l5-unresolved.json
│
└── iterations/iter-N/                      ← per-iter 全包
    ├── pipeline/status.md                  ← process_output
    ├── plan/harness-plan.md                ← per-iter 计划
    ├── plan/{feature}.md
    ├── research/{00-l1-recap,...}.md       ← evidence_archive 快照
    ├── design/scaffold-smoke.md
    ├── verify/{l5-*,health-check,wander-test,dual-contract,r11,deployment-report,final-report}.md
    ├── verify/smoke-test-passed
    ├── execute/exec-loop-*.log
    ├── chaos/chaos-loop-*.log
    ├── wire-reviews/{page}/review.md
    ├── gate-logs/{wire-validate,ux-check,coverage-check,stub-scan,lifecycle-gate}.log
    ├── reports/{bug-report,design-review,coverage-snapshot}-*
    └── .inherited/                          ← 来自 iter-N-1 的 halt/unresolved
```

## 5 类 lifecycle × 路径

| Lifecycle 角色 | 路径 | 例子 | 跨 iter? |
|---------------|------|------|---------|
| **design_baseline** | `.xdd/baseline/{...}/` | intent / bdd / arch / flow / add / research / resilience / wire / business | ✅ 跨 iter 复用 |
| **process_output** | `.xdd/iterations/iter-N/{pipeline, plan, verify}/{status,harness-plan,deployment-report}.md` | pipeline 状态 / plan / 部署报告 | ❌ per-iter |
| **control_marker** | `.xdd/gates/{scale.md, current-iteration, xdd-version, .xdd-halt.json, .l5-unresolved.json}` | 项目级控制 | ✅ 项目级 (跨 iter) |
| **template_instance** | `.xdd/baseline/business/{BXX-slug}.md` | 业务线模板实例 | ✅ 跨 iter |
| **evidence_archive** | `.xdd/iterations/iter-N/{verify,execute,chaos,wire-reviews,gate-logs,reports,bdd-trace,research,design}/` | 跑过的报告, review, gate log, 快照 | ❌ per-iter, 收尾后 frozen |

## 详细分类

### 跨 iter (`.xdd/baseline/` + `.xdd/gates/`) — design_baseline + control_marker + template_instance

```
.xdd/baseline/                            ← 8 子目录
├── intent/intent.md
├── research/                              ← L0 笔记本 (9 文件)
│   ├── 00-l1-recap.md
│   ├── 01-customer.md ... 07-competitor.md
│   └── 08-brainstorm.md
├── bdd/{slug}/                            ← BXX 业务线 BDD
│   ├── spec.md
│   └── *.feature
├── flow/{slug}.mermaid                    ← 业务流程图
├── add/{slug}/add.md                      ← 架构设计说明书
├── arch/                                  ← 架构 (3 件)
│   ├── {slug}/architecture.md
│   ├── aggregate-landscape.md
│   └── event-contract.md
├── resilience/{slug}/                     ← L3 韧性 (5 件)
│   ├── failure-modes.md
│   ├── failsafe-design.md
│   ├── chaos-scenarios.md
│   ├── resilience-test-plan.md
│   └── recovery-runbook.md
├── wire/{page}/                           ← 页面原型 (HTML 6 操作态)
│   ├── index.html
│   ├── index.mobile.html
│   ├── error.html
│   ├── loading.html
│   ├── success.html
│   └── review.md
└── business/{BXX-slug}.md                 ← 业务线模板实例

.xdd/gates/                                ← 5 文件
├── scale.md                               ← 规模 (S/M/L) + strict_mode
├── current-iteration                       ← 当前 iter (e.g. iter-1)
├── xdd-version                             ← 框架版本
├── .xdd-halt.json                          ← 3 试未过 HALT
└── .l5-unresolved.json                     ← L5 audit 未解 P1
```

### per-iter (`.xdd/iterations/iter-N/`) — process_output + evidence_archive

```
.xdd/iterations/iter-N/
├── pipeline/status.md                     ← process_output (per-iter 阶段状态)
├── plan/                                  ← per-iter 实施计划
│   ├── harness-plan.md
│   └── {feature}.md
├── research/                              ← L0 笔记本快照 (跟 baseline 同步, 收尾存档)
├── design/scaffold-smoke.md               ← Phase 2.7 scaffold 验证
├── verify/                                ← Phase 6 验证报告
│   ├── l5-{correctness,security,performance,maintainability}.md
│   ├── l5-audit.md
│   ├── health-check.md
│   ├── wander-test.md
│   ├── dual-contract-verification.md
│   ├── r11-production-contract.md
│   ├── deployment-report.md
│   ├── final-report.md
│   └── smoke-test-passed                   ← control_marker
├── execute/exec-loop-*.log                ← 回环 3 实施-验证 log
├── chaos/chaos-loop-*.log                  ← 回环 6 L3 chaos log
├── wire-reviews/{page}/review.md          ← 攻击式 review
├── gate-logs/                              ← 7 loop 闸门跑过的 log
│   ├── wire-validate.log
│   ├── ux-check.log
│   ├── coverage-check.log
│   ├── stub-scan.log
│   ├── lifecycle-gate.log
│   ├── rxx-consistency.log
│   └── chaos-runner.log
├── reports/                                ← session 复盘
│   ├── bug-report-{session-id}.md
│   ├── design-review-{date}.md
│   └── coverage-snapshot-{ts}.md
└── .inherited/                              ← 来自 iter-N-1 的 halt/unresolved
```

## 为什么合并成 6 目录

**改造前** (11 目录):
```
.xdd/{core, bdd, arch, architecture, add, plan, research, resilience, wire, business, scale.md, current-iteration, xdd-version, ...}
```

**问题**:
- 11 个目录在 .xdd/ 根平铺, ls .xdd/ 看不过来
- `bdd/` 跟 `arch/` 跟 `add/` 都属于"Phase 2 设计产物", 跟 `plan/` `research/` `resilience/` 混杂
- `core/` (intent.md) 跟 `research/` 都是"前期调研", 应该一起
- `scale.md` / `current-iteration` 跟目录混, 容易丢

**改造后** (6 目录):
- `baseline/` — 所有跨 iter design_baseline 8 子目录, 1 个 ls 看清楚
- `gates/` — 所有 control_marker 5 文件, 1 个 ls 看清楚
- `iterations/iter-N/` — per-iter 全包, 1 个 ls 看清楚

**收益**:
- 顶层扁平: ls .xdd/ 只看到 3 项 (baseline/ + gates/ + iterations/)
- 业务线维度自然分: 实战项目用 `{slug}/` 子目录 (B01-customer, B02-product 等)
- 跨 iter 跟 per-iter 物理分离, 不会误改
- iter 收尾时 `iter-N/` 整体 freeze

## 实战演示 — 合并前 vs 合并后

### 合并前 (混乱, 实战产物)
```
.xdd/verify/                       ← 散落根
.xdd/execute/                      ← 散落根
.xdd/wire/login/review.md         ← 跟 wire 资产混
.xdd/wire/{login,dashboard}/      ← HTML
.xdd/iterations/iter-1/verify/    ← 重复
```

### 合并后 (扁平, 3 顶层)
```
.xdd/baseline/wire/{login,dashboard}/{index,error,loading}.html  ← design_baseline
.xdd/iterations/iter-1/wire-reviews/{login,dashboard}/review.md   ← evidence_archive
.xdd/iterations/iter-1/verify/{l5-*,health-check,wander-test}.md   ← evidence_archive
```

## iter 收尾流程

```bash
# iter-N 完成 (Phase 6 ✅) 时:
bash skills/xdd-init/scripts/iter-inherit.sh save
# 复制 .xdd-halt.json / .l5-unresolved.json / reports/ → iter-N+1/.inherited/

# iter-N 整体 freeze (git commit 整 iter 目录)

# iter-N+1 init 跑回环 5:
bash skills/xdd-init/scripts/iter-inherit.sh load
# phase-researcher 启动时读 .inherited/SUMMARY.md 优先修遗留
```

## 速查表

```
设计资产 (跨 iter):       .xdd/baseline/{intent, research, bdd, flow, add, arch, resilience, wire, business}
控制标记 (项目级):        .xdd/gates/{scale.md, current-iteration, xdd-version, .xdd-halt.json, .l5-unresolved.json}
阶段状态 (per-iter):       .xdd/iterations/iter-N/pipeline/status.md
实施计划 (per-iter):       .xdd/iterations/iter-N/plan/harness-plan.md
验证报告 (per-iter):       .xdd/iterations/iter-N/verify/{l5-*, health-check, wander-test, ...}
实施 log (per-iter):       .xdd/iterations/iter-N/execute/exec-loop-*.log
混沌实验 (per-iter):       .xdd/iterations/iter-N/chaos/chaos-loop-*.log
页面 review (per-iter):    .xdd/iterations/iter-N/wire-reviews/<page>/review.md
闸门 log (per-iter):       .xdd/iterations/iter-N/gate-logs/<gate>.log
session 复盘 (per-iter):   .xdd/iterations/iter-N/reports/<type>-<id>.md
inherited (跨周期):        .xdd/iterations/iter-N/.inherited/
```

## 跟其他 skill 配合

- `xdd-artifact-lifecycle` — 5 类 lifecycle 单一源真理
- `xdd-init` — init 时按本规范生成 `baseline/` + `gates/` + `iterations/iter-1/`
- `xdd-plan` — plan Task 里写"产物路径"用本规范
- `xdd-halt` — `.xdd-halt.json` 写在 `.xdd/gates/` (control_marker, 跨 iter 可见)
- `iter-inherit.sh` — 跨 iter 传递 halt/unresolved
