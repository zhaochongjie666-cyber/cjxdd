# L2 BDD Step 绑定指南（Step Binding）

## 为什么需要 Step 绑定

L2 写了 Gherkin 场景（Feature/Scenario），但**写了的场景 ≠ 真能跑**。常见问题：

1. **场景是文档不是代码**：写完 .feature 文件，半年没人实现 step definitions
2. **场景和 step defs 漂移**：场景改了 step defs 没改，或反过来
3. **场景不可执行**：写法太抽象，无法映射到具体操作
4. **场景无法定位 bug**：失败时只能定位到场景，不知道是哪个 UI 元素
5. **场景无法数据驱动**：同样的步骤要复制 N 遍

**Step 绑定 = 在 L2 写场景时，同时生成可执行的 step definitions 和绑定**。

## 现状

现有 L2 skill 写的是 **Gherkin 文档**（e2e.md / coverage-matrix.md / uat-script.md），**不是可执行 spec**。

执行化在 L5-impl 阶段做（写 Playwright 代码），但**没有 L2 阶段的绑定**。

问题：
- L2 写场景时不知道「这个 Given 步骤能不能用 Playwright 实现」
- L5-impl 时才发现某场景不可执行
- 改场景 → 改 step defs → 改测试代码，链条长易错

## Step 绑定的位置

```
L2 e2e 写场景
  ↓ (现在)
  Feature + Scenario（纯文档）
  ↓ (需要新增)
  Feature + Scenario + 绑定表（场景→step defs→Playwright 实现）
  ↓
L5-impl 写 step definitions
  ↓
L6 deploy 跑场景
```

## 绑定表模板

每个 Feature 文件加一个绑定表：

```yaml
# e2e/annotation.feature

@P0 @covers-R12 @covers-B02-N08
Feature: 创建标注

  Background:
    Given 标注员已登录
    And 任务已打开，状态为 IN_PROGRESS

  Scenario: 标注员创建有效 2D 框标注
    When 标注员在画面上拖拽创建矩形框并关联标签 "car"
    Then 创建标注记录，状态 EMPTY → IN_PROGRESS
    And 发布 AnnotationCreated 事件

# ===== 绑定表 =====
binding:
  feature: annotation.feature
  total_scenarios: 5
  
  steps:
    - step: "Given 标注员已登录"
      type: precondition
      impl: e2e/step_defs/auth.py:login_as_annotator
      test_data: e2e/fixtures/users.py:annotator_alice
      pass_count: 0      # 跑过几次
      last_run: 2026-06-01
      
    - step: "And 任务已打开，状态为 IN_PROGRESS"
      type: precondition
      impl: e2e/step_defs/tasks.py:open_task_in_progress
      test_data: e2e/fixtures/tasks.py:task_001
      pass_count: 0
      last_run: null
      
    - step: "When 标注员在画面上拖拽创建矩形框并关联标签 \"car\""
      type: action
      impl: e2e/step_defs/canvas.py:drag_create_bbox
      page_selector: "[data-test='canvas-main']"
      interaction: drag
      pass_count: 0
      last_run: null
      
    - step: "Then 创建标注记录，状态 EMPTY → IN_PROGRESS"
      type: assertion
      impl: e2e/step_defs/assertions.py:assert_annotation_status
      db_query: "SELECT status FROM annotations WHERE id=:id"
      pass_count: 0
      last_run: null
      
    - step: "And 发布 AnnotationCreated 事件"
      type: assertion
      impl: e2e/step_defs/events.py:assert_event_published
      event_type: AnnotationCreated
      pass_count: 0
      last_run: null
```

## 绑定元数据

每个 step 必须有：

| 字段 | 必填 | 说明 |
|------|------|------|
| `type` | ✅ | precondition/action/assertion |
| `impl` | ✅ | 对应 step def 的 file:func |
| `page_selector` | action 类必填 | UI 选择器（data-test 优先） |
| `interaction` | action 类必填 | click/drag/type/hover/scroll |
| `db_query` | assertion 类可选 | DB 断言查询 |
| `event_type` | event assertion 必填 | 监听的事件名 |
| `test_data` | 条件 | 测试数据 fixture 引用 |
| `pass_count` | 自动 | 通过次数（L6 累计） |
| `last_run` | 自动 | 上次跑过时间 |

