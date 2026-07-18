---
name: xdd-blind-journey
description: |
  xdd 验证层 -- 盲测用户验收。黑盒验证真实角色能否通过产品界面完成工作。
  Actor/Judge 两阶段隔离：Actor 只知身份+目标（剥离 Then），通过浏览器真实操作；Judge 读完整 Feature + 证据判验收。
  不验证代码漂亮，只验证真实用户能不能用。不读代码/DOM/API/DB/日志，只看用户能看到的。
  触发：盲测、blind journey、黑盒验收、用户体验验收、Actor/Judge、真实用户能不能用、验收能力、journey、角色模拟验收。
---

# xdd-blind-journey - 盲测用户验收

## 我锚定什么 / 上游 / 下游

**我证明真实用户能用** -- 不是"测试通过"，是"具备特定身份和业务知识的真实用户，能理解并完成任务"。

| | |
|---|---|
| **上游** | `xdd-spec`（.feature Gherkin 场景）+ `xdd-wire`（页面线框）+ 已部署的可访问环境 |
| **我产出** | Blind Journey 报告（旅途记录 + Feature 验证 + 体验问题 + 覆盖报告）|
| **回溯锚** | 每个场景对照 spec 的 .feature Then 步骤，验证用户可见结果是否符合预期 |

## 核心原则

**可信度来自隔离，不是提示词。**

真正的防作弊必须依靠：
- Actor 不提前看到 Then（不知道预期结果）
- 只用浏览器可见内容操作（不读代码/DOM/API/DB）
- 每步留证据（截图/观察记录）
- Judge 独立判断（读完整 Feature + Actor 证据）

仅在提示词里写"不要看代码"，但仍给 Agent 提供代码搜索、Shell、DOM 工具，不构成真正盲测。

## 两阶段隔离架构

### Phase 1: Journey Actor（盲操作）

Actor 模拟真实用户。它只能读取：
- 角色定义（身份、权限、业务目标、未知知识）
- 当前处境（从 Feature 的 Given 步骤转换）
- 用户目标（从 Feature 的 When 步骤转换）
- 产品入口地址
- 登录凭据（运行时注入，不写入报告）

它**不能**读取：
- Then 验收结果（**关键**：防止目标导向作弊）
- 技术架构 / API 文档 / 数据库结构
- 源代码 / 测试代码
- 其他 Agent 的执行记录

**用 `xdd_blind_journey` 工具 action="prepare_actor" 生成 Actor 提示词。** 工具会自动剥离 Then 步骤。

### Phase 2: Acceptance Judge（裁判）

Judge 在 Actor 执行结束后运行。它可以读取：
- 完整 Feature（含 Then）
- Actor 的操作轨迹和证据

它负责判断：
- Feature 是否通过
- 用户是否真正完成了目标
- 是否存在"错误成功"（显示成功但实际未完成）
- 是否存在体验阻碍
- 证据是否足够

**用 `xdd_blind_journey` 工具 action="prepare_judge" 生成 Judge 提示词。**

## 怎么做

### 1. 定义角色

在 `.xdd/runs/xdd_run/blind-journey/roles/` 下为每个角色创建定义文件：

```yaml
# roles/project_admin.yaml
role_id: project_admin
name: 项目管理员
business_goal:
  - 保证项目任务按时完成
  - 调整项目成员和任务分工
permissions:
  - 查看当前项目
  - 管理当前项目成员
  - 分配当前项目任务
prohibited_permissions:
  - 管理其他项目
  - 查看其他客户数据
domain_knowledge:
  - 理解项目、任务、标注员等业务术语
  - 知道任务可以被分配给项目成员
unknown_knowledge:
  - 不知道数据库字段
  - 不知道接口地址
  - 不知道页面具体入口
behavior:
  patience: medium
  technical_experience: low
  product_experience: normal
device:
  type: desktop
  viewport: 1440x900
  locale: zh-CN
```

