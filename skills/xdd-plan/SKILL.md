---
name: xdd-plan
description: |
  xdd 桥接层 —— 把设计层的锚（design.md 意图 + RXX 规则 + architecture 端点/事件 + wire 页面 + resilience 兜底）翻译成零上下文工程师可直接执行的 TDD 任务计划。
  每个任务显式回指 RXX 规则 —— 这就是「设计锚定代码」的桥：plan task → RXX → design 意图，代码 @implements RXX 再回指 task。
  粒度 2-5 分钟单动作步骤，先测试后实现，禁占位符，频繁提交。
  产出实施 plan + 实现前冻结的独立 QA Plan。
  触发：计划、plan、任务拆解、实施计划、开发计划、TDD 计划、实现计划、开工、跑计划。
---

# xdd-plan — 锚的桥

## 我锚定什么 / 上游 / 下游

**我是设计层和代码层之间的桥** —— 把验收场景、架构战术、流程组件、UI 产出转成 bite-sized 任务。计划的每个 task 都回指 RXX 规则（它来自 design.md 意图），这样写代码时不会偏离用户。计划不负责业务意图/架构/UI 规范（那些归设计层），只负责"按什么顺序、改哪些文件、写什么代码、跑什么测试"。

| | |
|---|---|
| **上游** | `xdd-brainstorm`(design.md 意图) + `xdd-spec`(spec/{bxx-slug}/ RXX 规则 + Feature) + `xdd-architecture`(architecture/{bxx-slug}/ 端点/事件/状态机/文件清单) + `xdd-wire`(wire/{page}.md 前端线框) + `xdd-resilience`(architecture/{bxx-slug}/resilience/ 兜底约束) |
| **我产出** | `.xdd/runs/xdd_run/plan.md`（任务 DAG）+ `.xdd/runs/xdd_run/qa-plan.md`（实现前冻结的公开入口 QA 契约） |
| **下游消费者** | `xdd-execute`（按 task 写代码，每个 commit 回指 RXX） |
| **回溯锚** | 每个 task 标 `**回指 RXX:** R01,R03` + `**Feature:** login.feature :: Scenario: 密码登录成功` |

## 怎么做

```
work():
  1. INPUT: 读全部设计层锚（design.md + spec/{bxx-slug}/ + architecture/{bxx-slug}/ + wire/ + resilience/）
  2. ACT:   输入对齐——术语 1:1 一致，未知标"待确认"，不编造
  3. ACT:   拆 task——一条行为路径 = 一个 task；粒度 3-5 个 Step
  4. ACT:   先枚举全部 `.feature` 的每个 Scenario/Scenario Outline，再让每个场景落入 task；每 task 标五字段（回指 RXX + Stack + Feature + Implementation + Files）
     GATE:  grep -c "回指 RXX" plan.md == task 数
            && grep -c "Stack:" plan.md == task 数
            && grep -c "Implementation:" plan.md == task 数
            && grep -c "Files:" plan.md == task 数
  5. ACT:   排依赖（Depends on DAG，无依赖的首批先跑）
  6. ACT:   先以 QA 视角生成 qa-plan.md，再生成 plan.md；execute 只能消费 QA 契约，不能按实现反改期望
     GATE:  test -f 该 plan.md 且每个 task 都有 ≥1 个测试 Step（grep "Expected: PASS/FAIL"）
```

## 独立 QA Plan（execute 前冻结）

`.xdd/runs/xdd_run/qa-plan.md` 必须先于实现生成。它只从 Feature、用户旅程、API/Wire 契约推导，不读取未来实现，不以内部函数或数据库操作充当测试入口。

**先约定、后 Gate：下面代码块是机器解析契约，不是排版示例。必须原样保留 `### QA-ID` 和 `- Field: value` 结构；字段名和值必须在同一行。禁止加粗字段名、拆成字段名/值两行、改成表格，或把独立 `RXX` 行当成 Category。RXX 只写入 plan task 的 `回指 RXX` 字段。Gate 会严格按此契约兜底，并在拒绝时重显正确模板。**

