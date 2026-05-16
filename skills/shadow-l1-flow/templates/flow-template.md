# project.flow.mermaid 模板

文件：`.shadow/L1-business/project.flow.mermaid`

> Shadow Flow 只维护一张项目级总图。BXX 是总图里的泳道/领域编号，不再对应独立业务线 flow 文件。

```mermaid
flowchart TD
    START["触发来源：用户/外部系统发起业务请求"] --> GATEWAY["API Gateway / Event Router"]

    subgraph B01["B01 用户与权限"]
        direction TB
        B01-N01["校验用户身份与权限<br/>read: session/user/role"]
        B01-N02{"权限是否满足"}
        B01-N03["返回 403\n提示无权限"]
    end

    subgraph B02["B02 核心业务处理"]
        direction TB
        B02-N01["创建业务记录\nPOST /api/resources\nwrite: resource"]
        B02-N02["执行业务校验\n状态 S01→S02\nread: rules/config"]
        B02-N03{"校验是否通过"}
        B02-N04["写入失败原因\n状态 S02→S_ERR\nwrite: error_reason"]
        B02-N05["提交业务结果\n状态 S02→S03\nwrite: resource.status"]
    end

    subgraph B03["B03 通知与审计"]
        direction TB
        B03-N01["记录审计日志\nwrite: audit_log"]
        B03-N02["发送业务完成通知\nexternal: email/sms/webhook"]
    end

    GATEWAY --> B01-N01
    B01-N01 --> B01-N02
    B01-N02 -->|否| B01-N03
    B01-N02 -->|是 HTTP| B02-N01
    B02-N01 --> B02-N02
    B02-N02 --> B02-N03
    B02-N03 -->|否| B02-N04
    B02-N03 -->|是| B02-N05
    B02-N05 -.->|event: resource.completed| B03-N01
    B03-N02 -->|超时/失败: retry 3次| B03-N03["记录通知失败\nwrite: notification_failed"]
    B03-N03 --> RESULT
    B03-N01 --> B03-N02
    B03-N02 --> RESULT["resultNode: 用户收到业务完成结果"]
    B01-N03 --> RESULT
    B02-N04 --> RESULT

    classDef inbound fill:#e1f5fe,stroke:#0288d1
    classDef gateway fill:#ede7f6,stroke:#673ab7
    classDef process fill:#f3e5f5,stroke:#7b1fa2
    classDef decision fill:#e8f5e9,stroke:#2e7d32
    classDef event fill:#fff8e1,stroke:#f9a825,stroke-dasharray: 5 5
    classDef error fill:#ffebee,stroke:#c62828
    classDef resultNode fill:#e8f5e9,stroke:#1b5e20

    class START inbound
    class GATEWAY gateway
    class B01-N01,B02-N01,B02-N02,B02-N05,B03-N01,B03-N02 process
    class B01-N02,B02-N03 decision
    class B01-N03,B02-N04,B03-N03 error
    class RESULT resultNode
```

**约束：**
- 必须通过 Mermaid 渲染校验脚本（优先 `skills/shadow-l1-flow/scripts/mmdc-check.sh`，兼容 `skills/mermaid-check/scripts/mmdc_check.sh`）
- 项目只允许一个 L1 Flow 总图：`.shadow/L1-business/project.flow.mermaid`
- BXX subgraph 是总图里的领域/泳道分组，不是独立文件
- 每个节点命名包含具体动作或判断，禁止使用 `B01-N01[处理]`、`B01-N02{判断}` 等模糊命名
- 每个关键步骤必须有对应的异常处理分支，禁止只有 happy path
- 总图必须包含端到端主链路、异常链路、跨域协作和 resultNode
- 总图必须展示关键操作点、业务点、流程点、数据流转、接口请求流、外部依赖和错误处理点
- 用户交互节点必须标注 API 请求或数据读写；外部服务节点必须有失败/超时/重试路径
- 跨泳道同步调用必须在边标签标注 `HTTP` / `RPC` / `query` 等性质
- 跨泳道异步协作必须用虚线事件边，并使用 `event: domain.action` 命名
- 禁止为 B01/B02/B03 等业务线创建单独 `flow.mermaid`、`project.flow.mermaid` 或 `*.flow.mermaid`

### 品味约束

引用 `shadow-taste/references/taste-criteria.md`。
- 每个决策节点有否定/异常分支（无否定分支 = 否认意外存在）
- 外部依赖节点有超时/重试/降级路径
- 泳道 ≤ 10 节点 / 节点命名"动词+宾语"
- 关键节点标注 read/write/external
