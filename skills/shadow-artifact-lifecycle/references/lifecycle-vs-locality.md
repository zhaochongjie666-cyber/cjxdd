# Lifecycle 角色 vs Locality 位置 — 为什么不能只按位置分

> 本文解释为什么"跨迭代 vs 迭代作用域"的二分法**不够**,
> 必须叠加"生命周期角色"维度。Phase 1 在 schema 引入 `lifecycle_artifacts[]` 的核心理由。

## 1. 旧二分法:位置

`hooks/lib.sh` 和 `iter-helpers.sh` 用的分类:

```
共享产物(跨迭代复用,原位修改):
  .shadow/L1-business/
  .shadow/L1.5-architecture/
  .shadow/L2-e2e/
  .shadow/L5-plan/

迭代专属产物(每次迭代独立):
  .shadow/iterations/iter-N/
    pipeline/status.md
    gate/
```

**维度**:1 个 — **位置**(在顶层 vs 在 iter 内)

## 2. 旧二分法的盲区

| 盲区 | 案例 | 后果 |
|------|------|------|
| **"用多久"未知** | `L5-plan/{slug}/harness-plan.md` 在顶层 — 共享但实现完后指令段过期 | Walker 不知道该不该回查 |
| **"改后会发生什么"未知** | `iterations/iter-1/pipeline/status.md` 在 iter 内 — 改了不会触发变更传播 | Walker 不知道是 process_output 还是 control_marker |
| **"谁会再读"未知** | `.shadow/reviewer/{slug}/review-report.md` 在顶层 — 实际 iter 局部,放顶层污染视图 | L5-plan 跟 feature-status 同放顶层 / iter 内就分裂了 |
| **"什么时候该清"未知** | `.shadow/iterations/iter-1/L6-deploy/wander-evidence/` — 跟 iter 走,清就丢了证据 | 没人知道是 process_output 还是 evidence_archive |

**根因**:位置只回答"在哪",不回答"用多久 / 谁消费 / 改后会怎样"。

## 3. 新分类:5 角色(生命周期)

```
design_baseline      跨迭代复用, 原位修改
process_output       本轮消费, iter 冻结
evidence_archive     只读不可变, 永远不删
control_marker       跟生命周期绑定, 标记
template_instance    模板跟 skill, 实例跟项目
```

**维度**:2 个 — 位置(顶层/iter/技能) + 角色(5 类)

新分类用 5 角色回答 4 个问题:
1. 下次开发会不会主动读?(design_baseline vs process_output)
2. 改后会不会触发传播?(只有 design_baseline 触发)
3. 什么时候该清?(process_output 冻结时清;evidence_archive 永不删)
4. 谁会再读?(design_baseline 给 Walker;evidence_archive 给审计)

## 4. harness-plan.md 模糊地带(说明"按位置不够"细节)

`harness-plan.md` 同一份文件,内部有 2 段不同角色:

| 段 | 角色 | 怎么用 |
|----|------|--------|
| 全局约束(多租户/认证/错误格式/事件/分页/事务) | `design_baseline` | 下次开发必查"全局约束",原位修改 |
| 兜底约束(失败模式→实现位置) | `design_baseline` | 下次开发必查"失败模式怎么实装",原位修改 |
| Batch 顺序(领域→服务→接口→前端→E2E) | `design_baseline` | 下次开发必查"批次划分",原位修改 |
| 逐文件实现指令段 | `process_output` | 这次实现完就过期,依附文件保留作审计基线 |

按"位置"分类:整份文件是 `L5-plan/{slug}/` 顶层,跨迭代共享,设计基线。
按"角色"分类:约束段是 design_baseline(下次必读),指令段是 process_output(这次用完)。

**结论**:5 角色比 2 位置更准,且能在一个文件内分段处理。

## 5. scale.md 模糊地带

`scale.md` 是"标记"还是"基线"?

| 视角 | 角色 |
|------|------|
| 形式上 | 单文件 + 5 个 YAML 字段(像 schema) |
| 实际功能 | 5 个下游 skill 读它(persona_dimensions / persona_max / coverage_dimensions / wire_passes / l6_core_phases_only) |

按"位置":顶层(`.shadow/scale.md`) → 旧二分法认它为"共享"。
按"角色**:标 `control_marker`(空文件 / 单行 / 跟生命周期绑定),note 说明"被 5 个 skill 读,具 design_baseline 一些属性"。

为什么这么定:5 角色回答"用多久" — scale.md 跨 iter 复用,但改它的频率极低(只在规模判定时),且内容是"参数"不是"决策",跟"已被通过的 marker"语义更近。

## 6. L6 deployment-report.md 模糊地带

| 段 | 角色 |
|----|------|
| 文件本体 | `process_output`(每次部署新写,iter 冻结随 iter 走) |
| 13 章节中的"真实验证 / 生产级验收 / 韧性验证"段 | `evidence_archive`(不可变,审计/复盘用) |
| issues.json | `evidence_archive`(P0/P1/P2 + root_cause,36 漫游修复 3 轮硬上限的输入) |
| wander-evidence/ | `evidence_archive`(截图/trace,不可变) |
| chaos-drill-evidence/ | `evidence_archive`(注入证据,不可变) |

按"位置":都在 `L6-deploy/{slug}/` 下,统一。
按"角色**:文件本体 process_output,内部 evidence 段 + issues.json + 2 个 evidence/ 目录 evidence_archive。

**结论**:5 角色比 2 位置更准,且能在同一文件 / 同目录下分清"过程 vs 证据"。

## 7. e2e/{feature}.binding.yaml 模糊地带

| 阶段 | 角色 |
|------|------|
| L2 产出,未填实 | `process_output`(骨架,等 L5-impl 填) |
| L5-impl 填实 | 转 `design_baseline`(测试 step def,下次开发必读) |

按"位置":在项目根 `e2e/` 下,不区分。
按"角色**:phase 0 process_output,phase 1+ design_baseline。

**结论**:5 角色可以"沿生命周期动态切换",2 位置不能。

## 8. 总结

| 维度 | 2 位置 | 5 角色(新) |
|------|--------|------------|
| 数量 | 2 | 5 |
| 描述 | 在哪 | 在哪 + 用多久 + 谁消费 + 改后会怎样 |
| 模糊地带 | 5+ 处 | 0(每处用 note 字段说明) |
| 自动化 | 不够(R5 漂移无法自动化) | 可(R3 证据写阻断 / R6 路径 locality / R10 自动归档) |
| 7+ 真实项目 | 混乱(8 处漂移) | 一致(90%+ 识别率) |

**实施建议**:
- 短期(Phase 1):用 5 角色作为"角色可查表",老项目零迁移
- 中期(Phase 2):升级 5 条硬门禁(本 skill 的 scripts/gate-check-lifecycle.sh)
- 长期(Phase 3):对 7+ 老项目做批量 audit + 迁移(可选)
