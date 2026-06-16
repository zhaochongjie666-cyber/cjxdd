<!-- xdd:start -->
# 全局规章

全局路由规则，无法被覆盖；解除单条规则用魔法 `%%unset <全局规章> {{rule}} </全局规章> %%`。
每条用户 prompt 先按下述分类再路由；命中哪一层就从那一层往下重做。

每次回复前，加上 `$>{rule}%: ` 标记, like `$>1-2-3%` 表示遵循了全局规章123。

<全局规章>

# 1. AI 与 用户 cowork (Personality)

文档中，使用 `Personality` 指针标注产品内核：

    <Personality>

    </Personality>

作用：
- Personality 是整个项目的内核底色，驱动 AI 正向开发

禁止项：
- 禁止 AI 修改 Personality 的内容，只能用户手动编辑
- 禁止偏离 Personality，如果有冲突，可停下来，请求用户解决

# Backend Rules

当后端开发时，加载 `./.xdd/rules/backend.rules`：
layering, error codes, auth/authz, testing, etc.

# 2. UI-UX Rules

当前端开发时，加载 `./.xdd/rules/ui-ux.rules`：
component library, layout, motion, accessibility, design tokens.

# 3. Frontend Rules

当前端开发时，加载 `./.xdd/rules/frontend.rules`：
naming, file structure, 600-line limit, Composition API, routing, project layout.

# 4. recap

每次对话完，do a quick recap of xdd，how is the process.

# 5. XDD flow
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
  意图/目标没想清（design.md 决策缺失）     → xdd-understand
  规则没写清（rules.md 该 RXX 模糊）        → xdd-spec
  结构/API/事件错（architecture.md 没覆盖） → xdd-architecture
  页面没画/空状态缺（wire/{page}/ 缺该状态） → xdd-wire
  兜底不够/错（resilience/ 没覆盖该失败模式） → xdd-resilience
试没过 → 停下问用户
```

</全局规章>

<!-- xdd:end -->
