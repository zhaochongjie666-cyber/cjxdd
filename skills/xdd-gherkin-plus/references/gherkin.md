# Gherkin 语法完整参考（xdd-gherkin-plus 配套）

> 本文件是 `xdd-gherkin-plus` skill 的权威语法参考。基于 [Cucumber 官方文档](https://cucumber.io/docs/gherkin/reference/) 和 [Reqnroll 文档](https://docs.reqnroll.net/latest/gherkin/gherkin-reference.html) 整理。

## 目录

1. [总体规则](#总体规则)
2. [主要关键字](#主要关键字)
3. [步骤关键字](#步骤关键字)
4. [次要关键字](#次要关键字)
5. [语法结构详解](#语法结构详解)
6. [多语言支持](#多语言支持)
7. [最佳实践](#最佳实践)
8. [具体值写法（笼统 → 具体）](#具体值写法笼统--具体)

---

## 总体规则

| 规则 | 说明 |
|------|------|
| 关键字开头 | 每行（除空行和描述文本）以关键字开始 |
| 注释 | `#` 开头，只在新行开头，**不支持块注释** |
| 缩进 | 空格或 Tab 均可，推荐 **2 空格** |
| 冒号 | 部分关键字后跟 `:`，部分不跟——加错冒号会导致测试被忽略 |
| 单 Feature | 一个 `.feature` 文件只能有一个 `Feature` |

---

## 主要关键字

| 关键字 | 同义词 | 后跟冒号 | 用途 |
|--------|--------|----------|------|
| `Feature` | — | ✅ | 高层功能描述 + 场景分组。**文件第一个关键字** |
| `Rule` | — | ✅ | (Gherkin 6+) 一条业务规则，组织多个相关场景 |
| `Scenario` | `Example` | ✅ | 一个具体场景（测试用例） |
| `Scenario Outline` | `Scenario Template` | ✅ | 参数化模板，配合 Examples 表多次运行 |
| `Examples` | `Scenarios` | ✅ | Scenario Outline 的数据表 |
| `Background` | — | ✅ | 每个场景前自动运行的共享前置 |

---

## 步骤关键字

| 关键字 | 语义 | 匹配行为 |
|--------|------|---------|
| `Given` | 前置条件 / 初始状态（过去已发生） | 关键字不参与匹配 |
| `When` | 用户动作 / 触发事件（建议每场景 1 个） | 关键字不参与匹配 |
| `Then` | 预期结果 / 断言（只验证可观测输出） | 关键字不参与匹配 |
| `And` | 追加同类型步骤 | 关键字不参与匹配 |
| `But` | 追加反向/异常断言 | 关键字不参与匹配 |
| `*` | 任意步骤替代（列表式场景） | 关键字不参与匹配 |

**重要**：`Given`/`When`/`Then`/`And`/`But` 关键字**不参与步骤匹配**，所以以下两行是**重复**的：

```gherkin
Given there is money in my account
Then there is money in my account   # ❌ 重复！
```

---

## 次要关键字

| 符号 | 名称 | 用途 |
|------|------|------|
| `"""` 或 ` ``` ` | Doc String | 传递大段文本（支持内容类型标注） |
| `|` | Data Table | 传递表格数据 |
| `@` | Tag | 标记 Feature/Rule/Scenario（过滤/分组） |
| `#` | Comment | 行首注释 |

---

## 语法结构详解

### Feature

```gherkin
@smoke @important
Feature: Guess the word
  可在此写自由格式描述（支持 Markdown）
  描述在下级关键字出现时自动结束

  Background: ...
  Rule: ...
  Scenario: ...
  Scenario Outline: ...
```

- 每个 `.feature` 文件唯一
- Feature 上方可加 `@标签`
- 描述在下级关键字出现时自动结束

### Rule (Gherkin 6+)

```gherkin
Rule: There can be only One
  Background:
    Given ...

  Scenario: Only One -- More than one alive
    Given ...
    When ...
    Then ...
```

- 组织相关场景到一条业务规则下
- 可有自己的 `Background` 和 `@标签`
- Rule 标签继承到其下所有场景

### Background

```gherkin
Background:
  Given a global administrator named "Greg"
  And a blog named "Greg's anti-tax rants"
```

- 只能用 `Given` 步骤
- **每个场景前**自动执行（在 Before hooks 之后）
- Feature 级或 Rule 级各最多一个
- 建议 ≤ 4 行

### Scenario Outline + Examples

```gherkin
Scenario Outline: eating
  Given there are <start> cucumbers
  When I eat <eat> cucumbers
  Then I should have <left> cucumbers

  Examples:
    | start | eat | left |
    |    12 |   5 |    7 |
    |    20 |   5 |   15 |

  Examples: Edge cases
    | start | eat | left |
    |     0 |   0 |    0 |
```

- `<placeholder>` 引用表格列头
- 可有**多个** `Examples` 段
- Examples 列头必须唯一
- 大纲不直接运行，每行数据运行一次

### Doc String

```gherkin
Given a blog post named "Random" with Markdown body
  """markdown
  Some Title, Eh?
  ===============
  Here is the first paragraph.
  """
```

- `"""` 或 ` ``` ` 包裹
- 开头三个引号后可加**内容类型**（`markdown`、`json`、`xml` 等）
- 缩进以起始 `"""` 的列为基准
- 自动作为步骤最后一个参数

### Data Table

```gherkin
Given the following users exist:
  | name   | email              | twitter         |
  | Aslak  | aslak@cucumber.io  | @aslak_hellesoy |
  | Julien | julien@cucumber.io | @jbpros         |
```

- 紧跟步骤之后
- 自动作为步骤最后一个参数
- 表格内转义：`\n` → 换行，`\|` → 竖线，`\\` → 反斜杠

**Data Table vs Examples 区别**：Data Table 是单个步骤的入参（一次运行）；Examples 是 Scenario Outline 的参数化数据表（每行跑一次）。写固定一组前置数据用 Data Table；写多组同形用例用 Outline + Examples。

### Tags

```gherkin
@smoke @important
Feature: Login

  @wip
  Scenario: Successful login
    ...

  @edge_case
  Rule: Special characters in password
    ...
```

- Feature 标签继承到所有场景
- Rule 标签继承到其下所有场景
- `@ignore` 是特殊标签（生成被忽略的测试）
- 用于执行时过滤/分组

### Comments

```gherkin
# This is a comment
Feature: Guess the word
  # Comments can appear anywhere
```

- 只能在**新行开头**
- 不支持块注释

### Free-form Descriptions

```gherkin
Feature: Guess the word

  The word guess game is a turn-based game
  for two players. The Maker makes a word
  for the Breaker to guess.

  Scenario: ...
```

- 可出现在 Feature、Scenario、Background、Scenario Outline、Rule 下方
- 支持 Markdown
- 遇到关键字行自动结束
- 不影响运行时

---

## 多语言支持

文件首行 `# language: <code>` 指定语言，支持 **70+ 种语言**。

### 中文关键字对照

| 英文 | 中文 |
|------|------|
| `Feature` | `功能` |
| `Rule` | `规则` |
| `Scenario` | `场景` / `例子` |
| `Scenario Outline` | `场景大纲` / `场景模板` |
| `Examples` | `例子` / `场景` |
| `Background` | `背景` |
| `Given` | `假设` / `假如` / `前提` |
| `When` | `当` |
| `Then` | `那么` |
| `And` | `而且` / `并且` / `同时` |
| `But` | `但是` |

示例：

```gherkin
# language: zh-CN
功能: 猜单词

  场景: 出题者开始游戏
    当 出题者开始一个游戏
    那么 出题者等待猜词者加入
```

---

## 最佳实践

| 原则 | 说明 |
|------|------|
| 每场景 3-5 步 | 太多步骤失去表现力 |
| 每场景 1 个 When | 多 When 通常意味着应该拆分场景 |
| Then 只验证可观测输出 | 不要直接查数据库 |
| Background ≤ 4 行 | 太长读者记不住 |
| 步骤文本不重复 | Given/Then 的文本不能相同 |
| 用生动名字 | `"Dr. Bill"` 比 `"User B"` 更好记 |
| 异常路径独立 Scenario | 每个异常单独一个 Scenario |
| 断言具体值 | `Then 返回 201` 而非 `Then 成功` |

---

## 具体值写法（笼统 → 具体）

Gherkin 最常见的毛病是「占位式笼统」—— Given/Then 写了动作但没给可验证的具体变量。下面对照改。

### 例 1：指标重算立即刷新

❌ 笼统（看不出验证什么）：
```gherkin
Scenario: 指标重算立即刷新
  Given 指标已计算完成
  When 用户触发重算
  Then 后端立即重新执行指标计算并刷新缓存
```

✅ 具体（具体 ID + 缓存键 + 可测阈值 + 可观测产物）：
```gherkin
Scenario: 指标重算立即刷新
  Given 指标 "acc_001" 已基于 eval_config_hash="abc123" 计算完成，缓存键 metric:acc_001:abc123 已写入
  When 用户对指标 "acc_001" 触发重算
  Then 后端应在 1s 内重新执行计算
    And 缓存键 metric:acc_001:abc123 应被覆盖为最新结果
    And 前端应展示指标 "acc_001" 的 updated_at 更新为当前时间戳
```

关键：
- 「已计算完成」→ 落到具体 ID + 缓存键（`acc_001` / `metric:acc_001:abc123`）
- 「刷新缓存」→ 落到「哪个键被覆盖」
- 「立即」→ 落到「1s 内」可断言阈值
- 加可观测产物：前端 `updated_at` 时间戳

### 例 2：评测配置不一致告警

❌ 笼统：
```gherkin
Scenario: 评测配置不一致告警
  Given 两个版本的 eval_config 不同
  When 用户对比指标
  Then 后端发出 eval_config 一致性告警
```

✅ 具体（具体字段 + 告警通道 + 消费者可观测）：
```gherkin
Scenario: 评测配置不一致告警
  Given 版本 v1 的 eval_config.num_episodes=100，版本 v2 的 eval_config.num_episodes=50
  When 用户在对比页同时选择 v1 与 v2 的指标
  Then 后端应检测到 eval_config_hash 不一致
    And 应向用户展示告警："评测配置不一致，对比结果不可直接比较"
    And 应记录一条 audit_log，类型=config_mismatch，关联版本=[v1, v2]
```

关键：
- 「不同」→ 落到具体字段值（num_episodes 100 vs 50）
- 「告警」→ 落到用户可看到的文案 + audit_log 可查的产物

### 通用规则

| 笼统写法 | 具体写法 |
|---------|---------|
| `[值]` / `[错误码]` / `[字段]` 占位符 | 从 design.md / 端点清单取的真实字面量（具体 ID / 状态枚举） |
| 「立即」/「大量」/「高质量」 | 可测阈值（`1s 内` / `≥3 条` / `= 80 分`） |
| 「某个缓存」/「某条记录」 | 具体键名（`metric:acc_001:abc123`） |
| 「系统应告警」就结束 | 可观测产物（用户文案 / audit_log / 事件总线消息） |

---

## 参考来源

- [Cucumber 官方 Gherkin Reference](https://cucumber.io/docs/gherkin/reference/)
- [Reqnroll Gherkin Reference](https://docs.reqnroll.net/latest/gherkin/gherkin-reference.html)
