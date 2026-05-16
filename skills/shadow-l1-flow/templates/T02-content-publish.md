# T02: 内容发布流程模板

## 适用场景

- CMS 内容管理：博客、文章、新闻、文档
- 内容创建 → 审核 → 发布 → 下架全生命周期
- 多角色协作：创作者、编辑、审核员

## 泳道设计（W3H）

| 泳道 | Who | What | Why | How |
|------|-----|------|-----|-----|
| B01 创作者 | Author | 创建/编辑/提交内容 | 创作者需要表达内容意图 | HTTP API + 富文本编辑器 |
| B02 内容管理 | Editor, System | 审核、状态流转、定时发布 | 内容必须经过审核才能对外展示 | 状态机 + 定时调度 |
| B03 发布与分发 | System | 渲染、CDN 分发、SEO | 内容需要高性能、广覆盖地触达读者 | CDN + SSG/SSR |
| B04 通知与统计 | System | 状态通知、阅读统计 | 创作者需要了解内容表现 | 异步通知 + 埋点 |

## 入口分析（W3H）

| 入口 | Who | What | Why | How |
|------|-----|------|-----|-----|
| 创作者提交 | Author | 创建/编辑内容 | 创作者表达意图 | `POST /api/articles` |
| 编辑审核 | Editor | 通过/驳回内容 | 确保内容质量 | `POST /api/articles/:id/review` |
| 定时发布 | Cron | 到期内容自动发布 | 内容按计划时间上线 | `cron '*/1 * * * *'` |
| 创作者下架 | Author | 撤回已发布内容 | 内容过时或有误需撤回 | `POST /api/articles/:id/unpublish` |

## Mermaid 图

