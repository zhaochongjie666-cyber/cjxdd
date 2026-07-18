---
name: xdd-polish
description: |
  xdd 质询性评审 skill（按需手动调，不进默认流水线）。带批判/攻击态度，从两个角度挑刺，不放过、不轻易 PASS：
  ① 架构师视角：读 design/architecture/ + spec/ + design.md，质询架构方案本身是否合理（API 粒度/技术栈选型/替代方案/可部署可运维/事件驱动是否必要）。
  ② 用户视角：读 design/wire/{page}.md（含嵌入式 HTML 布局 + 6 操作态 + review），质询体验是否流畅、页面是否好看、6 态是否齐全。
  产出 runs/xdd_run/polish-report.md，列 P0/P1/P2 攻击项，严重项建议回设计层。
  与 xdd-verify 区分：verify 是符合性闸（代码是否符合契约），polish 是质询性评审（设计/体验本身好不好）。
  触发：打磨、polish、refine、批判、攻击式评审、架构批判、架构是否合理、UX 批判、体验好不好、页面好不好看、挑刺、red team、设计评审、帮我批判这个架构、帮我批判这个设计。
---

# xdd-polish — 质询性评审（攻击者，不放过）

## 我锚定什么 / 上游 / 下游

**我锚定的是「这个设计/体验本身站不站得住」** —— 不是代码符不符合契约（那是 `xdd-verify`），而是**方案好不好、体验顺不顺**。verify 证明「代码做到了设计说的」；polish 质询「设计说的这个方案本身对不对、体验爽不爽」。

| | |
|---|---|
| **上游** | `design/` 全套封存契约：`design.md`（意图/决策）、`spec/{bxx}/rules.md`（规则 RXX）、`architecture/{bxx}/architecture.md`（结构/端点/事件/运维）、`wire/{page}.md`（页面线框 + 6 操作态 + review，一个文件全含） |
| **我产出** | `runs/xdd_run/polish-report.md`（P0/P1/P2 攻击项 + 严重项建议回退到哪个设计层 skill） |
| **下游消费者** | 用户（决策：接受 / 回设计层重做）。**不进默认流水线，按需手动调** |
| **回溯锚** | 每条攻击点引用证据（`architecture.md:行号` / `wire/{page}.md:行号`） |

## 边界（跟 verify / wire review 不重复）

| 已有机制 | 它做什么 | polish 补什么 |
|---------|---------|--------------|
| `xdd-verify` 全链路一致性审计 | 代码**是否符合**封存契约（计数对账） | 设计/体验本身**好不好**（方案合理性、体验流畅度）——两个物种 |
| `xdd-wire` 的 `review.md` | design 层**写代码前**的**单页面**自审（Q1-Q5 + L1-L4） | **可跨页面**、**带攻击态度**、**代码前后都能调**的质询。复用 wire 的清单，但载体（质询层）+ 粒度（跨页面全局）不同 |
| `xdd-architecture` 自检 | 架构产物的**完整性**（13 节齐不齐） | 架构方案的**合理性**（这架构对不对，不是全不全） |

**一句话**：verify 管「做没做对契约」，wire review 管「单页面自审」，polish 管「整体站不站得住」。

## stance：攻击者，不放过

> 质询性评审的价值 = **评审闸低成本截住设计缺陷**。架构选型错了、流程割裂了，写完代码才发现 = 高昂返工。polish 把这些前移到评审截住。

执行纪律（沿用 verify 的硬核风格）：

1. **默认怀疑** —— 每个维度先假设「这里有问题」，去找证据，找不到才放过。
2. **不轻易 PASS** —— 要么列出攻击点，要么**明确说明**「这个维度确实没问题，证据是 X」。不许「看着没问题」就过。
3. **穷举 ≥3 攻击点/维度** —— 每个维度至少挖 3 个潜在问题，哪怕最后判定无害也要列出来（强迫深挖，杜绝浅扫）。
4. **每条攻击点三件套** —— `为什么是问题` + `证据（行号）` + `怎么改`。缺一不可，缺了 = 没价值。
5. **禁偷懒归因** —— 说「设计简单所以不需要」必须有证据，不能空泛放过。
6. **不报假完成** —— 没真审的维度直说没审，不写「基本通过」。

## 怎么做

### Step 0 · 定位 & 取输入

**按需手动调，不强制**。用户触发后：

1. 读 `design.md` + `design/intent.md`（意图 + 决策项 = 架构批判的判据源头）。
2. 读 `design/spec/{bxx}/rules.md`（规则 RXX —— 架构有没有覆盖每条规则）。
3. 读 `design/architecture/{bxx}/architecture.md` + 全局 `aggregate-landscape.md` / `event-contract.md` / `module-landscape.md`。
4. 读 `design/wire/{page}.md`（含嵌入式 HTML 布局 + 6 操作态 + review，UX 批判输入）。
5. 可选：用户给了**真实渲染 / 截图** → UX 批判优先看真的（比设计稿更准）。没给 → 看设计稿（代码前后都能调）。

> 没有完整 design/？告诉用户「polish 需要封存契约做判据，先跑完设计层锚」。别硬审半成品。

### Step 1 · 架构批判（架构师视角）

逐维度质询 `architecture.md` + `design.md` + `spec/`。**详细清单见 [`references/architecture-critique-checklist.md`](./references/architecture-critique-checklist.md)**（7 维度 × 好/坏信号 + 质询问题 + 反模式）。

