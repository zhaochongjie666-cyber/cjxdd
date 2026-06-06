---
name: shadow-l2-e2e
alias: Shadow·L2-E2E
methodology: BDD + Coverage Matrix — Behavior-Driven Development with exhaustive scenario coverage matrix
description: |
  Shadow L2 端到端验收场景 — 穷尽覆盖策略。
  使用此 skill 当用户提到：验收、e2e、BDD、场景设计、覆盖矩阵、穷尽测试、
  UAT、用户验收、真实场景、测试覆盖、场景穷举、端到端测试、验收标准。
  即使是轻量任务，只要涉及"怎么验证功能是对的"也适用本 skill。
  
  产出 e2e.md + 覆盖矩阵 + uat-script.md。
  核心工具：14 维覆盖矩阵（S/M/L 项目可缩放）+ 6 维用户画像发散 + 5 层旅程穷举 + 交叉矩阵。
  四层覆盖完整性：业务线 + 页面 + 交互点 + API 端点，目标 100%。
  三面手：设计（场景设计）+ 实现（Step 绑定骨架 → L5-impl 填实）+ 跟踪（覆盖率追踪 + flaky 检测）。
version: "9.0.0"
---

# Shadow·BDD+CM — 穷尽覆盖验收

## 角色

回答四个问题：

| 问题 | 工具 |
|------|------|
| 系统应该表现出什么行为？ | BDD（Given-When-Then） |
| 怎么知道测全了？ | 覆盖矩阵（Coverage Matrix） |
| 真实用户会不会用？ | UAT 用户验收剧本 |
| 真实用户怎么用？ | 用户旅程穷举 |

**穷尽 = 对每条规则系统性地枚举所有已知测试维度，确保每个维度至少有一个场景。**

### BDD vs TDD 边界

| 维度 | BDD（本层 L2） | TDD（Harness 计划测试断言） |
|------|----------------|--------------------------|
| 语言 | 业务语言（Given-When-Then） | 代码语言（assert/expect） |
| 读者 | 业务方、产品经理、测试 | 开发者 |
| 产出 | e2e.md + 覆盖矩阵 + uat-script.md | .py/.ts 测试代码 |
| 位置 | `.shadow/L2-e2e/` | 项目 `tests/` 目录 |

### 前端浏览器操作优先

真实场景和 UAT 剧本的第一表达形式是**真实的前端浏览器操作**，不是 API 调用序列。

- **前端项目**：用浏览器操作语言描述（打开页面、点击按钮、填写表单、等待反馈）。禁止用 API 调用替代。
- **纯后端项目**：用 HTTP API 操作语言描述（发送请求、检查状态码、验证响应体）。维度 13/14 标记 N/A。
- **UAT 必须可执行**：前端 → Playwright；纯后端 → API scenario replay。

参考：`references/playwright-cli.md`。

### 生产级验收与真正可用

- 生产级验收标准：真实用户愿意在真实工作中依赖它。引用 `references/production-acceptance-contract.md`。
- 真正可用标准：真实账号登录、真实持久化、跨服务链路闭合。引用 `references/real-usability-contract.md`。
- HTTP 200/201 只是连通性证据，不能单独作为业务成功断言。
- 禁止 mock DB、InMemoryRepository、假登录出现在 P0 验收路径。

## 三面手（设计 + 实现 + 跟踪）

L2 不只写 Gherkin 文档，还要让场景真能跑、追踪真实覆盖率。

