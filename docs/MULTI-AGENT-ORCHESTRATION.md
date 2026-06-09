# xdd 多 Agent 编排架构 (2026-06-09)

> **核心转变**: xdd-walker 从"工匠型"单体 agent 升级为"编排型"主 agent, 按 Phase 派发到 8 个 phase-subagent, 每个 subagent 装对应 skill 独立完成.
> **100% 完成门禁**: Phase 6 必 100% 真实持久化 + 跨服务 + 端到端测试, 缺一 HALT.

---

## 1. 架构对比

### 旧: 单体工匠 (session c3692b46 失败模式)

```
xdd-walker (单体工匠)
  ↓ 自己读 + 写 + 跑
  ↓ 全 6 Phase 自己干
  ↓ 容易:
  - 偷工 (Phase 5 60 端点只实施 23 = 38%)
  - 不回头验 (wire 12 门禁 11 失败)
  - DEPLOY_PASS 蒙混
```

### 新: 多 Agent 编排 (本次)

```
xdd-orchestrator (主调度)
  ├── Phase 1: dispatch → phase-researcher (装 xdd-l0)
  ├── Phase 2: dispatch → phase-designer (装 xdd-bdd + flow + add + wire)
  ├── Phase 2.5: dispatch → phase-architect (装 xdd-arch)
  ├── Phase 2.7: dispatch → phase-scaffolder (装 xdd-scaffold)
  ├── Phase 3: dispatch → phase-resilience-designer (装 xdd-l3)
  ├── Phase 4: dispatch → phase-planner (装 xdd-plan)
  ├── Phase 5: dispatch → phase-executor (装 xdd-execute)
  └── Phase 6: dispatch → phase-verifier (装 xdd-l6)
```

---

## 2. 8 个 Phase Subagent 详细映射

| Phase | Subagent | 装 Skill | 输入 | 输出 (完成度必 100%) |
|-------|----------|---------|------|---------------------|
| **0 INIT** | (主 orchestrator 自己做) | xdd-init | 空仓库 | `.xdd/xdd-version`, `current-iteration`, `scale.md`, `status.md` |
| **1 RESEARCH** | `phase-researcher` | xdd-l0 (含 brainstorm 引导问 + 5 方向 web search) | `.xdd/core/intent.md` | 9 份 L0 笔记本 (`00-l1-recap` + 01-08) |
| **2 DESIGN** | `phase-designer` | **xdd-bdd + xdd-flow + xdd-add + xdd-wire** (4 个并发) | L0 笔记本 + scale.md | 5 个工件: BBD features (100% RXX) + flow.mermaid + add.md + wire.svg (12 门禁过) + project.flow.mermaid |
| **2.5 ARCH** | `phase-architect` | xdd-arch | L0 + BBD + flow + add | 3 个工件: arch/architecture.md (含 100% API 端点清单) + aggregate-landscape.md + event-contract.md |
| **2.7 SCAFFOLD** | `phase-scaffolder` | xdd-scaffold + xdd-docker-helper | arch/architecture.md | 7 步 Docker 开发环境 + Hello API + smoke test 13 断言全过 |
| **3 L3** | `phase-resilience-designer` | xdd-l3 | 全部 Phase 2 产物 | 5 份韧性: failure-modes (5 字段或 8 字段) + failsafe-design + chaos-scenarios + resilience-test-plan + recovery-runbook |
| **3 REVIEW** | (主 orchestrator 提示) | — | 全部产物 | 用户确认 "OK" / "go" |
| **4 PLAN** | `phase-planner` | xdd-plan | 全部 Phase 2 + 2.5 + 3 产物 | harness-plan.md (17 项自检必过, **RXX 100% 覆盖**, **stub 禁令**) |
| **5 EXECUTE** | `phase-executor` | xdd-execute + xdd-l6 子阶段 | harness-plan.md | 100% 端点实施 + 100% 端到端测试 (真实 DB + 跨服务) + 0 stub |
| **6 VERIFY** | `phase-verifier` | xdd-l6 (含 L3 chaos + 4 维 audit) | 全部代码 + 部署 | 6 份报告 + R11 4 层验证 + 双契约 (Real Usability + Production Acceptance) |

