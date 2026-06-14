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

**我把计划变成能跑的代码** —— 按 task 顺序写，每个 commit 用 `@implements RXX` 回指规则，让代码可追溯到设计意图。执行者不改计划结构、不跳验证、不在阻塞时猜。

| | |
|---|---|
| **上游** | `xdd-plan`（`.xdd/plan/{slug}/plan.md` task DAG + RXX 回指） |
| **我产出** | 代码（每处 `@implements RXX`）+ 测试（每个 RXX 至少 1 个）+ 执行报告 |
| **下游消费者** | `xdd-verify`（按 Feature 验收 + 真实可用契约） |
| **回溯锚** | 代码注释 `@implements RXX` ← plan task ← spec 规则 ← design 意图 |

## Step 0：准备环境（吸收自旧 scaffold）

写第一行代码前：

- [ ] 当前不在 main/master（除非用户授权）
- [ ] 工作目录干净
- [ ] 依赖已装（`npm install` / `pip install` 等）
- [ ] 测试框架可用（跑一次空测试确认）
- [ ] Docker 服务起来（`docker compose up -d --wait`，每个 healthcheck 过）—— 用 `xdd-architecture` 的 docker-compose.yml
- [ ] DB 迁移跑过（`alembic upgrade head` 或等价）

## Step 1：加载与审计计划

1. 读 `.xdd/plan/{slug}/plan.md`，提取：文件结构表、依赖关系表、RXX 覆盖追踪表、所有 task
2. 逐项审计：每个 task 有精确文件路径？声明了依赖？标了回指 RXX？代码步骤是完整代码非占位符？验证步骤有精确命令+预期？
3. 分类问题：**结构性**（缺文件/占位符/类型不一致/缺依赖）→ 一次性上报全部，等修后重走 Step 1；**微小**（拼写/路径笔误）→ 记微调清单，不影响执行

## Step 2：逐 task TDD 执行

**执行顺序**：找 `Depends on: None` 的首批 → 按 task 序号线性（或依赖满足后并行派子 agent）→ 每完成一个检查是否有新 task 满足依赖。

**单个 task 流程**：

```
1. 检查依赖 task 都 [x] 了 → 标本 task [~]
2. 按计划 Step 顺序逐个执行（代码步骤照抄计划代码，不做计划外"优化"）
3. Pre-write Signoff（每个方法写前）：读计划该步 → 理解它实现哪条 RXX → 假设它怎么被测
4. 验证步骤：跑计划指定命令，比对实际 vs 预期
5. 每步完成更新 [x]
6. 全步完：确认 task 内测试通过 + 更新 RXX 覆盖追踪表对应行
```

**TDD 小回环（task 内，分钟级）**：红（写失败测试）→ 绿（写最小实现）→ 重构（清理）→ commit（message 含 RXX）。失败 → 修代码 → 再跑（不计数）。

### Pre-write Signoff（写每个方法前默念）

写代码前对要写的方法做三件事：
1. **读** —— 这方法在 plan 哪个 step？它实现哪条 RXX 规则？签名/返回是什么？
2. **理解** —— 它依赖哪些已实现的东西（依赖 task 里定义的）？它被谁调用？
3. **假设** —— 它怎么被测？测试会断言什么可观察结果？

说不清就停下回 plan 看，别凭印象写。

## Step 3：task 间 Review

每完成一个 task 检查：计划测试命令过了？新增/修改文件跟计划一致？引入计划外变更了吗？下一 task 依赖满足了吗？

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
□ 端点覆盖：architecture 的 API 端点清单，每个都有真实现？（别 60→23）
□ 真实持久化：写 → 查 → 重启后还在？（不是 mock DB）
□ 跨服务链路：事件 producer → queue → consumer → DB 真跑通？（至少关键路径）
□ 0 存根：no-stub-check.sh 零命中？
□ 全量测试 PASS
```

## Step 4：阻塞处理

**遇即暂停，不猜不跳**：计划标"待确认"、文件不存在、行号不匹配、函数签名不一致、测试结果与预期不符、缺未声明依赖、计划外新发现。

**测试结果异常先分析再上报**：

| Expected vs 实际 | 可能原因 | 处理 |
|---|---|---|
| FAIL 但实际 PASS | 断言不够严 / 实现已提前存在 / 测了错函数 | 上报：测试代码缺陷 |
| PASS 但实际 FAIL | 计划代码有 bug / 环境依赖缺 / 依赖 task 破坏了本 task | 上报：附错误日志 |

**禁止自行修根本原因**。分析清楚上报，让计划者定方案。可自行处理的：拼写、行号偏移、import 顺序、commit message 微调。

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
1 次失败 → 重跑仔细点
2 次失败 → 重读 plan 对应 step + 读 references，换实现方式
3 次失败 → 退一步：回 xdd-plan 重规划（RXX 映射错/端点漏/依赖冲突）
4 次失败 → 写失败日志，问用户
```

同一 task 连续 3 试没过 → 不要硬扛，回 plan 层（或更上 design/spec 层）找根因。这是文字纪律（靠你自觉），不是机器强制 —— 但它防的是"在错的层面反复修代码"。

## Step 5：收尾

所有 task 完成后：
1. 跑全量测试套件
2. 检查 RXX 覆盖追踪表：每个 RXX / Scenario 有对应通过的测试？
3. 跑 no-stub-check.sh 全项目扫，零命中
4. 检查 git log：commit 历史跟计划一致，每个 commit message 含 RXX
5. 输出执行报告（计划名 / 状态 / task 完成表 / RXX 覆盖结果 / 全量测试结果 / 提交历史 / 遗留事项）

**收尾测试失败**：识别失败属哪个 task → 判断类型（集成问题 / mock 不匹配 / 环境）→ 不自行修，上报附失败测试名 + 日志 + 估测冲突 task。

## 执行报告

```markdown
## 执行报告
**计划：** plan/{slug}/plan.md
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

## 自检（无平台 hook）

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
□ 没用 mock 假装真实持久化？
□ Docker 服务起来 + healthcheck 过？
```
