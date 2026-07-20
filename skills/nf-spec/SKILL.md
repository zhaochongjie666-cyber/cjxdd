---
name: nf-spec
description: |
  Normal Flow 第 2 阶段（spec）-- 把 design.md 翻译成可验收的业务规则（RXX）+ Gherkin 场景。
  .xdd/design/spec/ 格式与 xdd-spec 一致（rules.md + .feature，RXX 编号一致）。
  Feature 的 Then 必须外部可观察（HTTP/响应体/页面/DB），给 verify 阶段留证据。
  触发：normal-flow spec、nf spec、规格、业务规则、RXX、gherkin、feature、场景、验收标准。
---

# nf-spec -- 规则锚

**我做什么**：把意图翻译成可验收的业务规则（RXX）+ Gherkin 场景。每条 RXX = 一个 Feature，是 plan task 和代码 @implements RXX 回指的锚点。

**上游**：`nf-brainstorm` 的 design.md + intent.md
**我产出**：`.xdd/design/spec/{bxx}/rules.md`（RXX 表）+ `.xdd/design/spec/{bxx}/*.feature`
**下游**：`nf-plan` 翻译成 TDD 工作项；`nf-execute` 用 @implements RXX 回指；`nf-verify` 逐 RXX 举证

## 怎么做

> **无损切换原则**：如果 `.xdd/design/spec/` 下已有 xdd-spec 产的文件（rules.md / .feature / _landscape.md / business.md），READ + EXTEND，不要覆盖。xdd 写的 PX 角色绑定 / 8 类场景矩阵 / _landscape 全景 / business.md 都要保留。NF 只在文件缺失时才新建。

### 1. 写 rules.md（RXX 表）

与 xdd-spec 共享同一表格式。如果 `personas/` 目录存在（xdd 产的），必须加 PX 角色列：

```markdown
# Rules (B01 - <business line>)

| ID | Rule | Category | PX |
|----|------|----------|----|
| R01 | 用户用正确密码登录成功 | happy | P01 |
| R02 | 错误密码被拒（401） | rejection | P01 |
| R03 | 超长密码截断到 128 字符 | boundary | P01 |
```

如果没有 `personas/`（纯 NF 项目），PX 列可省。

### 2. 写 .feature（Gherkin）

```gherkin
Feature: 用户登录

  @AC-01
  Scenario: 用户登录成功
    Given 用户已注册且账号激活
    When 提交用户名 "alice" 和正确密码
    Then 返回 HTTP 200
    And 响应体包含 "token" 字段

  @AC-02
  Scenario: 错误密码被拒
    Given 用户已注册
    When 提交用户名 "alice" 和错误密码
    Then 返回 HTTP 401
    And 响应体包含 "error" 字段
```

**Then 必须外部可观察**：`返回 HTTP <code>` / `响应体包含 "..."` / `页面显示 ...` / `数据库表 X 有 Y 行`。
不能写「调用成功」「状态更新」这种内部表述--verify 阶段拿不到证据。

如果 `personas/` 存在，Feature 文件顶部加角色绑定（与 xdd-spec 一致）：

```gherkin
Feature: 用户登录
  # @roles P01
  ...
```

## 纪律

- 每条 RXX 至少 1 个 .feature 覆盖（含正向 + 异常）
- 至少 1 条异常/拒绝/边界 Scenario（spec Gate 检查关键词：攻击/异常/失败/拒绝/无权限/冲突）
- RXX 编号无重复；大型项目可加业务线前缀 `B01-R01`
- 不读源码
- **已有 xdd 产物时 READ + EXTEND，不覆盖**（保留 PX 绑定 / 8 类场景矩阵 / _landscape.md / business.md）

## 自检

- [ ] 每条 RXX 有 .feature 覆盖（含正向 + 异常）
- [ ] Then 步骤外部可观察
- [ ] 至少 1 条异常/拒绝/边界 Scenario
- [ ] RXX 编号无重复

## 工具

```
nf_observe / nf_desired_state / nf_difference
read .xdd/design/intent.md + design.md
write/edit .xdd/design/spec/{bxx}/rules.md + *.feature
nf_submit_artifact -> nf_advance
```
