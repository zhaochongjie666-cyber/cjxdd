# B01-cli — 命令行调度器

## 业务目标

让用户在**无人值守**(CI/批量/脚本)场景下,一条命令把 xdd 八节点跑完,且验收未过自动回退重跑,直到全过或人工停。

## 关键问题(本业务线要解的)

1. **节点产出路径必须忠实 skill** —— 旧版 7/8 错,导致跑完产物落错位置,下游 skill 读不到。→ R01
2. **prompt 必须传完整上下文** —— 否则 claude 不知道调哪个 skill 怎么调、上游是谁、用哪条业务线、第几 iter。→ R02
3. **验收闸要认 skill 真实自检符号** —— skill 用 `□`,旧版扫 `- [ ]`,对不上。→ R03
4. **验收循环要走 iter 迁移** —— 不能乱落 `loop_main_N/`,要忠实 xdd 的 `init --iter N+1`。→ R04 R05
5. **iter 号不能硬编码** —— 要从 `.xdd/current-iteration` 读。→ R06

## 范围

| In(做) | Out(不做) |
|---|---|
| `run_workflow.py` 主入口(argparse: -t/-m/-f/-iter) | 不做 Web UI(那是 B02) |
| 节点定义模块(忠实 8 skill 产出) | 不实现 skill 内容 |
| prompt 构造(注入上下文) | 不做用户认证 |
| gate 验收闸(认 □ + - [ ]) | 不做远程/多机 |
| 验收循环(init --iter N+1) | 不在 cjxdd 根跑(避 Meta) |
| subprocess 调 claude CLI + stream-json 解析 | |

## 通用语言(引用)

本上下文的词全部来自 `design/notes/glossary.md`,核心:节点 / next 边 / loop 边 / gate / 自检清单 / iter / 节点定义 / claude CLI / stream-json / models.yaml。

## 关联

| 产物 | 路径 |
|---|---|
| 本业务线规则 | `spec/B01-cli/rules.md`(R01~R06) |
| Feature | `spec/B01-cli/*.feature` |
| 架构 | `architecture/B01-cli/architecture.md` + `flow.mermaid` |
| 韧性 | `architecture/B01-cli/resilience/` |
| 计划 | `runs/iter-1/plan/B01-cli/plan.md` |
| 代码 | `workflow/run_workflow.py` + `workflow/nodes.py` + `workflow/gate.py`(@implements RXX) |

## 跨业务线关系

- **被 B02-web 复用**:B02 的 Web 引擎 import 本业务线的节点定义(`nodes.py`)和 gate(`gate.py`)。改动本业务线的 R01/R02/R03 会影响 B02。
- **共享 G 编号**:本业务线 RXX 支撑 G1/G2/G3/G4/G5/G8。
