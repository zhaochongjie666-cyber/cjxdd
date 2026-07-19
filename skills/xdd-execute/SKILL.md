---
name: xdd-execute
description: |
  xdd 代码层 —— plan 的执行者。加载计划，按 task 逐步 TDD 实现，代码用 @implements RXX 回指规则，处理阻塞，确保交付符合验收标准。
  核心纪律：无存根、无假实现、必须跑通有证据 —— 这是反「sham 交付」的底线（session c3692b46 教训：60 端点只实施 23 = 38% 蒙混）。
  吸收旧 xdd-scaffold 的 Step 0（环境准备：依赖/测试框架/Docker 服务）。
  触发：执行计划、实现计划、跑计划、开始开发、写代码、实施、开工、TDD。
---

# xdd-execute — 代码层

## 我锚定什么 / 上游 / 下游

**我把计划变成能跑的代码** —— 按 task 顺序写，并把当前 `plan.md` 当作执行期唯一事实源一边做一边更新；每个 commit 用 `@implements RXX` 回指规则，让代码可追溯到设计意图。执行者不擅改计划结构、不跳验证、不在阻塞时猜。

| | |
|---|---|
| **上游** | `xdd-plan`（`.xdd/runs/xdd_run/plan.md` task DAG + 冻结的 `qa-plan.md` 公开入口测试契约） |
| **我产出** | 代码（每处 `@implements RXX`）+ 测试（每个 RXX 至少 1 个）+ 执行报告 |
| **下游消费者** | `xdd-verify`（按 Feature 验收 + 真实可用契约） |
| **回溯锚** | 代码注释 `@implements RXX` ← plan task ← spec 规则 ← design 意图 |

## 怎么做

读 task 的 `**Stack:**` 字段，按栈装专项 skill：
- `backend`  → 装 `xdd-backend`（加载 `.xdd/rules/backend.rules` + 后端检查：DB 迁移/端点/事件/事务）
- `frontend` → 装 `xdd-frontend`（加载 `frontend.rules`+`ui-ux.rules` + 前端检查：对照 wire 6 态/600行）
- 纯后端项目（无 wire）→ 默认 backend

execute 是通用 TDD 主流程；专项 skill 补栈特定约定与检查。主流程 Step 0-5 如下：

## Step 0：准备环境（吸收自旧 scaffold）

写第一行代码前：

- [ ] 当前不在 main/master（除非用户授权）
- [ ] 工作目录干净
- [ ] 依赖已装（`npm install` / `pip install` 等）；缺依赖时必须自行安装并重跑，不把“未安装”上报为阻塞
- [ ] 测试框架可用（跑一次空测试确认）；浏览器/E2E 需要 Playwright/Selenium 时同步安装浏览器运行时
- [ ] Docker 服务起来（`docker compose up -d --wait`，每个 healthcheck 过）—— 用 `xdd-architecture` 的 docker-compose.yml；缺 DB/队列/缓存就拉起或配置 test 替代
- [ ] DB 迁移跑过（`alembic upgrade head` 或等价）
- [ ] 原失败测试命令已重跑并留证据；环境修复不是终点，验证结果才是终点

## Step 1：加载与审计计划

1. 读 `.xdd/runs/xdd_run/plan.md`、`.xdd/runs/xdd_run/qa-plan.md` 和对应全部 `.feature`，提取任务、全部 QA-XXX、公开 Entry 与 Expected
2. 先做场景集合差，确认每个 Feature Scenario 都有精确 `Feature` 锚、生产代码 `Implementation` 落点和可运行 `Acceptance Test`；再逐项审计 task 的文件路径、依赖、RXX、完整代码与验证命令
3. 分类问题：**结构性**（缺文件/占位符/类型不一致/缺依赖）→ 一次性上报全部，等修后重走 Step 1；**微小**（拼写/路径笔误）→ 记微调清单，不影响执行

**QA 冻结纪律**：execute 可以实现 QA 测试及其 fixture，但不得修改 qa-plan.md 的 `Feature`、`Entry`、`Expected` 或适用性结论来迁就代码。若实现事实证明 QA 契约错误，标记阻塞并回到 plan/spec 修订，再重新生成 plan review verdict。

**BXX 不进入代码目录（硬约束）**：`B01/B02/BXX` 只是 `.xdd` 设计文档和追踪矩阵里的业务线编号。源码目录、包名、服务名、容器名与部署目录必须按领域能力命名，并优先沿用项目已有结构。禁止创建 `b01-auth/`、`B02-project/` 等目录；应使用 `auth-service/`、`project-service/` 等语义名称。RXX 只允许出现在追踪表、提交说明和 `@implements RXX` 标注中。

**只读 Code Review 交接**：提交 execute 产物时，`artifacts` 必须包含生产源码路径，不能只交 plan/docs/tests。AIGate 使用 Pi 当前模型的隔离审查上下文检查空值安全、并发安全、资源生命周期、授权与注入、错误处理、架构漂移，并生成 `.xdd/runs/xdd_run/code-review.json`；Reviewer 只报告，不在审查调用中修改源码。

### Dynamic Plan + Grill（贯穿 Step 1-5）

