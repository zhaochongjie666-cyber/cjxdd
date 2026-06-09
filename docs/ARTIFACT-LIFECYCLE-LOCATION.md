# 工件位置规范 — 跨 iter vs iter-scope (2026-06-09)

**目的**: 阐明 `.xdd/` 根 vs `.xdd/iterations/iter-N/` 各自的工件归属, 避免"review/gate 报告污染根目录".

## 一句话原则

**`.xdd/` 根 = 跨 iter 复用的 design_baseline (改后必触发 L3/L5/L6 重跑)**
**`.xdd/iterations/iter-N/` = 这次 iter 跑的 evidence_archive (per-iter 证据, iter 收尾后 frozen)**

## 5 类 lifecycle × 路径

| Lifecycle 角色 | 路径 | 例子 | 跨 iter? |
|---------------|------|------|---------|
| **design_baseline** | `.xdd/{...}/` 根 | `bdd/`, `arch/`, `architecture/`, `add/`, `plan/`, `research/`, `resilience/`, `spec.md`, `intent.md`, `flow.mermaid`, `wire/` (HTML/SVG 资产) | ✅ 跨 iter 复用 |
| **process_output** | `.xdd/iterations/iter-N/pipeline/status.md` | pipeline 状态, phase 闸门追踪 | ❌ per-iter |
| **control_marker** | `.xdd/{scale.md, current-iteration, xdd-version, .xdd-halt.json, .l5-unresolved.json}` | 项目级控制 | ✅ 项目级 (跨 iter) |
| **template_instance** | `.xdd/business/BXX-*.md` | 业务线模板实例 | ✅ 跨 iter |
| **evidence_archive** | `.xdd/iterations/iter-N/{verify,execute,wire-reviews,gate-logs,chaos,reports,bdd-trace}/` | 跑过的报告, review, gate log | ❌ per-iter, 收尾后 frozen |

## 详细分类

### 跨 iter (`.xdd/` 根) — design_baseline + control_marker + template_instance

```
.xdd/
├── core/
│   └── intent.md                  ← design_baseline
├── bdd/                           ← design_baseline (跨 iter 复用)
│   ├── spec.md
│   └── *.feature
├── arch/ 或 architecture/         ← design_baseline
│   ├── architecture.md
│   ├── aggregate-landscape.md
│   └── event-contract.md
├── add/                           ← design_baseline
│   └── add.md
├── plan/
│   └── harness-plan.md            ← design_baseline
├── research/                      ← design_baseline (L0 笔记本)
│   ├── 00-l1-recap.md
│   ├── 01-customer.md
│   └── ...
├── resilience/                    ← design_baseline (L3 韧性)
│   ├── failure-modes.md
│   └── ...
├── wire/                          ← design_baseline (HTML/SVG wire)
│   ├── login/{index.html, error.html, ...}
│   └── dashboard/{index.html, ...}
├── business/                      ← template_instance
│   ├── B01-customer.md
│   └── ...
├── scale.md                       ← control_marker
├── current-iteration              ← control_marker
├── xdd-version                    ← control_marker
├── .xdd-halt.json                 ← control_marker
└── .l5-unresolved.json            ← control_marker
```

### per-iter (`.xdd/iterations/iter-N/`) — process_output + evidence_archive

```
.xdd/iterations/iter-N/
├── pipeline/
│   └── status.md                  ← process_output (per-iter 阶段状态)
├── design/                       ← evidence_archive (Phase 2.7 scaffold-smoke)
├── research/                     ← evidence_archive (Phase 1 L0 笔记本快照)
├── verify/                       ← evidence_archive (Phase 6)
│   ├── final-report.md
│   ├── deployment-report.md
│   ├── l5-correctness.md
│   ├── l5-security.md
│   ├── l5-performance.md
│   ├── l5-maintainability.md
│   ├── l5-audit.md
│   ├── health-check.md
│   ├── wander-test.md
│   ├── dual-contract-verification.md
│   ├── r11-production-contract.md
│   └── smoke-test-passed.marker
├── execute/                      ← evidence_archive (Phase 5)
│   └── exec-loop-*.log
├── chaos/                        ← evidence_archive (Phase 3 L3 chaos 实验)
│   └── chaos-*.log
├── wire-reviews/                 ← evidence_archive (Phase 2 page-level review)
│   ├── login/review.md
│   ├── dashboard/review.md
│   └── ...
├── gate-logs/                    ← evidence_archive (7 种 loop 闸门跑过的 log)
│   ├── wire-validate.log
│   ├── ux-check.log
│   ├── coverage-check.log
│   ├── stub-scan.log
│   ├── lifecycle-gate.log
│   ├── rxx-consistency.log
│   └── ...
├── reports/                      ← evidence_archive (session 复盘)
│   ├── bug-report-{session-id}.md
│   ├── design-review-{date}.md
│   └── coverage-snapshot-{ts}.md
└── bdd-trace/                    ← evidence_archive (RXX ↔ code 反向追溯)
    └── trace.json
```

