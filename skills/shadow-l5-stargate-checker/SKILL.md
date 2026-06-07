# shadow-l5-stargate-checker — Stop-gate CLI 验证器 (实施 A5)

> 让用户/AI 在任何 cwd 都能跑 framework 自身的 L5 stop-gate 5 段 + 5.5 段 (以及未来 5.6/5.7/5.8 段), 不必切到 OpenCode plugin session, 不被 Meta 旁路挡掉.

## 1. 为什么需要这个 skill

OpenCode plugin (`plugins/shadow-hooks.ts`) 的 L5 stop-gate 在 cjxdd 仓库自身 (Meta) **整个跳过** (`P0-7 Meta 旁路: 1775`). 想验证硬门禁真 fire 必须切到 demo session, 但 demo session 看不到 cjxdd 框架改动 (plugin 是 per-session 加载).

**本 skill = CLI 直跑 runStopGate, 强绕 Meta 旁路**. 用 `bun plugins/shadow-hooks.ts --run-stop-gate` 调 5 段 + 5.5 段, 把红 toast 等价输出落 stdout.

## 2. 何时自动加载

不自动加载. 用户在以下场景手动调:
- 想验证 framework 改完 commit 之前, 5 段真能 fire
- 想看 demo 项目当前 stop-gate 状态
- CI / smoke test 集成

## 3. 用法

```bash
# 跑 demo 项目 stop-gate (用 demo 的 .shadow/current-iteration 决定 iter)
bash skills/shadow-l5-stargate-checker/bin/check.sh /home/zhaocj/ws/cjxdd/demo/vlademo

# 指定 iter
bash skills/shadow-l5-stargate-checker/bin/check.sh --iter iter-3 /path/to/project

# 或 env 方式
ITER=iter-3 PROJECT_ROOT=/path/to/project bash skills/shadow-l5-stargate-checker/bin/check.sh
```

退出码:
- `0` = 5 段 + 5.5 段全 clean (success toast)
- `1` = 至少 1 段 hard error (error toast, 通常 demo 现状)
- `2` = schema 没装上 / project-root 不存在 / .shadow 缺席
- `3` = 写 current-iteration 临时覆盖失败

## 4. 实现原理

`plugins/shadow-hooks.ts`:
- L89: 加 module-level `let _forceRunStopGate = false`
- L2192: `function runStopGate` → `export function runStopGate`
- L1775: meta bypass 加 `&& !_forceRunStopGate` 守卫
- L2442+ (新增): `runStopGateCli()` + 文件末 CLI 入口, 解析 `--run-stop-gate --project-root DIR [--iter N] --schema PATH`

CLI 进程设置 `_forceRunStopGate = true`, `runStopGate` 接 `skipMetaBypass: true`, 5 段照常跑不挡. 真实 OpenCode event ctx 永远不动 `_forceRunStopGate` (闭包变量, 只 CLI 入口写).

## 5. 跟其他 5 修法 (A1-A4) 的关系

A1/A2/A3/A4 的 5.5/5.6/5.7/5.8 段真生效后, 跑本 CLI 必出红错误 (在没修 demo 之前). 这是 A5 设计的**核心价值**: 验证 5 段全 hard, 用户能直接看到.

## 6. 不要做

- ❌ **不要在 OpenCode 进程内调本 CLI** — OpenCode 已经加载 plugin, event ctx 走 `runStopGate` 自身, 不必绕
- ❌ **不要覆盖 framework 自身 `.shadow/current-iteration`** — CLI 临时写 iter, 跑完会恢复 (try/finally)
- ❌ **不要把 `_forceRunStopGate` 当成 "禁用 Meta 旁路" 的万能开关** — 它是 CLI 专用, OpenCode event ctx 仍走 Meta 旁路 (这是设计)
