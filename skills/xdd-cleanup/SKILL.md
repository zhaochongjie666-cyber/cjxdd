---
name: xdd-cleanup
description: |
  xdd 执行层 -- 代码实现后的清理收尾。删调试残留/占位符/待办标记、统一格式、剔除死代码死文件、同步文档。
  不是重构（不改行为），是让代码从"能跑"变成"能交付"。无独立产物文件，gate 用 gitHasChanges（有清理改动即可）。
  与 xdd-polish 区分：polish 是质询性评审（设计/体验好不好，离线手动调），cleanup 是实现后的机械清理（在流水线内）。
  触发：清理、cleanup、收尾、打扫、死代码、dead code、占位符、TODO、格式统一、lint、文档同步、交付前清理。
---

# xdd-cleanup - 交付前清理

## 我锚定什么 / 上游 / 下游

**我锚定的是「代码从能跑到能交付之间的距离」** -- 不改行为，只去噪、对齐、补文档。execute 产出的代码常有调试残留、占位符、未引用符号、过时注释；cleanup 把它们清掉，让 verify 看到的是干净代码。

| | |
|---|---|
| **上游** | `xdd-execute`（实现 + 测试，可能带调试残留）+ `docs/plan.md`（改动文件范围 = 清理边界，不越界） |
| **我产出** | 无独立产物文件；改动落在 execute 已创建的文件上（git diff 可见） |
| **下游消费者** | `xdd-verify`（拿到干净代码做验收） |
| **回溯锚** | 清理不破坏 `@implements RXX` 标注（删代码前确认它不是某条 RXX 的实现） |

## 边界（不做什么）

- **不改行为** -- 不重构逻辑、不改接口、不调整算法。发现行为问题 -> 标 TODO 给下一轮 execute，不在 cleanup 改。
- **不越界** -- 只动 plan.md 标注的文件范围 + execute 本轮新增的文件。不碰无关模块。
- **不删追溯锚** -- `@implements RXX` / `@failure-mode-FXX` / `@covers-RXX` 标注一律保留，它们是 verify 的对账依据。

## 怎么做

### 1. 删调试残留 / 占位符 / 待办标记

机械扫描并清除本轮 execute 留下的临时物：

| 扫描目标 | 命令示例 | 处置 |
|---------|---------|------|
| 调试打印 | `grep -rnE "console\.(log\|debug)\|print\(|dbg"` | 删，或换正式 logger（若确需保留日志） |
| 断点 / debugger | `grep -rnE "debugger\|breakpoint\|pdb\.set_trace"` | 删 |
| TODO/FIXME/XXX | `grep -rnE "TODO\|FIXME\|XXX\|HACK"` | 本轮该做的删掉做掉；跨轮的保留并标清归属 |
| 占位符 | `grep -rnE "TODO\|placeholder\|stub\|dummy\|lorem\|foo\|bar\|baz"` | 换成真实实现或真实数据；纯占位删掉 |
| 注释掉的代码 | `grep -rnE "^\s*//.*[a-zA-Z].*\(.*\)"` | 删（git 里有历史，不必注释留存） |

**判断准则**：占位符/TODO 是"本轮该做但偷懒没做" -> 做掉；是"跨轮规划" -> 保留并写清为何留、谁来做。不许留模糊的 `// TODO`。

### 2. 统一格式

跑项目约定的 linter / formatter，对齐 plan.md 约定的风格：

- 有 formatter（prettier / black / gofmt / rustfmt）：直接跑 `--write`，全量格式化本轮改动文件。
- 有 linter（eslint / ruff / golangci-lint）：跑，修掉本轮引入的 warning/error（不修历史遗留，避免越界）。
- 无约定：统一缩进、引号、分号、尾逗号风格，至少保证本轮新增文件内部一致。

**只格式化本轮改动文件**（`git diff --name-only`），别全量格式化整个仓库（越界 + 大 diff 淹没真实改动）。

### 3. 剔除死代码 / 死文件

找未被任何东西引用的符号和文件：

```bash
# 本轮新增/改动的文件
files=$(git diff --name-only --diff-filter=AM | grep -E '\.(t|j)sx?$|\.py$|\.go$')

# 对每个文件，检查它的导出符号是否被别处引用
# （用 grep / 或 IDE 的 find usages）
```

| 死代码类型 | 识别 | 处置 |
|-----------|------|------|
| 未引用函数/类/变量 | 导出但无 import / 调用 | 删 |
| 未引用文件 | 整文件无 import | 删文件 |
| 未使用的 import | linter 报 unused | 删 |
| 不可达分支 | `if (false)` / return 后的代码 | 删 |

**红线**：删之前确认它不是某条 RXX 的 `@implements` 锚、不是公开 API（spec 契约要求的接口）。删了会断追溯链 -> 不删，标 TODO 确认。

### 4. 同步文档

让文档反映最终接口与用法（对齐 spec rules.md 的 RXX）：

- **README**：若本轮加了新模块/接口，README 的用法/接口列表要补上；删了模块要相应去掉。
- **docs/**：架构图、API 说明若与代码脱节，更新。
- **spec rules.md 的"实现"列**：不手改（那是 `@implements` 驱动的运行时状态），但确认代码 `@implements RXX` 标注齐全（漏标的补上 -- 这是 cleanup 唯一允许加代码标注的场景）。

**不重写文档** -- 只同步脱节点。大改文档归下一轮 brainstorm/spec。

## 产出

无独立产物文件。清理改动通过 `git diff` 体现，gate（`gitHasChanges`）校验"有清理改动"。verify 阶段看到的是清理后的代码。

## 自检

```
□ 调试打印 / debugger / 断点全删了？
□ 本轮该做的 TODO 做掉了，跨轮 TODO 标清归属了？
□ 占位符 / stub / dummy 换成真实实现或删了？
□ 注释掉的死代码删了（git 有历史）？
□ 格式化只跑了本轮改动文件（没全量越界）？
□ 未引用的函数/文件/import 删了？
□ 删代码前确认没断 @implements RXX / @failure-mode-FXX 追溯锚？
□ README / docs 与最终接口同步了（脱节点修了）？
□ 没改行为（只去噪对齐补文档，没重构逻辑）？
□ 没越界（只动 plan.md 范围 + 本轮新增文件）？
```