## 实战对比 — 改造前 vs 改造后

### 改造前 (混乱)

```
.xdd/verify/                        ← 10 报告 散落根
.xdd/execute/                       ← execute log 散落根
.xdd/wire/login/review.md           ← review 跟 wire 资产混
```

**问题**: 根目录被 per-iter 报告污染, 跨 iter 复用时不知道哪些是 design_baseline 哪些是 evidence.

### 改造后 (清晰)

```
.xdd/wire/login/{index.html, error.html, ...}  ← design_baseline (HTML 资产)
.xdd/iterations/iter-1/wire-reviews/login/review.md  ← evidence_archive (per-iter review)
.xdd/iterations/iter-1/verify/                   ← evidence_archive (per-iter verify)
```

**好处**:
- 根目录 = 跨 iter 复用的设计资产 (bdd/arch/plan/wire 资产)
- iter-N/ = 这次跑的证据 (review/verify/execute/gate-logs)
- iter 收尾时 `iter-1/` 整体 freeze, `iter-2/` 起新目录
- iter-N+1 init 跑 `xdd-init/scripts/iter-inherit.sh` 把 iter-N 的 halt/unresolved 复制到 iter-N+1/.inherited/

## 5 类 × 路径速查

```
设计资产 (跨 iter):
  intent / spec / bdd / arch / plan / wire HTML 资产 / resilience 文档
  → .xdd/ 根
  改 → 触发 L3/L5/L6 重跑 (跨 iter 复用)

控制标记 (项目级):
  scale.md / current-iteration / xdd-version / .xdd-halt.json
  → .xdd/ 根
  改 → 整个项目状态变化

阶段状态 (per-iter):
  pipeline/status.md (✅/⏳/🔄/❌ 各 phase)
  → .xdd/iterations/iter-N/pipeline/

验证报告 (per-iter):
  final-report / l5 audit / wander / dual contract / r11 / smoke-marker
  → .xdd/iterations/iter-N/verify/

实施 log (per-iter):
  exec-loop-*.log (回环 3 输出)
  → .xdd/iterations/iter-N/execute/

混沌实验 (per-iter):
  chaos-*.log (回环 6 输出)
  → .xdd/iterations/iter-N/chaos/

页面 review (per-iter):
  wire-reviews/<page>/review.md (攻击式 5Q)
  → .xdd/iterations/iter-N/wire-reviews/

闸门 log (per-iter):
  wire-validate.log / ux-check.log / coverage-check.log / stub-scan.log
  → .xdd/iterations/iter-N/gate-logs/

session 复盘 (per-iter):
  bug-report / design-review / coverage-snapshot
  → .xdd/iterations/iter-N/reports/
```

## iter 收尾时做什么

```bash
# iter-N 完成 (Phase 6 ✅) 时:
bash skills/xdd-init/scripts/iter-inherit.sh save
# 复制 iter-N/.xdd-halt.json / .l5-unresolved.json / reports/ → iter-N+1/.inherited/

# iter-N 整体 freeze (git commit 整 iter 目录)

# iter-N+1 init 跑回环 5:
bash skills/xdd-init/scripts/iter-inherit.sh load
# phase-researcher 启动时读 .inherited/SUMMARY.md 优先修遗留
```

## 实战修正 (本次提交)

| 实战产物 | 改造前 | 改造后 |
|---------|-------|-------|
| URL shortener 实战 | `.xdd/verify/` (10 文件) + `.xdd/iterations/iter-1/verify/` (2 文件) 重复 | `.xdd/iterations/iter-1/verify/` (统一) |
| URL shortener 实战 | `.xdd/execute/` (在根) | `.xdd/iterations/iter-1/execute/` |
| React login 实战 | `.xdd/wire/login/review.md` (跟 wire 资产混) | `.xdd/iterations/iter-1/wire-reviews/login/review.md` |

## 跟其他 skill 配合

- `xdd-artifact-lifecycle` — 5 类 lifecycle 单一源真理 (`.xdd/xdd-schema.json:lifecycle_artifacts[]`)
- `xdd-init` — init 时按本规范生成目录
- `xdd-plan` — plan Task 里写"产物路径"用本规范
- `xdd-halt` — `.xdd-halt.json` 写在 `.xdd/` 根 (control_marker), 跨 iter 可见
- `iter-inherit.sh` — 跨 iter 传递 halt/unresolved (per-iter evidence → 下 iter inherited)