---

## 3. Orchestrator 主入口 (xdd-orchestrator)

### 3.1 何时用

- 用户说"用 xdd 给我做一个 XX 系统" → 加载 xdd-orchestrator
- xdd-walker (旧工匠) 保留作 fall-back (单文件 demo, 不需要 dispatch)

### 3.2 流程

```
1. 收到任务
2. is_meta_project? → 退出 (framework 自身禁用流程)
3. 检测 .xdd/ 存在?
   - 否 → 调 xdd-init (生成骨架)
   - 是 → 读 status.md
4. 找下一个 ⏳ phase, dispatch 到对应 subagent
5. subagent 装 skill → 写产物 → 标记 status.md ✅
6. 跑 xdd-gate-{phase}.sh 验证
7. 6 Phase 全 ✅ → final.md + DEPLOY_PASS
8. 任一 HALT → 提示用户
```

### 3.3 subagent dispatch 表 (orchestrator 内部硬编码)

| ⏳ phase | subagent | skill 装 | 必装 |
|----------|----------|---------|------|
| 0 INIT | (orchestrator 自己做) | xdd-init | — |
| 1 RESEARCH | `phase-researcher` | xdd-l0 | — |
| 2 DESIGN | `phase-designer` | xdd-bdd, xdd-flow, xdd-add, xdd-wire | — |
| 2.5 ARCH | `phase-architect` | xdd-arch | strict-mode 全规模触发 |
| 2.7 SCAFFOLD | `phase-scaffolder` | xdd-scaffold, xdd-docker-helper | — |
| 3 L3 | `phase-resilience-designer` | xdd-l3 | — |
| 3 REVIEW | (orchestrator 提示) | — | — |
| 4 PLAN | `phase-planner` | xdd-plan | — |
| 5 EXECUTE | `phase-executor` | xdd-execute, xdd-l6 | 100% 端到端 |
| 6 VERIFY | `phase-verifier` | xdd-l6 | — |

---

## 4. 8 个 Phase Subagent 详细规范

每个 subagent 必须满足:
1. **单一职责**: 专管一个 Phase
2. **装指定 skill**: 必装, 不允许跳
3. **必填产物**: 不允许 incomplete
4. **3 试 HALT**: 失败 3 次升级 HALT
5. **回报告到 orchestrator**: 产物路径 + 自检结果

### 4.1 phase-researcher

**装 skill**: xdd-l0

**必填产物** (9 份):
- `00-l1-recap.md` (L1 消费摘要)
- `01-industry-notes.md` (行业)
- `02-competitor-analysis.md` (竞品)
- `03-user-personas.md` (画像 6-8 维度)
- `04-user-journeys.md` (旅程 5 层次)
- `05-tech-research.md` (技术)
- `06-events-brainstorm.md` (事件)
- `07-external-references.md` (引用 5 方向)
- `08-brainstorm.md` (5-10 引导问答案)

**自检**:
- [ ] 9 份 .md 文件存在
- [ ] 8 份 mtime ≤ 14 天
- [ ] 03 画像 ≥ 6 维度
- [ ] 04 旅程 ≥ 画像数 × 5
- [ ] 07 引用 ≥ 5 来源

**HALT 触发**: 8 份 mtime ≥ 14 天.

### 4.2 phase-designer

**装 skill**: xdd-bdd, xdd-flow, xdd-add, xdd-wire

