# T03: 多步骤表单模板

## 适用场景

- 注册向导、问卷填写、申请流程
- 多步骤表单：信息收集 → 校验 → 提交
- 步骤间数据暂存、前进/后退、草稿恢复

## 泳道设计（W3H）

| 泳道 | Who | What | Why | How |
|------|-----|------|-----|-----|
| B01 表单收集 | User | 多步骤数据录入 | 用户需要分步提供信息降低认知负担 | HTTP API + 前端向导 |
| B02 校验与持久化 | System | 数据校验、去重、保存 | 确保数据完整正确后持久化 | 服务端校验 + DB |
| B03 后续处理 | System | 通知、关联业务触发 | 提交后需要触发后续流程 | 异步事件 |

## 入口分析（W3H）

| 入口 | Who | What | Why | How |
|------|-----|------|-----|-----|
| 用户填写 | User | 进入表单向导 | 用户需要提交信息 | `GET /api/form/:type` |
| 草稿恢复 | User | 恢复上次未完成的填写 | 用户可能中断后回来 | `GET /api/form/:id/draft` |
| 自动保存 | User(前端定时) | 定期保存用户进度 | 防止用户丢失已填数据 | `PUT /api/forms/:id/autosave` |

## Mermaid 图

```mermaid
flowchart TD
    ENTRY_NEW["👤 用户开始填写表单<br/>trigger: user<br/>entry: GET /api/forms/:type/new<br/>role: User"]
    ENTRY_DRAFT["👤 用户恢复草稿(避免重新填写)<br/>trigger: user<br/>entry: GET /api/forms/:id/draft<br/>role: User"]
    ENTRY_AUTOSAVE["👤 自动保存(防数据丢失)<br/>trigger: user<br/>entry: PUT /api/forms/:id/autosave<br/>role: User"]

    subgraph B01["👤 B01 表单收集"]
        %% Why: 分步收集降低用户认知负担
        direction TB
        B01-N01["加载步骤1表单<br/>GET /api/form-schema/step1<br/>read: form_schema<br/>role: User"]
        B01-N02["用户填写步骤1<br/>write: form_data.step1<br/>role: User"]
        B01-N03{"步骤1校验(即时反馈)<br/>condition: required fields & format valid"}
        B01-N04["保存步骤1数据(暂存)<br/>PUT /api/forms/:id/step1<br/>update: form_data<br/>role: User"]
        B01-N05["加载步骤N表单<br/>GET /api/form-schema/stepN<br/>read: form_schema<br/>role: User"]
        B01-N06["用户填写步骤N<br/>write: form_data.stepN<br/>role: User"]
        B01-N07{"步骤N校验<br/>condition: step fields valid & cross-step consistency"}
        B01-N08["用户确认提交(最终确认)<br/>POST /api/forms/:id/submit<br/>role: User"]
    end

    subgraph B02["⚙️ B02 校验与持久化"]
        %% Why: 确保数据完整正确后才持久化
        direction TB
        B02-N01["全表单校验(完整性检查)<br/>condition: all steps valid & no conflict<br/>role: System"]
        B02-N02{"是否有重复提交(防重复)<br/>condition: idempotency_key unique"}
        B02-N03["持久化表单数据<br/>write: form_submission<br/>状态: → S01_SUBMITTED<br/>role: System"]
        B02-N04["清除草稿(已完成)<br/>delete: form_draft<br/>role: System"]
    end

    subgraph B03["🔔 B03 后续处理"]
        %% Why: 提交后需要触发后续业务流程
        direction TB
        B03-N01["发送提交确认通知(告知用户)<br/>external: email, sms<br/>fallback: retry×2 → log<br/>role: System"]
        B03-N02["触发关联业务(启动下游)<br/>external: webhook<br/>fallback: retry×3 → dead_letter_queue<br/>role: System"]
    end

    ENTRY_NEW --> B01-N01
    ENTRY_DRAFT --> B01-N05
    ENTRY_AUTOSAVE --> B01-N04

    B01-N01 --> B01-N02
    B01-N02 --> B01-N03
    B01-N03 -->|否| B01-N02
    B01-N03 -->|是| B01-N04
    B01-N04 --> B01-N05
    B01-N05 --> B01-N06
    B01-N06 --> B01-N07
    B01-N07 -->|否| B01-N06
    B01-N07 -->|是| B01-N08

    B01-N08 --> B02-N01
    B02-N01 --> B02-N02
    B02-N02 -->|"是: 重复提交"| RESULT_DUPLICATE["resultNode: 请勿重复提交"]
    B02-N02 -->|"否: 首次提交"| B02-N03
    B02-N03 --> B02-N04
    B02-N03 -.->|"event: form.submitted(通知用户)"| B03-N01
    B02-N03 -.->|"event: form.submitted(触发下游)"| B03-N02

    RESULT_DRAFT["resultNode: 草稿已保存"]
    RESULT_SUBMITTED["resultNode: 提交成功"]
    ERR_STEP["resultNode: 当前步骤校验失败"]

    B01-N04 --> RESULT_DRAFT
    B02-N03 --> RESULT_SUBMITTED

    classDef triggerUser fill:#3D2C00,stroke:#FBBF24,color:#FEF3C7,stroke-width:2px
    classDef process fill:#172033,stroke:#5AA9E6,color:#E5EDF7,stroke-width:2px
    classDef decision fill:#1A3A2D,stroke:#2E7D32,color:#E8F5E9,stroke-width:2px
    classDef error fill:#4A1D24,stroke:#FB7185,color:#FFE4E6,stroke-width:2px
    classDef resultNode fill:#173E2D,stroke:#34D399,color:#D1FAE5,stroke-width:2px

    class ENTRY_NEW,ENTRY_DRAFT,ENTRY_AUTOSAVE triggerUser
    class B01-N01,B01-N02,B01-N04,B01-N05,B01-N06,B01-N08,B02-N03,B02-N04,B03-N01,B03-N02 process
    class B01-N03,B01-N07,B02-N01,B02-N02 decision
    class RESULT_DUPLICATE resultNode
    class RESULT_DRAFT,RESULT_SUBMITTED resultNode
```

## 异常路径清单

| 触发点 | 错误码 | Why | 恢复方式 |
|--------|--------|-----|---------|
| B01-N03 | 400 | 步骤1校验失败 | 前端即时反馈 |
| B01-N07 | 400 | 步骤N校验失败 | 前端即时反馈 |
| B02-N02 | 409 | 重复提交 | 返回提示 |
| B03-N01 | 502 | 邮件/短信发送失败 | retry×2 → log |
| B03-N02 | 502 | Webhook 触发失败 | retry×3 → dead_letter_queue |
| B01-N04 | 500 | 自动保存失败 | 前端本地暂存 |

## 常见变异

| 变异点 | 默认方案 | 替代方案 |
|--------|---------|---------|
| 步骤间暂存 | 服务端 session | 前端 localStorage |
| 校验时机 | 每步即时校验 | 最终统一校验 |
| 草稿存储 | DB 持久化 | Redis（TTL 自动过期） |
| 步骤跳转 | 严格顺序 | 允许跳步（自由导航） |
| 并发填写 | 无 | 多人协作（WebSocket 同步） |
| 表单模式 | 固定步骤 | 动态步骤（条件分支决定下一步） |