六类必须逐项决策：`happy`、`rejection`、`boundary`、`concurrency`、`dependency-failure`、`load`。适用则写测试项；确实不适用则写 `Applicability: not-applicable` 和不少于 10 字的业务理由，禁止只写 N/A。

```markdown
### QA-001
- Category: happy
- Feature: `auth/login.feature :: Scenario: valid password`
- Entry: POST /login
- Expected: HTTP 200 and usable token
- Automation: automated

### QA-LOAD
- Category: load
- Applicability: not-applicable
- Reason: 本次是离线单用户工具，没有并发或吞吐量承诺
```

每个 Feature Scenario/Scenario Outline 必须至少被一个适用测试项的 `Feature` 精确锚定。`Entry` 必须是 UI、CLI、公开 API 或事件入口；`Automation` 只能是 `automated` 或 `manual`。

## 输入对齐（生成前必读，术语必须 1:1 一致，未知标"待确认"）

1. `.xdd/design/spec/{bxx-slug}/*.feature` —— Feature/Scenario、Then/And 断言、异常路径、Scenario Outline + Examples（语法/具体值写法 → 详见 `xdd-gherkin-plus` skill）
2. `.xdd/design/architecture/{bxx-slug}/architecture.md` —— 状态机、启动/关闭、并发模型、异常恢复、API 端点契约、文件清单、规则传导矩阵
3. `.xdd/design/architecture/{bxx-slug}/flow.mermaid` —— 组件名/职责、数据流向、协议、外部依赖
4. `.xdd/design/wire/{page}.md` -- 页面线框、组件交互、6 操作态、设计 token（前端项目）
5. `.xdd/design/architecture/{bxx-slug}/resilience/failsafe-design.md` —— 兜底约束 + 失败注入点

**代码路径命名边界**：上游路径里的 `{bxx-slug}` 只属于 `.xdd` 设计工件。plan 的 Implementation、测试、迁移、部署文件路径必须沿用项目现有结构并按领域能力命名；禁止把 `B01/B02/BXX` 复制成 `src/b01-*`、`backend/services/b02-*`、包名或服务名。正确示例：`backend/services/auth-service/`；错误示例：`backend/services/b01-auth/`。
6. 当前代码/材料 —— 文件路径、入口、数据模型、错误码、测试框架

## 全局约束（定义一次，所有 task 共享）

跨切关注点在计划头部定义一次，所有 task 遵守：多租户隔离、认证授权、统一错误格式、事件发布、分页、事务边界、幂等键。每个 task 不重复定义，引用头部即可。

## 文件结构（分解决策的锚点）

定义任务前列出所有要创建/修改的文件及职责：每个文件单一明确职责；一起变更的放一起（按职责拆非按技术层拆）；遵循既有模式。

## 任务粒度

> **task 该拆还是合、依赖怎么排不乱、plan 怎么自查质量 → 查 `references/task-decomposition.md`**（拆解法：粒度边界判断/DAG 无环有起点/RXX 全覆盖 M==N/好计划 6 维）。

**一个 task = 一个行为路径**（按行为路径拆，非按组件拆）：

- "用户密码登录成功" — 一个 task
- "用户密码错误" — 一个 task
- "账号被锁定" — 一个 task

| task 类型 | 步数 | 模式 |
|---|---|---|
| 简单 | 3 | 写测试 → 实现 → 提交 |
| 标准（推荐） | 5 | 写失败测试 → 确认失败 → 写最小实现 → 确认通过 → 提交 |
| 复杂 | ≤7 | 多一轮 TDD + 提交 |

**超 7 步必拆。每步一个动作（2-5 分钟）。**

## 依赖关系（DAG）

每个 task 头部标 `Depends on`。计划头部有依赖表：

```markdown
| Task | Depends On | 可并行 |
|---|---|---|
| Task 1 | None | 是 |
| Task 3 | Task 1 | 否 |
```

