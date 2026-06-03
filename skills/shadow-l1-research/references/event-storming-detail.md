# 事件风暴详细方法 + EDD 架构决策详细指南

> 本文件是 SKILL.md 的详细参考。事件风暴的核心原则和流程在 SKILL.md §3 中定义，本文件提供详细的方法和 EDD 架构决策指南。

## 1. 领域事件识别

用过去时态动词列出领域里发生的重要事件（OrderPlaced、PaymentFailed...）。

每个事件问五个问题：
- 什么触发了它？（命令/操作）
- 谁干的？（角色）
- 它改变了什么？（聚合状态变化）
- 谁需要知道？（其他上下文）
- **事件接收方在同一个进程还是不同进程？**（EDD 关键问题）

**关键原则**：事件是业务关心的，不是技术关心的。不要列技术事件。

## 2. 事件分类（EDD 准备）

把事件按**传递范围**分类：

| 类型 | 范围 | 传递方式 | 示例 |
|------|------|---------|------|
| **进程内事件** | 同一上下文内，聚合间协调 | EventBus（asyncio/观察者模式） | AnnotationSubmitted → ReviewRequested（同进程触发质检） |
| **跨上下文事件** | 不同限界上下文间，同一进程 | EventBus + 防腐层适配 | OrderPlaced → InventoryReserved（单体内部上下文协调） |
| **跨进程事件** | 不同服务实例，需要持久化 | Kafka/RabbitMQ/SQS | OrderPlaced → PaymentService（微服务间通信） |
| **外部系统事件** | 第三方系统，需要可靠投递 | Kafka + 死信队列 + 重试 | OrderShipped → 物流系统通知 |

## 3. EDD 架构决策（显式选择）

根据事件分类，做出 EDD 架构决策：

### 3.1 决策：事件传递基础设施

| 方案 | 适用场景 | 优点 | 缺点 |
|------|---------|------|------|
| **进程内 EventBus** | 模块化单体、上下文间强耦合、实时性要求高 | 零延迟、零运维成本、调试简单 | 服务重启丢失未消费事件、无法水平扩展 |
| **消息队列（Kafka/RabbitMQ）** | 微服务、跨进程通信、需要事件持久化 | 可靠投递、支持重试、支持多消费者 | 运维复杂、延迟增加、调试困难 |

### 3.2 决策问自己

- 事件丢失会影响业务吗？（订单支付失败事件不能丢）
- 事件消费者需要独立部署吗？（质检服务可能独立扩容）
- 当前团队规模能运维消息队列吗？（单体阶段用 EventBus，后期升级）

### 3.3 决策输出（写入 research.md）

```
EDD 架构决策:
  - 进程内事件: AnnotationSubmitted → ReviewRequested（同进程触发质检）
  - 跨上下文事件: OrderPlaced → InventoryReserved（单体内部 EventBus）
  - 跨进程事件: 无（当前阶段单体架构，后期可升级 Kafka）
  - 外部系统事件: OrderShipped → 物流系统（预留 Kafka 接口，当前用 HTTP 回调）

  基础设施选择: 进程内 EventBus（asyncio），接口抽象保证后期可替换为 Kafka
```

## 4. 事件契约定义（预留给 L1.5 event-contract.md）

每个事件简要定义载荷结构（不重复定义，预留给 L1.5 Architecture）：

```
AnnotationSubmitted:
  - annotationId: UUID
  - taskId: UUID
  - annotatorId: UUID
  - projectId: UUID
  - submittedAt: ISO8601
  - 触发下游: ReviewRequested（同进程）
```

## 5. 事件风暴完整示例

### 示例：标注业务线（B02-annotation）

| 事件名 | 触发时机 | 载荷 | 分类 |
|--------|---------|------|------|
| AnnotationCreated | 标注员创建标注 | {annotation_id, task_id, type} | 进程内 |
| AnnotationSubmitted | 标注员提交质检 | {annotation_id, task_id} | 进程内 |
| ReviewPassed | 质检通过 | {review_id, annotation_id} | 进程内 |
| ReviewRejected | 质检驳回 | {review_id, annotation_id, reason} | 进程内 |
| DataAvailable | 采集数据上传完成 | {collection_id, scene_ids[]} | 跨上下文 |
| SceneReady | 采集数据可仿真回放 | {collection_id, scene_ids[]} | 跨上下文 |
| AnnotationReady | 标注结果可仿真叠加 | {annotation_id, scene_ids[]} | 跨上下文 |

EDD 决策：进程内 EventBus 处理标注内部事件（Created/Submitted/Passed/Rejected）；消息队列处理跨上下文事件（DataAvailable 触发标注任务创建）。
