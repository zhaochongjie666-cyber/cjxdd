---
name: xdd-brainstorm
description: |
  xdd 设计层第一步 —— 理解用户意图，发散调研，收敛成 design.md（意图锚）。
  整条「prompt → 设计 → 代码」链的起点：用户说的每一句话都在这里被固化成"我们要做什么、不做什么、为什么"。
  下游 xdd-spec 只消费 design.md + intent.md，不读发散笔记。
  产出 .xdd/design/intent.md（意图）+ .xdd/design/design.md（收敛决策 5 段）。
  触发：理解需求、发散、调研、brainstorm、意图、intent、design、design.md、项目意图、需求分析、新项目、新功能、模块化、通用能力、基础能力、核心业务、复用。
---

# xdd-brainstorm — 意图锚

## 我锚定什么 / 上游 / 下游

**我锚定的是「为什么做、做什么、不做什么」** —— 这是整条链的根。后面所有 spec 规则、架构决策、代码实现，最终都要能回溯到这里的一句话意图。意图错了，后面全错。

| | |
|---|---|
| **上游** | 用户的原始 prompt（可能模糊） |
| **我产出** | `.xdd/design/intent.md`（意图）+ `.xdd/design/design.md`（收敛决策） |
| **下游消费者** | `xdd-spec`（把 design.md 翻译成 RXX 规则）、`xdd-architecture`（技术决策依据） |
| **回溯锚** | 下游每条 RXX 规则、每个架构决策，都应能指向 design.md 的某一段 |

## 怎么做

### 1. 先吃透现状（必做，任何 iter）—— 建立前因后果再谈别的

**发散前先把所有该读的读进来。** 不知道现有设计、现有业务、现有约定，就谈不上"本轮做什么"——在信息不全时发散 = 重发明 + 偏离现状。这一步**任何 iter 都做**（iter-1 也读：用户材料/存量代码；iter-2+ 读上轮全部产物）。

**读什么（按存在性逐类读，缺的标"本轮要补"）**：

```
【项目层·意图与决策】
.xdd/design/intent.md                          # 项目意图（为什么做）
.xdd/design/design.md                          # 收敛决策（做什么/不做什么/全局决策）
.xdd/runs/iter-N/goals.md                      # 本 iter 目标 + G 编号

【业务线层·现有规则与结构】
.xdd/design/spec/_landscape.md                 # 业务线全景（有哪些业务线）
.xdd/design/spec/{bxx-slug}/business.md        # 各业务线目标/范围/术语
.xdd/design/spec/{bxx-slug}/rules.md           # 现有 RXX 规则（现有业务行为）
.xdd/design/spec/{bxx-slug}/*.feature          # Gherkin 验收场景
.xdd/design/architecture/{bxx-slug}/architecture.md   # 架构决策/技术栈/端点
.xdd/design/architecture/{bxx-slug}/flow.mermaid       # 流程/组件/数据流

【全局·跨业务线契约】
.xdd/design/architecture/aggregate-landscape.md  # 聚合全景（现有领域模型）
.xdd/design/architecture/event-contract.md       # 事件契约（现有服务间协作）
.xdd/design/architecture/module-landscape.md     # 模块全景（基础建设/依赖方向）

【前端与韧性】
.xdd/design/wire/{page}/                         # 现有页面/交互/状态态
.xdd/design/architecture/{bxx-slug}/resilience/  # 现有失败模式/兜底

【项目约定】
.xdd/rules/backend.rules / frontend.rules / ui-ux.rules   # 项目编码/设计约定

【现有业务·代码】（给已有项目加功能/改功能时读，要和设计对照）
src/ app/ server/ ...                           # 现有代码
git log                                         # 提交历史（前因后果/演进）
```

> **设计 ↔ 代码要对照，发现脱节标记裁决，别单信一方**。文档写"设计想做什么"，代码是"实际做了什么"——两者常脱节，且**双向都可能**：
> - **设计新、代码旧**（设计演进，代码没跟上）→ 代码读到过时实现
> - **代码新、设计旧**（代码改了甚至 sham 了，设计没更新）→ 代码读到偏离意图的实现（**在 xdd 里更危险**，会让偏差固化进新一轮设计）
>
> 读代码不是"拿代码当真相"，是**和 .xdd/ 设计对照**：一致 ✅；脱节 → 标到 recap「⚠️ 设计↔代码脱节」，写清是哪边该改（设计过时改设计 / 代码 sham 改代码），**本轮 brainstorm 先认设计意图为准**（xdd 的锚是设计，不是代码），脱节项留给下游 execute/verify 修。iter-1 全新项目无代码则跳过。

