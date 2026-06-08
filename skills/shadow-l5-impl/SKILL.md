---
name: shadow-l5-impl
alias: Shadow·L5-Impl
description: |
  Shadow L5 代码实现 — 基于 Harness 计划的机械执行。
  AI coder 只读 Harness 计划，不需要任何上游文档，按 Batch 逐文件实现。
  生产实现必须满足真正可用契约：真实持久化、真实认证、跨服务数据流。
  触发：L5、实现、代码、TDD、Harness。
version: "5.0.0"
---

# Shadow·L5 — Harness 计划执行者

## 角色

**Harness 计划是入口 + 索引, 上游设计文档是 detail (v5 修订)**。coder 写代码前**必读** plan, 然后**按 `@upstream` 跳读上游对应段**理解设计意图。

旧"只读 Harness 计划"哲学根因: 让 coder 写"参数对但语义错"的代码 (例如, R03 业务背景是"审核员必须看到 2 个标注才能 approve", coder 只看 plan 写"if status == SUBMITTED: approve" 通过了断言但漏了">=2 个标注"前置条件). v5 强制 coder 读上游 5 分钟, 拿回业务上下文.

**Plan 包含** (自包含层, coder 不必查):
- 每个文件的类签名、方法签名、字段类型
- 每个方法的校验条件、状态变更、事件发布
- 每个方法的测试断言
- 错误码、错误消息
- 依赖服务的接口签名

**Plan 索引 + 上游 detail** (v5 新增, coder 写代码前必读):
- `@upstream: spec.md §R03` → spec.md 业务背景 / 异常路径 / 跟其他规则关系
- `@upstream: wire.svg page-annotator-workbench` → 页面布局 / 交互区域 / 状态
- `@upstream: arch.md §API.POST /annotations` → 完整请求/响应 schema / 错误码
- `@upstream: event-contract.md §AnnotationSubmitted` → 载荷字段 / 订阅者
- `@upstream: failure-modes.md §F12 (RPN=27)` → 失败原因 / 触发条件 / 检测信号
- `@upstream: e2e.feature:scenario-R03-submit` → Gherkin 步骤 / 验收剧本

**L5-impl 的纪律**: 写每个文件前 5 分钟, 跳 plan 顶部 **"上游引用矩阵"** + 该文件指令段的 `@upstream` 列表, 全部 `Read` 一遍, 理解设计意图再动键盘。

## 怎么做

### 1. 读 Harness 计划 + 跳读上游 (v5 修订)

**先** 读取 `.shadow/L5-plan/{slug}/harness-plan.md` **顶部"上游引用矩阵"**（6 张表: 规则/端点/事件/失败模式/页面/验收场景 → 上游文件 + 段行号）。

**plan-iter-check (v5.1 必做, 防 iter 间设计冲突)**: 读 `.shadow/current-iteration` 看当前活跃 iter, 跟 plan 顶部 metadata 块的 `@iter: N` 对比:

| 情况 | 行为 |
|------|------|
| `@iter == current-iteration` | ✅ 正常, 继续读 plan |
| `@iter < current-iteration` | ⛔ **plan 过期**: 提示 "plan 是 iter-N 时的, 当前是 iter-M (M>N), 走 L5-plan 重新生成, 不要再读这个 plan 写代码" |
| `@iter > current-iteration` | ⛔ **plan 错位**: 提示 "plan 是 iter-N 时的, 但 current-iteration 是 iter-M (M<N), 不正常, 检查 .shadow/SHADOW_VERSION 跟 status.md" |

**为什么必做**: 用户的核心需求 "iter 间设计冲突保留正向". 旧 plan 跟新上游 (spec/arch) 冲突时, coder 不查 `@iter` 就直接写, 写出来是**反向 (iter-N 旧设计)** 而不是正向 (iter-M 新设计). 例: iter-1 plan 写 "心跳失败 >=3 标 OFFLINE", iter-2 spec 改 ">=5", current-iter=2, plan @iter=1 → coder 写 ">=3" → 跟新 spec 冲突 → 业务错. 走 plan-iter-check 立即停.

