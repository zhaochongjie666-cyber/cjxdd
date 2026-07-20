---
name: nf-brainstorm
description: |
  Normal Flow 第 1 阶段（explore）-- 理解用户意图，产出 intent.md + design.md。
  .xdd/design/ 是与 xdd 共享的设计层，格式一致；如果 cwd 上已有 xdd 产出的 design/，直接复用。
  触发：normal-flow explore、nf brainstorm、理解需求、意图、intent、design、需求分析、新项目、新功能。
---

# nf-brainstorm -- 意图锚

**我做什么**：把用户的原始 prompt 收敛成 1 句话意图 + 可验证成功标准 + 非目标。

**上游**：用户的原始 prompt（可能模糊）
**我产出**：`.xdd/design/intent.md` + `.xdd/design/design.md`
**下游**：`nf-spec` 把 design.md 翻译成 RXX 规则

## 怎么做

### 1. 写 intent.md

> **无损切换原则**：如果 `.xdd/design/intent.md` 已存在（可能是 xdd-brainstorm 产的），READ + EXTEND，不要覆盖。只在缺失的节补内容。

与 xdd-brainstorm 共享同一 5 节格式：

```markdown
# 意图锚 - {项目名}

> 一句话：{这个项目到底要解决什么问题，给谁，达成什么}

## 成功标准

用户用了觉得"成了"的可验证事实（不是"做完"）：

- {e.g. 用户能在 30s 内完成一次短链创建并拿到短 URL}
- {e.g. 短链点击能正确跳转，数据落库，重启后还在}
- {e.g. 未登录用户不能创建短链，拿到明确的拒绝提示}

## 非目标（明确不做）

- {e.g. 不做自定义短码}
- {e.g. 不做点击统计分析}

## 谁是用户

- {主要角色 + 他们怎么用}

## 为什么做

{痛点 / 现状 / 期望，1-2 段}
```

成功标准必须是 verify 阶段能拿证据验证的（HTTP/CLI/页面/DB），不能是「系统应稳定」。

### 2. 写 design.md（5 段）

> **无损切换原则**：如果 `.xdd/design/design.md` 已存在，READ + EXTEND，不要覆盖。xdd 写的表格 / 项目层说明要保留。

与 xdd-brainstorm 共享同一 5 段格式，段名严格匹配（gate 校验关键词）：

```markdown
# Design - {项目名} 项目级总决策 ({date})

## Selected（选定方案）

本轮项目到底做什么。1-3 句话说清。

{方案描述}

## Alternatives（被否方案）

| 方案 | 为什么没选 |
|------|------------|
| {方案 A} | {一句理由} |
| {方案 B} | {一句理由} |

## Assumptions（假设 -- 我拍的默认值）

- {e.g. 数据库用 PostgreSQL 15}
- {e.g. 鉴权用 JWT，access token 15min}

## Out of Scope（明确不做 -- YAGNI）

| 砍项 | 为什么本轮不做 |
|------|----------------|
| {e.g. 自定义短码} | {用户没提，YAGNI} |

## Open Questions（待用户定 -- 关键决策）

- [ ] {e.g. 短码生成策略：自增 ID + base62 还是随机 hash？}
```

5 段至少 4 段非空（xdd understand Gate 要求 ≥4/5 关键词；NF explore Gate 要求 ≥3/5）。

## 纪律

- 只读 README/docs，不读源码
- 不写 `.xdd/design/architecture/`、`wire/`、`resilience/`（NF 没有这些阶段）
- 主要用户角色在 Assumptions 简述即可，不做 7 类 10 维度档案

## 自检

- [ ] intent.md 成功标准外部可观察
- [ ] design.md 5 段至少 3 段非空
- [ ] 没读源码

## 工具

```
nf_observe / nf_desired_state / nf_difference
read README/docs
write/edit .xdd/design/intent.md + design.md
nf_submit_artifact -> nf_advance
```
