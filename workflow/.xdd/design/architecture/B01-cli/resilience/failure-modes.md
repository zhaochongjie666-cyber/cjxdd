# 失败模式(FMEA)— B01-cli

> 命令行调度器的失败模式分析。每条带 FXX 编号、影响、触发、检测、兜底。
> 标签 `@failure-mode-FXX` 给 failsafe/chaos 引用(连字符,非空格)。

| FXX | 失败模式 | 影响 | 触发条件 | 检测方式 | 关联 RXX |
|---|---|---|---|---|---|
| **F01** | claude CLI 不可用(不在 PATH) | 全链无法启动 | claude 未安装/PATH 缺失 | `which claude` 非 0;subprocess 启动报错 | — |
| **F02** | claude 调用超时 | 单节点卡死 | 模型限流/prompt 过大/网络慢 | select 心跳计时 > 3000s | B01-R04 |
| **F03** | claude 返回非 success | 节点产出不完整 | rc≠0 / result subtype≠success | parser_msg 解析 result 消息 | — |
| **F04** | models.yaml 缺失或 key 空 | 模型 env 拼不出 | 文件不存在 / env 字段空 | MODEL_ENVS 检查 | — |
| **F05** | current-iteration 缺失/损坏 | iter 号错,产物落错位 | 文件不存在 / 内容无可解析数字 | current_iter() 检查 | B01-R06 |
| **F06** | 节点产出路径落错(不忠实 skill) | 下游 skill 读不到上游 | build_nodes 路径错 | verify 对照 R01 检测 | B01-R01 |
| **F07** | 验收闸永远不过 | 死循环回退 | gate 条件无法满足 | iter 计数达上限 | B01-R04/R05 |
| **F08** | iter 迁移失败(init.sh 非 0) | 卡在旧 iter | init 脚本报错 / .xdd 损坏 | subprocess returncode | B01-R04 |
| **F09** | prd.md 缺失 | 无从开始 | task_dir 无 prd.md | 文件存在检查 | — |
| **F10** | 磁盘满(log/产物写不进) | 节点产出丢失 | 磁盘空间耗尽 | write 抛异常 | — |

## 维度覆盖

| 维度 | 覆盖(FXX) |
|---|---|
| 外部依赖(claude CLI) | F01 F02 F03 |
| 配置(models/iter 文件) | F04 F05 |
| 数据正确性(路径/产物) | F06 |
| 流程(验收循环) | F07 F08 |
| 输入(prd) | F09 |
| 资源(磁盘) | F10 |

≥ 6 维 ✅。workflow 无网络/DB/跨地域维度(本地工具),相应 N/A。

## 严重度分级

- **P0**(阻断,必须人工):F01(claude 不可用)、F09(无 prd)
- **P1**(可自动恢复/重试):F02 F03 F04 F05 F06 F08 F10
- **P2**(防死循环兜底):F07
