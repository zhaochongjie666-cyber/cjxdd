# T08: 任务分配与跟踪模板

## 适用场景

- 项目管理、工单系统、标注平台
- 任务创建 → 分配 → 执行 → 质检 → 完成
- 任务状态机、优先级、超时处理

## 泳道设计（W3H）

| 泳道 | Who | What | Why | How |
|------|-----|------|-----|-----|
| B01 任务管理 | Manager | 创建/分配/调整任务 | 管理者需要把工作分给合适的人 | HTTP API |
| B02 任务执行 | Worker | 领取/执行/提交任务 | 执行者需要高效完成任务 | HTTP API |
| B03 质检验收 | Reviewer | 审核任务质量 | 确保交付质量达标 | HTTP API |
| B04 通知与统计 | System | 状态通知、绩效统计 | 管理者需了解进度和质量 | 异步通知 + 报表 |

## 入口分析（W3H）

| 入口 | Who | What | Why | How |
|------|-----|------|-----|-----|
| 管理者创建 | Manager | 创建并分配任务 | 工作需要分配到人 | `POST /api/tasks` |
| 执行者执行 | Worker | 领取并执行任务 | 执行者需要完成分配的工作 | `POST /api/tasks/:id/start` |
| 执行者提交 | Worker | 提交完成的任务 | 交付工作成果 | `POST /api/tasks/:id/submit` |
| 质检审核 | Reviewer | 审核提交质量 | 确保质量达标 | `POST /api/tasks/:id/review` |
| 超时扫描 | Cron | 扫描超时任务 | 防止任务无限期挂起 | `cron '0 */1 * * *'` |

## Mermaid 图

