---
name: shadow-l0-research
alias: Shadow·L0-Research
description: |
  Shadow L0 发散笔记本 — 自由发散调研阶段。什么都往里扔，不评判、不精简、不怕重复。
  产出 .shadow/L0-research/ 目录下的自由格式笔记文件。
  下游（L1 Research）不消费这些笔记，只消费从笔记中收敛出的结论。
  无门禁检查。不设品味约束。
  触发：发散、笔记本、笔记、调研笔记、brainstorm、发散调研、L0。
version: "1.0.0"
---

# Shadow·L0 — 发散笔记本

## 角色

**自由发散，不评判。** 这是你的调研笔记本。什么都往里扔：

- 行业文章的摘要
- 竞品功能的截图描述
- 用户抱怨的原话
- 技术方案的随手记录
- 灵感、假设、疑问、矛盾
- 搜索结果的链接和要点
- 开源项目的架构观察
- 任何你觉得"可能有用"的东西

**不要求**：语言精确、品味标准、完整性。内容格式自由。

**唯一要求**：记录你的思考过程，让未来的收敛步骤（L1 Research）能从这些笔记中提取出有价值的结论。为此，必须按产出清单的分节组织文件。

## 每轮必须重做 (P0-Y Round 1)

L0 是"每轮的起点", **不是"项目一次性"**, **不是"iter-1 例外"**。
**项目一直都是迭代的**: iter-1 是项目首轮开发, iter-2/3/... 是后续开发, 每轮都必须重做 L0。

- iter-1: 项目首轮开发, 写 L0 到 `.shadow/iterations/iter-1/L0-research/`
- iter-2+: 后续开发, 写 L0 到 `.shadow/iterations/iter-N/L0-research/`
- schema 里的 `.shadow/L0-research/*.md` 是历史位置; per-iter 是新约定

### 触发检测 (pre-skill.sh 自动)

每轮 iter (含 iter-1) 装 L1+ skill 时, 若 `.shadow/iterations/iter-N/L0-research/`:
- 目录不存在 → 软警告
- 目录存在但无 `.md` 笔记本 → 软警告
- 1+ 个 `.md` 但 mtime ≥ 14 天 → 软警告

### 怎么重做 (Walker 流程)

1. **创目录**: `mkdir -p .shadow/iterations/iter-N/L0-research/`
2. **写 7 份笔记**: 按上方产出清单的 7 份文件 (industry-notes / competitor-analysis / user-personas / user-journeys / tech-research / events-brainstorm / external-references)
3. **mtime 自动刷新**: 文件写入后 mtime 是当前时间 → R11/R12-style 软警告自动消失

### 7 份文件模板 (每轮可能涉及新方案/新竞品)

| 文件 | 内容关注点 (每轮修订) |
|------|------------------------|
| `01-industry-notes.md` | 本轮需求所在行业的新趋势 |
| `02-competitor-analysis.md` | **新需求是否有新竞品** (老竞品可能已退出) |
| `03-user-personas.md` | 本轮需求涉及的新用户群 |
| `04-user-journeys.md` | 新需求触发的用户路径 |
| `05-tech-research.md` | **新需求是否需要新方案** (技术栈是否变化) |
| `06-events-brainstorm.md` | 本轮涉及的新领域事件 |
| `07-external-references.md` | 本轮调研的外部资料 |

> Round 1: 软警告, 不阻断 (L0 缺/旧时仍可装 L1+ skill, 会被提醒)
> Round 2: 硬阻断 (新项目 L0 缺 → 拒绝 L1+ skill 加载, 跟 R3/R5 同等力度)
> 老项目 (无 `.shadow/LIFECYCLE.md`): 仍 advisory, 零破坏

## 怎么做

### 1. (v2 新增) **L1 消费 — 跑 L0 前先读已有 L1**

L0 不是"零起点发散", 是**站在已有 L1 肩膀上**继续发散. iter-1 第一次跑没 L1 可读 (首次), iter-2+ 跑前**必读**现 L1 避免重发明.

