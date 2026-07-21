# Gate 与正向开发配对审查

## 审查结论

Gate 是完成后的观察器，不是任务生成器。流程必须先把正向动作交给 AI，再对动作的产物和证据运行 Gate。本审查覆盖 xdd 中会改变流程判定的 Gate；底层 `requireGlobs` / `runBuild` 等是阶段 Gate 的检查原语，继承调用阶段的正向入口。

2026-07 复审进一步明确：**语义质量只由 AI 审查，硬 Gate 只校验结构、路径、追溯 ID 和可执行证据**。不再用“文档是否出现指定中英文标题/关键词”代替语义审查。AIGate 响应中的角度名和结论标记是为了确认审查完整性的最小传输协议，不是对被审产物的字符匹配。

## XDD 与 Normal Flow 严格匹配复审

| 位置 | 原先问题 | 处理 | 正向配对 |
|---|---|---|---|
| XDD init | 要求文档命中“目标/边界/技能”等字面词 | 改为存在+最小大小；内容由 AIGate 语义审查 | init `desiredState` 明确调研、边界、技能和交接产物 |
| XDD understand | 要求英文五段标题字面命中 | 改为存在+最小大小；允许中文或其他等价表达 | `desiredState` 与 AIGate standard 都先声明五类决策内容 |
| XDD architecture | 要求“模块/依赖/数据流/失败”字面命中 | 改为存在+最小大小；交由 AIGate 判断是否真正覆盖 | architecture `desiredState` 先要求相同设计内容及失败模式 |
| Normal explore/spec/plan/verify | 使用英文段名、Attack/Gate/Expected 或 P0/P1 等字面词判定语义质量 | 删除字面词 Gate，保留产物大小、RXX 追溯、测试执行和孤儿标注等可机械证明项 | 各阶段 `desiredState` 先要求正向+异常、TDD/攻击用例及逐 RXX 验证 |

## 配对矩阵

| Gate | Gate 前的正向开发入口 | 失败后的修复入口 | 结论 |
|---|---|---|---|
| 10 阶段 hard Gate | `stages.ts` 每阶段 `desiredState` + `outputs` + 对应 skill | `xdd_next_task` 给出未完成目标，`xdd_diagnose` 回炉 | 已配对；StageContract 编译时强制校验 |
| AIGate | 同阶段 `desiredState`/`outputs`，且 prompt 明示“先声明产出” | 逐角度 `❌` finding + `建议：` 动作；响应不完只重试审查 | 已配对 |
| QA plan Gate | plan 阶段 desiredState 和 `xdd-plan` 先生成冻结 QA 契约 | 字段级 remediation 回到 plan | 已配对 |
| execute Code Review Gate | `xdd-execute` 先 TDD 实现，再生成绑定源码 digest 的 review | findings 指向 execute 修复 | 已配对 |
| Commit Review Gate | `xdd-git-commit` 先检查并暂存明确 diff | 逐 diff finding 指向修复，diff 变更后重审 | 已配对 |
| Verify Evidence Gate | `xdd-verify` 先执行正向、兜底、Blind Journey 并写 evidence/report | 结构化 remediation 路由到 spec/architecture/execute/resilience | 已配对 |
| Runtime Observability Gate | verify 先启动可部署 runtime、记录基线并发起攻击 | P1 回炉；无 runtime 明确 N/A | 已配对 |
| Quality Score Gate | verify 先聚合真实证据并生成 score artifact | 仅排序改进项，不构成无限硬 Gate | 已配对 |
| Release Decision Gate | verify 完成双契约证据、review 和工作树收敛后生成 decision | 每个 release check 回指负责产物 | 已配对 |
| Stage Group Gate | 组内各阶段先逐一完成并提交 | 定位失败阶段后回炉，不让组 Gate 生成新任务 | 已配对 |

## 强制规则

1. StageContract 只要声明 Gate，就必须同时有非空 `desiredState`；文档阶段用 `outputs` 声明产物，execute/cleanup 这类代码树阶段由 desiredState 声明可观察证据。
2. 阶段 prompt 必须明说“先完成正向开发与自检，再 Gate”，并禁止未修改产物时原样重提。
3. AIGate 使用灵活的语义行而非 JSON；只固定“角度名 + 结论标记”这个最小协议，解释和建议保持自然语言。
4. Gate 失败必须携带证据和可执行修复方向；不完整的审查响应是审查协议故障，不是产物缺陷。
