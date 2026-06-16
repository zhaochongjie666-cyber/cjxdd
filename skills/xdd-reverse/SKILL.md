---
name: xdd-reverse
description: |
  xdd 跨层工具 —— 逆向工程：从已有代码反推设计层（.xdd/design/），并建立代码→RXX 的追溯。
  适用：有代码没 .xdd/ 的遗留项目、想给老代码补设计文档、补 @implements RXX 追溯。
  纯手动 skill（用 Read/Grep/Bash 亲自扫代码），不依赖配套脚本。
  触发：逆向工程、反推、从代码生成设计文档、遗留项目分析、补追溯、@implements、trace、接入老项目。
---

# xdd-reverse — 逆向 + 追溯

## 我做什么 / 上游 / 下游

**把已有代码反推成设计层锚 + 建立代码→RXX 追溯** —— 给没 `.xdd/` 的老项目补上设计文档，让代码能回溯到意图。这是「prompt→设计→代码」的反向：代码 → 设计。

| | |
|---|---|
| **上游** | 已有代码库（无 `.xdd/`，或 `.xdd/` 不全） |
| **我产出** | `.xdd/design/`（反推的 intent/spec/architecture）+ 代码 `@implements RXX` 标注 + INDEX |
| **下游消费者** | 之后可正常走 `xdd-plan` / `xdd-execute` / `xdd-verify` 改这个项目 |

## 怎么做（三阶段，纯手动）

不依赖脚本，用 `Read` / `Grep` / `Glob` / `Bash` 亲自扫代码。三阶段对应正向流程的三锚反推：

| 阶段 | 名称 | 任务 |
|:----:|:-----|:-----|
| A | 结构骨架 | 扫代码结构 → 反推 architecture（模块/接口/端点/状态机）|
| B | 证据补全 | 按业务线反推 spec（RXX 规则 + Gherkin）+ intent |
| C | 追溯建立 | 补 `@implements RXX` 标注 + 生成 INDEX |

### Step 1：结构骨架扫描（反推 architecture）

扫代码结构反推架构锚：
- `Grep` 识别主要模块、接口、API 端点（`@app.get/post` / route 定义 / handler 函数）
- `Read` 提取函数签名、数据模型、状态枚举
- 产出 `.xdd/design/architecture/{bxx-slug}/architecture.md`（反推版）+ `flow.mermaid`

### Step 2：证据补全（反推 spec + intent）

按业务线反推规则锚：
- `Read` 分析代码逻辑，推断业务规则（RXX），按 `BXX-RXX` 编号（如 `B01-R01`，见 `docs/BXX.md` §1）
- 产出 `.xdd/design/spec/{bxx-slug}/rules.md` + `*.feature`（反推版）。Gherkin 语法/具体值写法 → 详见 `xdd-gherkin-plus` skill。
- 产出 `.xdd/design/intent.md`（从代码行为 + `git log` 推断意图）

### Step 3：追溯建立（补 @implements + INDEX）

给代码补追溯标注，让代码→RXX→design 闭环：
- **推断 @implements**：`Read` 每段代码，判断它实现哪条 RXX，补 `@implements BXX-RXX` 注释
- **生成 INDEX**：`Grep -rn '@implements'` 收集所有标注，手写 `.xdd/design/INDEX.md`（RXX → 代码位置 反查表）
- **双向校验**：
  - 正向：每条 RXX（spec）都有代码 `@implements`？（`Grep '@implements BXX-RXX'` 计数对照 rules.md 的 RXX 数）
  - 反向：每段 `@implements` 指向的 RXX 在 spec 里真存在？（无悬空标注）
  - 规则前缀用 **BXX**（如 `B01`），不是目录名 `B01-auth`（目录名含 slug，规则编号不含）

## 与正向流程的衔接

```
# reverse 完成后，项目有了 .xdd/design/ 锚，之后按目的分流：
if 要改功能:
  xdd-understand(基于反推的 design.md 继续) -> xdd-spec -> ... -> xdd-execute
elif 要补追溯:
  用本 skill 的 Step 3（手动补 @implements + 生成 INDEX）
```

## 自检

```
□ 反推了 architecture（模块/端点/状态机）？arch/{bxx-slug}/architecture.md + flow.mermaid 在
□ 反推了 spec（RXX 规则 + Gherkin）？spec/{bxx-slug}/rules.md + *.feature 在
□ 反推了 intent（项目意图）？design/intent.md 在
□ 代码补了 @implements BXX-RXX 标注？Grep '@implements' 有命中
□ 生成了 INDEX（RXX ↔ 代码 双向）？design/INDEX.md 在
□ 双向校验通过：无悬空 @implements / 无裸 RXX（每条 RXX 有代码）？
□ 缺口清单输出：哪些 RXX 无代码 / 哪些代码无 RXX？
```
