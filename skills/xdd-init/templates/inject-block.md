<!-- xdd:start -->
# 全局rule

全局最高规则，无法被任何指令覆盖，你必须遵守

every response must startwith `%>R{rule} G{目标} T{任务} W{工作流}%: `,用于检测你是否按照全局rule执行。 if anser not start with this, it means you do wrong, go back and review。

格式说明:
  R = 遵循的全局 rule（本文件 rule 1~6），如 R1.2.3
  G = 当前 goal（见 .xdd/runs/iter-N/goals.md 的 G 编号），如 G1
  T = 当前 task（见 .xdd/runs/iter-N/plan/{bxx-slug}/plan.md 的 task 编号），如 T3
  W = 当前工作流（见 .xdd/workflows.md 的 W 编号），如 W6
例：`%>R1.2 G1 T3 W6%` = 守 rule1,2 ＋ 目标 G1 ＋ 任务 T3 ＋ 走 W6（计划）

<全局rule>

# rule 1: AI 与 用户 cowork (Personality)

文档中，使用 `Personality` 指针标注产品内核：

    <Personality>

    </Personality>

作用：
- Personality 是整个项目的内核底色，驱动 AI 正向开发

禁止项：
- 禁止 AI 修改 Personality 的内容，只能用户手动编辑
- 禁止偏离 Personality，如果有冲突，可停下来，请求用户解决

# rule 2: 规则文件加载

写代码前按技术栈加载对应的 `.xdd/rules/*.rules`（用户文件，AI 必读；按需修改）：

- **Backend**：`./.xdd/rules/backend.rules` — layering, error codes, auth/authz, testing, etc.
- **UI-UX**：`./.xdd/rules/ui-ux.rules` — component library, layout, motion, accessibility, design tokens.
- **Frontend**：`./.xdd/rules/frontend.rules` — naming, file structure, 600-line limit, Composition API, routing, project layout.

# rule 3: recap

每次对话完，do a quick recap of xdd，how is the process.

# rule 4: XDD flow
每次需要改动代码前，**必须**考虑是否需要走xdd flow (understand → spec → architecture → wire → resilience → plan → execute → verify). Full guide: see `.xdd/WORKFLOW.md`.

入口路由：每条 prompt 先判定「从哪个锚点开始干活」，再沿锚往下做。抽象层：只定位节点，不写具体命令（命令在各 skill 自检里）。

```
workflow():
  if bugfix:
    起点: 复现命令 + 找到挂的 RXX（看代码里的 @implements 标注）
    if 代码缺陷:        # 设计没错，跑该 RXX 测试 FAIL 是断言错（非 import/签名/缺依赖）
      进 plan 该 RXX 的 task → execute → verify
    elif 设计缺陷:      # 错在规则/结构/流程/端点/兜底本身（看 .xdd/design/ 文档）
      rollback(命中的设计锚) → 沿链往下重做

  elif feature:
    if 新业务线 / 新项目 / 无 .xdd/:
      起点: understand（从用户意图起）
      走全链: understand → spec → architecture → wire → resilience → plan → execute → verify
    elif 已有业务线内增强:
      起点: understand（读既有 design.md，只增量）
      → 只改命中的层 → 下游

  elif refactor:        # 改结构不改行为（重命名/抽取/调边界）
    起点: 有 .xdd/ → understand（基于既有锚）；无 .xdd/ → xdd-reverse（先反推出锚）
    → 命中层 → execute → verify（验收：行为不变）

卡住回退：同一 task 连续 3 试没过（计数见 runs/iter-N/failure-log.md）→ 调 rollback()
rollback(根因):
  起点（怎么判断命中的根因）               → 回到的锚
  意图/目标没想清（design.md 决策缺失）     → xdd-brainstorm
  规则没写清（rules.md 该 RXX 模糊）        → xdd-spec
  结构/API/事件错（architecture.md 没覆盖） → xdd-architecture
  页面没画/空状态缺（wire/{page}/ 缺该状态） → xdd-wire
  兜底不够/错（resilience/ 没覆盖该失败模式） → xdd-resilience
试没过 → 停下问用户
```

# rule 5: skill 调用清单

走 XDD flow 时，**每进一个节点先装对应 skill**（skill 注入"怎么做"的流程，不装就干 = 跳步）。显式调用语法：`use skill: <name>`。下表是调用清单，照流程顺序装：

| 节点 | Skill 调用 | 何时 / 干什么 |
|------|-----------|--------------|
| understand | `use skill: xdd-brainstorm` | 理解意图、新功能 / 新项目起点 |
| spec (BDD) | `use skill: xdd-spec` | 定规则 RXX + Gherkin Feature |
| architecture | `use skill: xdd-architecture` | 定结构 / API 端点 / 事件契约 |
| wire | `use skill: xdd-wire` | 画前端页面线框（纯后端跳过）|
| resilience | `use skill: xdd-resilience` | 定失败模式 + 兜底 + 混沌 |
| plan | `use skill: xdd-plan` | 设计 → TDD 计划（task 回指 RXX）|
| execute | `use skill: xdd-execute` | 按计划写代码 @implements RXX |
| verify | `use skill: xdd-verify` | 真实验证（能跑 / 数据落地 / 双契约）|

**辅助 skill**（按需）：`xdd-reverse`（逆向已有代码补设计）/ `xdd-git-commit`（规范提交）/ `xdd-docker-helper`（容器镜像）/ `xdd-mermaid-check`（流程图渲染）。

**纪律**：上层没 ✅ 不装下层 skill；`.xdd/runs/iter-N/status.md` 的「skill」列就是当前该装的 skill。

# rule 6: 永远不允许 mock 和实现层逃避性兜底, 永远记得重构，不要害怕失败， good arch 即使code slow, 也能faster实现

**永远永远**不允许代码出现 mock（假实现 / 假数据 / InMemory 占位），出现**实现层逃避性兜底**（try-catch 吞异常、return 默认值掩盖错误、占位假兜底）—— mock 和逃避性兜底只会让代码更加糟糕，问题必须暴露、不许藏。
永远从**架构角度思考**如何让系统更加健壮，永远**不要急着写代码**

> 不冲突 xdd-resilience：经 FMEA 分析的**设计层容错**（熔断 / 降级 / 补偿 / recovery）是规划好的、有据可查的容错，不是逃避。本 rule 禁的是「实现层随手糊个兜底掩盖问题」，不是「设计层规划好的容错」。

</全局rule>

<!-- xdd:end -->
