---
name: shadow-artifact-lifecycle
alias: Shadow·Artifact-Lifecycle
methodology: |
  Shadow 工件生命周期分类 — 5 类角色(设计基线 / 过程产物 / 证据存档 / 控制标记 / 模板与实例)
  单一源真理: .shadow/shadow-schema.json:lifecycle_artifacts[]
  配套门禁: scripts/gate-check-lifecycle.sh (5 角色 × canonical_path 一致性)
description: |
  Shadow 工件生命周期元 skill — 替代"跨迭代 vs 迭代作用域"二分法, 回答"工件用多久 + 谁消费 + 改后会怎样".
  5 角色: design_baseline / process_output / evidence_archive / control_marker / template_instance.
  单一源真理: .shadow/shadow-schema.json:lifecycle_artifacts[]. 配 scripts/gate-check-lifecycle.sh.
  触发: 工件分类、lifecycle、artifact role、design_baseline、drift、漂移、归档.
version: "1.0.0"
---

# Shadow·Artifact-Lifecycle — 工件生命周期元 skill

## 角色

把 Shadow `.shadow/` 下 30+ 份工件按**生命周期角色**分成 5 类,让 Walker、Reviewer、trace-init 有一个统一语言回答"这份产物用多久 + 改后会怎样"。

**核心价值**:
- 替代"跨迭代 vs 迭代作用域"位置二分法(只描述在哪,不说用多久)
- 让 5 类角色 = 5 种命运(累积 / 弃用 / 冻结 / 标记 / 模板)
- 让 stop-gate 漂移扫描、Reviewer chain 审计、trace-init 反向追溯用同一张表

**Walker 信条**:
1. **5 类足矣** — 不要再发明第 6 类,不够就拆"模糊地带"到现有 5 类
2. **角色判定看命运,不看位置** — 一份文件是设计基线还是过程产物,看它被消费几次
3. **漂移不是错,是数据** — 7+ 真实项目里 8 处命名漂移是数据,记录在 `aliases[]` 即可,不强迫改名
4. **证据存档真的只读** — `evidence_archive` 角色文件 chmod 444,改它之前先反思

## 5 类生命周期角色(完整 58 工件映射见 schema)

| 角色 | 英文 | 典型产物 | 命运 |
|------|------|----------|------|
| **设计基线** | `design_baseline` | `spec.md` / `architecture.md` / `failure-modes.md` / `failsafe-design.md` / `harness-plan.md`(约束段) / 项目代码 | 跨迭代累积,原位修改 |
| **过程产物** | `process_output` | L0 笔记本 / `status.md` / 审查报告 / `wire-skeleton.svg` / 审查 `result.json` | iter 冻结时随 iter 一起冻结 |
| **证据存档** | `evidence_archive` | `wander-evidence/` / `chaos-drill-evidence/` / `issues.json` | 永远不删,加 `.archived` 锁 |
| **控制标记** | `control_marker` | `SHADOW_VERSION` / `current-iteration` / `scale.md` / `.passed` / `.done` | 跨迭代顶层 + iter 局部 |
| **模板与实例** | `template_instance` | `skills/{name}/templates/*.md` | 模板跟 skill 版本化,实例落地后转 design_baseline |

## 4 问判别启发式(下次有新工件不知归哪时,按顺序问)

1. **下次开发会不会主动读它?** 是 → 设计基线;否 → 过程产物
2. **是否只服务"证明某事发生过"?** 是 → 证据存档
3. **是否只是"已通过/已完成"标记?** 是 → 控制标记
4. **是否只是空骨架等被填?** 是 → 模板(实例落地后转问 1)

## 怎么做

### 1. 装本 skill 后第一件事:读 schema

`.shadow/shadow-schema.json:lifecycle_artifacts[]` 登记 58 工件,5 角色,所有路径 + 别名。完整映射在 schema 里,本 skill 不重复抄。

