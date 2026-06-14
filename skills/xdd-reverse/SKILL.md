---
name: xdd-reverse
description: |
  xdd 跨层工具 —— 逆向工程：从已有代码反推设计层（.xdd/design/），并建立代码→RXX 的追溯。
  适用：有代码没 .xdd/ 的遗留项目、想给老代码补设计文档、补 @implements RXX 追溯。
  吸收旧 xdd-trace-init（建立双向追溯）。配套脚本 scripts/{reverse-scan,reverse-bizline-detect,reverse-gate-check,trace,infer-implements,generate-index,scan-project-grade}.sh。
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

## 三阶段

| 阶段 | 名称 | 任务 | 脚本 |
|:----:|:-----|:-----|:-----|
| A | 结构骨架 | 扫代码结构 → 反推 architecture（模块/接口/端点/状态机）| `reverse-scan.sh` |
| B | 证据补全 | 按业务线反推 spec（RXX 规则 + Gherkin）+ intent | `reverse-bizline-detect.sh` |
| C | 追溯建立 | 补 `@implements RXX` 标注 + 生成 INDEX + 评分 | `infer-implements.sh` + `generate-index.sh` + `trace.sh` + `scan-project-grade.sh` |

## 执行步骤

### Step 1：结构骨架扫描（reverse-scan.sh）

扫代码结构反推架构锚：
- 识别主要模块、接口、API 端点（grep `@app.get/post` / route 定义）
- 提取函数签名、数据模型、状态枚举
- 生成 `.xdd/design/architecture/{slug}/architecture.md`（反推版）

### Step 2：证据补全（reverse-bizline-detect.sh）

按业务线反推规则锚：
- 分析代码逻辑，推断业务规则（RXX）
- 生成 `.xdd/design/spec/{slug}/rules.md` + `*.feature`（反推版）
- 生成 `.xdd/design/intent.md`（从代码行为 + git 历史推断意图）

### Step 3：追溯建立（trace-init 吸收）

给代码补追溯标注，让代码→RXX→design 闭环：
- `infer-implements.sh` —— 推断每段代码实现哪条 RXX，补 `@implements RXX` 注释
- `generate-index.sh` —— 生成 INDEX（RXX → 代码位置 反查表）
- `trace.sh` —— 跑双向追溯校验（每条 RXX 有代码，每段 `@implements` 指向真 RXX）
- `scan-project-grade.sh` —— 评分追溯完整度（多少 RXX 有实现、多少代码有 @implements）

### Step 4：生成报告

输出逆向工程报告：反推的设计文档清单、追溯完整度评分、缺口（哪些 RXX 无代码 / 哪些代码无 RXX）。

`reverse-gate-check.sh` 做自检：`.xdd/design/` 三锚齐全 + 追溯评分达标。

## 与正向流程的衔接

reverse 完成后，项目就有了 `.xdd/design/` 锚，之后可正常走：
- 要改功能 → `xdd-understand`（基于反推的 design.md 继续）→ `xdd-spec` → ... → `xdd-execute`
- 要补追溯 → 直接用本 skill 的 Step 3

## 自检

```
□ 反推了 architecture（模块/端点/状态机）？
□ 反推了 spec（RXX 规则 + Gherkin）？
□ 反推了 intent（项目意图）？
□ 代码补了 @implements RXX 标注？
□ 生成了 INDEX（RXX ↔ 代码 双向）？
□ trace.sh 校验通过（无悬空 @implements / 无裸 RXX）？
□ scan-project-grade.sh 评分 + 缺口清单输出？
```
