# T16: 自动驾驶数据标注平台模板

## 适用场景

- 自动驾驶数据标注：2D/3D 标注、语义分割、目标检测
- 数据采集 → 清洗 → 标注 → 质检 → 模型训练导出
- 标注任务分配、多级质检、标注员绩效

## 泳道设计（W3H）

| 泳道 | Who | What | Why | How |
|------|-----|------|-----|-----|
| B01 数据采集与导入 | System, Admin | 采集车数据导入、解包、清洗 | 原始传感器数据是标注的起点 | ROS bag 解包 + ETL |
| B02 标注任务管理 | Manager | 创建标注项目、分配任务 | 标注需按场景/难度分给合适的人 | HTTP API |
| B03 标注执行 | Annotator | 2D/3D 标注、属性标注 | 标注员需要高效完成标注 | HTTP API + 标注工具 |
| B04 质检与导出 | Reviewer, System | 多级质检、格式转换、导出 | 标注质量直接决定模型效果 | HTTP API + 自动化脚本 |

## 入口分析（W3H）

| 入口 | Who | What | Why | How |
|------|-----|------|-----|-----|
| 数据导入 | Admin | 导入采集数据 | 新采集数据需要进入标注流程 | `POST /api/datasets/import` |
| 创建标注项目 | Manager | 创建项目并分配 | 标注需要组织和管理 | `POST /api/projects` |
| 标注员标注 | Annotator | 执行标注任务 | 标注员完成标注工作 | `POST /api/tasks/:id/submit` |
| 质检员审核 | Reviewer | 审核标注质量 | 确保标注质量达标 | `POST /api/tasks/:id/review` |
| 定时质检超时 | Cron | 扫描超时任务 | 防止任务无限期挂起 | `cron '0 */1 * * *'` |

## Mermaid 图

