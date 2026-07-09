# 意图锚 — workflow(外部编排层)

> 整条 xdd 链的根。后面所有 spec 规则、架构决策、代码实现,最终都要能回溯到这里的一句话意图。
> 这一层是**用户审的契约**——确认对齐才往下。

## 一句话

> 让 xdd 的八节点工作流可以被**无人值守地(命令行)、可视化地(网页)**跑起来——调 xdd skill,不替代它们。

## 现状痛点

xdd 的 skill + agent 是给 AI agent 读、由 agent 自走的工作流(平台中立)。但有两类场景 agent 自走覆盖不到:

1. **无人值守/CI/批量** —— 没有交互式 agent 在场,需要外部调度器按序触发 `claude` CLI 把八节点跑完。
2. **可视化编排** —— agent 自走时节点顺序和回退策略硬编码在 walker 里;用户想自己决定有哪些节点、怎么连、哪里循环。

旧版 `workflow/run_workflow.py`(已归档到 `archive/workflow-pre-xdd/`)尝试补这块,但有三个硬伤:
- **节点产出路径 7/8 是错的**(硬编码 `design/spec/rules.md`,实际 skill 产 `{bxx-slug}/rules.md`+`*.feature`)。
- **prompt 不传上下文**(不给 claude 业务线/iter/上下游指针)。
- **验收闸扫错符号**(扫 `- [ ]`,但 skill 自检用 `□`)。

## 做什么(范围)

| 做 | 不做 |
|---|---|
| CLI:`run_workflow.py` 按序调 claude CLI 跑八节点 + 验收循环 | 不重新实现 skill 逻辑(只调 skill) |
| Web:画布拖拽节点 + 拉回退边 + SSE 实时看 | 不做用户认证/多租户(单机本地工具) |
| 忠实反映 8 个 skill 真实入口/产出/上下游 | 不给 workflow 强加 docker/服务/DB(Python 包) |
| 验收循环走 `init --iter N+1` 迁移 | 不在 cjxdd 仓库根跑(避 Meta 守卫) |

## 两条业务线(限界上下文)

- **B01-cli**:命令行调度器。八节点顺序执行 + verify 验收闸 + 验收未过回退重跑。
- **B02-web**:可视化编排前端。节点/边是图、拖拽编辑、SSE 实时回显、任意回退边。

两者共享同一套"节点定义"(skill 名、产出路径、prompt 构造、模型选择),Web 是 CLI 的可视化 driver。

## 非目标(不做什么)

- ❌ 不实现 skill 内容 —— workflow 只发 `use skill: xdd-xxx` 给 claude,怎么做由 skill 教。
- ❌ 不依赖平台 hook/plugin —— 纯 subprocess 调 CLI + 纯前端,平台中立。
- ❌ 不改变 xdd 产物契约 —— 节点产出路径必须和 skill 真实产出 1:1 对齐(旧版 bug,本次修)。
- ❌ 不做 walker —— workflow 是调度器,不是自走 agent。

## 成功标准

→ 详见 `runs/iter-1/goals.md` 的 G 编号。核心三条:
1. CLI 能把八节点跑完,产出路径与 skill 真实产出一致。
2. Web 能起 server,画布编辑 + SSE 实时回显节点状态和流式日志。
3. 验收闸正确识别 skill 自检符号(`□` 和 `- [ ]` 都认)。