**必填产物** (5 个):
- `bdd/{slug}/*.feature` (1 业务线 ≥ 1 Scenario, 多业务线每个 BXX 独立)
- `bdd/index.md` (BXX 索引 + cross-BXX 一致性 checklist)
- `add/{slug}/*.md` (状态机 + 时序 + 排障)
- `wire/{page}.svg` 或 `wire/{group}/{group}.{desktop|mobile}.svg` (12 门禁全过)
- `flow/project.flow.mermaid` (BXX-NYY 节点 + mmdc 验证)
- `project.flow.mermaid` (项目级)

**自检 (12 门禁)**:
- [ ] 设计声明 1 行
- [ ] 3 旋钮 (VARIANCE/MOTION/DENSITY)
- [ ] 设计系统 (FluentUI / Tailwind / Material)
- [ ] 设计 Token (颜色/间距/圆角/字体阶梯)
- [ ] desktop + mobile 双 SVG
- [ ] 零 em-dash (0 命中, xdd-gate-wire-validate 验证)
- [ ] 页面主题锁 (light 或 dark)
- [ ] 色彩一致 (1 accent)
- [ ] Hero fit 视口 (≤ 2 行)
- [ ] Eyebrow 计数 ≤ ceil(section/3)
- [ ] 真实图像占位 (picsum-seed)
- [ ] 12 类门禁全过

**HALT 触发**: em-dash ≥ 1 / data-page < 8 / mobile SVG 缺失.

### 4.3 phase-architect

**装 skill**: xdd-arch

**必填产物** (3 个):
- `arch/{slug}/architecture.md` (质量属性 + 安全 + 性能 + 文件清单 + docker-compose)
- `arch/aggregate-landscape.md` (聚合根 + 跨业务线)
- `arch/event-contract.md` (EDD 独立契约)

**API 端点清单覆盖率自检** (必 100%):
- [ ] 必含每个 RXX 对应的 API 端点
- [ ] 每个端点 @flow BXX-NYY 节点引用
- [ ] 每个端点 @rules RXX 引用
- [ ] 端点数 = BDD Scenario 数 × N (≥ 1)

**HALT 触发**: API 端点 < BDD Scenario 数.

### 4.4 phase-scaffolder

**装 skill**: xdd-scaffold, xdd-docker-helper

**必填产物** (7 步):
- 目录骨架 (5 段: apps/libs/web/infra/tests)
- `pyproject.toml` / `package.json` / `go.mod`
- 测试框架配置
- 服务依赖启动 (`docker compose up -d --wait` GREEN)
- DB 迁移 (≥ 1 张表 + 1 条 seed)
- Hello API 1 端点 (curl 200 + 真实 DB 写入)
- Smoke test 13 断言全 PASS

**自检**:
- [ ] `docker compose up -d --wait` 全部 GREEN
- [ ] `curl /api/hello` → 200 + 真实 DB 数据
- [ ] `pytest smoke/` → 13/13 PASS

**HALT 触发**: 任何步骤失败 3 次.

### 4.5 phase-resilience-designer

**装 skill**: xdd-l3

**必填产物** (5 份, l3_extended_mode 决定字段数):
- `resilience/{slug}/failure-modes.md` (FMEA 5 字段 [S/M] 或 8 字段 [L])
- `resilience/{slug}/failsafe-design.md` (10 兜底 [S/M] 或 12 模式 [L])
- `resilience/{slug}/chaos-scenarios.md` (≥ 11 P0 @chaos [S/M] 或 16 P0 [L])
- `resilience/{slug}/resilience-test-plan.md` (测试矩阵)
- `resilience/{slug}/recovery-runbook.md` (运维 runbook)

**自检**:
- [ ] failure-modes 每行 5 字段 (S) 或 8 字段 (L) 完整
- [ ] 兜底模式数 ≥ scale 阈值
- [ ] chaos 场景数 ≥ scale 阈值
- [ ] FMEA 引用 RXX 比例 100%

**HALT 触发**: 兜底模式数 < 阈值.

### 4.6 phase-planner

**装 skill**: xdd-plan