**然后** 对每个 Batch:
- 看 plan 该 Batch 的文件清单, 每行有 `@upstream` 列, 列出上游文件 + 段
- **跳读所有 `@upstream`** (用 Read tool 读对应段) — 这是 v5 新增的纪律
- 旧"只读 plan" 在 v5 算违规 (会被 §13 L5 Consistency Audit 的 4 维审计抓)

**iter 间 delta 必读 (v5.1 新增)**: 读 `.shadow/iterations/iter-{N-1}/pipeline/status.md` 的"## 变更记录"段, 看 iter-N 改的 RXX 跟 iter-N-1 的差:
- 看到 `反向 (⛔ 删)` → code 要改
- 看到 `正向 (✅ 增)` → code 要加
- 看到 `修改 (🔄 改)` → code 要替换

**只保留正向**: 走 iter-N+1 plan 时, 把 iter-N plan 跟新 spec 对比, **反向的标记 ⛔ 过期**, 正向的标记 ✅ 仍有效. coder 看到 ⛔ 必查, 看到 ✅ 跳过 (因为代码已经是正向).

### 2. 领域模型一致性检查

在写任何代码前，对照 Harness 计划 + 上游 aggregate-landscape.md 中的聚合定义检查理解：

```
聚合根类名 → 与 Harness 计划 + aggregate-landscape.md 一致？
聚合边界 → 包含/不包含与 Harness 计划 + landscape.md 一致？
跨聚合引用 → ID 引用而非对象嵌入？
一致性边界 → 强一致/最终一致与 Harness 计划 + landscape.md 一致？
```

(landscape.md 通过 plan 里的 `@upstream: aggregate-landscape.md §B01-annotation` 跳读)

### 3. TDD 循环（按 Batch 逐文件）

以 **Batch** 为单位串行执行，Batch 内文件可并行：

```
对每个 Batch:
  对该 Batch 内每个文件:
    1. 找到 Harness 计划中该文件的实现指令
    2. 先写测试（Harness 计划中的测试断言）
    3. 写最小实现让测试通过
    4. 重构（保持测试通过）
  该 Batch 全部完成后，运行该 Batch 的全部测试验证
```

**文件完成定义**：
- Harness 计划中该文件的所有测试全 GREEN
- Harness 计划中该文件的所有方法都有实现
- 无存根代码（禁止 pass、return None、TODO）

### 4. 文件头（追溯强制）

#### 后端实现文件

```python
"""
File: backend/app/services/user_service.py
L1: user-service (.shadow/L1-business/BXX-user-service/)
L5-Plan: .shadow/L5-plan/user-service/harness-plan.md
@implements: user-service-R01 (B01-N03), user-service-R02 (B01-N04)
@intent: 管理员需要管理用户信息和角色分配
"""
```

#### 前端实现文件

```typescript
/**
 * File: frontend/src/pages/AnnotatorWorkbench.tsx
 * L1: annotation-platform (.shadow/L1-business/B01-annotation-platform/)
 * L5-Plan: .shadow/L5-plan/annotation-platform/harness-plan.md
 * @implements: annotation-R11, annotation-R12, annotation-R13, annotation-R14, annotation-R15
 * @intent: 标注员需要在一个页面内完成完整标注工作流
 * @page: AnnotatorWorkbench
 * @route: /tasks/:taskId/annotate
 */
```

**追溯要求**：
- 每条 spec 规则必须在某个实现文件的 @implements 中出现
- @implements 引用的规则必须在 spec.md 中存在 (v5: 实现前读过对应段, 不止看 plan)
- 每个实现文件必须包含 @intent
- 每个前端页面/组件必须与 wire.svg 交互区域对应 (v5: 实现前读过 wire.svg 对应 page 段)
- v5: 每个实现文件头加 `@upstream: <file>:<section>` 列出实现时读过的上游段, 供 §13 审计追溯

## v5 5 必读纪律 (写代码前)

每个文件实现前, coder **必须** `Read` 下列上游 (5 分钟, 不止 plan):