```mermaid
flowchart TD
    ENTRY_IMPORT["👑 管理员导入数据<br/>trigger: admin<br/>entry: POST /api/datasets/import<br/>role: Admin"]
    ENTRY_PROJECT["👤 管理者创建标注项目<br/>trigger: user<br/>entry: POST /api/projects<br/>role: Manager"]
    ENTRY_ANNOTATE["👤 标注员提交标注<br/>trigger: user<br/>entry: POST /api/tasks/:id/submit<br/>role: Annotator"]
    ENTRY_REVIEW["👤 质检员审核<br/>trigger: user<br/>entry: POST /api/tasks/:id/review<br/>role: Reviewer"]
    ENTRY_TIMEOUT["⏰ 超时任务扫描(防无限挂起)<br/>trigger: cron<br/>entry: cron '0 */1 * * *'<br/>role: System"]

    subgraph B01["📥 B01 数据采集与导入"]
        %% Why: 原始传感器数据必须经过解包和清洗才能进入标注流程
        direction TB
        B01-N01["接收采集数据包(ROS bag/图像序列)<br/>write: raw_data<br/>状态: → D01_IMPORTED<br/>role: Admin"]
        B01-N02["解包传感器数据(提取帧)<br/>write: frame<br/>role: System"]
        B01-N03{"数据完整性校验(防损坏数据)<br/>condition: frame_count = expected & sensor_count = expected"}
        B01-N04["数据清洗(去除无效帧)<br/>condition: blur_score < threshold & exposure valid<br/>role: System"]
        B01-N05["创建数据集(结构化管理)<br/>write: dataset<br/>状态: D01→D02_READY<br/>idempotent: dataset.import_id<br/>role: System"]
    end

    subgraph B02["⚙️ B02 标注任务管理"]
        %% Why: 标注需按场景/难度分给合适的人，确保效率和质量
        direction TB
        B02-N01["创建标注项目(定义标注规则)<br/>write: project, annotation_schema<br/>role: Manager"]
        B02-N02["从数据集抽样(选取标注数据)<br/>read: dataset, frame<br/>role: Manager"]
        B02-N03["生成标注任务(拆分分派)<br/>write: annotation_task<br/>状态: → T01_CREATED<br/>role: System"]
        B02-N04["分配给标注员(匹配能力)<br/>update: annotation_task.assignee_id<br/>状态: T01→T02_ASSIGNED<br/>role: Manager"]
        B02-N05{"标注员技能匹配(保证质量)<br/>condition: annotator.skill_level >= task.difficulty_level"}
        B02-N06["超时任务重新分配(防阻塞)<br/>update: annotation_task.assignee_id<br/>role: System"]
    end

    subgraph B03["👤 B03 标注执行"]
        %% Why: 标注员需要高效完成标注，工具需支持多种标注类型
        direction TB
        B03-N01["标注员加载标注任务<br/>GET /api/tasks/:id<br/>read: annotation_task, frame<br/>role: Annotator"]
        B03-N02["执行标注操作(2D框/3D点云/语义分割)<br/>write: annotation<br/>role: Annotator"]
        B03-N03{"标注完整性校验(防空/漏标)<br/>condition: all required objects annotated & attributes filled"}
        B03-N04["提交标注成果<br/>状态: T02→T03_SUBMITTED<br/>update: annotation_task.status<br/>idempotent: annotation_task.submit_id<br/>role: Annotator"]
        B03-N05["处理驳回任务(修正问题)<br/>状态: T05_REJECTED→T02_ASSIGNED<br/>update: annotation_task.status<br/>role: Annotator"]
    end

    subgraph B04["✅ B04 质检与导出"]
        %% Why: 标注质量直接决定模型效果，必须严格质检
        direction TB
        B04-N01["质检员加载待检任务<br/>GET /api/tasks?status=SUBMITTED<br/>read: annotation_task, annotation<br/>role: Reviewer"]
        B04-N02{"质检决策(质量评分)<br/>condition: iou_score >= 0.85 & no_missing_objects & attribute_accuracy >= 0.9"}
        B04-N03["通过质检(合格)<br/>状态: T03→T04_ACCEPTED<br/>update: annotation_task.status<br/>role: Reviewer"]
        B04-N04["驳回标注(不合格)<br/>状态: T03→T05_REJECTED<br/>update: annotation_task.status<br/>write: reject_reason<br/>role: Reviewer"]
        B04-N05["项目数据集导出(训练就绪)<br/>POST /api/projects/:id/export<br/>write: export_file<br/>external: format_converter<br/>fallback: retry×3 → log<br/>role: System"]
        B04-N06["更新标注员绩效(衡量表现)<br/>update: annotator_stats<br/>role: System"]
    end

    ENTRY_IMPORT --> B01-N01
    B01-N01 --> B01-N02
    B01-N02 --> B01-N03
    B01-N03 -->|否| ERR_CORRUPT["resultNode: 数据损坏，请重新导入"]
    B01-N03 -->|是| B01-N04
    B01-N04 --> B01-N05

    ENTRY_PROJECT --> B02-N01
    B02-N01 --> B02-N02
    B02-N02 --> B02-N03
    B02-N03 --> B02-N04
    B02-N04 --> B02-N05
    B02-N05 -->|否| ERR_SKILL["resultNode: 标注员技能不匹配"]
    B02-N05 -->|是| RESULT_ASSIGNED["resultNode: 任务已分配"]

    B01-N05 -.->|"event: dataset.ready(可用于创建项目)"| B02-N02

    ENTRY_ANNOTATE --> B03-N01
    B03-N01 --> B03-N02
    B03-N02 --> B03-N03
    B03-N03 -->|否| B03-N02
    B03-N03 -->|是| B03-N04
    B03-N04 -.->|"event: task.submitted(通知质检)"| B04-N01

    ENTRY_REVIEW --> B04-N01
    B04-N01 --> B04-N02
    B04-N02 -->|通过| B04-N03
    B04-N02 -->|驳回| B04-N04
    B04-N03 -.->|"event: task.accepted(更新绩效)"| B04-N06
    B04-N04 -.->|"event: task.rejected(通知标注员)"| B03-N05

    ENTRY_TIMEOUT --> B02-N06

    RESULT_IMPORTED["resultNode: 数据导入成功"]
    RESULT_ANNOTATED["resultNode: 标注已提交"]
    RESULT_ACCEPTED["resultNode: 质检通过"]
    RESULT_REJECTED["resultNode: 质检驳回，请修正"]
    RESULT_EXPORTED["resultNode: 数据集已导出"]

    B01-N05 --> RESULT_IMPORTED
    B03-N04 --> RESULT_ANNOTATED
    B04-N03 --> RESULT_ACCEPTED
    B04-N04 --> RESULT_REJECTED
    B04-N05 --> RESULT_EXPORTED

    B04-N06 -.->|"event: stats.updated(项目完成度)"| B04-N05

    classDef triggerAdmin fill:#3B1028,stroke:#F472B6,color:#FCE7F3,stroke-width:2px
    classDef triggerUser fill:#3D2C00,stroke:#FBBF24,color:#FEF3C7,stroke-width:2px
    classDef triggerCron fill:#1A2A3A,stroke:#60A5FA,color:#DBEAFE,stroke-width:2px
    classDef process fill:#172033,stroke:#5AA9E6,color:#E5EDF7,stroke-width:2px
    classDef decision fill:#1A3A2D,stroke:#2E7D32,color:#E8F5E9,stroke-width:2px
    classDef error fill:#4A1D24,stroke:#FB7185,color:#FFE4E6,stroke-width:2px
    classDef resultNode fill:#173E2D,stroke:#34D399,color:#D1FAE5,stroke-width:2px

    class ENTRY_IMPORT triggerAdmin
    class ENTRY_PROJECT,ENTRY_ANNOTATE,ENTRY_REVIEW triggerUser
    class ENTRY_TIMEOUT triggerCron
    class B01-N01,B01-N02,B01-N04,B01-N05,B02-N01,B02-N02,B02-N03,B02-N04,B02-N06,B03-N01,B03-N02,B03-N04,B03-N05,B04-N01,B04-N03,B04-N04,B04-N05,B04-N06 process
    class B01-N03,B02-N05,B03-N03,B04-N02 decision
    class ERR_CORRUPT,ERR_SKILL error
    class RESULT_IMPORTED,RESULT_ASSIGNED,RESULT_ANNOTATED,RESULT_ACCEPTED,RESULT_REJECTED,RESULT_EXPORTED resultNode
```

## 异常路径清单

| 触发点 | 错误码 | Why | 恢复方式 |
|--------|--------|-----|---------|
| B01-N03 | 400 | 数据包损坏，帧数不匹配 | 重新导入 |
| B02-N05 | 400 | 标注员技能不匹配 | 重新分配 |
| B03-N03 | 400 | 标注不完整，存在漏标 | 返回继续标注 |
| B04-N02 | 200 | 质检未通过（IoU < 0.85） | 驳回修正 |
| B04-N05 | 502 | 导出格式转换失败 | retry×3 → log |

## 常见变异

| 变异点 | 默认方案 | 替代方案 |
|--------|---------|---------|
| 标注类型 | 2D 框 + 3D 点云 | 语义分割 / 关键点 / 多边形 |
| 质检方式 | 人工全量质检 | 自动质检（模型预检）+ 人工抽检 |
| 数据源 | ROS bag | 直连采集车流式上传 |
| 标注工具 | Web 端 | 客户端工具（性能更高） |
| 预标注 | 无 | 模型预标注 + 人工修正 |
| 导出格式 | COCO / KITTI | 自定义格式 / ONNX 标注 |