```mermaid
flowchart TD
    ENTRY_CREATE["👤 创作者创建/编辑内容<br/>trigger: user<br/>entry: POST /api/articles<br/>role: Author"]
    ENTRY_REVIEW["👤 编辑审核内容<br/>trigger: user<br/>entry: POST /api/articles/:id/review<br/>role: Editor"]
    ENTRY_SCHEDULE["⏰ 定时发布扫描(按计划上线)<br/>trigger: cron<br/>entry: cron '*/1 * * * *'<br/>role: System"]
    ENTRY_UNPUBLISH["👤 创作者下架内容(内容有误或过时)<br/>trigger: user<br/>entry: POST /api/articles/:id/unpublish<br/>role: Author"]

    subgraph B01["👤 B01 创作者"]
        %% Why: 创作者需要高效表达内容意图
        direction TB
        B01-N01["填写内容表单<br/>write: article<br/>状态: → S01_DRAFT<br/>role: Author"]
        B01-N02{"内容校验(防空白/违规)<br/>condition: title & body non-empty & no banned words"}
        B01-N03["保存草稿(暂存)<br/>write: article<br/>状态: S01_DRAFT<br/>role: Author"]
        B01-N04["提交审核(请求发布)<br/>POST /api/articles/:id/submit<br/>状态: S01→S02_PENDING_REVIEW<br/>update: article.status<br/>role: Author"]
        B01-N05["编辑退回的内容(修正问题)<br/>状态: S03_REJECTED→S01_DRAFT<br/>update: article.status<br/>role: Author"]
        B01-N06{"是否可下架(权限校验)<br/>condition: article.author_id = current_user<br/>role: Author"}
    end

    subgraph B02["⚙️ B02 内容管理"]
        %% Why: 内容必须经审核才能对外展示，确保质量和合规
        direction TB
        B02-N01["编辑查看待审列表<br/>GET /api/articles?status=PENDING_REVIEW<br/>read: article<br/>role: Editor"]
        B02-N02["编辑审核内容(质量把关)<br/>read: article<br/>role: Editor"]
        B02-N03{"审核决策(质量+合规判断)<br/>condition: title.length >= 5 & body.length >= 100 & no banned words"}
        B02-N04["通过审核<br/>状态: S02→S04_APPROVED<br/>update: article.status<br/>role: Editor"]
        B02-N05["驳回审核(附原因)<br/>状态: S02→S03_REJECTED<br/>update: article.status<br/>write: reject_reason<br/>role: Editor"]
        B02-N06{"是否定时发布<br/>condition: article.scheduled_at exists"}
        B02-N07["立即发布<br/>状态: S04→S05_PUBLISHED<br/>update: article.status, published_at<br/>role: System"]
        B02-N08["加入定时发布队列<br/>update: article.status=S04_SCHEDULED<br/>role: System"]
        B02-N09["到期自动发布<br/>状态: S04_SCHEDULED→S05_PUBLISHED<br/>update: article.status, published_at<br/>role: System"]
        B02-N10["下架内容<br/>状态: S05→S06_UNPUBLISHED<br/>update: article.status<br/>role: Author"]
    end

    subgraph B03["🌐 B03 发布与分发"]
        %% Why: 内容需要高性能触达读者
        direction TB
        B03-N01["渲染静态页面(提升加载速度)<br/>write: html<br/>role: System"]
        B03-N02["推送至 CDN(广覆盖)<br/>external: cdn<br/>fallback: retry×3 → log<br/>role: System"]
        B03-N03["通知搜索引擎(提升收录)<br/>external: sitemap/ping<br/>fallback: skip<br/>role: System"]
        B03-N04["清除 CDN 缓存(下架时)<br/>external: cdn<br/>fallback: retry×2 → log<br/>role: System"]
    end

    subgraph B04["🔔 B04 通知与统计"]
        %% Why: 创作者需要了解内容表现
        direction TB
        B04-N01["通知创作者审核结果<br/>external: email, push<br/>fallback: retry×2 → log<br/>role: System"]
        B04-N02["记录阅读统计(衡量表现)<br/>write: article_stats<br/>role: System"]
    end

    ENTRY_CREATE --> B01-N01
    B01-N01 --> B01-N02
    B01-N02 -->|否| B01-N03
    B01-N02 -->|是| B01-N04
    B01-N04 -.->|"event: article.submitted(通知编辑)"| B02-N01
    B01-N04 -.->|"event: article.submitted(通知创作者)"| B04-N01

    ENTRY_REVIEW --> B02-N01
    B02-N01 --> B02-N02
    B02-N02 --> B02-N03
    B02-N03 -->|通过| B02-N04
    B02-N03 -->|驳回| B02-N05
    B02-N05 -.->|"event: article.rejected(通知创作者)"| B04-N01
    B04-N01 -.->|"event: notification.sent(引导修正)"| B01-N05

    B02-N04 --> B02-N06
    B02-N06 -->|"否: 立即发布"| B02-N07
    B02-N06 -->|"是: 定时发布"| B02-N08

    B02-N07 -.->|"event: article.published(触发分发)"| B03-N01
    ENTRY_SCHEDULE --> B02-N09
    B02-N09 -.->|"event: article.published(触发分发)"| B03-N01

    B03-N01 --> B03-N02
    B03-N02 --> B03-N03

    ENTRY_UNPUBLISH --> B01-N06
    B01-N06 -->|否| ERR_UNPUBLISH["resultNode: 无权下架他人内容"]
    B01-N06 -->|是| B02-N10
    B02-N10 --> B03-N04

    B03-N03 -.->|"event: article.published(开始统计)"| B04-N02

    RESULT_DRAFT["resultNode: 草稿已保存"]
    RESULT_SUBMITTED["resultNode: 已提交审核"]
    RESULT_APPROVED["resultNode: 审核通过"]
    RESULT_REJECTED["resultNode: 审核驳回，请修正"]
    RESULT_PUBLISHED["resultNode: 内容已发布"]
    RESULT_UNPUBLISHED["resultNode: 内容已下架"]
    RESULT_SCHEDULED["resultNode: 已加入定时发布"]

    B01-N03 --> RESULT_DRAFT
    B01-N04 --> RESULT_SUBMITTED
    B02-N04 --> RESULT_APPROVED
    B02-N05 --> RESULT_REJECTED
    B02-N07 --> RESULT_PUBLISHED
    B02-N09 --> RESULT_PUBLISHED
    B02-N10 --> RESULT_UNPUBLISHED
    B02-N08 --> RESULT_SCHEDULED

    classDef triggerUser fill:#3D2C00,stroke:#FBBF24,color:#FEF3C7,stroke-width:2px
    classDef triggerCron fill:#1A2A3A,stroke:#60A5FA,color:#DBEAFE,stroke-width:2px
    classDef process fill:#172033,stroke:#5AA9E6,color:#E5EDF7,stroke-width:2px
    classDef decision fill:#1A3A2D,stroke:#2E7D32,color:#E8F5E9,stroke-width:2px
    classDef error fill:#4A1D24,stroke:#FB7185,color:#FFE4E6,stroke-width:2px
    classDef resultNode fill:#173E2D,stroke:#34D399,color:#D1FAE5,stroke-width:2px

    class ENTRY_CREATE,ENTRY_REVIEW,ENTRY_UNPUBLISH triggerUser
    class ENTRY_SCHEDULE triggerCron
    class B01-N01,B01-N03,B01-N04,B01-N05,B02-N01,B02-N02,B02-N04,B02-N05,B02-N07,B02-N08,B02-N09,B02-N10,B03-N01,B03-N02,B03-N03,B03-N04,B04-N01,B04-N02 process
    class B01-N02,B01-N06,B02-N03,B02-N06 decision
    class ERR_UNPUBLISH error
    class RESULT_DRAFT,RESULT_SUBMITTED,RESULT_APPROVED,RESULT_REJECTED,RESULT_PUBLISHED,RESULT_UNPUBLISHED,RESULT_SCHEDULED resultNode
```

## 状态机

```
S01_DRAFT → S02_PENDING_REVIEW → S04_APPROVED → S05_PUBLISHED
                ↓                      ↓                ↓
          S03_REJECTED          S04_SCHEDULED     S06_UNPUBLISHED
                ↓                      ↓
          S01_DRAFT(修正)       S05_PUBLISHED(到期)
```

## 异常路径清单

| 触发点 | 错误码 | Why | 恢复方式 |
|--------|--------|-----|---------|
| B01-N02 | 400 | 内容为空或含违禁词 | 返回编辑页提示 |
| B01-N06 | 403 | 无权下架他人内容 | 返回 403 |
| B02-N03 | 400 | 内容不符合质量标准 | 驳回附原因 |
| B03-N02 | 502 | CDN 推送失败 | retry×3 → log |
| B03-N03 | 502 | 搜索引擎通知失败 | skip |
| B04-N01 | 502 | 邮件/推送发送失败 | retry×2 → log |

## 常见变异

| 变异点 | 默认方案 | 替代方案 |
|--------|---------|---------|
| 审核层级 | 单级审核 | 多级审核（编辑→主编） |
| 发布方式 | 定时+立即 | 仅立即发布 |
| 渲染方式 | SSG 静态渲染 | SSR 服务端渲染 / ISR 增量渲染 |
| 内容类型 | 文章 | 视频/音频/图集（增加转码流程） |
| 协作模式 | 单人编辑 | 多人协同（加锁/OT） |
| 版本管理 | 覆盖更新 | 版本历史（可回滚） |
