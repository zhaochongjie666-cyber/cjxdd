---
name: xdd-init
description: |
  xdd 入口 —— 把空仓库变成 xdd 项目。生成简化版 .xdd/（design/ 设计层锚 + plan/ 桥接 + status.md 进度 + current-iteration）。
  平台中立，无 hook 依赖。新项目第一步。
  触发：初始化、init、新项目、xdd-init、起项目、开始、脚手架骨架。
---

# xdd-init — 项目入口

把空仓库变成 xdd Walker 能识别的项目：生成 `.xdd/` 三层骨架。**新项目第一步**。

## 何时用

- 拿到空仓库/新目录，准备开始 `prompt → 设计 → 代码`
- 上一个 iter 完成，开新 iter（`--iter 2`）

**不要在以下情况用**：
- 项目已有 `.xdd/` 且想继续 → 直接调 walker / 下一个 skill
- 想迁移老项目 → 手改或重跑 `--force`

## 最快路径

```bash
# 任何项目目录下：
bash skills/xdd-init/scripts/init.sh
# 或装好后：bash ~/.claude/skills/xdd-init/scripts/init.sh
```

## 参数

| 参数 | 默认 | 说明 |
|------|------|------|
| `--iter N` | `1` | 初始化哪个 iter，写 `current-iteration` |
| `--force` | false | `.xdd/` 存在时强制覆盖（**危险**，丢 status） |
| `--bizlines B01-鉴权,B02-订单` | 空 | 多业务线项目：预生成 `spec/_landscape.md` + 每业务线 `spec/{slug}/business.md` 占位 |

## 生成的结构

```
.xdd/
├── design/                    ← 设计层（锚）
│   ├── intent.md              ← 意图锚（xdd-understand 填）
│   ├── design.md              ← 收敛决策（xdd-understand 填）
│   ├── spec/                  ← 规则锚 RXX + Gherkin（xdd-spec 填）
│   │   ├── _landscape.md      ← 业务线全景（--bizlines 时生成）
│   │   └── {slug}/business.md ← 业务线占位（--bizlines 时生成）
│   ├── architecture/          ← 结构锚 colocation（xdd-architecture 填）
│   └── wire/                  ← 前端锚（xdd-wire 填，纯后端跳过）
├── plan/                      ← 桥接（xdd-plan 填 plan.md）
├── status.md                  ← 进度（3 层 × 业务线，✅/⏳）
└── current-iteration          ← "iter-N"
```

**砍掉的旧产物**（深度重构）：`scale.md`（不再 scale 降级，默认就做扎实）、`xdd-schema.json`（曾是闸门单一源真理，无闸门则不需要）、`gates/`（control_marker 目录）、`iterations/iter-N/pipeline/` 子树（status.md 提到根，iter 版本走 git）、5-marker 状态机（⏳/🔄/✅/❌/🚧 → 简化 ✅/⏳）。

## status.md（3 层骨架，简化）

```markdown
# Pipeline Status — iter-1

## 项目层
| 层 | 状态 | skill | 产出 |
|----|------|-------|------|
| 设计·理解 | ⏳ | xdd-understand | design/intent.md + design.md |
| 设计·规则 | ⏳ | xdd-spec | design/spec/{slug}/ |
| 设计·架构 | ⏳ | xdd-architecture | design/architecture/{slug}/ |
| 设计·前端 | ⏳ | xdd-wire | design/wire/{page}/ |
| 设计·韧性 | ⏳ | xdd-resilience | design/architecture/{slug}/resilience/ |
| 桥接·计划 | ⏳ | xdd-plan | plan/{slug}/plan.md |
| 代码·实现 | ⏳ | xdd-execute | 代码 @implements RXX |
| 代码·验证 | ⏳ | xdd-verify | 验证报告 |

## 上下文地图
### 当前
- 层: — / 活跃 slug: — / 失败计数: 0
### 本层必读
- skill: — / 输入: — / 上游指针: — / 自检: —
```

多业务线时（`--bizlines`），按 `## BXX 业务线名` 分段重复层表 + 末尾加跨业务线一致性 checklist。

## 设计原则

1. **只生骨架** — init 不写 design.md 内容（那是 xdd-understand 的活），只生占位 + 目录结构。
2. **idempotent-with-warning** — 重复 init 不静默覆盖，`--force` 才覆盖。
3. **不调 walker** — init 完打印"下一步"，但 walker 由用户触发。
4. **平台中立** — 纯 bash，无 hook 依赖，无 schema.json，任何平台能跑。

## 下一步

```bash
# 对 AI 说:
"用 xdd-walker 给我做一个 <你的功能>"

# walker 第一步装 xdd-understand 写 design/intent.md + design.md
```

## 故障排查

| 现象 | 原因 | 修法 |
|------|------|------|
| `.xdd/ already exists` | 已初始化 | 换目录，或 `--force` 强覆盖 |
| walker 加载后看到空 status | init 漏跑 | `bash scripts/init.sh --force` |