**角色定义描述的是用户真实拥有的知识，不是产品操作手册。** 错误示例：

```yaml
# 错误！这泄露了操作路径
domain_knowledge:
  - 点击左侧"任务管理"
  - 点击右上角"分配任务"
```

### 2. 识别验收场景

从 `.xdd/design/spec/**/*.feature` 中识别需要盲测的场景。优先选择：
- 核心业务路径（主用户的 Given/When/Then）
- 权限边界场景（越权被拒）
- 状态转换场景（关键状态变化）
- 每个角色至少 1 个场景

### 3. 执行 Actor 阶段

```
xdd_blind_journey(action="prepare_actor", featurePath="...", scenarioId="AC-01", roleId="project_admin", roleDef="...", entryUrl="https://preview.example.com")
```

工具返回 Actor 提示词（不含 Then）。按提示词执行：
1. 打开产品入口
2. 判断当前页面（ORIENT）
3. 规划下一步用户动作（PLAN）
4. 执行浏览器操作（ACT）
5. 观察页面变化（OBSERVE）
6. 循环直到目标完成/无法继续/预算耗尽

**每步记录**：操作前（页面表达什么/下一步做什么/为什么）+ 操作后（页面变化/系统反馈/是否接近目标/困惑或错误）。

### 4. 执行 Judge 阶段

```
xdd_blind_journey(action="prepare_judge", featurePath="...", scenarioId="AC-01", journeyReportPath="...")
```

工具返回 Judge 提示词（含完整 Feature）。按提示词：
1. 读取 Actor 的旅途报告
2. 逐条验证 Feature 的每个 Then
3. 判断验收结果
4. 记录体验问题

### 5. 记录结果

```
xdd_blind_journey(action="record", scenarioId="AC-01", roleId="project_admin", verdict="PASS", confidence="High", issues=[...], evidencePaths=[...], reportPath="...")
```

### 6. 生成覆盖报告

```
xdd_blind_journey(action="coverage")
```

工具生成 `.xdd/runs/xdd_run/blind-journey/coverage-report.md`，含每个角色的场景覆盖矩阵和总体结论。

## 验收结果（只能选一个）

| 结果 | 含义 |
|---|---|
| **PASS** | 用户通过正常入口完成目标，所有 Feature 断言均有可见证据 |
| **PASS_WITH_FRICTION** | 业务目标完成，但存在明显体验障碍（入口难发现/反馈模糊/需多次尝试） |
| **FAIL** | 系统行为与 Feature 明确冲突（越权/状态错/数据错/假成功） |
| **BLOCKED** | 用户在正常操作范围内无法继续（无法登录/页面持续加载/入口不存在） |
| **INCONCLUSIVE** | 证据不足，无法确认通过或失败 |

**BLOCKED 和 INCONCLUSIVE 都不能作为通过处理。**

## 体验问题等级

| 等级 | 含义 | 处理 |
|---|---|---|
| **P0** | 安全或数据隔离问题（越权/跨项目泄露/敏感信息暴露） | 直接阻止发布 |
| **P1** | 核心旅途无法完成（角色无法完成主要任务/操作导致数据丢失/假成功） | 直接阻止发布 |
| **P2** | 可以完成但有严重阻碍（入口极难发现/错误提示无指导/需多次尝试） | 默认阻止，允许豁免 |
| **P3** | 一般体验问题（文案不一致/反馈延迟/布局易误解） | 不阻止，进待办 |
| **P4** | 建议（不影响任务完成的优化） | 不阻止 |

## 操作规则（Actor 必须遵守）

### 允许的浏览器操作

open / navigate / screenshot / click / double_click / type / keypress / scroll / hover / wait / back / forward / refresh / upload_user_file / download_user_visible_file

操作目标来自：页面截图、可见文字、可访问性名称、用户可见标签。

### 禁止的能力