依赖必指向序号更小的 task（无环）。Task B 依赖 Task A，则 A 定义的类型/函数 B 可直接引用。

## RXX → Task 映射

- **一条 RXX 规则 → 一个或多个 task**（成功路径一个、异常路径各一个）
- **Scenario Outline + Examples → 一个 task**（Examples 每行用 parametrize 覆盖）
- **Background → 第一个相关 task 的 setup 步骤**
- 每个 task 标 `**回指 RXX:**` + `**Feature:**`

## Feature Scenario → 可实现闭环（禁止把 Feature 当参考资料闲置）

生成 task 前逐文件读取 `.xdd/design/spec/{bxx-slug}/*.feature`，枚举所有 `Scenario:` 与 `Scenario Outline:`（Background 不是独立场景）。**每个场景必须且只能用规范锚至少映射到一个 task**：`relative/path.feature :: Scenario: 原始名称`；Outline 保留 `Scenario Outline:`，其 Examples 每一行都由该 task 的参数化验收测试执行。不得只写 Feature 文件名、不得用“相关场景”等模糊引用。

每个场景的 task 必须同时指明：

1. `**Implementation:**` 具体生产代码符号（如 `src/auth/service.ts::AuthService.login`），说明该场景由哪里实现；
2. `**Acceptance Test:**` 具体测试文件 + 测试名，且测试通过公开入口执行该 Scenario 的 Given/When/Then；
3. TDD Step 中先运行该验收测试得到 FAIL，再实现，再运行得到 PASS；完成后把 PASS 命令写入 Evidence。

plan Gate 必须做集合差：`Feature 文件全部场景 - plan 的 **Feature:** 锚 = ∅`。任一场景漏映射、名称不精确、只有测试没有生产实现落点，plan 不得交 execute。

## 计划头部（每份必含）

```markdown
# [功能] 实现计划

> 给执行工程师：按顺序执行，每步用 checkbox 标进度。遇"待确认"立即停下问人。
> 本文件也是执行期唯一的动态计划：边做边写，状态、命令证据和决策必须在发生时落盘，禁止收尾时批量补写。

**目标：** [一句话]
**架构：** [2-3 句方案]
**技术栈：** [关键依赖]
**验收来源：** spec/{bxx-slug}/*.feature
**回指锚：** 每个task标 RXX，代码用 @implements RXX 回指

## 全局约束
- {多租户/认证/错误格式/事件/分页/事务/幂等 — 定义一次}

## 文件结构
| 文件 | 操作 | 职责 |
|---|---|---|

## 依赖关系
| Task | Depends On | 可并行 |
|---|---|---|

## RXX 覆盖追踪
| RXX 规则 | Feature Scenario | Task | 状态 |
|---|---|---|---|
| R01 登录返回JWT | login.feature :: 密码登录成功 | Task 6 | - [ ] |
```

## 任务结构（每个 task 必含）

`**Stack:**` 取 `backend` 或 `frontend`（来自 architecture 规则传导矩阵的列：后端文件→backend / 前端组件→frontend；纯后端项目全 backend）。task 的 Stack 字段决定 execute 装哪个专项 skill（`xdd-backend` / `xdd-frontend`）。

````markdown
### Task N: [行为路径]
# ↑ N = T 编号（ACK T 区索引）。task 按本文件出现顺序自然编号 T1/T2...，全局唯一。
# 多业务线时 T 编号在各自 plan/{bxx-slug}/plan.md 内独立（ACK T 区配合 status.md 活跃 slug 定位）。

**Depends on:** Task X
**回指 RXX:** R01,R03
**Stack:** backend
**Feature:** `login.feature :: Scenario: 密码登录成功`
**Implementation:** `src/auth/service.py::AuthService.login`
**Acceptance Test:** `tests/features/test_login.py::test_password_login_success`
**Files:**
- Create: `exact/path/file.py`
- Modify: `exact/path/existing.py:123-145`
- Test: `tests/exact/path/test.py`

