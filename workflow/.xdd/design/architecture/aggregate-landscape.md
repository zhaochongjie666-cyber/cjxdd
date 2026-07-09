# 聚合全景(aggregate-landscape)— workflow

> workflow 是工具型项目,没有 DDD 领域聚合(没有"订单/用户"这类业务对象)。
> 这里的"聚合"适配为**核心抽象的一致性边界**:每个抽象是一个内聚单元,边界外只通过明确接口/事件访问。

## 核心抽象清单(按业务线)

### B01-cli
| 抽象 | 一致性边界 | 不变量 | 子域类型 | 发布事件 |
|---|---|---|---|---|
| **节点定义(NodeSpec)** | name/skill/output_doc/model/extra/gate 七字段一体 | 产出路径必须忠实 skill;id 唯一 | 核心 | — |
| **验收闸(gate)** | 同一份 gate_check 同时认 □ 和 - [ ] | 通过=未完成0且已完成>0 | 核心 | gate_result(passed/stats) |
| **迭代指针(iter)** | current-iteration 单一真理源 | iter 只前进不倒退 | 支撑 | iter_changed |

### B02-web
| 抽象 | 一致性边界 | 不变量 | 子域类型 | 发布事件 |
|---|---|---|---|---|
| **编排图(graph)** | nodes+edges 一体,边只 next/loop 两类 | next 边无环;loop 边必带 condition | 核心 | graph_saved |
| **执行句柄(RunHandle)** | events 队列 + stop_event + finished 一体 | events 单调追加;finished 后不再追加 | 核心 | node_start/node_log/node_done/loop_trigger/workflow_done |
| **图执行引擎** | 拓扑前进 + 回退重跑 | 回退必重置目标及 next 下游;步数上限防死循环 | 核心 | loop_trigger |

## 抽象间关系

- **跨上下文只引"接口"不持有对象引用**:
  - B02 的 engine **import** B01 的 NodeSpec 和 gate_check(遵奉者关系,B02 依赖 B01 核心抽象)。
  - engine 不重写 gate,只调用。
- **一致性边界**:NodeSpec 的产出路径字段是强一致(改一处全局生效);RunHandle 的 events 是最终一致(异步推 SSE)。

## 跨上下文映射(context-map)

| 上游(被依赖) | 下游(依赖者) | 关系 |
|---|---|---|
| B01 NodeSpec/gate | B02 engine | 遵奉者(conformist):B02 完全采纳 B01 的抽象,不另起 |
| B01 iter 指针 | B01 验收循环 + B02 engine | 共享内核(shared kernel):iter 号是全局共享的简单值 |

## 与 spec _landscape 一致性

业务线清单与 `spec/_landscape.md` 一致:B01-cli、B02-web。子域类型也一致。
