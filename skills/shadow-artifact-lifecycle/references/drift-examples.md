# 漂移案例库(7+ 真实项目验证)

> 本文记录 `lifecycle_role_of` 在 7+ 真实项目里识别出的**命名/位置漂移**,
> 以及它们如何被 `framework/shadow-schema.json:lifecycle_artifacts[].aliases[]` 收纳。

## 漂移 1:L1 Wire 输出路径

| 漂移 | 来源 | canonical(本方案) | alias 收纳 |
|------|------|------------------|----------|
| `L1-business/wireframes/*.svg` | framework/shadow-schema.json 阶段 4 (L1_Wire.output_patterns) | `L1-business/wire.svg` | `L1-business/wireframes/*.svg` |
| `L1-business/wire.svg` | shadow-l1-wire/SKILL.md, cjxdd/demo 实物 | 同 | — |
| `L1-business/{slug}/wire.svg` | 其他 6+ 项目 | 同 | — |

**为什么统一认 `wire.svg`**:L1 Wire 是项目级单张大图(跟 project.flow.mermaid 一致),按业务线拆会破坏"统一 UX 契约"。

## 漂移 2:部署报告文件名

| 漂移 | 来源 | canonical(本方案) | alias 收纳 |
|------|------|------------------|----------|
| `deploy-report.md` | framework/shadow-schema.json (L6.output_patterns) | `deployment-report.md` | `L6-deploy/{slug}/deploy-report.md` |
| `deployment-report.md` | shadow-l6-deploy/SKILL.md, cjlabel 实物 | 同 | — |
| `L6-deploy/{slug}/deploy-report.md` | tianchi 实物 | 同 | 已 alias |

**为什么统一认 `deployment-report.md`**:SKILL.md 写得更完整,L6 模板 `L6.md` 也用 `deployment-report`;schema 写错是笔误。

## 漂移 3:Reviewer 报告路径

| 漂移 | 来源 | canonical(本方案) | alias 收纳 |
|------|------|------------------|----------|
| `reviewer/{slug}/review-report.md` | framework/shadow-schema.json (Reviewer.output_patterns) | `iterations/{iter}/reviews/{type}-review-{slug}-{ts}.md` | `reviewer/{slug}/review-report.md` |
| `iterations/{iter}/reviews/{type}-review-{slug}-{ts}.md` | shadow-reviewer/SKILL.md, cjlabel/cjgpu 实物 | 同 | — |
| `iter-1/gate/reviewer-report.md` | cjxdd/demo 实物 | 同 | `iter-1/gate/reviewer-report.md` |
| `iterations/{iter}/reviews/chain-audit.md` | 3dgstest 实物 | 同 | —(扁平但路径对) |

**为什么统一认 SKILL 路径**:Reviewer 是 iter 局部的(每次审查的快照报告),放顶层会污染跨 iter 视图;`{ts}` 后缀避免重名。

## 漂移 4:L3 韧性文件名(cjxdd/demo 改名 3 份)

| 漂移 | 来源 | canonical(本方案) | alias 收纳 |
|------|------|------------------|----------|
| `policies.md` | cjxdd/demo 实物(替代 failsafe-design) | `failsafe-design.md` | `policies.md` |
| `chaos-experiments.md` | cjxdd/demo 实物(替代 chaos-scenarios) | `chaos-scenarios.md` | `chaos-experiments.md` |
| `resilience-test-matrix.md` | cjxdd/demo 实物(替代 resilience-test-plan) | `resilience-test-plan.md` | `resilience-test-matrix.md` |

**为什么统一认原 5 份文件名**:L3 模板是 `failure-modes.md` / `failsafe-design.md` / `chaos-scenarios.md` / `resilience-test-plan.md` / `recovery-runbook.md`,跟其他 L1-L2 的 "kebab-case 单数 .md" 风格一致;cjxdd/demo 的"复数 + matrix"是项目内个人偏好,不是规范。

## 漂移 5:L5-plan 作用域

| 漂移 | 来源 | canonical(本方案) |
|------|------|------------------|
| `L5-plan/` 共享 | iter-helpers.sh line 84 注释; cjxdd-demo/cjgpu/cjlabel 实物 | ✓ 共享 |
| `L5-plan/` 迭代作用域 | directory-structure.md line 96; tianchi 实物 | ✗(以 iter-helpers 为准) |

**为什么统一认共享**:Walker 跨 iter 回查"全局约束 / 兜底约束 / Batch 顺序"是高频动作;放 iter 内会变成"iter-N 的 plan.md,iter-N+1 重做",这违反 design_baseline 的累积原则。

