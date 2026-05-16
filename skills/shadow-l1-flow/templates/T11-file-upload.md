# T11: 文件上传与处理模板

## 适用场景

- 图片/视频/文档上传、转码、存储
- 大文件分片上传、断点续传
- 上传后自动处理（压缩、缩略图、OCR）

## 泳道设计（W3H）

| 泳道 | Who | What | Why | How |
|------|-----|------|-----|-----|
| B01 上传入口 | User | 文件上传、分片、校验 | 用户需要提交文件 | HTTP API + 直传 OSS |
| B02 文件处理 | System | 转码、压缩、缩略图 | 原始文件不适合直接使用 | 异步任务队列 |
| B03 存储管理 | System | 持久化、CDN 分发 | 文件需要可靠存储和快速访问 | 对象存储 + CDN |
| B04 回调通知 | System | 处理完成通知 | 用户需知道处理结果 | 异步事件 |

## 入口分析（W3H）

| 入口 | Who | What | Why | How |
|------|-----|------|-----|-----|
| 用户上传 | User | 提交文件 | 用户需要提交文件 | `POST /api/files/upload` |
| 分片上传 | User | 大文件分片提交 | 大文件需要分片传输 | `POST /api/files/chunk` |
| 完整合并 | User | 合并所有分片 | 分片上传后需要合并 | `POST /api/files/merge` |
| 定时清理 | Cron | 清理过期临时文件 | 防止临时文件占满存储 | `cron '0 3 * * *'` |

## Mermaid 图