**必填产物**:
- `plan/harness-plan.md` (17 项自检必过)
- `plan/{feature}.md` (每个 feature 一份, 多个 feature 拆开)

**17 项自检 (全部必过)**:
- [ ] BDD 覆盖率 100% (每个 RXX 有对应 Task)
- [ ] 无 TBD/TODO
- [ ] 类型一致性 (跨 Task 引用)
- [ ] 术语一致性 (跟 BDD/ADD/Flow)
- [ ] 依赖一致性 (DAG, 无环)
- [ ] 任务步骤 ≤ 7
- [ ] TDD 循环 (先测试后实现)
- [ ] 提交步骤
- [ ] 异常路径覆盖
- [ ] 全局约束 (多租户/认证/错误码/事件/分页/事务)
- [ ] 全局约束 (Phase 5 实施覆盖率)
- [ ] 端点覆盖率 100% (每个 API 端点有 Task)
- [ ] 兜底约束 (L3 失败模式 + 兜底)
- [ ] 度量 ≥ 80%
- [ ] 风险预案
- [ ] stub 禁令
- [ ] 度量 ≥ 80%

**HALT 触发**: 17 项任何 1 项不通过.

### 4.7 phase-executor (100% 端到端完成度强制)

**装 skill**: xdd-execute, xdd-l6

**必填产物**:
- 100% 端点实施 (Phase 2.5 arch 设计的端点, 一个都不能少)
- 100% 端到端测试 (每个 RXX 必 1 个 e2e 测试, 真实 DB + 跨服务)
- 0 stub (pass / TODO / NotImplementedError / InMemoryRepository)
- 0 假实现 (current_user = "admin" / mock DB)

**100% 完成度自检** (xdd-gate-coverage-check 强制):
- [ ] 设计端点数 = 实施端点数
- [ ] 设计 RXX 数 = 实施 RXX 数
- [ ] stub 行 = 0
- [ ] e2e 测试数 ≥ RXX 数
- [ ] e2e 测试用真实 DB (无 Mock)
- [ ] e2e 测试跨服务 (B01 → B02 数据流)

**HALT 触发**: 端点缺失 1 个 / stub ≥ 1 / e2e < RXX 数.

### 4.8 phase-verifier

**装 skill**: xdd-l6

**必填产物** (10 份):
- `verify/l5-a1-spec-code.md` (spec↔code 4 维审计)
- `verify/l5-a2-wire-code.md` (wire↔code)
- `verify/l5-a3-arch-code.md` (arch↔code)
- `verify/l5-a4-l3-code.md` (l3↔code)
- `verify/l6-b1-health-check.md` (健康检查)
- `verify/l6-b2-wander-test.md` (漫游测试)
- `verify/l6-b3-chaos-drill.md` (混沌演练)
- `verify/l6-b4-real-usability.md` (真实可用)
- `verify/l6-b5-production-acceptance.md` (生产级验收)
- `verify/smoke-test-passed` (R11 marker, chmod 444)

**自检 (双契约)**:
- [ ] Real Usability: 真实持久化 + 重启保留 + 真实认证 + 跨服务 + P0 UAT
- [ ] Production Acceptance: 10 闭环全过
- [ ] L5 4 维审计 ≥ 90%
- [ ] R11 4 层验证全过 (mtime < 7 天 + L2/L3/L4)

**HALT 触发**: 双契约任一不通过.

---

## 5. Orchestrator 的 3 试 HALT 升级

每个 subagent 失败 3 次, orchestrator 升级 HALT:
1. 写 `.xdd/iterations/{iter}/.xdd-halt.json`:
   ```json
   {
     "halt_at": "2026-MM-DDTHH:MM:SSZ",
     "phase": "5-execute",
     "subagent": "phase-executor",
     "issue": "e2e 测试 < RXX 数 (50/80)",
     "attempts": 3,
     "last_error": "...",
     "suggested_retreat": "Phase 2.5 ARCH 重新设计 API 端点"
   }
   ```