**读完后产出 `notes/00-recap.md`**（现状建象，必出，下游也参考）：

```markdown
# 现状 recap

## 前因后果
- 项目为什么存在 / 要解决什么 / 历史怎么走到现在（从 intent + git log）

## 现有设计（已有什么）
- 业务线：B01-x / B02-y（来自 _landscape）
- 现有规则：B01 有 R01..R05，B02 有 R01..R03
- 架构：技术栈 X，聚合 Y/Z，事件 e1/e2，基础模块 auth/storage
- 前端：已有 login/order-list 页面

## 现有业务（代码实际在跑什么）
- （有代码时）核心模块/入口/依赖关系摘要

## ⚠️ 设计 ↔ 代码脱节（对照发现，标记裁决）
- 设计 X vs 代码 Y：哪边该改（设计过时 / 代码 sham）→ 本轮先认设计意图，脱节留 execute/verify 修
- （无脱节则写"一致"，无代码则写"全新项目"）

## 缺什么 / 本轮增量
- 本轮要补的：新增 B03 / B01 加 R06 / 补 wire 空状态 / ...

## 约束与边界
- 项目约定（rules）、不可碰的不变量、Out of Scope 继承项
```

**自检**：读全了上述（存在的都读了，缺的标了）？recap 写清了前因后果 + 现有设计 + 现有业务 + 本轮增量？**没读全别进 Step 2 发散**——信息不全的发散是浪费。

### 2. Brainstorm —— 基于现状跟用户对话探索方案

吃透现状（Step 1）后，基于"已有什么、缺什么"跟用户对话，不是从零问。这是"用户驱动 + AI 引导"的对话，不是 AI 单向发散。**对话要带着现状提问**：例如"现有 B01 有 R01..R05，你说的这个功能是 B01 加规则，还是新开 B03？"按需挑 5-10 问：

| # | 引导问 | 目的 |
|---|--------|------|
| 1 | 想解决什么具体问题？痛点 / 现状 / 期望 | 锚定问题空间 |
| 2 | 谁最痛？用现有方案遇到啥障碍 | 锁定核心用户 |
| 3 | 想过哪些方案？各方案利弊？ | 探索方案空间 |
| 4 | 有哪些硬约束（合规 / 性能 / 预算 / 集成）？ | 划清边界 |
| 5 | 成功长啥样？哪些数字或事实能证明做对了 | 定义验收标准 |
| 6 | 现在最担心失败的是啥？怎么算失败 | 暴露风险 |
| 7 | 有现成组件 / 内部系统可复用吗 | 评估复用面 |
| 8 | 时间预算 / 优先级 / MVP 边界？ | 划 MVP |
| 9 | 谁会反对？顾虑是啥？怎么回 | 政治面 |
| 10 | 下一个 iter 大概接啥？提前留啥接口 | 演进路径 |

答案写到 `.xdd/design/notes/brainstorm.md`。

### 3. 发散调研

按 7 个方向自由记录（不限顺序、不限数量、内容格式自由）：

| 方向 | 记录什么 |
|------|---------|
| 行业背景 | 行业怎么做这件事？公认模式？ |
| 竞品分析 | 同类产品怎么做的？优缺点？ |
| 用户理解 | 谁会用？怎么用？谁会误用？极端场景？ |
| 技术方案 | 有哪些技术路线？开源参考？ |
| 事件与流程 | 业务里发生了什么？谁触发？怎么流转？ |
| 约束与风险 | 合规？性能？安全？已知陷阱？ |
| 灵感与假设 | 如果这样做会怎样？这个方向可行吗？ |
| **模块化识别** | **哪些是通用基础能力（认证/存储/通知/审计等，该用现成/复用），哪些是核心业务（该自建）？避免每条业务线各造一遍通用能力** |