**读哪些** (按 iter-N 当前 L1 状态, 7 类必读):
```
.shadow/L1-business/intent.md                # 项目意图 / 成功标准
.shadow/L1-business/business-landscape.md    # 业务全景 / 限界上下文概览
.shadow/L1-business/{BXX}*/research.md      # 各业务线 research.md
.shadow/L1-business/{BXX}*/spec.md           # 各业务线 spec.md (RXX 规则现状)
.shadow/L1.5-architecture/architecture.md    # 架构决策 D1..D20
.shadow/L2-e2e/coverage-matrix.md            # 已覆盖的验收维度
.shadow/L3-resilience/failure-modes/         # 失败模式目录
```

**读完标 3 段到笔记本** (写 `00-l1-recap.md` 或每节头部):
- **已有什么**: 哪些规则 / 端点 / 兜底 / 画像 / 旅程 已存在 (列 RXX / API 端点)
- **缺什么**: 哪些维度空白 (e.g. 业务线 X 没 research.md, 角色 Y 没画像)
- **本轮增量**: 本轮新需求涉及哪些 RXX / 端点 / 画像 (跟 L1 delta)

**为什么 v2 加这段**:
- 旧"零起点发散" → iter-2+ 大量重写 7 笔记本, 跟 iter-1 L1 重复 → 浪费时间
- 新"L1 增量发散" → iter-2+ 只发散"本轮新需求", 旧维度标注 "@inherits: iter-1 §X" → 笔记本聚焦
- L1 → L0 反向链: 笔记能溯源到 L1 的 RXX / 端点, L1 Research 收敛时省力

### 2. (v2 新增) **Brainstorm — 跟用户对话探索方案**

L0 跑前**先**跟用户 brainstorm, **再**发散写 7 笔记本. Brainstorm 是"用户驱动 + AI 引导"的对话, 不是 AI 单向发散.

**触发**: 用户说 "想做一个 XX" / "想加 XX 功能" / "想优化 XX" 但需求模糊时, walker 自动进入 brainstorm 模式 (问 5-10 引导问).

**5-10 引导问 (按需挑, 不全问)**:
| # | 引导问 | 目的 |
|---|--------|------|
| 1 | "想解决什么具体问题? 痛点 / 现状 / 期望" | 锚定问题空间 |
| 2 | "谁最痛? 用现有方案遇到啥障碍" | 锁定核心用户 |
| 3 | "想过哪些方案? 各方案利弊?" | 探索方案空间 |
| 4 | "有哪些硬约束 (合规 / 性能 / 预算 / 集成)? 不能妥协的有哪些?" | 划清边界 |
| 5 | "成功长啥样? 哪些数字或事实能证明做对了" | 定义验收标准 |
| 6 | "现在最担心失败的是啥? 怎么算失败" | 暴露风险 |
| 7 | "有现成组件 / 内部系统 / 团队可复用吗? 还是要从零造" | 评估复用面 |
| 8 | "时间预算 / 优先级 / MVP 边界?" | 划 MVP |
| 9 | "谁会反对? 他们的顾虑是啥? 怎么回" | 政治面 |
| 10 | "做完的下一个项目 / 下一个 iter 大概会接啥? 提前留啥接口" | 演进路径 |

**Brainstorm 产物**: 写到 `.shadow/L0-research/08-brainstorm.md`, 格式:
```markdown
# Brainstorm — {项目 / 主题}

> 跟用户对话时间: {ISO ts} / 参与人: {user} + {walker}
> 引导问: 5-10 选 {N} 问 (按用户需求模糊度)

## 1. 想解决什么具体问题
{用户原话 + AI 总结}

## 2. 谁最痛
{用户描述}

...

## 3. 想过的方案
- 方案 A: {描述, 利弊}
- 方案 B: {描述, 利弊}
- 方案 C: {描述, 利弊}

## 4. 硬约束
- {约束 1}
- {约束 2}

## 5. 成功标准
- {可量化 1} (e.g. 延迟 < 200ms)
- {可量化 2} (e.g. 用户 7 日留存 > 60%)

## 6. 担心失败
- {风险 1}
- {风险 2}

## 7. 复用 / 集成
- {现成组件}
- {需新造}

## 8. MVP 边界
- v1 含: {核心功能}
- v1 不含: {非核心, 留后续}

## 9. 政治面
- 反对者 / 顾虑 / 回应

## 10. 演进路径
- 下一 iter / 下一项目
```