```mermaid
flowchart TD
    ENTRY_CREATE["👤 管理者创建任务<br/>trigger: user<br/>entry: POST /api/tasks<br/>role: Manager"]
    ENTRY_START["👤 执行者开始执行<br/>trigger: user<br/>entry: POST /api/tasks/:id/start<br/>role: Worker"]
    ENTRY_SUBMIT["👤 执行者提交成果<br/>trigger: user<br/>entry: POST /api/tasks/:id/submit<br/>role: Worker"]
    ENTRY_REVIEW["👤 质检员审核<br/>trigger: user<br/>entry: POST /api/tasks/:id/review<br/>role: Reviewer"]
    ENTRY_TIMEOUT["⏰ 超时任务扫描(防无限挂起)<br/>trigger: cron<br/>entry: cron '0 */1 * * *'<br/>role: System"]

    subgraph B01["👤 B01 任务管理"]
        %% Why: 工作需要合理分配到合适的人
        direction TB
        B01-N01["创建任务(定义工作内容)<br/>write: task<br/>状态: → S01_CREATED<br/>role: Manager"]
        B01-N02["分配执行者(匹配能力)<br/>update: task.assignee_id<br/>状态: S01→S02_ASSIGNED<br/>role: Manager"]
        B01-N03{"执行者是否有能力<br/>condition: worker.skills match task.required_skills"}
        B01-N04["重新分配(能力不匹配)<br/>update: task.assignee_id<br/>role: Manager"]
        B01-N05["设置截止时间(确保时效)<br/>update: task.deadline<br/>role: Manager"]
    end

    subgraph B02["👤 B02 任务执行"]
        %% Why: 执行者需要高效完成分配的工作
        direction TB
        B02-N01["查看待办任务列表<br/>GET /api/tasks?assignee=me&status=ASSIGNED<br/>read: task<br/>role: Worker"]
        B02-N02["开始执行(锁定任务)<br/>状态: S02→S03_IN_PROGRESS<br/>update: task.status, started_at<br/>lock: task.id<br/>role: Worker"]
        B02-N03["填写执行结果<br/>write: task_result<br/>role: Worker"]
        B02-N04{"结果是否完整(防空提交)<br/>condition: required fields filled"}
        B02-N05["提交任务(交付成果)<br/>状态: S03→S04_SUBMITTED<br/>update: task.status, submitted_at<br/>role: Worker"]
        B02-N06["处理驳回任务(修正问题)<br/>状态: S06_REJECTED→S03_IN_PROGRESS<br/>update: task.status<br/>role: Worker"]
    end

    subgraph B03["✅ B03 质检验收"]
        %% Why: 确保交付质量达标
        direction TB
        B03-N01["查看待质检列表<br/>GET /api/tasks?status=SUBMITTED<br/>read: task, task_result<br/>role: Reviewer"]
        B03-N02["审核执行结果(质量把关)<br/>read: task_result<br/>role: Reviewer"]
        B03-N03{"质检决策(质量判断)<br/>condition: quality score >= threshold"}
        B03-N04["通过验收(合格)<br/>状态: S04→S05_COMPLETED<br/>update: task.status, reviewed_at<br/>role: Reviewer"]
        B03-N05["驳回任务(不合格)<br/>状态: S04→S06_REJECTED<br/>update: task.status<br/>write: reject_reason<br/>role: Reviewer"]
    end

    subgraph B04["🔔 B04 通知与统计"]
        %% Why: 管理者需了解进度和质量
        direction TB
        B04-N01["发送任务状态通知(通知相关方)<br/>external: email, push<br/>fallback: retry×2 → log<br/>role: System"]
        B04-N02["更新执行者绩效统计(衡量表现)<br/>update: worker_stats<br/>role: System"]
        B04-N03["超时告警通知(催促执行)<br/>external: push<br/>fallback: log<br/>role: System"]
    end

    ENTRY_CREATE --> B01-N01
    B01-N01 --> B01-N02
    B01-N02 --> B01-N03
    B01-N03 -->|否| B01-N04
    B01-N03 -->|是| B01-N05
    B01-N04 --> B01-N05
    B01-N05 -.->|"event: task.assigned(通知执行者)"| B04-N01

    ENTRY_START --> B02-N01
    B02-N01 --> B02-N02
    B02-N02 --> B02-N03
    B02-N03 --> B02-N04
    B02-N04 -->|否| B02-N03
    B02-N04 -->|是| B02-N05
    B02-N05 -.->|"event: task.submitted(通知质检)"| B03-N01
    B02-N05 -.->|"event: task.submitted(通知管理者)"| B04-N01

    ENTRY_REVIEW --> B03-N01
    B03-N01 --> B03-N02
    B03-N02 --> B03-N03
    B03-N03 -->|通过| B03-N04
    B03-N03 -->|驳回| B03-N05
    B03-N04 -.->|"event: task.completed(更新统计)"| B04-N02
    B03-N04 -.->|"event: task.completed(通知管理者)"| B04-N01
    B03-N05 -.->|"event: task.rejected(通知执行者)"| B02-N06
    B03-N05 -.->|"event: task.rejected(通知管理者)"| B04-N01

    ENTRY_TIMEOUT --> B04-N03

    RESULT_CREATED["resultNode: 任务已创建并分配"]
    RESULT_SUBMITTED["resultNode: 任务已提交"]
    RESULT_COMPLETED["resultNode: 任务已完成"]
    RESULT_REJECTED["resultNode: 任务被驳回，请修正"]

    B01-N05 --> RESULT_CREATED
    B02-N05 --> RESULT_SUBMITTED
    B03-N04 --> RESULT_COMPLETED
    B03-N05 --> RESULT_REJECTED

    classDef triggerUser fill:#3D2C00,stroke:#FBBF24,color:#FEF3C7,stroke-width:2px
    classDef triggerCron fill:#1A2A3A,stroke:#60A5FA,color:#DBEAFE,stroke-width:2px
    classDef process fill:#172033,stroke:#5AA9E6,color:#E5EDF7,stroke-width:2px
    classDef decision fill:#1A3A2D,stroke:#2E7D32,color:#E8F5E9,stroke-width:2px
    classDef resultNode fill:#173E2D,stroke:#34D399,color:#D1FAE5,stroke-width:2px

    class ENTRY_CREATE,ENTRY_START,ENTRY_SUBMIT,ENTRY_REVIEW triggerUser
    class ENTRY_TIMEOUT triggerCron
    class B01-N01,B01-N02,B01-N04,B01-N05,B02-N01,B02-N02,B02-N03,B02-N05,B02-N06,B03-N01,B03-N02,B03-N04,B03-N05,B04-N01,B04-N02,B04-N03 process
    class B01-N03,B02-N04,B03-N03 decision
    class RESULT_CREATED,RESULT_SUBMITTED,RESULT_COMPLETED,RESULT_REJECTED resultNode
```

## 状态机

```
S01_CREATED → S02_ASSIGNED → S03_IN_PROGRESS → S04_SUBMITTED → S05_COMPLETED
                                    ↑                  ↓
                                    └── S06_REJECTED ←─┘
```

## 异常路径清单

| 触发点 | 错误码 | Why | 恢复方式 |
|--------|--------|-----|---------|
| B01-N03 | 400 | 执行者技能不匹配 | 重新分配 |
| B02-N04 | 400 | 提交内容不完整 | 返回要求补充 |
| B03-N03 | 400 | 质检未通过 | 驳回附原因 |
| B04-N01 | 502 | 通知发送失败 | retry×2 → log |
| B04-N03 | 200 | 任务超时告警 | 通知催促执行 |

## 常见变异

| 变异点 | 默认方案 | 替代方案 |
|--------|---------|---------|
| 分配方式 | 指定执行者 | 抢占式（先到先得）/ 自动分配 |
| 质检 | 全量质检 | 抽检（按比例）/ 免检（信任度高） |
| 优先级 | 固定 | 动态优先级（FIFO + 紧急插队） |
| 多人协作 | 单人执行 | 多人执行（拆分子任务） |
| 批次管理 | 无 | 按批次创建/分配/质检 |
| 结算 | 无 | 按完成量和质量结算报酬 |
