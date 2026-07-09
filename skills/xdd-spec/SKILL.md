---
name: xdd-spec
description: |
  xdd 设计层 —— 把 design.md 的意图翻译成可验收的业务规则（RXX）+ Gherkin 场景。
  规则锚：每条 RXX 规则 = 一个 Feature，是 plan task 和代码 @implements RXX 回指的锚点。
  与 xdd-architecture 互补：spec 写"业务该表现成什么样"，architecture 写"系统怎么实现"。
  产出 .xdd/design/spec/_landscape.md（业务线全景）+ {bxx-slug}/business.md + {bxx-slug}/rules.md(RXX) + {bxx-slug}/*.feature。
  触发：规格、spec、业务规则、RXX、验收、bdd、gherkin、feature、场景、验收标准、业务线、需求转场景。
---

# xdd-spec — 规则锚

## 我锚定什么 / 上游 / 下游

**我锚定的是「业务在什么上下文下应该表现成什么样」** —— 把模糊意图变成一条条带编号（RXX）的可验收规则。每条 RXX 就是一个验收契约，下游 plan 把它拆成 task，代码用 `@implements RXX` 回指，verify 按 Gherkin 场景验。

| | |
|---|---|
| **上游** | `xdd-brainstorm` 的 design.md（意图 + 决策） |
| **我产出** | `spec/_landscape.md` + `{bxx-slug}/business.md` + `{bxx-slug}/rules.md`(RXX) + `{bxx-slug}/*.feature` |
| **下游消费者** | `xdd-architecture`（每条规则映射到层/端点）、`xdd-wire`（Feature 里的页面名/交互/角色）、`xdd-resilience`（.feature 行为基线，找反面）、`xdd-plan`（规则拆 task）、`xdd-verify`（Gherkin 验收） |
| **回溯锚** | RXX 规则编号 —— plan 的每个 task、代码的每处 `@implements RXX` 都指回这里 |

> **怎么把意图拆成规则、规则粒度多大、异常路径怎么穷举 → 查 `references/rule-design.md`**（规则设计方法）。Gherkin 语法 → `xdd-gherkin-plus`。

## BDD vs 架构的边界（不串味）

**BDD 写**（业务可观察）：用户目标、业务前置、领域状态变化、前端可见结果、后端可观察结果、数据是否存在、错误码/提示/拒绝原因、通知/权限/审计。

**BDD 不写**（实现细节，归 architecture）：启动/关闭序列、线程池/协程/后台循环、分布式锁/CAS/lease/TTL、重试退避算法、健康检查、容器调度、DB 事务实现、内部类名/函数调用链。

必须提后端行为时，只写**可观察结果**，不解释内部实现。

## 输入对齐（生成前必读）

所有状态名、产物名、角色名、错误原因必须与以下来源一致，未知标"待确认"，不编造：

1. `.xdd/design/design.md` + `intent.md`（意图锚，字段映射见下）
2. `.xdd/design/architecture/{bxx-slug}/flow.mermaid`（组件名、外部系统、产物流向；**仅 iter-2+ 变更回读**，首次全链路此文件不存在）
3. 当前代码 / 用户材料（API 名、状态枚举、错误码、存储对象）

## 怎么做

```
work():
  1. INPUT: 读 design.md + intent.md，按字段映射提取（**显式指针**，非笼统"提取意图"）：
       intent.md「1 句话定位」「成功标准」「非目标」 → 本业务线规则的目标边界
       design.md「Selected」   → 做什么（转正向 Scenario）
       design.md「Out of Scope」→ 不做什么（转约束/边界）
       design.md「Assumptions」→ 前置假设（转 Given/前置条件）
       design.md「Open Questions」→ 待定项（标 TODO，不编规则）
  2. ACT:   按 BXX 拆规则，每条业务规则 = 一个 RXX（编号见下）
  3. ACT:   每条 RXX 写一个 Feature（Background + 正向 Scenario + Scenario Outline + 异常 Scenario）
     GATE:  find .xdd/design/spec/{bxx-slug} -name '*.feature' | wc -l >= RXX 数（每 RXX ≥1 文件）
  4. ACT:   断言具体可观察（Then 写前端/后端/存储/通知/审计，给具体字段值；笼统→具体见 xdd-gherkin-plus）
     GATE:  每个 Feature 至少 1 个含"应"或"应返回"或"应拒绝"的 Then（无空泛"系统正常运行"）
  5. ACT:   输入对齐（状态名/产物名/角色名/错误码与 design + architecture 一致，未知标"待确认"）
  6. ACT:   自检（见文末清单，逐项过）
     GATE:  每个 Feature 含 ≥1 个异常 Scenario（Scenario 名含"拒绝/失败/不存在/无权限/冲突"之一）
```

## 核心编写规范（补充）

1. **禁止程序式 UI 流水账** —— 不写"点击某按钮""输入某文本""勾选复选框"。改业务意图："用户选择对比任务""用户提交回灌任务"。

2. **单个 Scenario 只验证一个业务规则** —— 不要一个 Scenario 同时验创建+调度+计算+下载+通知+权限。长链路按业务阶段或产物类型拆。

3. **步骤数控制** —— 单 Scenario 建议 5-8 行。超 8 行优先拆成多个 Scenario 或 Scenario Outline。

4. **多类型/多状态/多模型必须数据驱动** —— 平行路径用 `Scenario Outline + Examples`。

5. **Then/And 必须是可观察断言** —— 禁止"系统应自动处理""系统正常运行"。
   - 推荐：前端应展示[具体状态/字段]、后端应写入[对象]其[字段]为[值]、存储中应存在[产物]、系统应拒绝并返回[错误码]。

6. **前后端边界明确** —— 全栈场景的 Then/And 区分：前端展示什么 / 后端保存什么 / 存储存在什么 / 通知发给谁 / 审计记什么。

7. **必须覆盖异常路径** —— 每个 Feature 至少一个异常 Scenario（数据缺失/状态不允许/权限不足/类型不匹配/重复提交/部分失败/上游未完成）。

8. **幂等与重复提交业务化表达** —— 不写 CAS/锁/事务。写"不应创建重复任务""应返回已存在任务""原状态不应被覆盖"。

## 标准输出模板

> Gherkin 语法质量（具体值、Examples、Data Table、异常路径）→ 详见 `xdd-gherkin-plus` skill。

```gherkin
Feature: [业务能力] — [核心价值]    @covers-R01

  Background: [共享前置]
    Given [角色/系统处于某业务上下文]
      And [上游数据/产物/权限已满足]

  Scenario: [单一业务规则]
    Given [业务前置]
    When [用户或外部系统发起业务意图]
    Then 前端应[展示具体状态/字段/提示]
      And 后端应[保存具体对象及字段状态]
      And [存储/通知/审计]应[出现可验证结果]

  Scenario Outline: [多类型规则] - <case_type>
    Given 业务类型为 "<case_type>"
    When [执行业务意图]
    Then 前端应展示 "<expected_ui>"
      And 后端应记录 "<expected_backend>"
    Examples:
      | case_type | expected_ui | expected_backend |

  Scenario: [异常路径] - [不可执行原因]
    Given [缺失/冲突/无权限/上游未完成的业务上下文]
    When [用户发起业务意图]
    Then 系统应拒绝该操作，并返回 "[错误原因]"
      And 不应创建新的[任务/记录/产物]
```

## RXX 规则编号（锚的核心）

**一条业务规则 = 一个 RXX = 一个 Feature 文件**。RXX 是贯穿 plan→code→verify 的追溯 ID。Gherkin 语法/具体值写法 → 详见 `xdd-gherkin-plus` skill。

`rules.md` 是规则目录：

```markdown
# B01 鉴权 (auth) — 规则

| RXX | 规则一句话 | 覆盖 Feature | 关联端点 | 实现 |
|-----|-----------|-------------|---------|------|
| R01 | 用户用邮箱密码登录，成功返回 JWT | login.feature | POST /api/auth/login | - [ ] |
| R02 | 密码连续错 5 次锁定账号 15 分钟 | lockout.feature | POST /api/auth/login | - [ ] |
| R03 | 未登录访问受保护 API 返回 401 | auth-required.feature | (所有受保护端点) | - [ ] |
```

**「实现」列语义**（状态标记，看有没有落实）：
- `- [x]` = 该 RXX 在代码有 `@implements RXX` 标注且 verify 4 维审计未标 ❌
- `- [ ]` = 未实现
- 此列是运行时状态（由代码 `@implements` 驱动），不参与规则**内容**的评审冻结
- 可由 `xdd-verify/scripts/sync-contract-checkboxes`（基于 `grep @implements RXX`）半自动翻转
- 注意区分：本列是「RXX 是否在代码落实」（design 层）；`runs/iter-N/plan/{bxx}/plan.md` 的 RXX 覆盖追踪表状态列是「task 执行进度」（执行层），两层语义勿混

**约束**：
- 每条 RXX 至少 1 个 `*.feature` 覆盖（空规则 = 漏验收）
- RXX 编号：业务线内裸 `R01`；跨业务线/全局表带 `BXX` 前缀（`B01-R01`）。详见 `docs/BXX.md` §1.1 前缀裁决
- 改一条 RXX → 通知 plan + code（改下游追溯链）

## 业务线分组（多业务线项目）

**业务线（BXX）= DDD 限界上下文（Bounded Context）**。每条业务线是一套独立的通用语言 + 领域模型，词义不跨业务线混淆。详见 `skills/xdd-architecture/references/ddd.md § 限界上下文`。

`_landscape.md` 是全局业务线全景，**加子域类型列**（决定投入分配：核心域重点 DDD 建模、通用域买现成）：

```markdown
# 业务线 Landscape

| BXX | slug | 名称 | 定位（1 句话） | 子域类型 |
|-----|------|------|--------------|---------|
| B01 | auth | 鉴权 | 登录注册+鉴权+权限 | 通用（用现成方案） |
| B02 | sim | 仿真 | 提交仿真任务+运行+结果 | 核心（重点 DDD） |
| B03 | labeling | 标注 | 数据帧分派+标注+质检 | 核心 |
| B04 | dataset | 数据管理 | 数据集+版本+血缘 | 支撑 |

## 跨业务线主题
- 多租户隔离: 所有业务线按 tenant_id 隔离
- 跨上下文关系: 见 architecture context-map（ACL/OHS/遵奉者等）
```

**子域类型判定**：核心（差异化竞争力，重点投入 DDD）/ 支撑（必要但非差异化，简化做）/ 通用（行业通用，买开源）。详见 `references/ddd.md § 子域`。

每个业务线 `{bxx-slug}/business.md` 写：业务目标 / 关键问题 / 范围（in/out）/ **通用语言（从 understand 的 glossary.md 引用本上下文的词）** / 关联（RXX 列表 + arch + resilience + wire 路径）。

## 产出

```
.xdd/design/spec/
├── _landscape.md          ← 业务线全景（全局索引）
└── {bxx-slug}/                ← 每业务线一个目录
    ├── business.md        ← 业务线分组：目标/关键问题/范围/关联
    ├── rules.md           ← RXX 规则目录（一条规则一行 + 关联 Feature/端点）
    └── *.feature          ← Gherkin 验收场景，一条 RXX 一个文件
```

## 自检

```
□ 没有 UI 点击流水账？
□ 每个 Scenario 只验证一个业务规则？
□ 每个 Scenario 5-8 行左右？
□ Then/And 都是可观察断言（无"系统应自动处理"）？
□ 每个 Feature 至少一个异常路径？
□ 多类型/状态用 Scenario Outline + Examples？
□ 前端展示 vs 后端可观察状态分清了？
□ 没把架构细节（锁/事务/线程）写进 BDD？
□ 每条 RXX 至少 1 个 Feature 覆盖？
□ 状态名/角色名/错误码跟 design.md / flow.mermaid / 代码一致，未知标"待确认"？
□ RXX 规则术语全部来自 understand 的 glossary.md（通用语言），无新造同义词？
□ _landscape.md 每条业务线标了子域类型（核心/支撑/通用）？
□ _landscape.md 业务线清单跟 architecture/aggregate-landscape.md 一致？
```