当前业务线的 `.xdd/runs/xdd_run/plan/{bxx-slug}/plan.md` 是唯一动态计划，不另建影子 TODO。**一边做一边写**：状态或事实发生变化后、开始下一动作前，立即原子更新 plan；禁止最后批量勾选。

每个动作都执行一次 Grill，不停拷问而不是机械照单：

1. **计划合理吗？** 当前动作仍服务对应 RXX/Scenario 吗？依赖真的满足吗？有没有更早、更小的验证？
2. **实现合理吗？** 可观察行为符合契约吗？是否引入假实现、隐式耦合或计划外范围？
3. **正向跑通了吗？** 用哪条真实命令/操作证明，而非“看起来正确”？
4. **兜底被攻击了吗？** 失败、拒绝、异常、依赖不可用或恢复路径至少攻击了哪一条？
5. **证据要求回炉吗？** 若事实推翻假设，应该修 execute，还是退回 plan/spec/architecture/resilience？

动态更新格式写在对应 task/Step 下：

```markdown
- [~] **Step N: ...**
  - Plan update (2026-01-01T00:00:00Z): Fact: ...; Grill: ...; Decision: ...; Impact: ...
  - Evidence: `exact command` → PASS/FAIL（关键结果）
```

允许直接更新：`[ ] → [~] → [x]`、命令证据、失败次数、不改变外部契约的微调。必须 `[!]` 并回炉重规划：RXX/验收标准、公开接口、依赖 DAG、文件范围、新依赖或安全/韧性策略变化。重规划保留旧记录并追加原因，不擦除失败证据；这样中断或压缩后可从 plan 恢复真实进度。

## Step 2：逐 task TDD 执行

**执行顺序**：

```
run_tasks(tasks):
  ready = [t for t in tasks if t.depends_on is None]      # 首批：无依赖
  while tasks has 未完成:
    for t in (ready 且依赖都已 [x]):       # 序号线性，或依赖满足后并行派子 agent
      run_single_task(t)
      on_complete: 解锁依赖 t 的新 task   # 每完成一个检查是否有新 task 满足依赖
```

**单个 task 流程**：

```
run_single_task(t):
  assert all(dep.status == [x] for dep in t.depends_on)   # 1. 依赖都完成
  t.status = [~]                                          # 标本 task 执行中
  for step in t.plan_steps:                               # 2. 按 Step 顺序逐个执行（代码照抄，不计划外"优化"）
    pre_write_signoff(step)                               # 3. 写前默念（见下）
    run(step.cmd); compare actual vs step.expected        # 4. 验证步骤
    append step Evidence + Grill decision                 # 5. 证据先落盘
    step.status = [x]                                     # 6. 每步完成立即更新，禁止批量补写
  assert tests_pass(t)                                    # 7. 全步完：task 内测试通过
  update RXX + Feature Scenario 覆盖追踪(t.RXX, t.Feature)
```

**TDD 小回环（task 内，分钟级）**：红（写失败测试）→ 绿（写最小实现）→ 重构（清理）→ commit（message 含 RXX）。失败 → 修代码 → 再跑（不计数）。

> **TDD 怎么真正落地、测试怎么写好、@implements 落哪、sham 手法识别 → 查 `references/tdd-in-practice.md`**（实操层：好测试三特征/红绿重构怎么转/@implements 落点/sham 7 手法对策）。

### Pre-write Signoff（写每个方法前默念）

写代码前对要写的方法做三件事：
1. **读** —— 这方法在 plan 哪个 step？它实现哪条 RXX 规则？签名/返回是什么？
2. **理解** —— 它依赖哪些已实现的东西（依赖 task 里定义的）？它被谁调用？
3. **假设** —— 它怎么被测？测试会断言什么可观察结果？

说不清就停下回 plan 看，别凭印象写。

## Step 3：task 间 Review

每完成一个 task 检查：计划测试命令过了？新增/修改文件跟计划一致？引入计划外变更了吗？下一 task 依赖满足了吗？

把答案和命令证据写回 plan 后才解锁下一 task；“代码写完但 plan 未更新”仍算未完成。

**计划外变更分级**：

| 级别 | 示例 | 处理 |
|---|---|---|
| 可忽略 | 多个 import、空行、注释微调 | 记微调清单，继续 |
| 需记录 | 函数内部细节与计划略不同（接口不变）| 记微调 + 说明，继续 |
| 需上报 | 新增/删除文件、改接口签名、新增依赖 | 暂停上报 |

## 反 sham 底线（无存根、无假实现、跑通有证据）

**session c3692b46 教训**：60 端点只实施 23（38%）、2 处 stub、0 e2e、谎报 DEPLOY_PASS —— 这是 sham。本 skill 的底线就是杜绝这种事。

**绝对禁止**：
- ❌ 存根：`pass` / `TODO` / `return None` / `NotImplementedError` / `raise NotImplementedError`
- ❌ 假实现：`InMemoryRepository`、mock DB、硬编码 `current_user`、假数据
- ❌ 跳过验证步骤
- ❌ "先 commit 后修" —— 验证失败 = 立即修
- ❌ 在没跑通时声称"基本完成"

