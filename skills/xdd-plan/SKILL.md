---
name: xdd-plan
description: |
  xdd 桥接层 —— 把设计层的锚（design.md 意图 + RXX 规则 + architecture 端点/事件 + wire 页面 + resilience 兜底）翻译成零上下文工程师可直接执行的 TDD 任务计划。
  每个任务显式回指 RXX 规则 —— 这就是「设计锚定代码」的桥：plan task → RXX → design 意图，代码 @implements RXX 再回指 task。
  粒度 2-5 分钟单动作步骤，先测试后实现，禁占位符，频繁提交。
  产出 .xdd/runs/iter-N/plan/{slug}/plan.md。
  触发：计划、plan、任务拆解、实施计划、开发计划、TDD 计划、实现计划、开工、跑计划。
---

# xdd-plan — 锚的桥

## 我锚定什么 / 上游 / 下游

**我是设计层和代码层之间的桥** —— 把验收场景、架构战术、流程组件、UI 产出转成 bite-sized 任务。计划的每个 task 都回指 RXX 规则（它来自 design.md 意图），这样写代码时不会偏离用户。计划不负责业务意图/架构/UI 规范（那些归设计层），只负责"按什么顺序、改哪些文件、写什么代码、跑什么测试"。

| | |
|---|---|
| **上游** | `design.md`(意图) + `spec/{slug}/`(RXX 规则 + Feature) + `architecture/{slug}/`(端点/事件/状态机/文件清单) + `wire/{page}/`(前端) + `architecture/{slug}/resilience/`(兜底约束) |
| **我产出** | `.xdd/runs/iter-N/plan/{slug}/plan.md`（任务 DAG + RXX 回指 + 全局约束） |
| **下游消费者** | `xdd-execute`（按 task 写代码，每个 commit 回指 RXX）、`xdd-verify`（按 Feature 验收） |
| **回溯锚** | 每个 task 标 `**回指 RXX:** R01,R03` + `**Feature:** login.feature :: Scenario: 密码登录成功` |

## 输入对齐（生成前必读，术语必须 1:1 一致，未知标"待确认"）

1. `.xdd/design/spec/{slug}/*.feature` —— Feature/Scenario、Then/And 断言、异常路径、Scenario Outline + Examples
2. `.xdd/design/architecture/{slug}/architecture.md` —— 状态机、启动/关闭、并发模型、异常恢复、API 端点契约、文件清单、规则传导矩阵
3. `.xdd/design/architecture/{slug}/flow.mermaid` —— 组件名/职责、数据流向、协议、外部依赖
4. `.xdd/design/wire/{page}/` —— 页面清单、组件交互、设计 token（前端项目）
5. `.xdd/design/architecture/{slug}/resilience/failsafe-design.md` —— 兜底约束 + 失败注入点
6. 当前代码/材料 —— 文件路径、入口、数据模型、错误码、测试框架

## 全局约束（定义一次，所有 task 共享）

跨切关注点在计划头部定义一次，所有 task 遵守：多租户隔离、认证授权、统一错误格式、事件发布、分页、事务边界、幂等键。每个 task 不重复定义，引用头部即可。

## 文件结构（分解决策的锚点）

定义任务前列出所有要创建/修改的文件及职责：每个文件单一明确职责；一起变更的放一起（按职责拆非按技术层拆）；遵循既有模式。

## 任务粒度

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

## 计划头部（每份必含）

```markdown
# [功能] 实现计划

> 给执行工程师：按顺序执行，每步用 checkbox 标进度。遇"待确认"立即停下问人。

**目标：** [一句话]
**架构：** [2-3 句方案]
**技术栈：** [关键依赖]
**验收来源：** spec/{slug}/*.feature
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

````markdown
### Task N: [行为路径]

**Depends on:** Task X
**回指 RXX:** R01,R03
**Feature:** `login.feature :: Scenario: 密码登录成功`
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

## 自检（写完逐项过）

```
□ 规格覆盖：每条 RXX / 每个 Scenario 能指向一个 task？列缺口补上
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

**阻塞上报**（遇即暂停）：计划标"待确认"、代码与计划不符、测试结果与预期不符、缺未声明依赖、需改计划结构。执行者不得自行改计划结构（可修拼写/路径错误）。
