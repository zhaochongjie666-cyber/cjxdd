# 混沌场景(chaos)— B01-cli

> workflow 无 docker/网络服务,混沌注入用**进程级**手段(kill/超时/改文件)。
> 每场景:`@chaos` + `@failure-mode-FXX` + `@P0/P1` + `@covers-B01-RXX` + Gherkin。

## 场景 1:claude 子进程被 kill(@failure-mode-F03)

```gherkin
@chaos @failure-mode-F03 @P1 @covers-B01-R04
Feature: claude 子进程中途被杀
  Scenario: 杀掉正在跑的 claude 进程
    Given workflow 正在跑 architecture 节点,claude 子进程 PID 为 12345
    When 注入: kill -9 12345
    Then claude 子进程退出(returncode≠0)
      And workflow 应检测到 claude 非 success
      And 应在日志记录 "[warn] claude 未返回 success"
      And 不应无限重试该节点
```
注入命令:`kill -9 <pid>`(替代 docker kill)。

## 场景 2:超时模拟(@failure-mode-F02)

```gherkin
@chaos @failure-mode-F02 @P1
Feature: claude 长时间无响应
  Scenario: claude 卡住不发数据
    Given claude 子进程启动后挂起(sleep)
    When 等待超过 3000s(或测试时调小超时阈值)
    Then select 心跳应累计超时
      And 应 kill 该 subprocess
      And 节点应标 failed
```
注入命令:`sleep 999999 | cat`(让 claude stdin 挂起)/ 测试时设 timeout=10s。

## 场景 3:models.yaml 无 key(@failure-mode-F04)

```gherkin
@chaos @failure-mode-F04 @P1
Feature: 模型 key 缺失
  Scenario: models.yaml 的 env 为空字符串
    Given models.yaml 内容为 models: YACC: env: ""
    When workflow 加载模型配置
    Then 应检测到 env 为空
      And 应输出警告"模型 YACC 无 env 配置"
      And 应继续用默认(claude 读自身环境)
      But 不应崩溃
```
注入命令:`echo 'models: {YACC: {env: ""}}' > models.yaml`(备份原文件)。

## 场景 4:current-iteration 损坏(@failure-mode-F05)

```gherkin
@chaos @failure-mode-F05 @P1 @covers-B01-R06
Feature: iter 指针损坏
  Scenario: current-iteration 内容是乱码
    Given .xdd/current-iteration 内容为 "garbage"
    When workflow 读取当前 iter
    Then 应回退默认 iter 1
      And 应输出警告
      But 不应崩溃
```
注入命令:`echo garbage > .xdd/current-iteration`。

## 场景 5:验收死循环(@failure-mode-F07)

```gherkin
@chaos @failure-mode-F07 @P2 @covers-B01-R04
Feature: 验收永远不过
  Scenario: verify 产出永远含未完成自检项
    Given 模拟 gate_check 永远返回 False
    When workflow 跑验收循环
    Then 应在 iter 达上限(如 5)后停止
      And 应报告"疑似无法收敛"
      But 不应无限循环
```
注入命令:测试时 monkeypatch gate_check 返回 False。

## 场景 6:prd.md 缺失(@failure-mode-F09)

```gherkin
@chaos @failure-mode-F09 @P0
Feature: 无需求文档
  Scenario: task_dir 没有 prd.md
    Given task_dir 下无 prd.md
    When 启动 workflow
    Then 应立即报错"缺需求文档"
      And 不应进入八节点执行
```
注入命令:`rm prd.md`(在测试 task_dir)。
