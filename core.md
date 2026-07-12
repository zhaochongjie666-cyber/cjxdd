xdd 流程

输入：用户描述

start
阶段一
1. 调研需求，
2. 编写 user 旅途,
3. 自我攻击，用户旅途实际是否符合？
4. 编写详细的 features,  
5. 自我攻击,  Feature 有无遗漏？有无矛盾？是否偏离了用户旅途？
6. 编写详细的可靠性，Feature 的可靠性、断点恢复、解耦性。 已知的已知，已知的未知，未知的已知，未知的未知
7. 自我攻击  是否有纰漏？

输出：用户旅途， Feature 文档。可靠性，测试方法论，

阶段二，
1. 设计解耦的，模块化的，可单元测试的。
2. 自我攻击  架构一定要解耦。模块化，单点可测试。 模块化编程，组件抽象为基础能力

阶段三，
1. 代码实现。
2. 清理（调试残留 / 格式统一 / 死代码剔除 / 文档同步）。
3. 自我攻击，有无纰漏

阶段四
1. 验证交付，
2. 多方检查

end


State 是唯一事实来源（Single Source of Truth）
Task 必须由 Difference 推导，而不是人工硬编码
Gate 决定阶段推进，不允许模型自行宣布完成
Checkpoint 必须支持 Resume
Controller 必须保持幂等（Idempotent）
任何 Runtime 都只能通过 Adapter 接入，不得依赖 XDD Core

while (true):
observation = observe()

state = buildCurrentState(observation)

diff = compare(desiredState, state)

if diff.isEmpty():
    break

tasks = scheduler(diff)

execute(tasks)

checkpoint()


背景（Why）
目标（Goal）
核心概念（Concept）
数据模型（Data Model）
生命周期（Lifecycle）
状态机（State Machine）
时序图（Mermaid）
TypeScript Interface
JSON Schema
实现要求（MUST / SHOULD / MAY）


它只问两个问题: 
1.当前状态是什么？ 
2.距离目标状态还差什么？ 
这两个问题回答出来，下一步任务就是推导结果，而不是人为编排的流程。

目标定义期望状态；观测重建当前状态；差距生成下一步行动；行动产生事件；事件更新工程状态；控制器持续循环，直到工程状态收敛到目标状态。

                Human
                  │
                  ▼
               Goal
                  │
                  ▼
           Desired State
                  │
                  ▼
         ┌─────────────────┐
         │   Controller     │
         │------------------│
         │ Observe          │
         │ Compare          │
         │ Schedule         │
         │ Update           │
         └─────────────────┘
                  │
     ┌────────────┴────────────┐
     ▼                         ▼

   Current State              Task Queue
         │                         │
         ▼                         ▼
  Engineering Graph          Agent Runtime
         ▲                         │
         └────────────┬────────────┘
                      ▼
                    Events




Event
↓
Observation
↓
State
↓
Difference
↓
Task
↓
Action
↓
Event