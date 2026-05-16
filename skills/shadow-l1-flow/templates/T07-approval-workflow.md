# T07: 审批工作流模板

## 适用场景

- OA 审批：请假、报销、合同审批、采购审批
- 多级审批、条件路由、驳回/撤回/转审
- 审批状态机、催办、超时处理

## 泳道设计（W3H）

| 泳道 | Who | What | Why | How |
|------|-----|------|-----|-----|
| B01 发起与草稿 | Employee | 创建/编辑/提交/撤回审批 | 发起人需要表达审批意图 | HTTP API + 表单 |
| B02 审批引擎 | System | 路由规则、状态流转、超时处理 | 审批必须按规则流转到正确的人 | 规则引擎 + 事件驱动 |
| B03 审批操作 | Approver | 通过/驳回/转审/加签 | 审批人需要做出决策 | HTTP API |
| B04 通知与归档 | System | 状态通知、归档、业务回调 | 审批结果必须通知到所有相关方 | 异步通知 + Webhook |

## 入口分析（W3H）

| 入口 | Who | What | Why | How |
|------|-----|------|-----|-----|
| 发起审批 | Employee | 创建审批单 | 员工需要申请某项授权/资源 | `POST /api/approvals` |
| 审批人操作 | Approver | 处理审批任务 | 审批人需要做出决策 | `POST /api/approval-tasks/:id/:action` |
| 撤回审批 | Employee | 撤回已提交审批 | 发起人发现错误需要修改 | `POST /api/approvals/:id/withdraw` |
| 超时催办 | Cron | 扫描超时审批 | 审批不能无限期挂起 | `cron '0 9 * * 1-5'` |

## Mermaid 图

