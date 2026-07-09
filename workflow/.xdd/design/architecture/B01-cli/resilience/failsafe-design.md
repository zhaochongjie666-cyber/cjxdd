# 兜底设计(failsafe)— B01-cli

> 每个兜底策略标 `@failure-mode-FXX`(连字符),实现位置精确到模块函数。

## 兜底模式清单(≥5)

| 兜底模式 | 应对的失败 | 实现位置 | 机制 |
|---|---|---|---|
| **超时熔断** | @failure-mode-F02 claude 超时 | `claude_runner.run_agent_stream` | select 心跳计时,>3000s kill subprocess,节点标失败 |
| **失败重试** | @failure-mode-F03 claude 非 success | `run_workflow.workflow`(可加 retry) | 当前记 warn 继续下节点;关键节点可加重试计数 |
| **配置缺失降级** | @failure-mode-F04 无 key / @failure-mode-F05 无 iter | `models.load_model_envs` `iter_utils.current_iter` | 缺 key 用默认 env+警告;缺 iter 回退 1+警告 |
| **路径忠实校验** | @failure-mode-F06 产出落错 | `nodes.build_nodes`(数据驱动)+ verify 对照 | build_nodes 路径对照 skill 真实产出表;verify 按表验收 |
| **死循环上限** | @failure-mode-F07 验收永不过 | `run_workflow.workflow` | iter 计数达上限(如 5)停止+报告"疑似无法收敛" |
| **前置检查(快速失败)** | @failure-mode-F01 claude 不可用 / @failure-mode-F09 无 prd | `run_workflow.workflow` 入口 | which claude / prd.md 存在性,缺则立即报错退出,不进八节点 |
| **迁移失败保护** | @failure-mode-F08 init 非 0 | `run_workflow.workflow` | init 失败则停止,保留旧 iter 不破坏 |

## 决策树(关键场景)

### claude 节点超时(@failure-mode-F02)
```
select 心跳 → 10s 无数据 → 检查耗时
  → > 3000s? → kill subprocess → 节点标 failed → 记 log/claude/*.log → 报告
  → < 3000s? → 继续 select 等待
```

### 验收循环收敛判断(@failure-mode-F07)
```
verify gate 检查
  → 过? → 🎉 完成
  → 未过? → iter < 上限? → init --iter N+1 → 重跑 plan→execute→verify
            → iter ≥ 上限? → 停止 + 报告"疑似无法收敛,检查 verify gate 条件"
```

## 不做的兜底(及理由)

- **无断路器(circuit breaker)** —— workflow 不调外部服务集群,只调本地 claude CLI,无需熔断积累。
- **无降级到本地缓存** —— 无数据持久化需求,产物本就落本地文件。
- **无幂等重试** —— 每节点产物有幂等性(同路径覆盖),重跑即幂等,无需去重。