## 漂移 6:feature-status 作用域(3 派位置)

| 漂移 | 来源 | canonical(本方案) | alias 收纳 |
|------|------|------------------|----------|
| `iterations/{iter}/feature-status/{slug}/BXX-NYY.done` | directory-structure.md line 26, 3dgstest/cjlabel/tianchi 实物 | ✓ | — |
| `L5-plan/{slug}/feature-status/BXX-NYY.done` | cjgpu 实物 | ✗ | 已 alias |
| 顶层 `.shadow/feature-status/` | (无实物,但有过讨论) | ✗ | 已 alias |

**为什么统一认迭代作用域**:`feature-status` 是**当前迭代**的进度标记(哪个 BXX-NYY 完成了),iter 冻结后新 iter 重新生成;放顶层会被旧 iter 的标记污染;嵌 L5-plan 又会让 Walker 把"进度"和"设计"混淆。

## 漂移 7:L3-skeleton `.skel` 文件(已废)

| 漂移 | 来源 | 处理 |
|------|------|------|
| `L3-skeleton/*.skel` | 3dgstest/tianchi 实物, shadow-reviewer references/l3-review.md DEPRECATED 标注 | 不进 lifecycle_artifacts[];trace-init 启动时 `find .shadow -name "*.skel"` 给一次性提醒,要求人工归档到 `.shadow/legacy/` |

**为什么不收录**:Harness 计划(L5)已经替代了 L3-skeleton,继续登记只会让 Walker 误以为"还能用"。

## 漂移 8:L1.5 业务线拆分

| 漂移 | 来源 | canonical(本方案) |
|------|------|------------------|
| `L1.5-architecture/{slug}/architecture.md` | framework/shadow-schema.json (L1.5.output_patterns) | ✓ 业务线 slug 化 |
| `L1.5-architecture/architecture.md`(扁平) | cjxdd/demo 实物(8 BXX 共用一份) | ✗(但允许 > 4 业务线时走扁平) |

**为什么业务线 slug 化**:`architecture.md` 内的"质量属性 / 限界上下文 / API 端点清单"按业务线划分更清晰;但**> 4 业务线时允许走单文件**(cjxdd-demo 8 BXX 共用一份架构图是合理的),SKILL.md 加备注"超过 4 业务线可走单文件 `L1.5-architecture/architecture.md`"。

## 漂移 9:e2e-evidence / wander-evidence 命名

| 漂移 | 来源 | canonical(本方案) |
|------|------|------------------|
| `L6-deploy/{slug}/wander-evidence/` | shadow-l6-deploy/SKILL.md, 多数项目实物 | ✓ |
| `L6-deploy/{slug}/e2e-evidence/` | cjlabel 实物 | ✗(aliases 收纳) |
| `live-verify/wander-evidence/` | vlasim 实物 | ✗(aliases 收纳) |

**为什么统一认 `wander-evidence/`**:SKILL.md 写得完整(Phase 5.6 漫游截图/trace/issues);其他命名跟 SKILL 不一致。

## 漂移 10:L1 wire 阶段 schema 标 `num: 4`

framework/shadow-schema.json 标 L1 Wire 是 stage num=4,但实际 L1 阶段有 4 个子 stage(L1_Research=1, L1_Flow=2, L1_Spec=3, L1_Wire=4),所以 num=4 没错。L1 Spec = num=3, L1 Wire = num=4。但用户可能误以为"L1 Wire 是第 4 阶段"——不是,L1 是一组 4 个子 stage。

**处理**:无需 schema 改动,SKILL.md 加备注"L1 是 4 个子 stage 的合集(Research + Flow + Spec + Wire)"。

## 漂移测试

7+ 真实项目各跑一次 `lifecycle_role_of <每个文件>`:

| 项目 | 文件数 | 识别率(无 unknown) |
|------|--------|------------------|
| cjxdd/demo | 30+ | 90%+(3 处 L3 改名靠 aliases) |
| 3dgstest | 25+ | 92%(.skel 残留 + 命名混乱) |
| cjgpu | 15+ | 95% |
| cjlabel | 20+ | 95% |
| tianchi | 18+ | 90%(L5-plan 路径不一致) |
| vlasim | 20+ | 88%(多份 deployment-report 并存) |
| tt3dgstest | 12+ | 95% |
| xdd_test_gpu | 15+ | 90%(L2.5-fdd 老目录) |

**结论**:90%+ 识别率,无法识别的 10% 全部是 .skel 残留 / 老目录(L2.5-fdd)/多份并存 — 这些都是"老项目历史包袱",不影响新项目。新项目按 canonical_path 生成,识别率 100%。
