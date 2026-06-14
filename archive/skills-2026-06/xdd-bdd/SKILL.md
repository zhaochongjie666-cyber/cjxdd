---
name: xdd-bdd
description: |
  基于 Gherkin 语法生成全栈业务蓝图（BDD）+ 业务线 landscape (吃掉旧 xdd-business 目录, v2.0)。
  与 ADD / project.flow.mermaid 互补, 专注于业务意图、领域规则、产物状态、前后端可观察断言与异常路径, 不描述内部架构战术。
  产出 _landscape.md (业务线全景) + {slug}/business.md (业务线分组) + {slug}/spec.md (规则) + {slug}/*.feature (场景).
  触发: bdd, Gherkin, feature, 验收, 业务规则, 业务线 landscape, business-landscape, BXX, 业务线分组.
version: "2.0.0"
changelog:
  - "2.0.0 (2026-06-09): 吃掉 xdd-business 目录, business-landscape 工件迁入 bdd/_landscape.md, 每个业务线增加 bdd/{slug}/business.md."
---

# xdd-bdd — Behavior Driven Development Skill

## 使用场景

当用户要求编写、优化、审阅或补全 BDD / Gherkin / Feature / 业务蓝图 / 验收场景时，使用本 skill。

BDD 的目标是描述"业务在什么上下文下应该表现成什么样"，用于产品验收、测试设计、自动化 Step 定义和跨端协作。

BDD 不负责解释系统如何实现。实现细节、启动关闭序列、线程模型、资源租约、重试策略、健康检查等内容应进入 ADD，而不是 BDD。

## 输入对齐要求

生成 BDD 前，优先对齐以下来源：

1. `.xdd/bdd`
   - 业务术语
   - 角色
   - 领域状态
   - 产物类型
   - 错误原因
   - 验收口径

2. `project.flow.mermaid`
   - 组件名称
   - 外部系统名称
   - 产物流向
   - 前后端边界

3. 当前代码或用户提供材料
   - API 名称
   - 状态枚举
   - 数据字段
   - 错误码
   - 存储对象
   - 页面 / 工作台名称

所有状态名、产物名、角色名、错误原因、任务类型必须与以上来源保持一致。未知内容标注为"待确认"，不要编造。

## BDD 与 ADD 边界

BDD 可以写：

- 用户目标
- 业务前置条件
- 领域状态变化
- 前端可见结果
- 后端可观察结果
- 数据或产物是否存在
- 错误码、错误提示、拒绝原因
- 通知、权限、审计等业务可见结果

BDD 不应写：

- 启动序列
- 关闭序列
- 线程池、协程、后台循环
- 分布式锁、CAS、lease、TTL
- 重试退避算法
- 健康检查
- 容器调度细节
- 数据库事务实现
- 服务内部类名和函数调用链

如果必须提到后端行为，只写可观察结果，不解释内部实现。

## 核心编写规范

1. 禁止程序式 UI 流水账

   不允许写：
   - 点击某按钮
   - 输入某文本
   - 打开某下拉框
   - 勾选某复选框

   应改为业务意图：
   - 用户选择对比任务
   - 用户提交回灌任务
   - 用户筛选失败 Case
   - 用户确认发布候选版本

2. 单个 Scenario 只验证一个业务规则

   一个 Scenario 不要同时验证创建、调度、指标计算、下载、通知、权限。长链路必须按业务阶段或产物类型拆分。

3. 步骤数量控制

   单个 Scenario 建议 5-8 行。超过 8 行时，优先拆成多个 Scenario 或 Scenario Outline。

4. 多类型 / 多状态 / 多模型必须数据驱动

   涉及平行路径时，必须使用 `Scenario Outline + Examples`，例如：
   - LLD / TSR / MOD / CAR
   - 成功 / 失败 / 处理中 / 已取消
   - 普通回灌 / GT 回灌 / 断言回灌
   - 基线版本 / 候选版本

5. Then/And 必须是可观察断言

   禁止写"系统应自动处理""系统应完成适配""系统正常运行"这类不可测试描述。

   推荐写法：
   - 前端应展示 [具体字段 / 状态 / 提示]
   - 后端应写入 [对象]，其 [字段] 为 [值]
   - 存储中应存在 [路径 / 产物]，并关联 [业务 ID]
   - 系统应拒绝该操作，并返回 [错误码 / 错误原因]
   - 不应创建重复的 [任务 / 记录 / 产物]

6. 前后端边界必须明确

   当场景涉及全栈验收时，Then / And 应明确区分：
   - 前端应展示什么
   - 后端应保存什么
   - 存储应存在什么
   - 通知应发送给谁
   - 审计应记录什么

7. 必须覆盖异常路径

   每个 Feature 至少包含一个异常或不可执行路径，例如：
   - 上游产物未完成
   - 输入数据缺失
   - 任务类型不匹配
   - 用户无权限
   - 重复提交
   - 产物不存在
   - 版本不可比
   - 部分 Case 失败

8. 幂等与重复提交要业务化表达

   不描述 CAS、锁或事务。应写成：
   - 不应创建重复任务
   - 应返回已存在任务
   - 原任务状态不应被覆盖
   - 用户应看到重复提交提示

## 标准输出模板

```gherkin
Feature: [业务能力名称] — [核心业务价值]

  Background: [共享业务前置条件]
    Given [角色 / 系统处于某业务上下文]
      And [上游数据 / 产物 / 权限已经满足]

  Scenario: [单一业务规则]
    Given [业务前置条件]
    When [用户或外部系统发起业务意图]
    Then 前端应[展示具体状态 / 字段 / 提示]
      And 后端应[保存具体对象及字段状态]
      And [存储 / 通知 / 审计]应[出现可验证结果]

  Scenario Outline: [多类型业务规则] - <case_type>
    Given 业务类型为 "<case_type>"
      And [共享前置条件]
    When [执行业务意图]
    Then 前端应展示 "<expected_ui_state>"
      And 后端应记录 "<expected_backend_state>"
      And 系统应返回 "<expected_result>"

    Examples:
      | case_type | expected_ui_state | expected_backend_state | expected_result |
      | 类型 A    | 状态 A             | 后端状态 A              | 结果 A          |
      | 类型 B    | 状态 B             | 后端状态 B              | 结果 B          |

  Scenario: [异常路径] - [不可执行原因]
    Given [缺失 / 冲突 / 无权限 / 上游未完成的业务上下文]
    When [用户或外部系统发起业务意图]
    Then 系统应拒绝该操作，并返回 "[错误原因]"
      And 不应创建新的[任务 / 记录 / 产物]
      And 前端应展示 "[可操作提示]"
```

## 推荐场景拆分方式

按业务阶段拆：

- 创建 / 提交
- 校验 / 准入
- 执行 / 消费
- 结果展示
- 对比 / 分析
- 导出 / 下载
- 通知 / 审计
- 异常 / 拒绝

按产物类型拆：

- 数据集
- 图片
- 视频 / 帧
- 指标结果
- Badcase
- 报告
- 模型版本
- 真值 / 标定数据

按角色拆：

- 普通用户
- 审核用户
- 管理员
- 外部系统
- 定时任务

## Then 断言句式规范

### 推荐

```gherkin
Then 前端应展示任务状态为 "PENDING"
  And 后端应创建一条 sil_job 记录，其 dataset_type 为 "normal"
  And 后端应为每个 Case 创建一条 sil_task 记录
  And 不应创建重复的 sil_task
```

```gherkin
Then 系统应拒绝该操作，并返回 "模型版本不一致"
  And 前端应展示不可对比提示
  And 后端不应触发新的差异分析任务
```

```gherkin
Then 指标结果应包含 Case ID、指标类型、分数与 Badcase 标记
  And 后端应将该结果关联到对应任务
  And 前端应在结果表中展示 Badcase 筛选入口
```

### 禁止

```gherkin
Then 系统应自动完成处理
Then 系统应完成路径兼容与结构归一化处理
Then 系统应保证高性能
Then 后端应执行异步任务
Then 数据库事务应提交成功
Then 系统应调用某个内部函数
```

## Scenario Outline 使用规则

当输入维度决定期望结果时，使用 `Scenario Outline`。

适合：

```gherkin
Scenario Outline: 不同回灌任务类型的创建准入 - <dataset_type>
  Given dataset_type 为 "<dataset_type>"
    And 上游产物状态为 "<upstream_state>"
  When 用户提交回灌任务
  Then 系统应返回 "<expected_result>"
    And 后端任务类型应为 "<job_type>"
    And 前端应展示 "<ui_message>"

  Examples:
    | dataset_type  | upstream_state | job_type      | expected_result | ui_message |
    | normal        | ready          | normal        | 创建成功         | 任务已进入队列 |
    | gt_mod        | ready          | gt_obstacle   | 创建成功         | 任务已进入队列 |
    | assert_tsr    | missing_pack   | assert_tsr    | 创建失败         | TSR pack 缺失 |
```

不适合：

- 只是为了减少文字而把无关业务塞进同一个 Examples
- Examples 列太多，导致场景不可读
- 每一行代表完全不同的业务链路

## 异常路径覆盖要求

每个 Feature 至少包含一个异常 Scenario。复杂 Feature 应覆盖以下类型中的至少两类：

| 异常类型 | 推荐断言 |
|---|---|
| 数据缺失 | 返回缺失字段 / 缺失产物提示，不创建任务 |
| 状态不允许 | 返回当前状态不可操作，原状态不变 |
| 权限不足 | 返回无权限提示，不暴露敏感数据 |
| 类型不匹配 | 返回类型不兼容，不触发下游处理 |
| 重复提交 | 返回已存在任务或重复提交提示，不创建重复记录 |
| 部分失败 | 标记失败项，成功项保持可见且可追踪 |
| 上游未完成 | 返回等待上游完成，不进入执行态 |

## 全栈断言边界

当场景涉及前后端协作时，优先使用以下顺序：

```gherkin
Then 前端应[展示用户可见结果]
  And 后端应[保存领域对象与字段状态]
  And 存储应[存在或不存在指定产物]
  And 通知应[发送或不发送给指定角色]
  And 审计应[记录操作者、对象和结果]
```

不是所有场景都必须包含全部层级。只写业务验收需要观察的层级。

## 输出质量门禁

生成 BDD 后，自检以下问题：

- 是否没有 UI 点击流水账？
- 是否每个 Scenario 只验证一个业务规则或一个产物路径？
- 是否每个 Scenario 控制在 5-8 行左右？
- Then/And 是否是可观察断言？
- 是否避免了"系统应自动处理"这类不可测试描述？
- 是否至少包含一个异常或不可执行路径？
- 多类型、多状态、多模型是否使用 `Scenario Outline + Examples`？
- Examples 是否只包含影响期望结果的字段？
- 是否明确区分前端展示与后端可观察状态？
- 是否避免把 ADD 内容写进 BDD？
- 状态名、产物名、角色名、错误原因是否与 `.xdd/bdd`、`project.flow.mermaid` 或代码枚举一致？
- 未知内容是否标注为"待确认"，而不是编造？

## 输出路径与产出物 (v2.0)

> **v2.0.0 合并自 `xdd-business`**: 业务线 landscape 不再是独立目录, 全部住进 `bdd/`. 9→6 目录合并的一部分.

### 目录结构

```
.xdd/baseline/bdd/
├── _landscape.md           ← 业务线全景 (旧 business/business-landscape.md)
└── {slug}/                 ← 每个业务线一个目录, slug 跟 BXX-id 对应
    ├── business.md         ← 业务线分组 (旧 business/{slug}.md): 目标 / 关键问题 / 范围 / 关联
    ├── spec.md             ← RXX 规则列表
    ├── *.feature           ← Gherkin 验收场景, 一条 RXX 一个 feature 文件
    └── ...
```

### `_landscape.md` 模板 (全局业务线索引)

```markdown
# 业务线 Landscape

> 项目业务线全景 — 跨业务线主题 + 每条业务线 1 句话定位.

## 业务线清单

| BXX | slug | 名称 | 定位 (1 句话) | 关联文件 |
|-----|------|------|--------------|---------|
| B01 | auth | 鉴权 | 用户登录注册 + 鉴权 + 权限 | bdd/auth/ |
| B02 | order | 订单 | 下单 / 支付 / 履约 | bdd/order/ |

## 跨业务线主题 (可选)

- 多租户隔离: 所有业务线必须按 tenant_id 隔离
- 国际化: 所有 BXX 错误码必须支持 i18n
```

### `{slug}/business.md` 模板 (业务线分组)

```markdown
# B01 鉴权 (auth)

> 业务线说明 — 目标 + 关键问题 + 范围.

## 业务目标

- 用户能注册 / 登录 / 退出
- 鉴权策略 (JWT / 会话) 在所有受保护 API 生效

## 关键问题

1. 密码策略 (强度 / 重置)?
2. 多端登录互踢?
3. OAuth2 第三方集成?

## 范围

- in-scope: 邮箱密码登录、JWT 鉴权、密码重置邮件
- out-of-scope: 短信验证、OAuth2 (留 iter-2)

## 关联

- RXX 规则: R01, R02, R03 (见 bdd/auth/spec.md)
- Arch 设计 (含运维视图): baseline/arch/auth/architecture.md
- Resilience: baseline/resilience/auth/failure-modes.md
- 前端线框: baseline/wire/login/ + baseline/wire/register/
- 流程图: baseline/flow/auth.mermaid
```

### 一致性约束 (跟 arch / wire / resilience 对齐)

- `_landscape.md` 业务线清单 **必须等于** `arch/aggregate-landscape.md` 业务线分组 (聚合根按业务线归).
- `{slug}/business.md` 的 RXX 列表 **必须等于** `{slug}/spec.md` 实际定义的规则编号.
- 每条 RXX 至少有 1 个 `*.feature` 文件覆盖 (空规则 = 漏验收).
- 不允许 business.md 提及未在 `_landscape.md` 中注册的业务线.