```mermaid
flowchart TD
    ENTRY_CREATE["👤 员工发起审批<br/>trigger: user<br/>entry: POST /api/approvals<br/>role: Employee"]
    ENTRY_APPROVE["👤 审批人处理任务<br/>trigger: user<br/>entry: POST /api/approval-tasks/:id/:action<br/>role: Approver"]
    ENTRY_WITHDRAW["👤 发起人撤回(修正错误)<br/>trigger: user<br/>entry: POST /api/approvals/:id/withdraw<br/>role: Employee"]
    ENTRY_TIMEOUT["⏰ 审批超时扫描(防止无限挂起)<br/>trigger: cron<br/>entry: cron '0 9 * * 1-5'<br/>role: System"]

    subgraph B01["👤 B01 发起与草稿"]
        %% Why: 发起人需要表达审批意图，表单是意图的载体
        direction TB
        B01-N01["选择审批类型<br/>GET /api/approval-types<br/>read: approval_type<br/>role: Employee"]
        B01-N02["填写审批表单<br/>状态: → S01_DRAFT<br/>role: Employee"]
        B01-N03{"表单校验(确保信息完整)<br/>condition: required fields filled & format valid"}
        B01-N04["保存草稿(暂存意图)<br/>POST /api/approvals<br/>write: approval<br/>状态: S01_DRAFT<br/>role: Employee"]
        B01-N05["提交审批(启动流程)<br/>POST /api/approvals/:id/submit<br/>状态: S01→S02_PENDING<br/>update: approval.status<br/>role: Employee"]
        B01-N06["撤回审批(修正错误)<br/>POST /api/approvals/:id/withdraw<br/>状态: S02→S01_DRAFT<br/>update: approval.status<br/>role: Employee"]
        B01-N07{"是否可撤回(防干扰已处理)<br/>condition: no approver has acted"}
    end

    subgraph B02["⚙️ B02 审批引擎"]
        %% Why: 审批必须按规则流转到正确的人，不能跳过也不能遗漏
        direction TB
        B02-N01["解析审批流程规则(确定审批链)<br/>read: approval_rule<br/>role: System"]
        B02-N02{"判断审批节点类型(路由策略)<br/>condition: rule type"}
        B02-N03["按角色路由审批人<br/>read: user.role, department<br/>role: System"]
        B02-N04["按金额条件路由(大额需更高级审批)<br/>condition: approval.amount > threshold<br/>role: System"]
        B02-N05["指定具体审批人<br/>read: approval.approver_ids<br/>role: System"]
        B02-N06["创建审批任务(分配给审批人)<br/>write: approval_task<br/>状态: S02_PENDING<br/>role: System"]
        B02-N07{"是否还有下一级(多级审批)<br/>condition: current_level < max_level<br/>role: System"]
        B02-N08["超时催办/升级(防止流程阻塞)<br/>update: approval_task.reminder_count<br/>role: System"]
    end

    subgraph B03["✅ B03 审批操作"]
        %% Why: 审批人需要做出决策，决策必须有据可查
        direction TB
        B03-N01["审批人查看待审批列表<br/>GET /api/approval-tasks?status=PENDING<br/>read: approval_task<br/>role: Approver"]
        B03-N02["查看审批详情(了解上下文)<br/>GET /api/approvals/:id<br/>read: approval, approval_task<br/>role: Approver"]
        B03-N03{"审批决策(做出判断)<br/>condition: approver action"}
        B03-N04["通过审批(同意申请)<br/>POST /api/approval-tasks/:id/approve<br/>update: approval_task.status<br/>role: Approver"]
        B03-N05["驳回审批(否决申请)<br/>POST /api/approval-tasks/:id/reject<br/>update: approval_task.status<br/>write: reject_reason<br/>role: Approver"]
        B03-N06["转审给他人(转移审批权)<br/>POST /api/approval-tasks/:id/transfer<br/>write: approval_task.transferred_to<br/>role: Approver"]
        B03-N07["加签(增加审批人)<br/>POST /api/approval-tasks/:id/countersign<br/>write: approval_task<br/>role: Approver"]
    end

    subgraph B04["🔔 B04 通知与归档"]
        %% Why: 审批结果必须通知到所有相关方，归档确保可追溯
        direction TB
        B04-N01["发送审批状态通知(通知相关方)<br/>external: email, sms, push<br/>fallback: retry×2 → log<br/>role: System"]
        B04-N02["审批通过后归档(满足合规追溯)<br/>write: approval_archive<br/>role: System"]
        B04-N03["业务系统回调(触发后续动作)<br/>external: webhook<br/>fallback: retry×3 → dead_letter_queue<br/>role: System"]
        B04-N04["催办通知(推动流程前进)<br/>external: notification<br/>fallback: log<br/>role: System"]
    end

    ENTRY_CREATE --> B01-N01
    B01-N01 --> B01-N02
    B01-N02 --> B01-N03
    B01-N03 -->|"否: 字段不完整"| ERR_FORM["resultNode: 提示补全表单"]
    B01-N03 -->|"是: 校验通过"| B01-N04
    B01-N04 --> B01-N05
    B01-N05 -.->|"event: approval.submitted(启动审批链)"| B02-N01

    ENTRY_WITHDRAW --> B01-N07
    B01-N07 -->|"否: 已有人处理"| ERR_WITHDRAW["resultNode: 不可撤回"]
    B01-N07 -->|"是: 可撤回"| B01-N06
    B01-N06 -.->|"event: approval.withdrawn(通知审批人)"| B04-N01

    B02-N01 --> B02-N02
    B02-N02 -->|"按角色路由"| B02-N03
    B02-N02 -->|"按条件路由"| B02-N04
    B02-N02 -->|"指定审批人"| B02-N05

    B02-N03 --> B02-N06
    B02-N04 --> B02-N06
    B02-N05 --> B02-N06

    B02-N06 -.->|"event: approval_task.created(通知审批人)"| B03-N01
    B02-N06 -.->|"event: approval_task.created(通知相关方)"| B04-N01

    ENTRY_APPROVE --> B03-N01
    B03-N01 --> B03-N02
    B03-N02 --> B03-N03

    B03-N03 -->|"通过"| B03-N04
    B03-N03 -->|"驳回"| B03-N05
    B03-N03 -->|"转审"| B03-N06
    B03-N03 -->|"加签"| B03-N07

    B03-N04 -.->|"event: approval_task.approved(判断是否还有下一级)"| B02-N07
    B03-N05 -.->|"event: approval_task.rejected(通知发起人)"| B04-N01
    B03-N06 -.->|"event: approval_task.transferred(重新分配)"| B02-N06
    B03-N07 -.->|"event: approval_task.countersigned(新增审批人)"| B02-N06

    B02-N07 -->|"是: 有下一级"| B02-N06
    B02-N07 -->|"否: 全部通过"| B04-N02

    ENTRY_TIMEOUT --> B02-N08
    B02-N08 -.->|"event: approval.timeout(催办审批人)"| B04-N04

    B04-N02 --> B04-N03

    RESULT_DRAFT["resultNode: 草稿已保存"]
    RESULT_SUBMITTED["resultNode: 提交成功，等待审批"]
    RESULT_APPROVED["resultNode: 审批通过，已归档"]
    RESULT_REJECTED["resultNode: 审批驳回"]
    RESULT_TRANSFERRED["resultNode: 已转审"]
    RESULT_WITHDRAWN["resultNode: 已撤回，可重新编辑"]

    B01-N04 --> RESULT_DRAFT
    B01-N05 --> RESULT_SUBMITTED
    B04-N02 --> RESULT_APPROVED
    B03-N05 --> RESULT_REJECTED
    B03-N06 --> RESULT_TRANSFERRED
    B01-N06 --> RESULT_WITHDRAWN

    classDef triggerUser fill:#3D2C00,stroke:#FBBF24,color:#FEF3C7,stroke-width:2px
    classDef triggerCron fill:#1A2A3A,stroke:#60A5FA,color:#DBEAFE,stroke-width:2px
    classDef process fill:#172033,stroke:#5AA9E6,color:#E5EDF7,stroke-width:2px
    classDef decision fill:#1A3A2D,stroke:#2E7D32,color:#E8F5E9,stroke-width:2px
    classDef error fill:#4A1D24,stroke:#FB7185,color:#FFE4E6,stroke-width:2px
    classDef resultNode fill:#173E2D,stroke:#34D399,color:#D1FAE5,stroke-width:2px

    class ENTRY_CREATE,ENTRY_APPROVE,ENTRY_WITHDRAW triggerUser
    class ENTRY_TIMEOUT triggerCron
    class B01-N01,B01-N02,B01-N04,B01-N05,B01-N06,B02-N01,B02-N03,B02-N04,B02-N05,B02-N06,B02-N07,B02-N08,B03-N01,B03-N02,B03-N04,B03-N05,B03-N06,B03-N07,B04-N01,B04-N02,B04-N03,B04-N04 process
    class B01-N03,B01-N07,B02-N02,B02-N07,B03-N03 decision
    class ERR_FORM,ERR_WITHDRAW error
    class RESULT_DRAFT,RESULT_SUBMITTED,RESULT_APPROVED,RESULT_REJECTED,RESULT_TRANSFERRED,RESULT_WITHDRAWN resultNode
```