## L2 阶段的 step skeleton

L2 写场景时，**只填元数据骨架，不写具体 step def 代码**（留给 L5-impl）：

```yaml
binding:
  - step: "Given 标注员已登录"
    type: precondition
    impl: TODO  # L5-impl 阶段填
    test_data: TODO
    
  - step: "When 标注员在画面上拖拽创建矩形框"
    type: action
    impl: TODO
    page_selector: TODO
    interaction: drag
```

L5-impl 阶段把 `TODO` 填上。

## L2 场景可执行性自检

L2 写完后跑自检脚本（`scripts/step-binding-check.sh`），检查：

```
1. 每个 Scenario 的每个 step 都有 binding 条目
2. 每个 action step 有 page_selector + interaction
3. 每个 assertion step 有 db_query 或 event_type
4. TODO 字段在 L5-impl 后被填上
5. 绑定的 page_selector 在 wire.svg 中能找到对应元素
6. 绑定的 API 端点在 architecture.md API 端点清单中存在
```

## 与 L1.5 / L1 Wire 的对接

**page_selector 来源**：L1 Wire SVG 中的 `data-test` 属性。

L2 写场景时引用 wire 的 data-test：
```yaml
- step: "When 点击「提交」按钮"
  page_selector: "[data-test='submit-button']"  # 来自 wire.svg
```

L2 应在 status.md 的 "本阶段必读" 中加 "L1 Wire data-test 注册表"。

**API 端点来源**：L1.5 architecture.md §7 API 端点清单。

L2 写 API 调用类 step 时引用：
```yaml
- step: "When 调用 POST /api/annotations"
  api_endpoint: "POST /api/annotations"
  api_ref: "L1.5 architecture.md §7"
```

## 与 L5-impl 的接力

L5-impl 写 step definitions 时：

1. 读 L2 的 binding 表，找到 `TODO` 字段
2. 写实际 step def 代码
3. 把 `impl: TODO` 替换为 `impl: e2e/step_defs/xxx.py:func_name`
4. 跑 L2 场景验证全 GREEN
5. 跑 `step-binding-check.sh`，确认所有 TODO 已填

## 与 L6 的接力

L6 跑场景时，每次执行更新 binding 元数据：

```yaml
- step: "Given 标注员已登录"
  pass_count: 5
  last_run: 2026-06-05T10:30:00Z
  last_result: pass
```

这样可以识别**flaky 测试**（pass_count 高但偶尔失败）和**真问题**（pass_count 突然下降）。

## 工具

- 模板：`e2e/{feature}.feature` + `e2e/{feature}.binding.yaml`
- 脚本：`scripts/step-binding-check.sh`（自动检查 binding 完整性）
- 累积：L6 每次跑后自动更新 `pass_count` 和 `last_run`

## 反模式

❌ **「L2 写完场景就完了」**：L2 必须给出 binding 骨架
❌ **「L5-impl 时再补 binding」**：L2 不写 binding → L5-impl 不知道自己实现什么
❌ **「所有 step 都用 CSS selector」**：用 data-test 属性，与样式解耦
❌ **「assertion 只看 HTTP 200」**：必须断言业务数据（DB / event / 页面元素）
❌ **「flaky 测试不改」**：必须更新 binding 元数据，识别 flaky

## 与 L3 的对接

L3 失败模式中的「兜底机制」在 L2 中应该体现为 step：
- 限流兜底 → L2 场景有「当 qps > 100 时返回 429」的 step
- 熔断兜底 → L2 场景有「当下游失败时降级到缓存」的 step
- 补偿兜底 → L2 场景有「当 saga 失败时回滚」的 step

**L2 与 L3 必须协同**：

```
L3 失败模式 → 兜底设计 → 关联 e2e 场景
L2 场景 → 引用 L3 failsafe 设计 → 验证兜底有效
```

具体协同机制见 `shadow-l3_resilience-fdd` skill 的「与现有 skill 的传导矩阵」。

## 与 Walker 三面手原则的关系

L2 完整三面手：

| 面 | 内容 |
|---|------|
| **设计** | Gherkin 场景 + 覆盖矩阵 + UAT 剧本 |
| **实现** | Step binding 骨架 + L5-impl 填实 + step def 代码 |
| **跟踪** | pass_count / last_run 累积 + flaky 检测 + L6 回归 |