| 面 | 任务 | 产出 | 详细 |
|---|------|------|------|
| **设计**（核心） | 14 维覆盖矩阵 + Gherkin 场景 + UAT 剧本 + 旅程穷举 | e2e.md / coverage-matrix.md / uat-script.md | 本 SKILL.md §1-8 |
| **实现** | **Step 绑定（Step Binding）**：每个 step 给 page_selector / interaction / db_query / event_type 骨架，L5-impl 填实 | e2e/{feature}.binding.yaml + e2e/step_defs/*.py | references/playwright-step-binding.md |
| **跟踪** | **覆盖率追踪（Coverage Tracker）**：L6 跑场景后自动累积 run/pass/fail/flaky，量化真实覆盖 | e2e/coverage-tracker.json + 覆盖率报告 | references/bdd-coverage-tracker.md |

**闭环**：
- Step binding TODO → L5-impl 填实
- 覆盖率告警 → 回 L2 补场景
- 失败场景 → 回 L5-impl 修代码或回 L2 改场景

## 怎么做

### 0. 用户画像分析（前置）

三步流程：读 L1 已有画像 → 独立发散 → 对比发现遗漏。

**0-1. 读 L1**：读 `intent.md` 和 `research.md` 的用户画像。检查是否有"收敛丢弃清单"，评估被丢弃场景是否影响验收。

**0-2. 独立发散**（不限于 L1 已有）：

从测试验收视角，用 6 个维度穷举画像（每个维度至少 1 个变体）：

| 维度 | 问题 |
|------|------|
| 官方角色 | spec.md 定义了哪些角色？ |
| 技能梯度 | 新手/熟练/专家操作差异？ |
| 使用频率 | 高频/中频/低频/首次？ |
| 极端用户 | 批量操作？频繁撤销？多标签页？ |
| 误用/滥用 | 越权？疯狂点击？注入攻击？ |
| 意外场景 | 手机误触？慢网络？忘记退出？ |

画像数量要求：最少 5 个，每个必须有明确区分度。

画像详细格式和发散方法见 `references/persona-journey-guide.md` §1。

**0-3. 与 L1 对比**：将 L2 画像与 L1 对比，发现遗漏时进入 §0.2 L1 回溯协议。

### 0.1 用户旅程穷举（强制）

三步流程：读 L1 旅程 → 独立发散 → 对比 → 交叉矩阵。

对每个画像，按 5 层次穷举：

| 层次 | 目标 | 至少 |
|------|------|------|
| 主线 | 完成核心目标的最佳路径 | 1 条 |
| 分支 | 每个决策点的每个分支 | 每决策点 × 分支数 |
| 迂回 | 绕路/回退/重试/走弯路 | 2 条 |
| 意外 | 断网/崩溃/会话过期/误操作恢复 | 1 条 |
| 探索 | 无目的浏览/首次使用/越权尝试 | 1 条 |

旅程穷举完成后产出交叉矩阵：规则×旅程、页面×旅程、交互点×旅程。

穷举完成标准：
- 总旅程数 ≥ 画像数 × 5
- 每条规则被 ≥2 个不同画像覆盖
- 每个页面被 ≥2 个不同画像覆盖
- 不存在未被旅程覆盖的交互点（data-action）

旅程详细格式、穷举检查清单、交叉矩阵模板见 `references/persona-journey-guide.md` §2-4。

### 0.2 L1 回溯协议

触发条件：L1 画像不足 5 个、旅程不足、交叉矩阵有缺口、收敛丢弃清单中有应恢复的场景。

回溯规则：
1. 在 e2e.md 的"L1 回溯清单"中记录遗漏项。
2. **不自行修改 research.md / intent.md** — 回溯由上游层执行。
3. 旅程编号区分来源：`J-L1-XX`（L1 已有）、`J-T-XX`（L2 新增）。

### 1. 读上游产物

读 `spec.md` + `project.flow.mermaid` + `research.md` + `architecture.md`（§7 API 端点清单）+ `wire.svg`（metadata 页面/交互点注册表）。

### 2. 构建覆盖矩阵（先于写场景）

对每条规则按维度枚举测试点。

**覆盖维度**（`.shadow/scale.md` 存在时按 `coverage_dimensions` 取维度数；否则默认 14 维）：

S 项目（8 维）：1-8。M 项目（10 维）：1-10。L 项目（14 维）：全部。

| # | 维度 | 说明 |
|---|------|------|
| 1 | 主流程 | 规则正常执行的所有路径变体 |
| 2 | 异常路径 | 每个可识别的错误条件 |
| 3 | 前置条件违反 | 前置条件不满足时的行为 |
| 4 | 权限检查 | 每个角色对该规则的行为 |
| 5 | 状态机转换 | 合法 + 非法状态转换 |
| 6 | 边界 | 空值/最小值/最大值/超长/特殊字符 |
| 7 | 副作用/领域事件 | 发布/不发布/载荷校验 |
| 8 | 数据完整性 | 操作后数据状态变化 |
| 9 | 幂等性 | 重复执行同一操作（如适用） |
| 10 | 并发/竞态 | 并发操作（如适用） |
| 11 | 会话连续性 | 跨会话恢复/多标签页/会话过期 |
| 12 | 用户误操作 | 后退按钮/双击提交/刷新/误删恢复 |
| 13 | 环境多样性 | 浏览器/网络/屏幕/设备（纯后端 N/A） |
| 14 | UX 反馈点 | loading/empty/error/success/notification |

维度 11-14：对用户直接操作的规则强制覆盖。N/A 必须写理由。

**P0/P1 标注**：每个矩阵行和 UAT 剧本必须标注。P0 = 核心路径/金钱安全/失败不可恢复。P1 = 分支/边界/体验优化。

覆盖矩阵详细示例见 `references/coverage-matrix-guide.md`。

### 3. 写 Gherkin 场景

矩阵每一行 → 至少 1 个 Gherkin 场景。**使用完整 Gherkin 语法**（不是裸 Given-When-Then）：

```gherkin
  @P0 @covers-R12 @covers-B01-N08
  Feature: 创建标注

  Background:
    Given 标注员已登录
      And 任务已打开，状态为 IN_PROGRESS

  Scenario: 标注员创建有效 2D 框标注
    When 标注员在画面上拖拽创建矩形框并关联标签 "car"
    Then 创建标注记录，状态 EMPTY → IN_PROGRESS
      And 发布 AnnotationCreated 事件

  Scenario Outline: 无效标签被拒绝
    When 标注员尝试关联标签 "<label>"
    Then 拒绝创建，错误码 <error_code>

    Examples:
      | label         | error_code    |
      | unknown-uuid  | INVALID_LABEL |
      | deleted-uuid  | INVALID_LABEL |
```

**Gherkin 纪律**：
- Feature = 一条规则或一组紧密关联的规则
- Background = 多个 Scenario 共享的前置条件
- Scenario Outline + Examples = 同一逻辑的多组数据
- 一个 When 一个动作；Then 必须断言具体值（状态+事件+错误码）
- @covers 标签标注规则 ID + 流程节点
- Data Tables 用于结构化输入/输出
- Doc Strings 用于大段文本（如错误消息模板、JSON 响应体）

**禁止**：裸 Given-When-Then（无 Feature/Scenario 头）、"功能正常"、When 里多个动作。

完整语法参考见 `references/gherkin-guide.md`。

### 4. 流程节点覆盖（BXX-NYY）

每个流程节点覆盖：入口条件 + 每个出口 + 每个决策分支 + 领域事件触发。

### 5. 跨规则组合覆盖

同一聚合根的规则需要组合场景（如 R12 创建 → R15 提交、R18 驳回 → R12 重新创建）。

### 6. 真实场景

覆盖矩阵保证"零件检查过"，真实场景保证"整机能跑"。

真实场景要求：
- 从旅程穷举结果选取和组合，标注来源旅程编号
- 用浏览器操作语言描述
- 串联 ≥3 个节点、涉及 ≥2 条规则、≥2 个角色
- 使用生产级数据
- 包含浏览器导航步骤和 UX 反馈验证
- 包含持久化断言、跨服务断言、可恢复失败断言
- 至少 1 个误操作+恢复、1 个会话中断+恢复

停止条件：覆盖矩阵每行被场景覆盖 + 每条旅程被场景包含 + 四层覆盖 100%。

真实场景详细示例（含完整浏览器操作语言）见 `references/real-scenario-guide.md`。

### 7. UAT 用户验收剧本

每个业务线产出 `.shadow/L2-e2e/BXX-{slug}/uat-script.md`。

UAT 结构：
- 用户目标（不写技术目标）
- 角色 + 浏览器入口 URL
- 验收数据（账号、业务数据、外部依赖）
- 浏览器操作脚本（每步对应 Playwright 操作）
- Gherkin 行为摘要（每个 UAT 用一个 Scenario 描述核心行为，步骤用浏览器操作语言）
- 通过标准（页面反馈 + 数据可见 + DB 一致 + 副作用 + 错误处理 + 网络请求）
- 证据要求（截图 + 网络 + 数据 + 日志）

UAT 门槛：
- 每个核心角色覆盖所有核心目标
- 每条 UAT 串联 ≥3 节点、覆盖 ≥2 规则
- 操作用浏览器语言描述，能翻译为 Playwright 交互
- P0 UAT 包含真实持久化 + 重启后查询

UAT 详细模板和示例见 `references/uat-guide.md`。

### 8. Spec 漏洞检测与回溯

构建矩阵时发现规则未定义/歧义/冲突/遗漏异常 → 追加到 e2e.md 末尾"Spec 回溯清单"。
回溯动作：在 spec.md 末尾追加"L2 回溯修正"章节，标注 `@backtrack: L2-e2e-{slug}`。

## 四层覆盖完整性校验（强制）

每个 e2e.md 必须包含四张表：

| 层 | 来源 | 通过标准 |
|----|------|---------|
| 业务线覆盖 | `business-landscape.md` 业务线注册表 | 每条业务线有 e2e.md |
| 页面覆盖 | `wire.svg` metadata pages + data-page | 每个页面在 ≥1 场景中出现 |
| 交互点覆盖 | `wire.svg` metadata interactions + data-action | 每个交互点在 ≥1 场景中出现 |
| API 端点覆盖 | `architecture.md` §7 API 端点清单 | 每个端点被场景间接触发 |

综合覆盖率 = 四层各 25% 权重。目标 100%。缺口必须在覆盖简报中标注。

## 产出

> **生命周期角色**:`design_baseline` 设计基线。`e2e.md`(BDD 场景源) / `coverage-matrix.md`(14 维覆盖) / `uat-script.md`(L6 Phase 7 必读的 P0 剧本)三件套均跨迭代复用,改后触发 L5 / L6 重跑。详见 `framework/shadow-schema.json:lifecycle_artifacts` → `e2e-bxx` / `coverage-matrix` / `uat-script`。

| 文件 | 路径 |
|------|------|
| 验收场景 | `.shadow/L2-e2e/BXX-{slug}/e2e.md` |
| 覆盖矩阵 | `.shadow/L2-e2e/BXX-{slug}/coverage-matrix.md` |
| UAT 剧本 | `.shadow/L2-e2e/BXX-{slug}/uat-script.md` |

## 层内自检

| # | 检查项 | 通过标准 |
|---|--------|---------|
| 1 | 覆盖矩阵完整性 | 覆盖率 100%，维度 1-14 全部填写 |
| 2 | 规则覆盖 | 每条 spec 规则 RXX 在矩阵中有对应行 |
| 3 | 四层覆盖 | 四张表全部存在且无缺口 |
| 4 | 旅程穷举 | 总旅程 ≥ 画像数 × 5，每类各 ≥ 1 |
| 5 | 页面×旅程交叉 | 每个页面被 ≥2 画像覆盖 |
| 6 | 旅程编号 | J-L1-XX / J-T-XX，不重复 |
| 7 | 浏览器语言 | 真实场景用浏览器操作语言描述 |
| 8 | UAT 完整性 | P0 包含真实认证+持久化+重启+跨服务 |
| 9 | 回溯清单 | Spec 回溯 + L1 回溯，无遗漏时写"无" |
| 10 | 无 mock | P0 不使用 InMemoryRepository 或假登录 |

提交前加载 `shadow-reviewer`（review_type=chain）执行全链路审计，确认 L2 与 L1 传导一致。

L2 到 L5 的传导映射见 `references/L2-to-L4.md`。
