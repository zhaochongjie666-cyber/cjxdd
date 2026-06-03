# 多业务线 L1 设计规范

> 当一个项目涉及多条业务线（如用户管理、支付、订单、通知等），本规范定义如何在 L1 层清晰区分业务线、处理业务交叉、并保持 Mermaid 图分类清晰。

## 详细指南

本规范拆分为 3 个专题指南，按需阅读：

| 指南 | 内容 | 什么时候读 |
|------|------|-----------|
| [bizline-naming-guide.md](bizline-naming-guide.md) | BXX-NYY 编号体系、业务线标识系统、泳道视觉规范 | 划分业务线时（L1 Research §1）、画流程图时（L1 Flow） |
| [bizline-crossline-guide.md](bizline-crossline-guide.md) | 跨线连接协议、业务交叉场景处理（5 种典型模式） | 画跨泳道连线时（L1 Flow）、定义跨线事件时（L1 Research §3） |
| [bizline-flow-template.md](bizline-flow-template.md) | 项目级流程总图模板、多业务线工作流、Gate 检查扩展 | 画 project.flow.mermaid 时（L1 Flow）、执行 L1 门禁时 |

## 核心铁律

以下规则是所有多业务线项目必须遵守的底线，无论项目规模：

### 编号铁律

- **BXX-NYY = 业务操作全局唯一坐标**。从代码 `@implements: slug-B01-N03` → 定位到 B01 的节点 N03 → 从总图感知全局
- **一个节点 = 一个不可再拆的业务动作**。含条件分支/异步等待/外部调用/人工操作 → 必须拆分
- 子节点编号最多 3 级（`.01` → `.01.01` → `.01.01.01`），子节点 ≤ 8 个，编号连续无跳号

### 总图铁律

- **唯一总图**：`.shadow/L1-business/project.flow.mermaid` 是项目级唯一流程图。禁止按业务线拆独立 flow
- **跨线通信必须经过接口节点**：API Gateway / Event Bus / Shared Service。禁止两个业务线 subgraph 内部节点直接连接
- **双向声明强制**：A 的 spec 声明 `A-N03 → B-N01` 时，B 的 spec 必须在接入点章节反向声明

### 跨线铁律

- 跨线边必须有标签：`|HTTP POST /path|` 或 `|event: domain.action|`
- 事件命名格式：`domain.action`（如 `order.created`）
- 业务线间禁止 A→B→A 循环调用

### 配色铁律

- 每个业务线使用独立的 classDef 配色
- 色相环间隔 ≥ 60°，饱和度 40-70%，明度 15-35%

### Gate 铁律

多业务线场景下 Gate 增加检查项：总图包含所有业务线 subgraph、无独立流程图、跨线连接经过接口节点、连接标签完整、事件命名规范、无循环依赖、配色唯一、spec 有跨线依赖表、节点可追溯、总图可读、跨线引用双向声明、子节点编号连续、子节点 ≤ 8。

详细检查项见 [bizline-flow-template.md §7 Gate 检查扩展](bizline-flow-template.md)。