- 读取源代码 / 搜索 Git 仓库 / 执行 Shell
- 读取 DOM / CSS Selector / XPath / data-testid
- 查看网络请求 / 浏览器 Console / 执行 JavaScript
- 读取 localStorage / sessionStorage / Cookie 内容
- 直接调用产品 API / 读取数据库
- 读取服务端日志 / Trace
- 访问架构文档 / API Contract
- 向 Coding Agent 询问操作方法

## 预算限制

每个 Journey 的预算：
- max_actions: 40
- max_wrong_turns: 5
- max_retries_per_action: 2
- max_same_page_cycles: 3
- max_duration_seconds: 600

触发预算后，结果标记为 BLOCKED 或 INCONCLUSIVE（不是 PASS）。

**"没有发现失败"不等于"通过"。**

## 角色隔离

每个角色独立运行，不能共享：
- Agent Session
- Browser Profile / Cookie Storage
- Credential Context
- Journey Report

后运行的角色不能从先运行的角色获取页面入口和系统行为。

## 产出

```
.xdd/runs/xdd_run/blind-journey/
  ├── roles/                          # 角色定义
  │   ├── project_admin.yaml
  │   └── annotator.yaml
  ├── journeys/                       # Actor 旅途报告（每角色每场景一个）
  │   ├── project_admin_AC-01.md
  │   └── project_admin_AC-01-judge.md  # Judge 验收报告
  ├── results.json                    # 结构化结果（Gate 检查用）
  └── coverage-report.md              # 角色覆盖汇总
```

### Journey 报告格式

```markdown
# Blind Journey Experience Report
## 基本信息
- Feature / Scenario / Role / Device / Locale / Started At / Finished At
## 最终结论
- Result: PASS_WITH_FRICTION
- Severity: P2
- Confidence: High
## 用户目标
将 TASK-1024 分配给小王。
## 实际旅途
1. 从工作台进入任务页面。
2. 打开待分配任务列表。
3. 搜索 TASK-1024。
...
## Feature 验证
| 验收条件 | 观察结果 | 证据 | 结论 |
|---|---|---|---|
| 状态变为进行中 | 页面状态显示"进行中" | screenshot-09 | 通过 |
| 负责人为小王 | 负责人列显示小王 | screenshot-09 | 通过 |
## 体验问题
### UX-001: 任务详情中无法找到分配入口
- 等级: P2
- 发生位置: 任务详情页
- 用户预期: 任务负责人应能在任务详情中管理
- 实际表现: 详情页只展示负责人，没有修改入口
- 用户影响: 用户需要返回列表并打开隐藏菜单
- 证据: screenshot-05、screenshot-06
## 未确认事项
无法通过当前角色可见页面确认是否产生审计记录。
## 证据索引
- screenshot-01: 首页
- screenshot-09: 最终状态
```

## 自检

```
□ 每个角色有独立定义（不是"管理员""普通用户"敷衍）？
□ 角色定义不含操作路径泄露（没有"点击XX按钮"）？
□ Actor 提示词不含 Then 步骤（用 xdd_blind_journey prepare_actor 验证）？
□ Actor 没有使用代码/DOM/API/DB/日志工具？
□ 每步操作有前记录（页面表达/下一步/为什么）和后记录（变化/反馈/接近目标/困惑）？
□ Judge 读取了完整 Feature + Actor 证据？
□ 每个 Then 有可见证据对照（不是"应该成功"推断）？
□ BLOCKED/INCONCLUSIVE 给了具体原因（不是笼统"无法完成"）？
□ PASS_WITH_FRICTION 列了具体体验问题（P2/P3/P4）？
□ 覆盖报告列了所有角色的场景矩阵？
□ 每个角色使用独立浏览器会话（不共享 Cookie/状态）？
□ 证据文件（截图）真实存在且被报告引用？
□ 预算限制被遵守（没有超 40 步/600 秒）？
□ 纯后端项目跳过本 skill（无 UI 不做盲测）？
```
