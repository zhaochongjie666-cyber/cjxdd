---
name: xdd-flow
description: 系统架构设计时需要，包含架构图，行为图，业务图，数据图，接口图，部署图等,通过组件分解（Decomposition）来体现系统非功能性设计（高性能、高可用、可扩展性），拒绝纯业务画图
---

# xdd-flow
Depict the system architecture using a unified flow diagram that integrates architectural views, behavioral views, and business line exploration. Ensure the granularity is sufficiently detailed yet non-redundant, with fine-grained nodes. Regularly update the diagram to maintain consistency with the actual system architecture design. The diagram should be saved in `./.xdd/project.flow.mermaid`.

通过组件分解（Decomposition）来体现系统非功能性设计（高性能、高可用、可扩展性），拒绝纯业务画图

## 核心要求
1. **体现组件职责与边界**：必须清晰区分前端（Frontend）、网关（Gateway）、微服务（Services）、消息队列（MQ）、数据存储（DB/Cache/OSS）以及 AI/算法引擎。
2. **暴露核心数据流向**：箭头线上必须标注数据传输协议（HTTP/gRPC/RPC）或核心数据 Payload（如：JSON 报文、HLS 切片、指标快照）。
3. **凸显非功能性战术**：凡是涉及"高并发（并发治理/限流）"、"异步处理（转码/AI分析）"、"高可用（缓存/只读副本）"，必须在图中用专门的节点（如 Redis, Kafka, Celery Worker）体现。
4. **与 BDD 字段对齐**：图中的核心路由分支（如按 `eval_type` 路由）和数据状态，必须与 `.xdd/bdd` 中的名词完全一致。

## template

```mermaid
graph TD
    %% ==========================================
    %% 1. 样式与全局定义 (ADD 架构层级区隔)
    %% ==========================================
    classDef client fill:#e1f5fe,stroke:#0288d1,stroke-width:2px;
    classDef gateway fill:#ffe0b2,stroke:#f57c00,stroke-width:2px;
    classDef service fill:#e8f5e9,stroke:#388e3c,stroke-width:2px;
    classDef mq fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px;
    classDef storage fill:#eceff1,stroke:#455a64,stroke-width:2px;

    %% ==========================================
    %% 2. 节点组装 (Components & Responsibilities)
    %% ==========================================
    subhost[上游: 回灌任务系统] -->|1. 投递产物通知| GW[Pipeline Gateway 门禁/限流]
    
    subgraph Frontend [前端展示层]
        UI[P5 评测工作台]
        Player[视频 HLS 播放器]
    end

    subgraph Gateway [控制与路由层]
        GW -->|2. 校验产物类型| Router{产物类型路由器}
    end

    subgraph CoreServices [后端核心计算服务层]
        NormalSvc[Normal 处理服务]
        PipelineSvc[指标计算管线服务]
        TranscodeSvc[视频转码 Worker]
        AssertSvc[断言投影服务]
        CompareSvc[多版本对比服务]
    end

    subgraph AsyncInfra [异步与并发治理中间件]
        MQ[分布式消息队列 / RocketMQ]
        TaskEngine[异步任务引擎 / Temporal]
    end

    subgraph DataStorage [持久化与缓存数据层]
        DB[(关系型数据库: 指标/元数据)]
        Cache[(高性能缓存: Redis)]
        OSS[(对象存储: 视频帧/真值根目录)]
    end

    %% ==========================================
    %% 3. 核心数据流向与非功能战术 (Data Flows & ADD Tactics)
    %% ==========================================
    
    %% 路径 A: GT 指标计算流 (体现策略模式与归一化)
    Router -->|产物=GT / gRPC| PipelineSvc
    PipelineSvc -->|3.1 路径兼容与结构归一化| Strat{eval_type 策略路由}
    Strat -->|LLD/TSR/MOD/CAR/VRU| Calc[指标计算引擎]
    Calc -->|3.2 批量入库| DB
    Calc -->|3.3 阈值判定产生| Badcase[标记 Badcase]
    Calc -->|3.4 写旁路缓存| Cache

    %% 路径 B: 视频转码流 (体现异步削峰与流式切片)
    Router -->|产物=视频/帧| MQ
    MQ -->|消费者订阅| TranscodeSvc
    TranscodeSvc -->|4.1 读取原始帧| OSS
    TranscodeSvc -->|4.2 异步分片转码| OSS
    Player -.->|4.3 HLS 流式加载播放.-| OSS

    %% 路径 C: 断言投影流 (体现 CQRS 读写分离)
    Router -->|产物=断言| AssertSvc
    AssertSvc -->|5.1 断言执行并持久化| DB
    UI -->|5.2 /assert-tests 只读请求| DB

    %% 路径 D: 版本对比流 (体现 AI 异步分析与状态回写)
    UI -->|6.1 选择基线与候选任务| CompareSvc
    CompareSvc -->|6.2 读快照并归一化对齐| Cache
    CompareSvc -->|6.3 触发差异分析| TaskEngine
    TaskEngine -->|6.4 AI 差异分析中| AI[AI 大模型分析模块]
    AI -->|6.5 结论异步回写| DB

    %% ==========================================
    %% 4. 类组映射 (Apply Styling)
    %% ==========================================
    class UI,Player client;
    class GW,Router gateway;
    class NormalSvc,PipelineSvc,TranscodeSvc,AssertSvc,CompareSvc,Calc,AI service;
    class MQ,TaskEngine mq;
    class DB,Cache,OSS storage;
```



## 门禁
- check mermaid can render to svg
