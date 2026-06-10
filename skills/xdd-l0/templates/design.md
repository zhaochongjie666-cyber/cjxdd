# Design — {topic}

> date: {ISO}
> author: walker + user
> 状态: 🚧 draft / 🔄 under-review / ✅ approved
> 来源: xdd-l0 v3.0.0 收敛产物 (10 笔记本 → 1 份 design)

## Selected Approach

{1-2 段: 选什么, 关键设计点 (架构 / 流程 / 风险点 / MVP 边界)}

**Rationale**: 为什么这是最佳 (3-5 句, 引行业最佳实践 / L1 已有 / YAGNI 砍了)

## Alternatives Considered

### A. {方案 A}
{1 句描述}, 优点 {X}, 缺点 {Y}, **为什么不选** {Z}

### B. {方案 B}
{1 句描述}, 优点 {X}, 缺点 {Y}, **为什么不选** {Z}

## Assumptions

> walker 自主决策, 文档化以便将来验证

- {模糊处 1} → 假设 {取值}, 验证方法 {how to verify later (L1 spec? L5 audit?)}
- {模糊处 2} → 假设 {取值}
- {模糊处 3} → 假设 {取值}

## Out of Scope (YAGNI)

> 本轮**不**做的功能, 跟 §Selected 互补

- {不做项 1} + 为什么不做 (e.g. "本轮 MVP 不含多语言, iter-N+1 再加")
- {不做项 2} + 为什么不做 (e.g. "YAGNI: 没用户提, 砍掉")
- {不做项 3} + 为什么不做 (e.g. "性能 SLO ≤ 200ms, 不到 X 流量不需要加缓存")

**例外 (不可砍)**: 合规 / 安全 / 性能 SLO / 关键用户旅程必含.

## Open Questions

> **用户必须回**的问题 (跟 Assumptions 区别: 这里列 walker 不能自主决策的, 真不明确处)

- {Q1}: {具体问}
- {Q2}: {具体问}

---

**workflow**:
1. Walker 写完 10 笔记本, 收敛成 design.md (本模板)
2. Spec review subagent 5 维度审 (1-5 轮, 跟 halt_after)
3. Approved 后, walker 写 `.xdd/gates/.l0-review-block.md` 暂停
4. **用户审 design.md + 删 block.md** → 进 xdd-bdd
5. 用户反馈修改 → 改 design.md + 重新 spec review
