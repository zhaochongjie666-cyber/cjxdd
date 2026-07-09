# 韧性测试计划 — B01-cli

> 把混沌场景转测试矩阵。workflow 无 docker compose 环境,自动化用 pytest + monkeypatch,手工用 shell 注入。

| FXX 失败模式 | 自动化测试(pytest) | 手工测试(shell) | 巡检项 |
|---|---|---|---|
| F01 claude 不可用 | monkeypatch subprocess.Popen 报错 | `PATH=/empty run_workflow` | `which claude` |
| F02 超时 | monkeypatch select 计时,timeout=1s | `sleep 9999 \| cat` 喂 stdin | log/claude/*.log 时间戳 |
| F03 claude 非 success | mock stream-json 返回 result subtype=error | `kill -9 <pid>` | rc 记录 |
| F04 无 key | 写空 env 的 models.yaml | `echo 'env:""'` | 启动警告 |
| F05 iter 损坏 | 写 "garbage" 到 current-iteration | `echo garbage > .xdd/current-iteration` | iter 回退警告 |
| F06 产出路径错 | 对照 build_nodes vs skill 真实产出断言 | 人工对照 spec rules.md 路径表 | verify 报告路径检查 |
| F07 验收死循环 | monkeypatch gate_check 返回 False | mock verify 产物 | iter 计数 |
| F08 init 失败 | mock subprocess returncode≠0 | 破坏 .xdd/ 目录 | init 输出 |
| F09 无 prd | 删 prd.md 跑 | `rm prd.md` | 入口检查 |
| F10 磁盘满 | mock open 报 OSError | `dd` 填满 /tmp | write 异常 |

## 自动化测试组织

```
tests/
├── test_gate.py            # F02/F03/F04  gate 判定
├── test_nodes.py           # F06          产出路径忠实 skill
├── test_iter_utils.py      # F05          iter 解析
├── test_workflow_loop.py   # F07/F08      验收循环 + iter 迁移
└── test_prd_check.py       # F09          前置检查
```

## 覆盖目标

- P0(F01/F09):必须自动化(快速失败,避免误启动)。
- P1(F02~F06/F08/F10):至少手工演练 + 关键项自动化。
- P2(F07):自动化(monkeypatch 死循环上限)。
