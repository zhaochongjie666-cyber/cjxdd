# TIER 3 — 项目级修复验证（无头 MiniMax-M3）

你是 **xdd framework 维护者**。当前工作目录（CWD）是 **cjxdd framework 仓库自身**（`/home/zhaocj/ws/cjxdd`）。

> ⚠️ 这是 **Meta 任务**。**不要加载 xdd-walker / xdd-orchestrator**（它们对 cjxdd 自身有 Meta 守卫，会拒绝执行）。直接用 `Read` / `Edit` / `Grep` / `Glob` / `Bash` 改 `agents/` 和 `skills/` 下的源码即可。

## 背景

凌晨回归测试中，**trial ${TRIAL_NUM}** 失败了。失败证据和完整运行日志在文件里，**先用 Read 读它们**：

- 失败证据（结构化）：`${FAILURE_EVIDENCE_FILE}`
- 完整 m2cc 运行日志：`${TRIAL_LOG_FILE}`

## 任务

1. **定位根因**。读上面两个文件，穷举 **≥3 个假设**逐个验证。**禁偷懒归因** —— 不要轻易说"网络/环境/模型随机问题"，每个假设要有证据（命令输出 / 文件内容）支撑。
2. **判断根因类别**：
   - **(A) framework 缺陷**（agents/ 或 skills/ 的 bug、流程缺陷、产物模板缺字段、自检脚本语法错等）→ 做最小修复。
   - **(B) 非 framework 问题**（测试自身偶发、MiniMax 输出偏差、demo 一次性噪声）→ **不改 framework**，在 result 里说明类别 B + 证据。
3. **若属 (A) 改了 framework**：
   a. `git checkout -b regression-fix-${DATE}`（若该分支已存在则 `git switch` 到它复用）。**不要碰 main**。
   b. 只 `git add` 改动的 `agents/` `skills/` 文件，commit（Conventional Commits，如 `fix(verify): ...`，**末尾必须**带 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`）。
   c. **重跑失败的那个检查，证明修复真的有效**：
      - smoke 失败 → `bash skills/smoke-xdd-design-anchor.sh`
      - trial 失败 → 针对失败项做最小可重复验证（重跑 `node --test` / `grep` 产物 / 跑 `no-stub-check.sh` 等**确定性 bash 检查**）。
      - **不要**在 tier 3 里重跑整个 walker trial（太重；让下一晚的回归跑来再确认）。
   d. 失败仍穷举 ≥3 假设；修不好就如实标 UNRESOLVED，不要假装 FIXED。
4. **完成后，在 stdout 最后输出结果块**（bash 解析）：

```
<<<XDD_REGRESS_RESULT:BEGIN>>>
trial: ${TRIAL_NUM}
tier: 3
status: FIXED
pathway_verdict: VIABLE
root_cause: <一句话根因>
category: <A framework缺陷 / B 非framework>
fix_branch: <regression-fix-${DATE} 或 ->
fix_diff: <改了哪些文件，或 none>
reverify: <重跑结果，如 "smoke 13/13 PASS" 或 "node --test 10/10 PASS">
failures: <none 或遗留问题>
<<<XDD_REGRESS_RESULT:END>>>
```

- **status** 取值：`FIXED`（改了 framework 且重跑通过）/ `NO_FRAMEWORK_CHANGE`（判为类别 B，未动 framework）/ `UNRESOLVED`（改了或没改，但重跑仍失败）。
- **pathway_verdict** 取值（关键，bash 据此判定通路是否可行）：
  - `VIABLE` = 经你独立验证，trial 的产物/代码/测试**其实是通过的**（"失败"是 harness artifact，如会话超时被杀、结果块没来得及输出、或你已修好）。
  - `BROKEN` = 产物/代码/测试**确有真实缺陷**（如 node --test 真的失败、产物缺失、@implements 断链），且非 framework 能修（模型输出差/偶发）。
  - 判 VIABLE 前必须真的跑过验证命令（node --test / curl / grep 产物 / no-stub-check），把结果填进 reverify。不要凭感觉。
