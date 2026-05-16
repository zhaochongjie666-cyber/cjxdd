# T17: 自动驾驶仿真测试平台模板

## 适用场景

- 自动驾驶算法仿真：场景构建 → 仿真执行 → 结果评估
- 场景库管理、仿真任务调度、指标分析
- 回归测试、边缘场景验证

## 泳道设计（W3H）

| 泳道 | Who | What | Why | How |
|------|-----|------|-----|-----|
| B01 场景管理 | Engineer | 创建/编辑/管理测试场景 | 仿真的输入是场景，需要结构化管理 | HTTP API + 场景编辑器 |
| B02 仿真执行 | System | 调度仿真任务、运行仿真 | 算法需要在虚拟环境中验证 | 仿真引擎 + GPU 集群 |
| B03 结果评估 | System | 指标计算、通过/失败判定 | 仿真结果必须量化评估 | 自动化评估脚本 |
| B04 报告与回归 | System, Engineer | 生成报告、回归测试 | 评估结果需要可视化，算法迭代需要回归 | HTTP API + 报表 |

## 入口分析（W3H）

| 入口 | Who | What | Why | How |
|------|-----|------|-----|-----|
| 创建场景 | Engineer | 构建测试场景 | 需要定义测试用例 | `POST /api/scenarios` |
| 提交仿真 | Engineer | 提交算法跑仿真 | 验证算法表现 | `POST /api/simulations` |
| 仿真完成回调 | Simulation Engine | 仿真运行结束通知 | 仿真完成后触发评估 | Event subscribe |
| 定时回归 | Cron | 每夜回归测试 | 持续验证算法质量 | `cron '0 2 * * *'` |

## Mermaid 图