## 状态机

```
S01_DRAFT → S02_PENDING → S03_APPROVED → S04_ARCHIVED
     ↑           ↓
     └── withdraw    reject → S05_REJECTED

Why: DRAFT 允许修正，PENDING 等待决策，APPROVED 归档，REJECTED 终态。
```

## W3H 逐节点速查

| 节点 | Who | What | Why | How |
|------|-----|------|-----|-----|
| B01-N03 | System | 表单校验 | 确保信息完整避免无效提交 | condition: required fields |
| B01-N07 | System | 撤回校验 | 防干扰已处理的审批 | condition: no approver acted |
| B02-N02 | System | 路由策略选择 | 不同场景需不同审批链 | condition: rule type |
| B02-N04 | System | 金额条件路由 | 大额需更高级别审批 | condition: amount > threshold |
| B02-N07 | System | 多级判断 | 确保所有层级都审批 | condition: level < max |
| B02-N08 | System(Cron) | 超时催办 | 防止流程无限期阻塞 | update reminder_count |
| B03-N03 | Approver | 做出决策 | 审批人的核心职责 | approver action |
| B04-N02 | System | 归档 | 满足合规追溯要求 | write archive |
| B04-N03 | System | 业务回调 | 触发后续业务动作 | external webhook + retry |

## 入口与触发矩阵

| 入口节点 | 触发类型 | 进入节点 | 幂等策略 | Why |
|---------|---------|---------|---------|-----|
| ENTRY_CREATE | USER | B01-N01 | 防重复提交 | 发起审批意图 |
| ENTRY_APPROVE | USER | B03-N01 | taskId + status 幂等 | 审批人决策 |
| ENTRY_WITHDRAW | USER | B01-N07 | approvalId + status | 修正错误 |
| ENTRY_TIMEOUT | CRON | B02-N08 | approvalId 去重 | 防止流程阻塞 |

## 审批路由规则示例

| 审批类型 | 条件 | 审批链 | Why |
|---------|------|--------|-----|
| 请假 | ≤ 3 天 | Leader → HR | 短假只需直属上级确认 |
| 请假 | > 3 天 | Leader → 部门经理 → HR | 长假影响部门运转 |
| 报销 | ≤ 5000 | Leader → 财务 | 小额常规审批 |
| 报销 | > 5000 | Leader → 部门经理 → 财务总监 → 财务 | 大额需更高权限 |
| 合同 | 任意 | 法务 → 财务 → 总经理 | 合同风险高，需多层把关 |

## 异常路径清单

| 触发点 | 错误码 | Why | 恢复方式 |
|--------|--------|-----|---------|
| B01-N03 | 400 | 信息不完整无法流转 | 提示补全 |
| B01-N05 | 409 | 草稿状态冲突 | 提示刷新页面 |
| B01-N07 | 409 | 已有人处理，撤回会干扰 | 不可撤回 |
| B03-N04 | 409 | 不是当前审批人 | 提示无权操作 |
| B03-N06 | 400 | 转审目标不存在 | 选择有效审批人 |
| B04-N03 | 502 | 业务回调失败 | 重试 3 次 → 死信队列 |

## 常见变异

| 变异点 | 默认方案 | 替代方案 |
|--------|---------|---------|
| 审批路由 | 固定规则表 | 动态流程引擎（BPMN） |
| 会签 | 串行审批 | 并行会签（所有人通过才算通过） |
| 或签 | 无 | 一人通过即通过（多人中任一） |
| 驳回策略 | 驳回到发起人 | 驳回到上一级 / 驳回到指定节点 |
| 催办 | 定时提醒 | 超时自动升级给上级 |
| 代理审批 | 无 | 审批人可设置代理人 |
| 审批类型 | 硬编码 | 自定义表单 + 自定义流程 |
| 撤回限制 | 有审批人处理过不可撤回 | 任意时刻可撤回 |