| # | 上游 | 跳读什么 | 跳过的话会怎样 |
|---|------|---------|--------------|
| 1 | **intent.md** | 整个文件 (项目意图) | 不知道"为什么做", 写出来的功能跑偏 |
| 2 | **spec.md** | 该文件 @implements 的 RXX 段 | 写"参数对但语义错"的代码 (e.g. 漏业务前置条件) |
| 3 | **architecture.md** | 该文件对应的 API 端点段 (POST/GET/...) | 端点 schema / 错误码不一致, 跟前端对接失败 |
| 4 | **wire.svg** (前端) | 该文件对应 page 段 (data-page="X") | 页面布局 / 状态 / action 跟设计脱节 |
| 5 | **failure-modes.md** | 该文件兜底对应的 FMEA 段 (F0N) | 兜底机制挂在错地方 / 触发条件错 / 漏恢复路径 |

事件/聚合/验收场景按需 (e2e / event-contract / aggregate-landscape):

| 上游 | 何时读 |
|------|--------|
| event-contract.md | 该方法发布或订阅事件时, 必读对应 §EventName 段 |
| aggregate-landscape.md | 该文件定义或修改聚合时, 必读对应 §BXX 段 |
| e2e.feature | 该文件有 BDD 测试时, 必读对应 Scenario |

**怎么跳读**: 打开 plan 顶部 "上游引用矩阵" → 找到当前文件对应的 RXX / 端点 / 失败模式 → 跳到 spec.md §RXX / arch.md §API.X / failure-modes.md §F0N 段 → Read → 5 分钟理解 → 写代码.

**纪律保证**: §13 L5 Consistency Audit 在 4 维脱节 (spec↔code, wire↔code, arch↔code, l3↔code) 时会读 @upstream 引用反查. coder 没读就硬写会被审计抓.

## v5.2 Pre-write Signoff (写每个 method 前的 sign-off 块)

5 必读 + iter delta 跳读后, coder **写每个 method 前** 在 plan @upstream 段**追加** Sign-off Block. 这是 v5.2 新增的"机制", 不是"软鼓励":

```markdown
### Sign-off: {method_name}

@reviewed-by: coder-{id / session}
@reviewed-at: {ISO ts}

**读了**:
- spec.md §R03 line 45-78 (业务: 审核员看到 >=2 标注才能 approve, 状态机 PENDING→APPROVED/REWORK)
- architecture.md §API.POST /reviews line 145 (端点: req { annotation_ids: [UUID] }, 返 200/422/INVALID_STATE)
- e2e.feature:scenario-R03-approve (Gherkin: 2 标注 → approve, 1 标注 → 422)
- failure-modes.md §F08 (RPN=15: 审核员并发点 approve 同一任务)

**理解**:
- R03 业务: 审核员必须看到 >=2 标注才能 approve (前置业务条件, 不是技术校验)
- 状态机: PENDING→APPROVED/REWORK (PENDING 不可直接 APPROVED, 必须先审核)
- 错误码: 422 INVALID_STATE (业务前置不满足, 不是 500)

**假设**:
- 我假设 PostReview 必须先 count >= 2 (annotation_ids) 否则 422 INVALID_STATE
- 我假设 approval 不发事件 (e2e 没断言事件, 业务也只关心状态)
- 我假设并发: 用 SELECT FOR UPDATE 锁任务行 (避免 race condition)
```

**L5 reviewer audit 强制 (hard error)**:
- 扫所有 @implements method
- 找没 sign-off block 的 → ⛔ hard error, 列出 missing methods
- 找 sign-off 但 **"读了" 段少于 3 个上游引用** → ⛔ (凑数)
- 找 sign-off 但 **"假设" 段没写明业务约束翻译** (e.g. 假设只写"按 plan 实现" 而没写">=2 才 approve") → ⛔ (没真理解)

**为什么这机制 work**:
- 5 必读是"读不读你说了算", sign-off 是"**写下你读了什么 + 你怎么理解**"
- 写下来 ≠ 真正读了, 但 L5 reviewer 可以**问"如果 spec.md 改 R03 阈值从 2 到 3, 你代码会怎么改"**, coder 答不上来 = 假 sign-off
- 配合 §13 L5 Consistency Audit (4 维脱节) + L6 chaos (真实场景), 3 重门禁