```bash
# 列出所有设计基线工件
jq -r '.lifecycle_artifacts.artifacts[] | select(.role == "design_baseline") | .canonical_path' .shadow/shadow-schema.json
```

### 2. 给当前文件查角色

```bash
# 给任意文件路径查角色
source hooks/lib.sh && load_shadow_schema
lifecycle_role_of .shadow/L1-business/spec.md
# → design_baseline

# 给文件名带 placeholder 的查
lifecycle_role_of .shadow/L6-deploy/B01/wander-evidence/
# → evidence_archive
```

### 3. 给当前阶段查预期产物

Walker 干活时常问"我现在该写什么文件"。查 schema:

```bash
# 查 L1 Spec 阶段的所有预期产物
jq -r '.lifecycle_artifacts.artifacts[] | select(.stage == "L1_Spec") | "\(.role): \(.canonical_path)"' .shadow/shadow-schema.json
# → design_baseline: .shadow/L1-business/{slug}/spec.md
```

### 4. 跑门禁检查(5 角色一致性)

```bash
bash skills/shadow-artifact-lifecycle/scripts/gate-check-lifecycle.sh
```

检查项:
- schema 中 58 工件都登记了角色(数量检查)
- canonical_path 路径模板合法(占位符语法)
- 角色分布(5 类)与 walker 当前阶段一致
- aliases[] 不指向已废产物(如 `L3-skeleton/*.skel`)
- 当前 .shadow/ 实物文件被 lifecycle_role_of 识别率 ≥ 90%

### 5. 漂移诊断(7+ 真实项目案例)

若发现"文件存在但 lifecycle_role_of 返回 unknown",先检查:
1. 该路径在 schema 的 canonical_path 还是 aliases?
2. 占位符是否齐全(`{iter}` / `{slug}` / `{layer}` 等)
3. 是否新引入了角色之外的"第 6 类"——不应该,先看是否漏登记

漂移案例库见 `references/drift-examples.md`。

### 6. 模糊地带处理

| 模糊工件 | 怎么定 | 看 references/ |
|----------|--------|----------------|
| `harness-plan.md` 约束段 vs 指令段 | 标 `design_baseline`;note 说明"指令段实现完即过期" | `lifecycle-vs-locality.md` § 4 |
| `scale.md` 标记 vs 基线 | 标 `control_marker`;note 说明"被 5 个 skill 读,具 design_baseline 一些属性" | 同上 § 5 |
| `L6 deployment-report.md` 文件 vs 证据段 | 标 `process_output`;note 说明"内部 evidence 段是 evidence_archive" | 同上 § 6 |
| `e2e/{feature}.binding.yaml` 未填实 vs 填实 | 标 `process_output`;note 说明"填实后转 design_baseline" | 同上 § 7 |

## 5 条硬门禁规则(Phase 2 实施)

| ID | 规则 | 触发器 | 行为 |
|----|------|--------|------|
| **R1** | 设计基线改动传播 | `stop-gate` 阶段扫描 | 检测 `.shadow/L*-*/` 设计基线文件 mtime 异常(> 24h 内多次修改),提示"考虑触发下游变更传播" |
| **R3** | 证据写阻断 | `post-write-stub-scan` 写入时 | 任何 Write/Edit 落到 `evidence_archive` 角色文件 → chmod 444 阻断 + 警告"先确认是否真要改证据" |
| **R5** | 漂移扫描 | `stop-gate` 末尾 | 原 Phase 1 软警告,Phase 2 升级:漂移 ≥ 1 时 `exit 1`(原 exit 0) |
| **R6** | 路径 locality | `post-write-stub-scan` 写入时 | 任何 Write/Edit 落到 `.shadow/` 但不在 `canonical_path` 列表 → 警告"路径不在 schema 登记" |
| **R10** | 自动 `.archived` 锁 | iter 冻结时(`shadow-init --new-iter`) | 自动给 `evidence_archive` 文件加 `.archived` 后缀,chmod 444 |

