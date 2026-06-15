# xdd framework 回归测试（凌晨定时）

凌晨 ~01:03 由系统 crontab 触发，对**整个 xdd 工作流**做回归：跑 **3 次**独立 trial（无头 **MiniMax-M3** 驱动 walker 走完整 init→…→verify），验证「通路可行」；任一失败做**项目级修复验证**（根因 → 改 framework 到独立分支，不碰 main → 重跑证明）。

## 机制

```
crontab @ 01:03
   └─ run-nightly.sh（bash 编排）
        ├─ TIER 1  静态 smoke（smoke-xdd-design-anchor.sh，13 项，确定性，无 LLM）
        ├─ TIER 2  ×3 trial：mktemp 空目录 → m2cc -p（MiniMax-M3 无头）驱动 walker
        │           走 init→understand→spec→architecture→wire→resilience→plan→execute→verify
        │           做 hello-API → 自检 → 输出结构化结果块
        └─ TIER 3  任一失败 → m2cc -p 根因 + 改 agents/skills → regression-fix-<日期> 分支
                    → 重跑该检查 → 证明修复有效（不碰 main）
```

- **"测试三次"** = 一次触发里 3 个独立 fresh-demo trial（查 LLM 驱动流程的确定性/flaky）。3/3 过 = 通路可行。
- **MiniMax-M3** 通过 `m2cc`（~/.bashrc 的 bash 函数）环境驱动。`lib/m2cc-env.sh` 从 bashrc 提取 env（token 不入库），无头 `claude -p` 跑。等价于交互式 "Tamas"(tmux+m2cc) 手法的非交互版本（见 `docs/TIMAS-TESTING-PITFALLS.md`）。

## 文件

| 文件 | 作用 |
|------|------|
| `run-nightly.sh` | crontab 入口，bash 编排（smoke + 3 trial + 修复验证 + 报告）|
| `lib/m2cc-env.sh` | 从 ~/.bashrc 提取 m2cc env，提供 `run_m2cc_prompt` 无头驱动 |
| `prompts/trial-e2e.md` | TIER 2：walker 全流程做 hello-API + 自检 + 结果块 |
| `prompts/fix-verify.md` | TIER 3：根因 + 改 framework 到独立分支 + 重验 |
| `runs/<ts>/` | 单次运行的所有产物（trial 目录、m2cc 输出、结果块、证据）。>7 天自动清。**gitignore** |
| `reports/<ts>.md` | 汇总报告。`reports/cron.log` = crontab stdout/stderr。**gitignore** |

## 手动跑

```bash
cd /home/zhaocj/ws/cjxdd
bash regression/run-nightly.sh                 # 正式：smoke + 3 trial + 修复
TRIALS=1 bash regression/run-nightly.sh        # 调试：只跑 1 个 trial
TRIAL_TMO=600 TRIALS=1 bash regression/run-nightly.sh   # 缩短超时快速验证
```

## crontab 安装

```bash
# 加（幂等，不重复）：
LINE='3 1 * * * /home/zhaocj/ws/cjxdd/regression/run-nightly.sh >> /home/zhaocj/ws/cjxdd/regression/reports/cron.log 2>&1'
( crontab -l 2>/dev/null | grep -vF "run-nightly.sh"; echo "$LINE" ) | crontab -
crontab -l   # 确认
```

- 时间 `3 1 * * *` = 每天 01:03（稍偏整点，避免 fleet 拥堵）。crond 在 WSL2 已 enabled，开机自启。
- 修改时间：改上面 `$LINE` 的前两个字段，重新执行。

## 结果判定

- **GREEN** = smoke 13/13 PASS 且 3 个 trial 全 PASS（或被 TIER 3 修好并重验通过）→ 通路可行。
- **RED** = 有 trial 未能恢复 → 看 `runs/<ts>/` 日志根因。

修复都进 `regression-fix-<日期>` 分支，**不碰 main**，可人工 review/merge。