**对应 harness plan 模板字段** (L5-plan/templates/harness-plan-template.md 同步加):
```markdown
#### {method_name}({params}) -> {return_type}
- 上游: spec.md §R03 / arch.md §API.X / event-contract.md §EventName
- 校验: {具体条件}
- 状态: {状态变更}
- 事件: {发布的事件}
- 错误: {错误码 + 消息}
- 测试: {断言}
- ✅ 穷举: 测试 N / 校验 M + 正常 P ≥ N

### Sign-off: {method_name}  (v5.2 必填, L5 reviewer 抓)
**读了**: {上游文件:段 至少 3 个}
**理解**: {业务背景翻译, 至少 2 句}
**假设**: {业务约束 → 代码校验的映射, 至少 2 句}
```

## 产出

项目目录下的实现代码文件(后端 + 前端)+ 测试代码文件。

**生命周期角色**:混合 — 项目代码 + 测试 = `design_baseline` 设计基线(产品最终交付物,持续维护);`code-skeleton/`(L5-impl 起点) = `process_output` 过程产物(被覆盖填实);`e2e/{feature}.binding.yaml`(未填实) = `process_output`,填实后转 `design_baseline`;`e2e/coverage-tracker.json` = `process_output` 累积状态。详见 `.shadow/shadow-schema.json:lifecycle_artifacts` → `code-skeleton` / `e2e-step-binding` / `coverage-tracker`。

## 约束

- **(v5 修订) 先读 plan 顶部"上游引用矩阵"**, 再按每文件指令的 `@upstream` 跳读上游 (intent / spec / arch / wire / FMEA / event / aggregate / e2e 至少 5 必读), **写代码前 5 分钟** 必做
- @implements 必须与 Harness 计划中标注的规则一致 (且 v5: 实现前读过 spec.md 对应 RXX 段)
- @intent 必须与 Harness 计划一致 (且 v5: 实现前读过 intent.md)
- **(v5) @upstream 引用** 必填在文件头, 列出实现时读过的上游段, 供 §13 审计
- 无存根代码（禁止 pass、return None、TODO）
- 无硬编码 secret
- 无生产路径内存仓库
- 无假登录或硬编码用户
- 前端必须实现 Harness 计划中定义的所有 state/actions/events (且 v5: 实现前读过 wire.svg 对应 page)
- 按 Batch 顺序执行，一个 Batch 未完成前不可进入下一个
- **先写测试再写实现**（TDD：测试断言来自 Harness 计划 + 上游 e2e.feature）

## 代码品味约束

- [ ] 函数 ≤ 20 行，参数 ≤ 3 个
- [ ] 无 Code Smell（嵌套 ≤ 2 层，无重复 ≥ 3 处，无魔法数字）
- [ ] 错误不吞、可发现、可解释

## L5 门禁检查

### 层内自检

完成后运行 L5 门禁检查。门禁详细说明见 `references/gate-l5.md`，语义 gate 报告模板见 `references/l5-semantic-gate-report-template.md`。

执行下方 L5 门禁检查。检查 Harness 计划覆盖度、实现完整性、追溯完整性。

### 门禁检查项

#### Harness 计划覆盖度
1. Harness 计划存在（.shadow/L5-plan/{slug}/harness-plan.md）
2. Harness 计划中列出的所有文件都有实现
3. Harness 计划中列出的所有方法都有对应代码

#### 实现完整性
4. 每条 spec 规则在某个实现文件中有 @implements
5. 无存根代码
6. 无硬编码 secret
7. 领域模型与 Harness 计划中的聚合定义一致

#### 测试通过
8. 所有测试 GREEN（后端 + 前端）

#### 追溯完整性
9. 每个 @implements 可追溯到 spec.md 中的规则
10. 每个实现文件有 @intent 标注

#### 前端完整性（如适用）
11. 前端页面覆盖了 Harness 计划中定义的所有交互
12. 前端组件实现了所有 state/actions/events

#### 代码品味
13. 函数 ≤ 20 行
14. 无 catch 空块
15. 无硬编码魔法数字/字符串

### 门禁脚本

快速检查：`bash skills/shadow-l5-impl/scripts/gate-check-l5.sh <slug>`