**模块化识别（重要）**：意图层就要有这根弦——区分**核心业务**（项目差异化，值得自建）vs **通用基础能力**（行业通用，买/开源/复用就够）。这是下游 `xdd-architecture §13 模块化设计`的种子：brainstorm 识别出"哪些该下沉为基础模块"，architecture 才能把它们组织成 base 层 + 依赖矩阵。**别在意图层把通用能力当核心业务设计**——否则 spec 给它写 RXX 规则、architecture 给它建模，全是浪费（认证用现成方案就够，别给 JWT 设计聚合根）。

**外部调研至少搜 5 个方向**（产物写到 `notes/external-references.md`，带 URL）：
1. 行业最佳实践（`{domain} best practices 2026`）
2. 竞品分析（`{competitor} architecture`）
3. 技术方案（`{tech} open source`）
4. 安全事件 / 教训（`{domain} security incident postmortem`）
5. 用户反馈（`{domain} user feedback complaints`）

### 4. 用户理解（必须）

**用户画像**（至少 6 维度）：

| 维度 | 问题 |
|------|------|
| 官方角色 | 业务方定义了哪些角色？ |
| 技能梯度 | 每个角色的新手 / 熟练 / 专家怎么操作？ |
| 使用频率 | 高频 / 中频 / 低频 / 首次，路径有何不同？ |
| 极端用户 | 谁会大规模批量操作？谁会频繁撤销？ |
| 误用 / 滥用者 | 谁会越权？疯狂点击？输入垃圾数据？ |
| 意外场景 | 手机误触？慢网络？公共电脑忘记退出？ |

**用户旅程穷举**（5 层次）：主线 / 分支 / 迂回 / 意外 / 探索。

### 5. 通用语言（Ubiquitous Language，必出）

DDD 的起点 —— 开发和业务用同一套词，代码类名 = 业务术语，不翻译不同义化。复杂领域（仿真/数据/自动驾驶）术语密集、易漂移，**通用语言是后续 spec RXX 规则、architecture 聚合命名的唯一来源**。详见 `skills/xdd-architecture/references/ddd.md § 核心思想`。

建通用语言 3 步：
1. **收集** —— 从 brainstorm、用户访谈、行业资料里捞术语。每个词记：术语 / 定义 / 同义词（及为何不用）/ 来源。
2. **去歧义** —— 同一个词在业务里多义 → 拆成多个（如「任务」在仿真 vs 标注 vs 训练是三回事）。两个词指同一个 → 合并。
3. **分类** —— 标它是实体（有身份）、值对象（无身份看值）、还是过程/动作。

写到 `.xdd/design/notes/glossary.md`：

```markdown
| 术语 | 定义 | 同义词（不采用原因） | 类型 | 来源 |
|------|------|---------------------|------|------|
| 仿真任务 | 一次仿真运行请求，含场景+参数+车辆模型 | "作业"(太泛)、"Job"(非业务词) | 实体 | 业务访谈 |
| 场景 | 一组测试条件，用于仿真评测 | "用例"(混淆测试用例) | 实体 | 行业资料 |
| 场景坐标 | 标注框的 xywh | — | 值对象 | 标注团队 |
```

**YAGNI 也适用于通用语言**：只收本 scope 真的用到的词，不编「未来可能需要」的术语。每收一个词标来源（访谈/资料/推断），推断的标「待用户确认」。

### 6. 收敛成 design.md（必出）

发散完**必走**这一步。把零散笔记收敛成 1 份决策文档，5 段：

- **Selected**（选定方案）：本轮到底做什么，1-3 句话说清
- **Alternatives**（被否方案）：考虑过但没选的，各列一句为什么不选
- **Assumptions**（假设）：自己拍的默认值（e.g. 数据库用 PostgreSQL），写明
- **Out of Scope**（明确不做）：YAGNI 砍掉的，每项写一句"本轮为什么不做"
- **Open Questions**（待用户定）：关键决策（e.g. SQL vs NoSQL），必用户审

**YAGNI 要狠**：砍掉所有"未来可能需要""看起来酷""高级工程师炫技"类需求。例外不可砍：合规 / 安全 / 性能 SLO / 关键用户旅程。

**不替用户做决定**：复杂功能 / 砍功能 / 选方案必用户审（写到 Open Questions）。简单默认值（数据库选型、API 风格、错误码格式）可自主决策，写进 Assumptions。