> 详细实现见 `scripts/gate-check-lifecycle.sh` + `hooks/stop-gate.sh` + `hooks/post-write-stub-scan.sh` 的对应段。

## 产出

> **生命周期角色**:本 skill 本身 = `template_instance` 模板与实例 — `SKILL.md` + `references/*.md` + `scripts/gate-check-lifecycle.sh` 都是模板;Walker 调用本 skill 跑出来的产物(角色判定报告 / 漂移清单 / 归档动作)归到 `.shadow/LIFECYCLE.md` 作为 `control_marker` 控制标记(供 session-start 引用)。

**调用本 skill 后落地的产物**:
- `.shadow/LIFECYCLE.md` — 项目内生命周期索引页(由 `shadow-init` 自动创建,本 skill 引用)
- `gate/lifecycle.{ts}.passed` — 本 skill 跑过后留的 control_marker
- (可选)`lifecycle-audit-{ts}.md` — 漂移清单报告,归 `process_output`

## 约束

- **不要再发明第 6 类** — 5 类足够;模糊地带用 note 字段说明,不增加 role
- **判别用 4 问,不用位置** — 一个文件放 `.shadow/L0-research/` 不代表一定是 process_output,要看"下次开发会不会主动读"
- **aliases[] 是历史包袱,不是规范** — 老项目漂移收纳到 aliases,新项目用 canonical_path;不要新增别名
- **不要硬阻断老项目** — R5 漂移扫描是新增的,只在新建/活跃 iter 上跑;7+ 老项目跑仍然 0 漂移时 exit 0

## 跟其他 skill 的关系

- **影子 `shadow-init`**:本 skill 引用 `shadow-init` 创建的 `.shadow/LIFECYCLE.md`
- **`shadow-walker`**:Walker 装本 skill 查 schema,不在脑里记 5 类
- **`shadow-reviewer`**:Reviewer chain 审计用本 skill 的角色分布作维度
- **`shadow-trace-init`**:反向追溯时按角色加权(`design_baseline` 权最高,`process_output` 权最低)
- **`shadow-reverse`**:逆向已有系统时,本 skill 帮判断哪些是"野生设计基线"(反推产物类别)

## 三面手(本 skill 自身)

| 面 | 产物 |
|----|------|
| **设计** | 5 角色分类 + 4 问启发式 + 漂移案例库(本 SKILL.md + references/) |
| **实现** | `scripts/gate-check-lifecycle.sh` 5 条规则可执行;`hooks/` 集成 |
| **跟踪** | 角色分布 session-start 输出 + 漂移 stop-gate 报告 + 归档 action log |

## 自检(本 skill 完成后)

- [ ] 5 角色都能在 schema 中查到定义(`jq -e '.lifecycle_artifacts.roles | keys | length == 5' .shadow/shadow-schema.json`)
- [ ] 58 工件都在 schema 中登记(`jq '.lifecycle_artifacts.artifacts | length' .shadow/shadow-schema.json` = 58)
- [ ] `gate-check-lifecycle.sh` 跑出来 exit 0(无漂移)
- [ ] 任意给一个 .shadow/ 实物文件,`lifecycle_role_of` 能识别
- [ ] 7+ 真实项目跑 schema 查询,识别率 ≥ 90%(老项目有 alias 兜底)

## 引用

- 单一源真理: `.shadow/shadow-schema.json:lifecycle_artifacts[]`
- 概念入口: `CLAUDE.md` § 7
- Walker 决策依据: `agents/shadow-walker.md`(变更传播表 + 迭代管理段 + 回退决策树)
- hooks 实现: `hooks/lib.sh:lifecycle_role_of` / `lifecycle_paths_by_role` / `count_lifecycle_role_files`
- 漂移案例: `references/drift-examples.md`
- 5 角色深度: `references/lifecycle-taxonomy.md`
- 跟位置的边界: `references/lifecycle-vs-locality.md`
