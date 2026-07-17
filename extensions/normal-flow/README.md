# Normal Flow (NF)

xdd 的精简版：把 xdd 的 10 阶段折叠为 5 个（explore → spec → plan → implement →
verify），砍掉 AIGate / 外部可编程 Hooks / Blind Journey / Group Gates /
Renderers，只保留 reconcile 范式（desired state + 硬 gate）+ Controller 状态机。

设计文档：[`Docs/normal-flow.md`](../../Docs/normal-flow.md)。

## 用法

```
/normal-flow <任务描述>       # 启动一个新 run
/normal-flow-resume           # 从暂停状态或 checkpoint 恢复
/normal-flow-stop             # 中断当前 run（可再 resume）
```

## 与 xdd 的关系

**纯新增，不修改 `extensions/xdd/` 任何文件。** NF 复用 xdd 的：

- `XddController` / `RuntimeStore` / `.xdd/runtime.json`（同一份 schema）
- 硬 Gate helper（`requireGlobs*` / `requireTestsPass` / `requirePatternInSource`）
- Policy（`enforceToolCallPolicy` 等）、Audit、Harness、`archiveRun`
- `epoch-slicer.ts` / `context-prune.ts`（上下文裁剪）
- `controllerInitScaffold`（NF 没有 init 阶段，靠它建 `.xdd/` 骨架）

NF **不**复用 xdd 的 `context.ts`（system prompt 构建）和
`adapters/pi-controller.ts` 的 `PiControllerAdapter`：

- `extensions/xdd/context.ts` 的 `XDD_PREAMBLE`/`buildStageSystemPrompt` 写死了
  大段 `xdd_next_task`/`xdd_diagnose`/反思机制相关文案，NF 没有对应工具和流程，
  硬改字符串会很脆。NF 用自己的 [`context.ts`](./context.ts) 写等价但准确的
  prompt（仍复用 xdd 的 `NO_CODE_CONSTRAINT`/`ANTI_AI_CONSTRAINT` 等通用片段）。
- `XddController`（`extensions/xdd/core/controller.ts`）内部有一批写死的用户面
  文案（`[xdd] 阶段 X gate 已通过，请调用 xdd_advance 推进`之类），因为它是 xdd
  和 NF 共用的同一份状态机代码。[`xdd-text-bridge.ts`](./xdd-text-bridge.ts) 在
  这些 effect 文本流入 Pi 之前做一次改写（`xdd_* -> nf_*`、`[xdd] -> [normal-flow]`
  等），[`adapter.ts`](./adapter.ts) 是应用这层改写的 dispatch 包装。这是对 xdd
  具体措辞的字符串匹配，不是语义级隔离——如果 `core/controller.ts` 后续改写这些
  提示语，这里可能需要同步更新（见文件顶部注释）。

## 已知的简化 / 局限

- **不做实时 verify 只读契约的旁路检测**：`nf_submit_artifact` 会拒绝声明写了
  源码的产物路径（`stage.noCodeModification`），但不像 xdd 那样对 verify 阶段
  做全量 snapshot diff（`policy/verify-snapshot.ts`），不拦截绕过 `nf_submit_artifact`
  声明、直接用 bash/write 改动源码又不提交的情况。
- **没有 Hook 系统**：不支持外部可编程的 `before_tools`/`turn_start` 等 hook。
- **`[抽象动作]` 分类不精确**：system prompt 复用 xdd 的 `mapToolToAbstraction`
  作为参考，但它按精确字符串匹配 `xdd_*` 工具名，NF 的 `nf_*` 工具都会落到默认
  的 "Orchestrate" 分类，不影响功能，只是提示语没有 xdd 那么细。
- **归档**：`session_start`/`/normal-flow-resume` 只在 `.xdd/runtime.json` 的
  `plan[].stageName` 全部落在 NF 的 5 阶段集合内时才生效；否则提示该 cwd 已被
  xdd run 占用（或反之提示改用 `/xdd-resume`）。

## 验证

```bash
cd extensions && npx vitest run normal-flow
```

（此环境未安装 vitest 可执行文件；至少应确认 TypeScript 编译无错误。）
