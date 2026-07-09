# 模块全景(module-landscape)— workflow

> 哪些是基础建设(base/foundation,两业务线共享),哪些是业务上下文(core)。
> 业务→基础单向依赖,反向依赖必须为空。

## 基础上下文(base/foundation)

被两条业务线共享的核心抽象,下沉为基础模块。

| 模块 | 职责 | 对外接口(端口) | 实现方案 | 子域类型 |
|---|---|---|---|---|
| **nodes**(节点定义) | 八节点产出路径 + prompt 构造,忠实 skill | `build_nodes(task_dir)` `node_prompt(...)` | Python 模块,数据驱动 | 通用(行业通用调度抽象) |
| **gate**(验收闸) | 认 □ + - [ ] 双符号判定 | `gate_check(path) -> (bool, stats)` | 正则,纯函数 | 通用 |
| **claude_runner**(CLI 调用) | subprocess 调 claude + stream-json 解析 | `parser_msg(data)` `run_agent_stream(...)` | subprocess + select | 通用 |
| **models**(模型配置) | 读 models.yaml + 热刷 | `load_model_envs()` `available_models()` | yaml,模块级缓存 | 支撑 |
| **iter**(迭代指针) | 读/解析 current-iteration | `current_iter(xdd_dir)` | 读文件 + 正则解析 | 支撑 |

## 业务上下文(core)

| 上下文 | 核心子域 | 依赖的基础模块 |
|---|---|---|
| **B01-cli** | 命令行调度 + 验收循环(iter 迁移) | nodes, gate, claude_runner, models, iter |
| **B02-web** | 画布编排 + 图执行引擎 + SSE | nodes, gate, claude_runner, models, iter |

## 依赖矩阵(业务 × 基础)

|  | nodes | gate | claude_runner | models | iter |
|---|---|---|---|---|---|
| **B01-cli** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **B02-web** | ✓ | ✓ | ✓ | ✓ | ✓ |

**反向依赖检查**:基础模块**不得** import 业务模块。
- nodes/gate/claude_runner/models/iter 都不 import `run_workflow`(B01)或 `web.engine`(B02)。
- 业务模块可 import 基础模块。✓ 单向。

## 复用机制

- **直接调用**(业务"用"基础):engine 调 `gate_check`、`build_nodes`;CLI 调 `run_agent_stream`。
- **共享内核**:iter 号是全局共享的简单值,B01 验收循环和 B02 engine 都读同一个 current-iteration 文件。

## 文件落位

```
workflow/
├── nodes.py              # 基础:节点定义(@B01-R01/B01-R02/B02-R05)
├── gate.py               # 基础:验收闸(@B01-R03/B02-R05)
├── claude_runner.py      # 基础:claude CLI 调用内核
├── models.py             # 基础:模型配置
├── iter_utils.py         # 基础:iter 指针(@B01-R06)
├── run_workflow.py       # B01 业务:CLI 调度 + 验收循环(@B01-R04/R05)
└── web/                  # B02 业务
    ├── engine.py         # 图执行引擎(@B02-R03)
    ├── server.py         # FastAPI + SSE(@B02-R04)
    ├── graph_io.py       # graph.json 读写(@B02-R01/R06)
    └── static/           # 画布前端
```