- [ ] **Step 1: 写失败测试**
```python
def test_login_success():
    ...
```
- [ ] **Step 2: 跑测试确认失败**
Run: `pytest tests/... -v`  Expected: FAIL
- [ ] **Step 3: 写最小实现**
```python
...
```
- [ ] **Step 4: 跑测试确认通过**
Run: `pytest tests/... -v`  Expected: PASS
- [ ] **Step 5: 提交（commit message 回指 RXX）**
```bash
git add ... && git commit -m "feat(auth): 实现 R01 登录返回JWT"
```
````

**修改已有文件**：展示路径+行号+完整变更后代码（不是 diff），禁止"在 XX 行后插入"。

## 禁止占位符（反 sham 的核心纪律）

以下模式 = 计划不合格，绝不出现：
- "TBD"/"TODO"/"稍后实现"/"补充细节"
- "添加适当的错误处理"/"处理边界情况"（无具体代码）
- "为上述代码写测试"（无实际测试代码）
- "类似 Task N"（必须重复代码，工程师可能乱序读）
- 只描述做什么但不展示怎么做
- 引用未在任何 task 定义的类型/函数
- "在 XX 行后插入"而不展示完整上下文

## 产出

`.xdd/runs/xdd_run/plan/{bxx-slug}/plan.md` —— 零上下文工程师可直接执行的 TDD 任务 DAG：

- **计划头部**：目标 / 架构 / 技术栈 / 验收来源 / 全局约束 / 文件结构 / 依赖表 / RXX 覆盖追踪表
- **逐 task**：回指 RXX + Stack + Feature + Files + TDD Steps（红→绿→提交）

每个 task 回指 RXX，是下游 execute `@implements RXX` → verify 追溯链的桥梁。多业务线时每业务线一份 `plan/{bxx-slug}/plan.md`（T 编号在各自文件内独立）。

## 自检

```
□ 规格覆盖：每条 RXX、每个 Feature Scenario/Scenario Outline 都能精确指向 task，且场景集合差为空？
□ 可实现性：每个 Scenario task 都有生产代码 `Implementation` 落点 + 可运行 `Acceptance Test`，不是只复述设计？
□ 占位符扫描：搜禁止模式，发现即修
□ 类型一致性：跨 task 类型/方法签名/属性名一致（Task3 clearLayers vs Task7 clearFullLayers = bug）
□ 术语一致性：状态名/字段名/API 名跟 spec/architecture/flow 1:1 一致
□ 依赖一致性：依赖表跟实际引用一致，无环，被引用的都已定义
□ RXX 追踪完整：每个 task 标回指 RXX，每条 RXX 有 task 覆盖
□ 每个 task 步数 ≤ 7，单一行为路径，结尾有提交
□ 遵循 TDD（先测试后实现）
□ 修改已有文件展示完整上下文代码
□ 兜底约束（resilience）写进相关 task
```

## 执行交接

计划保存后给执行选择：(1) 逐 task 分派子 agent（推荐，大项目）；(2) 当前会话内联执行。

**进度标记**：`- [ ]` 待执行 / `- [~]` 执行中 / `- [x]` 完成 / `- [!]` 阻塞（必附原因）。

**动态计划约定**：执行者直接维护本文件，不另建一份 TODO/plan 造成双重事实源。task 开始即改 `[~]`；每个 Step 完成即改 `[x]` 并在该 Step 下追加 `Evidence: <命令 + 关键结果>`；假设、顺序或实现方式变化时追加带时间的 `Plan update`，说明“事实 / 拷问 / 决策 / 影响”。只允许原地更新进度、证据和不改变契约的微调；RXX、接口、依赖 DAG、文件范围或验收标准变化属于结构性变化，必须标 `[!]` 并回到 xdd-plan（必要时 design/spec/architecture）重规划后再执行。

**阻塞上报**（遇即暂停）：计划标"待确认"、代码与计划不符、测试结果与预期不符、缺未声明依赖、需改计划结构。执行者不得自行改计划结构（可修拼写/路径错误）。