```mermaid
flowchart TD
    ENTRY_UPLOAD["👤 用户上传文件<br/>trigger: user<br/>entry: POST /api/files/upload<br/>role: User"]
    ENTRY_CHUNK["👤 分片上传(大文件)<br/>trigger: user<br/>entry: POST /api/files/chunk<br/>role: User"]
    ENTRY_MERGE["👤 合并分片(完成上传)<br/>trigger: user<br/>entry: POST /api/files/merge<br/>role: User"]
    ENTRY_CLEANUP["⏰ 清理过期临时文件(释放存储)<br/>trigger: cron<br/>entry: cron '0 3 * * *'<br/>role: System"]

    subgraph B01["📥 B01 上传入口"]
        %% Why: 用户需要安全可靠地提交文件
        direction TB
        B01-N01["校验文件类型和大小(防恶意上传)<br/>condition: type in allowlist & size <= limit<br/>role: System"]
        B01-N02{"是否为大文件(>50MB)<br/>condition: file.size > 50MB"}
        B01-N03["请求预签名上传 URL(直传 OSS)<br/>external: oss<br/>fallback: 服务端中转上传<br/>role: System"]
        B01-N04["接收分片上传<br/>write: file_chunk<br/>role: System"]
        B01-N05{"所有分片是否到齐<br/>condition: received_chunks = total_chunks"}
        B01-N06["合并分片为完整文件<br/>write: file<br/>role: System"]
        B01-N07["校验文件完整性(MD5校验)<br/>condition: file.md5 = expected_md5<br/>role: System"]
        B01-N08["创建文件记录(持久化元数据)<br/>write: file_record<br/>状态: → S01_UPLOADED<br/>role: System"]
    end

    subgraph B02["🔄 B02 文件处理"]
        %% Why: 原始文件不适合直接使用，需要标准化处理
        direction TB
        B02-N01{"判断文件类型(路由处理策略)<br/>condition: file.media_type"}
        B02-N02["图片：压缩+生成缩略图(节省带宽)<br/>external: image_processor<br/>fallback: 使用原图<br/>role: System"]
        B02-N03["视频：转码+截取封面(适配多端)<br/>external: video_transcoder<br/>fallback: retry×3 → 标记处理失败<br/>role: System"]
        B02-N04["文档：提取文本/PDF 预览(可检索)<br/>external: doc_processor<br/>fallback: 跳过<br/>role: System"]
        B02-N05["更新文件处理结果<br/>update: file_record.variants<br/>状态: S01→S02_PROCESSED<br/>role: System"]
    end

    subgraph B03["💾 B03 存储管理"]
        %% Why: 文件需要可靠存储和快速访问
        direction TB
        B03-N01["持久化到对象存储(可靠存储)<br/>external: oss<br/>fallback: retry×3 → 告警<br/>role: System"]
        B03-N02["刷新 CDN 缓存(分发)<br/>external: cdn<br/>fallback: skip<br/>role: System"]
        B03-N03["清理临时分片文件(释放空间)<br/>delete: file_chunk<br/>role: System"]
    end

    subgraph B04["🔔 B04 回调通知"]
        %% Why: 用户需知道处理结果
        direction TB
        B04-N01["通知上传完成(告知用户)<br/>external: websocket<br/>fallback: log<br/>role: System"]
        B04-N02["通知处理完成(可用通知)<br/>external: websocket<br/>fallback: log<br/>role: System"]
    end

    ENTRY_UPLOAD --> B01-N01
    B01-N01 --> B01-N02
    B01-N02 -->|"否: 小文件"| B01-N03
    B01-N02 -->|"是: 大文件"| ERR_LARGE["resultNode: 请使用分片上传"]

    ENTRY_CHUNK --> B01-N04
    B01-N04 --> B01-N05
    B01-N05 -->|否| RESULT_CHUNK["resultNode: 分片已接收，等待其余分片"]
    B01-N05 -->|是| ENTRY_MERGE

    ENTRY_MERGE --> B01-N06
    B01-N06 --> B01-N07
    B01-N07 -->|否| ERR_MD5["resultNode: 文件校验失败，请重新上传"]
    B01-N07 -->|是| B01-N08

    B01-N03 --> B01-N08
    B01-N08 -.->|"event: file.uploaded(触发处理)"| B02-N01
    B01-N08 -.->|"event: file.uploaded(通知用户)"| B04-N01
    B01-N08 --> B03-N01

    B02-N01 -->|"image"| B02-N02
    B02-N01 -->|"video"| B02-N03
    B02-N01 -->|"document"| B02-N04
    B02-N02 --> B02-N05
    B02-N03 --> B02-N05
    B02-N04 --> B02-N05
    B02-N05 -.->|"event: file.processed(通知)"| B04-N02
    B02-N05 --> B03-N02

    ENTRY_CLEANUP --> B03-N03

    RESULT_UPLOADED["resultNode: 文件上传成功"]
    RESULT_PROCESSED["resultNode: 文件处理完成，可使用"]

    B01-N08 --> RESULT_UPLOADED

    classDef triggerUser fill:#3D2C00,stroke:#FBBF24,color:#FEF3C7,stroke-width:2px
    classDef triggerCron fill:#1A2A3A,stroke:#60A5FA,color:#DBEAFE,stroke-width:2px
    classDef process fill:#172033,stroke:#5AA9E6,color:#E5EDF7,stroke-width:2px
    classDef decision fill:#1A3A2D,stroke:#2E7D32,color:#E8F5E9,stroke-width:2px
    classDef error fill:#4A1D24,stroke:#FB7185,color:#FFE4E6,stroke-width:2px
    classDef resultNode fill:#173E2D,stroke:#34D399,color:#D1FAE5,stroke-width:2px

    class ENTRY_UPLOAD,ENTRY_CHUNK,ENTRY_MERGE triggerUser
    class ENTRY_CLEANUP triggerCron
    class B01-N03,B01-N04,B01-N06,B01-N08,B02-N02,B02-N03,B02-N04,B02-N05,B03-N01,B03-N02,B03-N03,B04-N01,B04-N02 process
    class B01-N01,B01-N02,B01-N05,B01-N07,B02-N01 decision
    class ERR_LARGE,ERR_MD5 error
    class RESULT_CHUNK,RESULT_UPLOADED,RESULT_PROCESSED resultNode
```

## 异常路径清单

| 触发点 | 错误码 | Why | 恢复方式 |
|--------|--------|-----|---------|
| B01-N01 | 400 | 文件类型/大小不合法 | 返回错误提示 |
| B01-N02 | 400 | 大文件需分片上传 | 提示使用分片 |
| B01-N05 | 200 | 分片未到齐 | 等待其余分片 |
| B01-N07 | 400 | 文件 MD5 校验失败 | 要求重新上传 |
| B02-N02 | 502 | 图片处理失败 | 使用原图兜底 |
| B02-N03 | 502 | 视频转码失败 | retry×3 → 标记处理失败 |
| B03-N01 | 502 | OSS 写入失败 | retry×3 → 告警 |

## 常见变异

| 变异点 | 默认方案 | 替代方案 |
|--------|---------|---------|
| 上传方式 | 服务端接收 | 客户端直传 OSS（预签名 URL） |
| 分片策略 | 固定大小 | 动态分片（根据网络状况调整） |
| 断点续传 | 无 | 记录已上传分片，支持续传 |
| 图片处理 | 服务端处理 | CDN 实时裁剪（参数化 URL） |
| 视频转码 | 同步队列 | 分布式转码集群 |
| 权限控制 | 登录即可上传 | 上传令牌（限时 URL） |
