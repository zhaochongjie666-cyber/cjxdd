# xdd-subagents

`xdd-subagents` 是 cjxdd 自带的 subagent 插件体系。它参考 `pi install npm:pi-subagents` 的资源组织方式：插件入口负责注册工具/命令，`agents/` 保存可发现的角色说明，`prompts/` 保存可复用工作流提示词。

## 安装到用户作用域

仓库根目录的 `AGENTS.md` 已推荐把整个 `extensions` 目录链接到 Pi 用户作用域：

```bash
ln -sf $REPO_ROOT/extensions ~/.pi/agent/extensions
```

之后可在 Pi 中加载 `extensions/xdd-subagents/index.ts`，或通过用户作用域自动发现。

## 内置角色

- `xdd-scout`：只读侦察，定位入口、约束、风险。
- `xdd-researcher`：外部资料/官方文档/近期事实研究。
- `xdd-planner`：写计划与验证闭环，不实现业务代码。
- `xdd-worker`：按批准计划执行最小实现。
- `xdd-reviewer`：攻击检查正向与兜底证据。
- `xdd-context-builder`：构建可交接上下文包。
- `xdd-oracle`：高风险决策前给第二意见。
- `xdd-delegate`：通用轻量委派角色。

## 工作流 prompts

`prompts/` 内置 review-loop、parallel-review、parallel-research、parallel-context-build、parallel-cleanup、parallel-handoff-plan、gather-context-and-clarify，用于对齐 pi-subagents 的常见委派工作流。

## 工具

- `xdd_list_subagents`：列出角色、适用阶段、工具边界。
- `xdd_delegate_prompt`：把角色 frontmatter、系统提示和任务组合成可交给子会话的委派提示词。
- `xdd_subagent_run`：用 `pi -p` 启动 xdd child process，支持 single / parallel / chain 和 async。
- `xdd_subagent_status`：读取 `.xdd/subagents/runs.json` 查看 run 状态。
- `xdd_subagent_wait`：轮询等待指定 run 完成或超时。
- `xdd_subagent_stop`：对记录了 pid 的 run 发送 `SIGTERM` 并标记 stopped。
- `xdd_subagent_fleet`：汇总最近 runs 的 queued/running/succeeded/failed/stopped 计数。
- `xdd_subagent_tree`：按 `parentRunId` 渲染 run lineage / session tree。
- `xdd_subagent_message` / `xdd_subagent_messages`：通过 `.xdd/subagents/intercom/*.jsonl` 与 child run 进行文件型 supervisor 通信。
- `xdd_subagent_claim`：接管 lease 已过期的 queued/running run，为跨进程 supervisor 接管打基础。
- `xdd_subagent_drain`：reconcile run store，标记 stale running runs，并统计 child_to_supervisor 消息；也可通过 `xddSubagents.autoDrain.enabled` 在 `agent_end` 自动执行。
- `xdd_subagent_watchdog_check`：用 `xdd-reviewer` 对当前 git diff 发起只读攻击检查，并在 TypeScript 项目中附带 `tsc --noEmit` 静态诊断。
- `xdd_subagent_watchdog_recommend_model`：根据当前主模型推荐互补 watchdog 强模型。
- `xdd_subagent_child_watchdog`：用 `xdd-reviewer` 审查指定 child run transcript，攻击伪成功、遗漏验证和兜底缺口。
- `xdd_subagents_doctor`：审查与 `nicobailon/pi-subagents` 的能力差距。

## 正向和兜底

正向路径：发现 agent markdown → 解析 frontmatter → 注册工具 → 生成委派 prompt。

兜底路径：缺失 `agents/` 时返回空列表；frontmatter 缺少 `name` 或 `description` 时抛出明确错误；未知 agent 委派时返回 `ok: false`，不伪造角色。


## 投产 smoke test

不要把 API key 写入仓库。按需在当前 shell 注入环境变量后运行：

```bash
MINIMAX_CN_API_KEY=... extensions/xdd-subagents/scripts/smoke-pi.sh MiniMax-M3
```

脚本默认使用已安装的 `pi --provider minimax-cn --model <model> --no-session -p hi` 做最小端到端验证，匹配 MiniMax 中国区账号；如需全球区可设置 `PI_PROVIDER=minimax` 并使用 `MINIMAX_API_KEY`。

如果希望 `xdd_subagent_run` 派生 child Pi session 时也默认走中国区 MiniMax，可在用户级 `~/.pi/agent/settings.json`（推荐）中配置：

```json
{
  "xddSubagents": {
    "defaultProvider": "minimax-cn",
    "defaultModel": "MiniMax-M3"
  }
}
```

也可以在调用 `xdd_subagent_run` 时传入 `provider: "minimax-cn"` 和 `model: "MiniMax-M3"` 做单次覆盖。不要把配置写到项目 `.pi`，本仓库约束禁止写 `{{current_project}}/.pi`。

## 与 nicobailon/pi-subagents 的复刻结论

没有完全复刻。`pi-subagents` 是完整执行器：安装后能启动 child Pi session，支持 foreground/background、single/parallel/chain、状态/等待/fleet、配置覆盖、watchdog、intercom、artifact 与 transcript 管理。当前 `xdd-subagents` 已新增基础 child process runner、run store、artifact/transcript、single/parallel/chain 调度骨架、chain previous 输出注入、wait/stop/fleet/drain/autoDrain 工具、settings model override 读取和 opt-in watchdog diff/static diagnostics review，并继承 cwd、git status 与 AGENTS.md 指令；并为 run 写入 lease/heartbeat；但仍缺上游级完整 Pi session tree 继承和上游级实时 supervisor channel。

可用 `xdd_subagents_doctor` 查看逐项差距：

- 已实现：插件资源组织、agent/prompt resources、agent frontmatter 发现、委派 prompt 生成、基础 run store/artifact/transcript、wait/stop/fleet/drain/autoDrain 工具骨架、settings model override 读取、run lease/heartbeat、expired lease claim。
- 部分实现：子会话执行器、single/parallel/chain 调度、async 状态查看、内置角色集合（scout/researcher/planner/worker/reviewer/context-builder/oracle/delegate）、watchdog diff/static diagnostics review、watchdog model recommendation、child watchdog transcript review、fork context 继承。
- 未实现：上游级实时 supervisor channel、上游级完整 session tree 继承（当前只有 parentRunId lineage）。

如果目标是“完全复刻 pi-subagents”，下一步应先实现子会话执行器和 run store，而不是继续增加 prompt 模板。

## Production hardening additions

- Session resume: every run now records a `session.resumeToken`; use `xdd_subagent_resume` to build a recovery prompt with the run tree, failed/pending tasks, and structured chain outputs.
- Structured chain output: chain steps write per-task JSON artifacts and pass a structured previous output block to the next task instead of only raw transcript text.
- Supervisor events: runtime state changes append to `.xdd/subagents/events.jsonl`; use `xdd_subagent_events` for a near-real-time status stream without writing project `.pi`.
- Config parity: settings can define `thinking`, `fallbackModels`, and `modelScope` globally or under `agentOverrides.<agent>` in addition to provider/model/disabled.
- Watchdog diagnostics: watchdog tasks include TypeScript static diagnostics and an LSP diagnostics section; if `typescript-language-server` is unavailable it degrades safely to the existing `tsc` path.