```mermaid
flowchart TD
    ENTRY_SCENARIO["👤 工程师创建场景<br/>trigger: user<br/>entry: POST /api/scenarios<br/>role: Engineer"]
    ENTRY_SIMULATE["👤 工程师提交仿真任务<br/>trigger: user<br/>entry: POST /api/simulations<br/>role: Engineer"]
    ENTRY_CALLBACK["📡 仿真引擎完成回调(结果就绪)<br/>trigger: event<br/>entry: subscribe simulation.completed<br/>role: System"]
    ENTRY_REGRESSION["⏰ 每夜回归测试(持续验证)<br/>trigger: cron<br/>entry: cron '0 2 * * *'<br/>role: System"]

    subgraph B01["🎬 B01 场景管理"]
        %% Why: 仿真的输入是场景，场景质量决定仿真有效性
        direction TB
        B01-N01["创建场景(定义道路+交通流+天气)<br/>write: scenario<br/>状态: → SC01_DRAFT<br/>idempotent: scenario.version_id<br/>role: Engineer"]
        B01-N02{"场景合法性校验(防无效场景)<br/>condition: road_network.valid & actors.non_empty & ego_route.defined"}
        B01-N03["场景入库(版本管理)<br/>write: scenario_version<br/>状态: SC01→SC02_PUBLISHED<br/>role: Engineer"]
        B01-N04["从真实数据提取场景(数据驱动)<br/>read: drive_log<br/>write: scenario<br/>role: System"]
    end

    subgraph B02["⚙️ B02 仿真执行"]
        %% Why: 算法需要在受控虚拟环境中验证，仿真需可靠执行
        direction TB
        B02-N01["创建仿真任务(绑定算法+场景)<br/>write: simulation<br/>状态: → SIM01_QUEUED<br/>idempotent: simulation.batch_id<br/>role: System"]
        B02-N02{"GPU 资源是否可用(防资源不足)<br/>condition: available_gpus >= required_gpus"}
        B02-N03["调度仿真到 GPU 节点(执行)<br/>external: simulation_engine<br/>fallback: 排队等待<br/>role: System"]
        B02-N04["仿真运行中(实时监控)<br/>状态: SIM01→SIM02_RUNNING<br/>role: System"]
        B02-N05{"仿真是否正常结束(防崩溃)<br/>condition: exit_code = 0 & output_files.exist"}
        B02-N06["仿真异常处理(重试或标记失败)<br/>状态: SIM02→SIM04_FAILED<br/>update: simulation.error<br/>role: System"]
    end

    subgraph B03["📊 B03 结果评估"]
        %% Why: 仿真结果必须量化评估，不能凭感觉
        direction TB
        B03-N01["收集仿真输出(轨迹+事件日志)<br/>read: simulation_output<br/>role: System"]
        B03-N02["计算评估指标(安全+舒适+效率)<br/>condition: compute KPIs<br/>role: System"]
        B03-N03{"是否通过评估<br/>condition: collision_rate = 0 & comfort_score >= 0.8 & lane_violation_rate < 0.05"}
        B03-N04["标记仿真通过<br/>状态: SIM02→SIM03_PASSED<br/>update: simulation.result<br/>role: System"]
        B03-N05["标记仿真失败(需分析)<br/>状态: SIM02→SIM04_FAILED<br/>update: simulation.result, failure_reason<br/>role: System"]
    end

    subgraph B04["📋 B04 报告与回归"]
        %% Why: 评估结果需要可视化，算法迭代需要回归验证
        direction TB
        B04-N01["生成仿真报告(可视化)<br/>write: simulation_report<br/>role: System"]
        B04-N02["发送结果通知(告知工程师)<br/>external: email, webhook<br/>fallback: log<br/>role: System"]
        B04-N03["创建回归测试套件(批量验证)<br/>write: regression_suite<br/>role: Engineer"]
        B04-N04["批量执行回归(全场景覆盖)<br/>write: regression_run<br/>role: System"]
        B04-N05{"回归通过率是否达标<br/>condition: pass_rate >= 0.95"}
        B04-N06["生成回归报告(趋势分析)<br/>write: regression_report<br/>role: System"]
    end

    ENTRY_SCENARIO --> B01-N01
    B01-N01 --> B01-N02
    B01-N02 -->|否| ERR_INVALID["resultNode: 场景不合法"]
    B01-N02 -->|是| B01-N03

    ENTRY_SIMULATE --> B02-N01
    B02-N01 --> B02-N02
    B02-N02 -->|否| RESULT_QUEUED["resultNode: 排队等待 GPU 资源"]
    B02-N02 -->|是| B02-N03
    B02-N03 --> B02-N04
    B02-N04 --> B02-N05
    B02-N05 -->|否| B02-N06

    ENTRY_CALLBACK --> B03-N01
    B02-N05 -->|是| B03-N01
    B03-N01 --> B03-N02
    B03-N02 --> B03-N03
    B03-N03 -->|通过| B03-N04
    B03-N03 -->|失败| B03-N05
    B03-N04 -.->|"event: simulation.passed(生成报告)"| B04-N01
    B03-N05 -.->|"event: simulation.failed(生成报告)"| B04-N01

    B04-N01 --> B04-N02

    ENTRY_REGRESSION --> B04-N03
    B04-N03 --> B04-N04
    B04-N04 --> B04-N05
    B04-N05 -->|是| B04-N06
    B04-N05 -->|否| B04-N06

    RESULT_SCENARIO["resultNode: 场景已发布"]
    RESULT_PASSED["resultNode: 仿真通过"]
    RESULT_FAILED["resultNode: 仿真失败"]
    RESULT_REPORT["resultNode: 报告已生成"]
    RESULT_REGRESSION["resultNode: 回归报告已生成"]

    B01-N03 --> RESULT_SCENARIO
    B03-N04 --> RESULT_PASSED
    B03-N05 --> RESULT_FAILED
    B04-N01 --> RESULT_REPORT
    B04-N06 --> RESULT_REGRESSION

    classDef triggerUser fill:#3D2C00,stroke:#FBBF24,color:#FEF3C7,stroke-width:2px
    classDef triggerCron fill:#1A2A3A,stroke:#60A5FA,color:#DBEAFE,stroke-width:2px
    classDef triggerEvent fill:#1A3A2D,stroke:#34D399,color:#D1FAE5,stroke-width:2px,stroke-dasharray: 5 5
    classDef process fill:#172033,stroke:#5AA9E6,color:#E5EDF7,stroke-width:2px
    classDef decision fill:#1A3A2D,stroke:#2E7D32,color:#E8F5E9,stroke-width:2px
    classDef error fill:#4A1D24,stroke:#FB7185,color:#FFE4E6,stroke-width:2px
    classDef resultNode fill:#173E2D,stroke:#34D399,color:#D1FAE5,stroke-width:2px

    class ENTRY_SCENARIO,ENTRY_SIMULATE triggerUser
    class ENTRY_REGRESSION triggerCron
    class ENTRY_CALLBACK triggerEvent
    class B01-N01,B01-N03,B01-N04,B02-N01,B02-N03,B02-N04,B02-N06,B03-N01,B03-N02,B03-N04,B03-N05,B04-N01,B04-N02,B04-N03,B04-N04,B04-N06 process
    class B01-N02,B02-N02,B02-N05,B03-N03,B04-N05 decision
    class ERR_INVALID error
    class RESULT_SCENARIO,RESULT_QUEUED,RESULT_PASSED,RESULT_FAILED,RESULT_REPORT,RESULT_REGRESSION resultNode
```

## 异常路径清单

| 触发点 | 错误码 | Why | 恢复方式 |
|--------|--------|-----|---------|
| B01-N02 | 400 | 场景不合法（缺少必要元素） | 返回编辑 |
| B02-N02 | 409 | GPU 资源不足 | 排队等待 |
| B02-N05 | 500 | 仿真引擎崩溃（exit_code ≠ 0） | 重试或标记失败 |
| B03-N03 | 200 | 评测未通过基线 | 标记需优化 |
| B04-N05 | 200 | 回归通过率 < 95% | 生成报告分析原因 |

## 常见变异

| 变异点 | 默认方案 | 替代方案 |
|--------|---------|---------|
| 仿真引擎 | 单机 GPU | 云端 GPU 集群 / 分布式仿真 |
| 场景格式 | OpenSCENARIO | CARLA / LGSVL 自定义格式 |
| 评估方式 | 规则评估 | 学习型评估（模型评分） |
| 回归策略 | 全量回归 | 增量回归（只跑变更影响的场景） |
| 数据驱动场景 | 手动提取 | 自动从真实数据挖掘边缘场景 |
| 并行度 | 单任务串行 | 多场景并行仿真 |