**模块化决策写进 design.md（衔接 architecture §13）**：发散阶段识别的"通用基础能力"，在 Selected/Assumptions 段明确"走基础模块/现成方案，不自建"。例：Selected 写"认证/授权用现成 OAuth2 方案作基础模块，不自建"；Assumptions 写"文件存储用对象存储基础服务，各业务线复用"。这样下游 spec 不会给通用能力编业务 RXX、architecture 把它们组织成 base 层。

### 7. 自审 + 用户审

**自审 5 维度**（对照 design.md）：
- **Completeness**：该定的都定了吗？有没有"待定"其实该拍板的？
- **Rationale**：每个选择有理由吗？
- **Alternatives**：主要岔路都考虑过替代方案吗？
- **Assumptions**：假设都写明了吗？有没有隐含假设？
- **YAGNI**：scope 是不是最小可行？有没有塞进去的"顺便做"？

**用户审**：design.md 写完，**停下来给用户看**。用户说改就改，用户说 OK 才进 `xdd-spec`。这一步是文字纪律（靠你自觉停），不是机器强制 —— 但它是整条链防偏的第一道闸，别跳。

## Anti-pattern：「这太简单不用做设计」

**每个项目都要设计，包括简单的。** "简单"项目最危险——没审视的假设浪费最多工作。简单项目 design.md 可以短（3-5 句），但**必出**。

## 产出

**我产出的是【项目层】总意图锚** —— 跨业务线共享的项目顶层视角。业务线级的具体设计（规则/结构/端点）由下游 spec/architecture 承载（带 BXX 分层），顶层 design.md 只管项目级总决策。

```
.xdd/design/
├── intent.md           ← 【项目层】意图锚：项目要什么 / 成功标准 / 1 句话定位 / 非目标（跨业务线共享）
├── design.md           ← 【项目层】收敛决策：跨业务线的全局决策（技术栈/错误码格式/auth 模型 等）
│                         ↑ 业务线级细节（端点/规则/架构）不写这里，见下游 spec/BXX/ + architecture/BXX/
└── notes/              ← 发散笔记（iter 内用，下游不直接读）
    ├── glossary.md     ← 通用语言（DDD 起点，下游 spec RXX 术语 + architecture 聚合命名唯一来源）
    ├── recap.md        ← 已有设计消费摘要（iter-2+）
    ├── brainstorm.md   ← 引导问答案
    ├── external-references.md  ← 外部来源 URL 主索引
    └── *.md            ← 行业 / 竞品 / 画像 / 旅程 / 技术 等，内容自由
.xdd/runs/iter-N/
└── goals.md            ← 【项目层】本 iter 高层目标 + G 编号（brainstorm 产，见下）
```

**G 编号生成方（brainstorm 的职责）**：brainstorm 把 intent.md 的「成功标准」拆成本 iter 的高层目标，写入 `runs/iter-N/goals.md`，**分配 G 编号**（G1/G2...，替换 init 占位）。这是 ACK 的 G 区索引源——G 编号由此 skill 生成，下游 plan 的 task 用 `**goal:** G1` 回指。多业务线时 goals 仍是项目级（一份），各业务线的 plan task 回指同一套 G。

**三层边界**：understand 产【项目层】（intent+design，无 BXX）；下游 spec/architecture/wire/resilience 产【业务线层】（带 BXX）。顶层 design.md 写"项目要什么、全局怎么定"，别把单业务线的端点清单/规则塞进来。

模板见 `templates/intent.md` + `templates/design.md`。

## 自检（无平台 hook，纯文字 + 可选 bash）

```
□ intent.md 写了：1 句话定位 + 成功标准 + 非目标
□ design.md 5 段齐全：Selected / Alternatives / Assumptions / Out of Scope / Open Questions
□ goals.md 写了本 iter 高层目标，分配了 G 编号（G1/G2...，替换 init 占位，来自 intent「成功标准」）
□ glossary.md 建了通用语言，每个术语有定义 + 类型（实体/值对象/过程）+ 来源
□ 通用语言去歧义了（多义词拆开、同义词合并，记录原因）
□ 每个 Open Question 是真关键决策（不是偷懒没想）
□ Out of Scope 每项有"为什么本轮不做"
□ 5 方向外部调研都有 URL
□ 6 维度画像 + 5 层次旅程至少各列了要点
□ 识别了通用基础能力 vs 核心业务（design.md 写明通用能力走基础模块/现成，不自建，衔接 architecture §13）
□ design.md 给用户看了，用户确认 OK
```