**每个 commit 前自检**（跑可移植脚本，非平台 hook）：

```bash
bash skills/xdd-execute/scripts/no-stub-check.sh <你刚改的文件或目录>
# 扫 pass/TODO/NotImplementedError/InMemoryRepository/mock_*/硬编码用户, 命中即修
```

**完成度自检**（每 task + 收尾，纯文字对照 plan + arch）：

```
□ RXX 覆盖：plan 的每条 RXX 都有代码 @implements RXX + 测试？（列缺口补）
□ Feature 覆盖：每个 Scenario/Scenario Outline 都已实现其 `Implementation`，对应 `Acceptance Test` 通过并有 Evidence？（按 feature 文件逐个点名，不能抽样）
□ 端点覆盖：architecture 的 API 端点清单，每个都有真实现？（别 60→23）
□ 真实持久化：写 → 查 → 重启后还在？（不是 mock DB）
□ 跨服务链路：事件 producer → queue → consumer → DB 真跑通？（至少关键路径）
□ 0 存根：no-stub-check.sh 零命中？
□ 全量测试 PASS
```

## Step 4：阻塞处理

```
on_block(problem):                      # 遇即暂停，不猜不跳
  if problem in [计划标"待确认", 文件不存在, 行号不匹配, 函数签名不一致, 缺未声明依赖, 计划外新发现]:
    report(problem)                     # 一次性上报，等修后重走；不自行修根本原因

  # 测试结果异常：先分析根因再上报；若是依赖/服务/DB/浏览器缺失，先按 Step 0 自愈并重跑
  elif test.FAIL_but_actually_PASS:     # 断言不够严 / 实现已提前存在 / 测了错函数
    report("测试代码缺陷", evidence)
  elif test.PASS_but_actually_FAIL:     # 计划代码有 bug / 环境依赖缺 / 依赖 task 破坏了本 task
    report("附错误日志", evidence)

  # 例外：可自行处理（不报）
  elif problem in [拼写, 行号偏移, import 顺序, commit message 微调]:
    log_microchange(); continue
```

**阻塞上报格式**：
```
[阻塞] Task N: [名]
- 阻塞步骤：Step X
- 原因：[描述]
- 实际：[输出/状态]  vs  计划预期：[...]
- 建议：[如有]
```

## 卡住怎么办（3 试 HALT，纯文字纪律）

```
on_failure(n):                          # n = 同一 task 连续失败次数
  append runs/xdd_run/failure-log.md:    # n==1 起每试记一行（持久化，防压缩后计数丢失）
    [n=N] task / 命令 / 错误摘要 / 试过什么
  if   n == 1: 重跑仔细点
  elif n == 2: 重读 plan 对应 step + references，换实现方式
  elif n == 3: 退一步回 xdd-plan 重规划（RXX 映射错 / 端点漏 / 依赖冲突；或更上 design/spec 层找根因）
  elif n == 4: failure-log 已累积 4 条，停下问用户
# 核心：3 试没过别在代码层反复修 —— 在错的层面硬扛无意义。
# failure-log 从 n==1 起持久化 → 压缩后仍知第几试，4 试上限有效。
```

## Step 5：收尾

所有 task 完成后：
1. 跑全量测试套件
2. 重新枚举全部 Feature 文件：每个 Scenario/Scenario Outline 都有生产实现落点、对应通过的验收测试和 Evidence；不得只按 RXX 数量推断场景已完成
3. 跑 no-stub-check.sh 全项目扫，零命中
4. 检查 git log：commit 历史跟计划一致，每个 commit message 含 RXX
5. 输出执行报告（计划名 / 状态 / task 完成表 / RXX 覆盖结果 / 全量测试结果 / 提交历史 / 遗留事项）

**收尾测试失败**：识别失败属哪个 task → 判断类型（集成问题 / mock 不匹配 / 环境）→ 不自行修，上报附失败测试名 + 日志 + 估测冲突 task。

## 执行报告

```markdown
## 执行报告
**计划：** plan/{bxx-slug}/plan.md
**状态：** 全部完成 / 部分完成
### Task 完成情况
| Task | 状态 | 备注 |
### RXX 覆盖结果
| RXX | Task | 测试状态 |
### 全量测试结果
[粘贴]
### 提交历史
[git log --oneline]
### 遗留事项
- [...]
```

## 自检

```
□ 每个 Step 按计划执行（无跳过/替换）？
□ 每个验证步骤跑了指定命令？
□ 每个 commit 用了计划 message + 含 RXX？
□ 代码每处 @implements RXX 回指？
□ 所有 RXX 有对应测试且通过？
□ no-stub-check.sh 全项目零存根？
□ 计划外变更按严重程度正确分级？
□ 遇阻塞及时上报而非猜？
□ 全量测试通过？失败按收尾流程？
□ RXX 覆盖追踪表跟实际一致？
□ 对应 RXX 的 design 契约「实现」列已翻 `- [x]`（基于本 task 的 `@implements RXX`：rules.md / architecture §6§7 / resilience failsafe）？
□ 没用 mock 假装真实持久化？
□ Docker 服务起来 + healthcheck 过？
```