2. 弹错误 toast 提示用户
3. 不允许 orchestrator 继续派工

**Bypass**: 真要绕过, 写 `# bypass-shdw: <具体原因>`, 走 audit log, L6 部署前 user 必审.

---

## 6. 5 Step Rhythm (orchestrator 自己节奏)

```
① 接收任务, 检测 .xdd/ 状态
② 找下一个 ⏳ phase, 派 subagent
③ subagent 装 skill → 写产物 → status.md ✅
④ 跑 xdd-gate-{phase}.sh 验证
⑤ 全 ✅ → 派下一 phase; 失败 → 3 试 HALT
```

---

## 7. 工件目录 (100% 必填)

```
.xdd/
├── xdd-version
├── current-iteration
├── scale.md (含 strict_mode + l0/l3/l6_required + bxx_enabled)
├── core/intent.md
├── research/                     ← Phase 1 产物 (9 份)
├── business/                      ← Phase 2 产物 (landscape + {slug}/{research,spec}.md)
├── arch/                         ← Phase 2.5 产物 (architecture + aggregate-landscape + event-contract)
├── add/                          ← Phase 2 产物 (架构设计说明书)
├── wire/                         ← Phase 2 产物 (12 门禁过的 svg)
├── bdd/                          ← Phase 2 产物 (Gherkin features)
├── project.flow.mermaid          ← Phase 2 产物
├── plan/                         ← Phase 4 产物 (harness-plan.md)
├── resilience/                   ← Phase 3 产物 (5 份韧性)
├── verify/                       ← Phase 6 产物 (10 份报告 + R11 marker)
└── iterations/iter-N/pipeline/
    ├── status.md
    ├── bdd-coverage.md
    └── final.md
```

---

## 8. 11 Hook 在编排中的角色

| Hook | 触发时机 | 角色 | 阻断 |
|------|----------|------|------|
| `xdd-gate-session-start` | SessionStart | 注入 orchestrator 上下文 | — |
| `xdd-gate-user-prompt-submit` | UserPromptSubmit | 检测"做一个 XX" → 加载 orchestrator | — |
| `xdd-gate-pre-skill` | PreToolUse(Skill) | 5 步节奏, subagent 必装 | 跳阶段 exit 2 |
| `xdd-gate-stub-scan` | PostToolUse(Write\|Edit) | 实时扫 stub | — |
| `xdd-gate-stop` | Stop | 5 段 hard-gate 编排器 | 多处 |
| `xdd-gate-team-dispatch` | PreToolUse(Task) | subagent dispatch 校验 (含 input/output 字段) | — |
| `xdd-gate-meta` | 独立 / 其他 gate 内部 | CWD=cjxdd 静默 | — |
| `xdd-gate-pressure` | UserPromptSubmit 内部 | 5 类压力信号 | — |
| `xdd-gate-0-init` | Phase 0 出口 | 校验 .xdd/ + scale.md | exit 1 |
| `xdd-gate-1-research` | Phase 1 出口 | status.md Phase 1 ✅ | exit 2 |
| `xdd-gate-2-design` | Phase 2 出口 | 5 工件 (BDD/flow/add/wire/arch) | exit 2 |
| `xdd-gate-3-review` | Phase 3 出口 | 用户确认 | — |
| `xdd-gate-4-plan` | Phase 4 出口 | 17 项自检 | exit 2 |
| `xdd-gate-5-execute` | Phase 5 出口 | **100% 完成度 + 0 stub** | **exit 2 (HALT)** |
| `xdd-gate-6-verify` | Phase 6 出口 | 10 报告 + R11 marker | exit 2 |
| **`xdd-gate-wire-validate`** (新) | PostToolUse(Write\|Edit) 或 Phase 2 出口 | **12 门禁自动检查** | **exit 2** |
| **`xdd-gate-coverage-check`** (新) | Phase 5 出口 | **设计 vs 实施 80% 覆盖率** | **exit 2** |

