# {项目名} polish 报告（xdd_run）

> 质询性评审：架构批判 + UI/UX 批判。攻击态度，不放过。
> 生成时间：{日期}
> 输入：`design.md` / `spec/` / `architecture/` / `wire/`（封存契约）

## 结论

<!-- 一句话定性，三选一 -->
- [ ] **敢交付** —— 无 P0/P1，质询通过
- [ ] **有 P0 必改** —— 存在架构级硬伤 / 阻断核心流程，必须回设计层
- [ ] **有 P1 待修** —— 无 P0 但有设计缺陷 / 严重体验问题，建议修

攻击点统计：P0 **{n}** 条 · P1 **{n}** 条 · P2 **{n}** 条

---

## 架构批判（架构师视角）

| 等级 | 维度 | 攻击点 | 为什么是问题 | 证据 | 怎么改 |
|------|------|--------|------------|------|--------|
| P0 | API 粒度 | | | `architecture.md:` | → xdd-architecture |
| P1 | 技术栈选型 | | | `architecture.md:` | → xdd-architecture |
| P2 | 替代方案 | | | `design.md:` | → xdd-brainstorm |

<!-- 7 维度：方案合理性 / API 粒度 / 技术栈选型 / 替代方案 / 可部署可运维 / 事件契约 / 数据模型 -->
<!-- 审完的维度标证据；没审的直说没审 -->

---

## UI/UX 批判（用户视角）

> 证据优先截图 + snapshot：每个被批页面截 `evidence/screenshots/{page}.png`（像素）+ `evidence/snapshots/{page}.yaml`（结构化，元素 ref）；无 playwright-cli 则 `evidence/responses/{page}.html`。关键攻击点在下方贴图：`![](evidence/screenshots/{page}.png)`

### 单页面（Q1-Q5 + L1-L4 + 混淆四类 + 10 反模式）

| 页面 | 等级 | 维度 | 攻击点 | 用户怎么受挫 | 证据 | 怎么改 |
|------|------|------|--------|------------|------|--------|
| {page} | P0 | L1 功能性 | | | `wire/{page}/index.html:` + `evidence/screenshots/{page}.png` + `evidence/snapshots/{page}.yaml` | → xdd-wire |
| {page} | P1 | 反模式·鬼按钮 | | | `wire/{page}/index.html:` | → xdd-wire |

### 跨页面（polish 独有）

| 维度 | 等级 | 攻击点 | 证据 | 怎么改 |
|------|------|--------|------|--------|
| 跨页面流程连贯性 | | | `wire/` | → xdd-wire |
| 全局视觉一致性 | | | `wire/` | → xdd-wire |
| 6 态覆盖全局视图 | | | `wire/` | → xdd-wire |
| 首用户旅程 | | | `wire/` | → xdd-wire |

#### 6 态覆盖矩阵（如有漏态填这里）

| 页面 | empty | loading | error | success | confirm | edge |
|------|-------|---------|-------|---------|---------|------|
| | | | | | | |

---

## 建议回退（严重项）

<!-- P0/P1 触发回设计层重做。跟 verify 的回退语义对齐。 -->

| 攻击点 | 回退到 | 重做什么 |
|--------|--------|---------|
| | xdd-architecture / xdd-wire / xdd-spec / xdd-resilience | |

---

## 自检

- [ ] 架构批判每个攻击点都有「为什么 + 证据 + 怎么改」三件套
- [ ] 架构批判 7 维度每个都审了（审完的标证据，没审的直说没审）
- [ ] UI/UX 批判每个页面都过了 Q1-Q5 + L1-L4
- [ ] 跨页面 4 维度（流程连贯 / 视觉一致 / 6 态覆盖 / 首用户旅程）扫了
- [ ] 没有轻易 PASS（要么列攻击点，要么明确「这维度没问题，证据 X」）
- [ ] 每维度穷举了 ≥3 潜在攻击点（哪怕判无害）
- [ ] P0/P1 攻击点建议了回退到具体哪个设计层 skill
- [ ] 证据引用了行号
