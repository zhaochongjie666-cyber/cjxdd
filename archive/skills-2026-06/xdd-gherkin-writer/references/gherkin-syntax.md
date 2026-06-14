# Gherkin 语法完整参考

> 本文件是 `gherkin-writer` skill 的权威语法参考。基于 [Cucumber 官方文档](https://cucumber.io/docs/gherkin/reference/) 和 [Reqnroll 文档](https://docs.reqnroll.net/latest/gherkin/gherkin-reference.html) 整理。

## 目录

1. [总体规则](#总体规则)
2. [主要关键字](#主要关键字)
3. [步骤关键字](#步骤关键字)
4. [次要关键字](#次要关键字)
5. [语法结构详解](#语法结构详解)
6. [多语言支持](#多语言支持)
7. [最佳实践](#最佳实践)

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

## 参考来源

- [Cucumber 官方 Gherkin Reference](https://cucumber.io/docs/gherkin/reference/)
- [Reqnroll Gherkin Reference](https://docs.reqnroll.net/latest/gherkin/gherkin-reference.html)
- [Shadow 体系 Gherkin Guide](../../shadow-l2-e2e/references/gherkin-guide.md)