7 维度速览：
1. **方案合理性** —— 分层/限界上下文切得对吗？职责泄漏？循环依赖？
2. **API 粒度** —— 端点太粗还是太细？CRUD 该合并/拆分？RESTful 还是 RPC？
3. **技术栈选型** —— 每个 `@intent` 选型站得住吗？有更简/更稳替代？（轻量项目别上 Kafka）
4. **替代方案** —— 核心决策列了 2+ 替代并说明为何不选？（design.md 的决策项）
5. **可部署可运维** —— docker-compose / ODD 运维视图真能落地？手工步骤没脚本化？
6. **事件契约** —— 事件驱动是否必要？同步会不会更简单？
7. **数据模型** —— 聚合边界合理？大事务 / 跨聚合一致性问题？

**每个攻击点格式**：
```
【P0/P1/P2】{攻击点一句话}
为什么是问题：{后果/风险}
证据：architecture.md:{行号} 原文「{片段}」
怎么改：{具体建议，指向 xdd-architecture / xdd-spec / xdd-resilience}
```

P0 = 架构级硬伤（交付即返工）；P1 = 设计缺陷（影响质量）；P2 = 改进建议（锦上添花）。

### Step 2 · UI/UX 批判（用户视角）

读 `design/wire/{page}.md`（含布局 + 6 态 + review），逐页面 + 跨页面质询。**完整清单见 [`references/ux-critique-checklist.md`](./references/ux-critique-checklist.md)**（复用 wire 的 Q1-Q5 + L1-L4 + 混淆四类 + 10 反模式 + polish 的跨页面维度）。

复用 wire 的清单（**复用不是重复**——wire review 是单页自审，polish 是带攻击态度的质询）：
- **Q1-Q5 攻击式问题**：按钮存在性 / 数字上下文 / 相似元素一致性 / 术语翻译 / 一次性交互
- **L1-L4 四级审查**：🔴 功能性 / 🟡 可用性 / 🟢 可达性 a11y / 🔵 体验质感
- **混淆元素四类扫描**：视觉 / 语义 / 交互 / 内容混淆
- **10 高频反模式**：鬼按钮 / 无限滚动 / 模态套模态 / 占位符代标签 / 错误只说「失败」/ 加载态消失但内容未到 / 响应式只断大屏 / 图标无标签 / 必填项没标记 / 暗模式只是反色

**polish 独有：跨页面维度**（wire review.md 是单页面的，polish 补全局）：
1. **跨页面流程连贯性** —— 用户从 A 页到 B 页，上下文接得住吗？状态丢失？跳转突兀？
2. **全局视觉一致性** —— 不同页面配色/字体/间距/组件统一吗？（设计系统漂移）
3. **6 态覆盖全局视图** —— 哪些页面漏了哪态？（empty/loading/error/success/confirm/edge）
4. **首用户旅程** —— 完全没上下文的新用户，能从首页走到核心功能完成吗？

**每个攻击点格式**（证据优先附截图）：
```
【P0/P1/P2】{页面} · {维度(L1-L4 或跨页面)} · {攻击点一句话}
为什么是问题：{用户会怎样受挫}
证据：wire/{page}.md:{行号} + evidence/screenshots/{page}.png
怎么改：{具体建议，指向 xdd-wire}
```

**截图取证**（UX 批判的可见证据）：对每个被批判的页面取证，存 `runs/xdd_run/evidence/`：截图 `screenshots/{page}.png`（像素证据）+ 结构化快照 `snapshots/{page}.yaml`（可访问性树 + 元素 ref，能看元素结构、a11y 层级）。polish 手动调时用 `xdd-verify/scripts/capture-evidence.sh <url> <png> <snapshot-yaml> <html>` 对 wire 产物或已部署页面取证（调微软 `playwright-cli`，缺失则降级 HTML 快照 `responses/{page}.html`）。报告里关键攻击点内联 `![](evidence/screenshots/{page}.png)` 直贴图，复杂结构问题附 snapshot 片段。

### Step 3 · 产出 polish-report.md

套 [`templates/polish-report.md`](./templates/polish-report.md)。要点：
- **结论先行**：敢交付 / 有 P0 必改 / 有 P1 待修（一句话定性）。
- 架构批判表 + UX 批判表分两节，每条攻击点带三件套。
- **建议回退**：P0/P1 触发回哪个设计层 skill 重做（`xdd-architecture` / `xdd-wire` / `xdd-spec` / `xdd-resilience`）。跟 verify 的回退语义对齐。
- 落 `runs/xdd_run/polish-report.md`（跟 `verify-report.md` 同层，工作记录单轮）。

## 自检

```
□ 架构批判每个攻击点都有「为什么 + 证据 + 怎么改」三件套？
□ 架构批判 7 维度每个都审了（审完的标证据，没审的直说没审）？
□ UI/UX 批判每个页面都过了 Q1-Q5 + L1-L4？
□ UX 批判证据含截图（`evidence/screenshots/{page}.png`）+ 结构化快照（`evidence/snapshots/{page}.yaml`）或降级 HTML 快照？关键攻击点内联贴图？
□ 跨页面 4 维度（流程连贯 / 视觉一致 / 6 态覆盖 / 首用户旅程）扫了？
□ 没有轻易 PASS（要么列攻击点，要么明确「这维度没问题，证据 X」）？
□ 每维度穷举了 ≥3 潜在攻击点（哪怕判无害）？
□ P0/P1 攻击点建议了回退到具体哪个设计层 skill？
□ 产物落 runs/xdd_run/polish-report.md，证据引用了行号？
```

## 什么时候用 polish

- 设计层锚封存后、写代码前 → 想先质询方案站不站得住（省代码层返工）
- verify 通过后、交付前 → 最后的质询把关
- 多个 run 跑下来感觉「差不多但说不清哪里不够好」→ polish 来挖
- **不要在 spec/architecture 还没封存时调 polish**（没判据，等于空审）