**为什么 v2 加 brainstorm**:
- 旧 L0 假设用户上来就能写需求 → 实际很多场景用户只有模糊方向 (e.g. "我想做个 AI 笔记")
- brainstorm 引导问帮用户从模糊 → 具体, 写出来的 7 笔记本有"根"
- 跟"用户探索方案" 哲学一致: 不替用户做决定, 帮用户想清楚

### 3. 确定调研范围

从用户需求 + brainstorm 结论中提取调研方向。不要缩小范围——宁可多记录，不可遗漏。

### 4. 发散调研

按以下方向自由记录（不限顺序、不限数量）：

| 方向 | 记录什么 |
|------|---------|
| 行业背景 | 行业怎么做这件事的？公认的模式是什么？ |
| 竞品分析 | 市面上有什么同类产品？各自怎么做的？优缺点？ |
| 用户理解 | 谁会用？怎么用？谁会误用？极端场景？ |
| 技术方案 | 有哪些技术路线？各自利弊？开源项目参考？ |
| 事件与流程 | 业务里发生了什么？谁触发？怎么流转？ |
| 约束与风险 | 合规要求？性能要求？安全风险？已知陷阱？ |
| 灵感与假设 | 如果这样做会怎样？这个方向可行吗？ |

### 5. 外部调研（v2 强化）

使用 Web Search 搜索至少 **5 个方向** (v2 从 3 升 5, 模板更具体):

| # | 搜索方向 | 模板 | 应该抄什么 |
|---|---------|------|-----------|
| 1 | **行业最佳实践** | `{domain} best practices 2026` / `{domain} industry standards` / `{domain} RFC` | 行业公认的"对"做法, 模式命名 (e.g. "Circuit Breaker"), 引用源 |
| 2 | **竞品分析** | `{competitor_name} architecture` / `{competitor_name} review` / `{competitor_name} pricing` | 竞品怎么做的, 优缺点, 用户抱怨, 截图描述 |
| 3 | **技术方案** | `{tech} open source` / `github {tech}` / `{tech} benchmark` | 开源项目 (star > 1k), 性能基准, 维护状态, license |
| 4 | **安全事件 / 教训** | `{domain} security incident` / `{domain} postmortem` / `{domain} advisory` | 历史踩过的坑, 失败模式, 跟 L3 failure-modes 对齐 |
| 5 | **用户反馈** | `{domain} user feedback` / `{competitor} complaints reddit` / `{domain} survey 2026` | 真实用户抱怨 / 期望 / 用法, 跟 03-user-personas / 04-user-journeys 对齐 |

**产物**: 搜索结果、文章要点、开源项目观察、URL 引用全部记录在 7 笔记本, **特别是 07-external-references.md** (主索引):

```markdown
# 07 External References

> 本轮调研引用的所有外部来源, 按方向分类.

## 行业最佳实践
- [{title}]({url}) — {1 句要点} (引自 {author/source})
- [...]

## 竞品分析
- [{title}]({url}) — {1 句要点}
- [...]

## 技术方案 (开源)
- [{repo}]({github_url}) — star={N}, license={X}, {1 句关键点}
- [...]

## 安全事件 / 教训
- [{title}]({url}) — {1 句踩坑}
- [...]

## 用户反馈
- [{title}]({url}) — {1 句用户原话}
- [...]

## 引用规则
- L1 Research 收敛时, 这些 URL 是关键引用源, 必须可点开
- iter-2+ 跑 L0 时, 已有引用标 "@inherits: iter-1 §XX" 不重抄
```