---

## 9. 100% 完成度的 6 道闸门

| 闸门 | 时机 | 检查 | 阻断阈值 |
|------|------|------|---------|
| **BDD 覆盖率** | Phase 4 出口 | BDD Scenario 数 ≥ RXX 数 | 任何缺口 |
| **API 端点覆盖率** | Phase 5 入口 | arch 端点数 = 实施数 | 任何缺口 |
| **端到端测试** | Phase 5 中段 | e2e 测试数 ≥ RXX 数 | < 100% |
| **真实持久化** | Phase 5 中段 | 测试用真实 DB, 无 Mock | 任何 Mock |
| **跨服务** | Phase 5 中段 | 测试跨 BXX 数据流 | 任何 1 BXX 无 e2e |
| **0 stub** | Phase 5 出口 | grep stub = 0 | 任何 stub |

**最终**: 6 道闸门全过 → Phase 6 入口 → R11 + 双契约.

---

## 10. 与旧 xdd-walker 的关系

- `xdd-walker.md` (旧工匠, 单体): 保留作 fall-back, 单文件 demo / 教学用
- `xdd-orchestrator.md` (新编排): 主力, 商业产品项目必用
- 区别: 旧 walker 自己做, 新 orchestrator dispatch

**何时用哪个**:
- 复杂项目 (> 5 业务线 / > 60 RXX / 多 service) → orchestrator
- 简单项目 (< 3 业务线 / < 20 RXX / 单 service) → walker 仍可用

---

## 11. 跟 xdd-meta 守卫的协同

orchestrator 跟 walker 一样, 必须先做 is_meta_project() 检查:
- CWD = cjxdd 仓库自身 → 立即退出
- 这是 Meta 任务, 不要加载 orchestrator / walker / 任何 subagent
- 改 framework 源码用 Read/Edit, 跑 smoke 验证

---

## 12. 实施路线图

### 立即 (P0, 1h)
1. 写 `agents/xdd-orchestrator.md` (~300 行)
2. 写 8 个 phase-subagent
3. 写 `hooks/xdd-gate-wire-validate.sh` (12 门禁)
4. 写 `hooks/xdd-gate-coverage-check.sh` (设计 vs 实施)
5. 写 `skills/xdd-artifact-lifecycle/scripts/gate-check-lifecycle.sh` (R5)

### 本周 (P1, 4h)
6. 改 xdd-wire SKILL.md (Pre-flight 12 门禁)
7. 改 xdd-arch SKILL.md (API 端点覆盖率)
8. 改 xdd-execute SKILL.md (100% 端到端)
9. 改 settings.json (注册 2 个新 hook)

### 1 周 (P2)
10. xdd-flow-bug-report skill (用户反馈)
11. xdd-design-review skill (4 维评审)
12. xdd-coverage-monitor skill (持续监控)

---

## 13. 跑通后 100% 完成度对比

| 指标 | session c3692b46 | 下次跑 (新架构) |
|------|------------------|------------------|
| BDD 覆盖率 | 80/80 (设计 100%) | 80/80 (设计 100%) |
| API 端点实施 | 23/60 = 38% | **60/60 = 100%** |
| stub | 2 | **0** |
| e2e 测试 | 0 (只有 unit) | **80 e2e** (1 per RXX) |
| 真实持久化 | 部分 | **100%** |
| 跨服务 | 0 | **80% 业务线有** |
| wire 12 门禁 | 1/12 | **12/12** |
| L5 4 维审计 | 1/4 (N/A) | **4/4 ≥ 90%** |
| DEPLOY_PASS | 蒙混过 | **真过 (10 报告 + R11 + 双契约)** |

---

**总目标**: 下次跑 demo, 0 偷工, 0 蒙混, 100% 真实完成.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
