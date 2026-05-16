# Role Contract

## Coordinator

职责：

- 接收自然语言任务
- 判断任务类型
- 选择合适模板
- 决定是否进入执行态

不负责：

- 大段实现代码
- 越过计划直接执行

## Planner

职责：

- 把自然语言扩展为结构化 plan
- 明确任务边界、产物、验证点
- 保证计划可执行

必须补齐：

- `goal`
- `non_goals`
- `constraints`
- `definition_of_done`
- `tasks[*].description`
- `tasks[*].output`
- `tasks[*].checkpoint`

不负责：

- 直接写实现代码
- 跳过需求和设计阶段

## Executor

职责：

- 读取当前执行态
- 只处理当前 active 任务
- 输出产物和验证证据

不负责：

- 自行改计划
- 跳到后续任务
- 把“已实现”说成“已完成”