**v2 强化理由**:
- 旧 3 方向太弱, 漏安全事件 (跟 L3 失败模式对齐) 跟用户反馈 (跟画像对齐)
- 5 方向是 v2 新基线, 跟 L1.5 质量属性 / L3 FMEA / L1 画像三方对齐
- 07-external-references.md 主索引化, 引用可溯源

### 6. 记录用户理解（必须）

用户画像发散（如果 `.shadow/scale.md` 存在，按 `persona_dimensions` 参数取维度数；否则默认 6 维度，每个维度至少 1 个画像变体）：

| 维度 | 问题 |
|------|------|
| 官方角色 | 业务方定义了哪些角色？ |
| 技能梯度 | 每个角色的新手/熟练/专家怎么操作？ |
| 使用频率 | 高频/中频/低频/首次，路径有何不同？ |
| 极端用户 | 谁会大规模批量操作？谁会频繁撤销？ |
| 误用/滥用者 | 谁会越权？疯狂点击？输入垃圾数据？ |
| 意外场景 | 手机误触？慢网络？公共电脑忘记退出？ |

用户旅程穷举（5 层次）：

| 层次 | 穷举目标 |
|------|---------|
| 主线旅程 | 完成核心目标的最佳路径 |
| 分支旅程 | 每个决策点的每个分支 |
| 迂回旅程 | 绕路/回退/重试/放弃 |
| 意外旅程 | 中断/故障/会话过期/误操作后恢复 |
| 探索旅程 | 无目的浏览/首次使用/输入非法数据 |

**注意**：这里的画像和旅程是发散过程——可以重复、可以矛盾、可以粗糙。L1 Research 会从中收敛出精简版本。

## 产出

`.shadow/L0-research/` 目录下的笔记文件。

**生命周期角色**（`process_output` 过程产物）：7 份发散笔记本,服务本轮 L1 收敛用;L1 Research 完成后即弃,新需求来时重新发散。详见 `.shadow/shadow-schema.json:lifecycle_artifacts` → `l0-notebooks`。

**最小结构要求**（内容自由，但以下分节必须存在，L1 Research 按分节名称提取）：

```
.shadow/L0-research/
  00-l1-recap.md              — (v2 必含) L1 消费摘要: 已有 / 缺 / 本轮增量
  01-industry-notes.md        — 行业调研笔记
  02-competitor-analysis.md   — 竞品分析笔记
  03-user-personas.md         — 用户画像发散（必须包含 §4 的 6 维度画像）
  04-user-journeys.md         — 用户旅程穷举（必须包含 §4 的 5 层次旅程）
  05-tech-research.md         — 技术方案调研笔记
  06-events-brainstorm.md     — 事件风暴发散
  07-external-references.md   — (v2 强化) 外部来源汇总, 5 方向分类 + URL 主索引
  08-brainstorm.md            — (v2 新增) 跟用户 brainstorm 引导问答案
  ...（自由增加，不限数量）
```

## 约束

- **内容格式自由**：每个文件内部可以用任何格式（列表/表格/段落/混合）
- **无品味约束**：不需要精简、不需要精确、不需要克制
- **无门禁检查**：L0 不设 gate
- **无下游消费**：L1 Research 不直接消费 L0 笔记，而是从中**收敛提取**关键结论
- **必须进行外部调研**：搜索 5 方向 (v2: 行业 / 竞品 / 技术 / 安全 / 用户反馈), 产物写到 07-external-references.md
- **必须进行用户理解**：画像发散 + 旅程穷举
- **必须 brainstorm (v2)**: 用户需求模糊时跑 5-10 引导问, 写到 08-brainstorm.md
- **必须消费 L1 (v2)**: iter-2+ 跑前读现有 L1, 写 00-l1-recap.md
- **文件命名必须以上述 9 个为基准 (v2: 7 → 9, 加 00-l1-recap.md + 08-brainstorm.md)**：L1 Research 按文件名定位各分节。可增加额外文件，不可省略基准文件
