/**
 * extensions/xdd/core/controller.ts 里有一批写死的用户面文案（SEND_FOLLOWUP /
 * NOTIFY effect 的 text），因为 `XddController` 是 xdd 和 Normal Flow 共用的
 * 同一份代码：例如 `[xdd] 阶段 X gate 已通过。请调用 xdd_advance 推进。`。直接
 * 把这些 effect 转给 Pi，会让 NF 的自动续跑提示喊出不存在的 xdd_* 工具名（NF
 * 注册的是 nf_*），或引用 NF 没有的 xdd_next_task 工具。
 *
 * 这里做一次性文案改写，只覆盖 extensions/xdd/core/controller.ts 里已核实存在
 * 的写死字符串（每条规则的注释标注了来源）。不修改 extensions/xdd 任何文件——
 * 改写只发生在 effect 文本流入 Pi 之前（见 adapter.ts）。
 *
 * 已知耦合风险：这是对 xdd 具体措辞的字符串匹配，不是语义级隔离。如果
 * core/controller.ts 后续改写这些提示语，这里可能需要同步更新；已尽量用
 * token 级正则（xdd_(\w+) -> nf_$1）而不是整句匹配来降低脆性。
 *
 * 注意：xdd 的阶段 system prompt（extensions/xdd/context.ts 的
 * buildActiveStageSystemPrompt / XDD_PREAMBLE）不在这里处理——那段文案大段引用
 * xdd_diagnose / 反思机制，NF 完全没有对应流程，字符串替换会很脆。NF 改用自己
 * 的 prompt builder（见 ./context.ts），不复用 xdd 的 system prompt。
 */

/**
 * 顺序很重要：更具体的短语级规则必须排在通用的 xdd_* -> nf_* 正则前面，否则
 * 通用规则会先把 "xdd_next_task" 变成不存在的 "nf_next_task"，后面的短语匹配
 * 就再也匹配不上了。
 */
const TEXT_REWRITES: ReadonlyArray<readonly [RegExp, string]> = [
	// resumeTransition() 的 SEND_FOLLOWUP："...请调 xdd_next_task 继续。"
	[/请调\s*xdd_next_task\s*继续。?/g, "请调用 nf_observe / nf_difference 继续。"],
	// schedulerText() 的 idle/working 分支："...请调用 xdd_next_task，根据 Difference 工作。"
	[/请调(?:用)?\s*xdd_next_task[，,]?\s*根据\s*Difference\s*工作。?/g, "请调用 nf_observe / nf_difference，根据差距继续工作。"],
	// 兜底：其余位置提到 xdd_next_task 但没匹配上面两条短语的情况。
	[/xdd_next_task/g, "nf_observe / nf_difference"],
	// 通用兜底：advance/observe/desired_state/difference/submit_artifact/rollback
	// 都有同名后缀的 nf_* 工具，直接换前缀即可。
	[/xdd_(\w+)/g, "nf_$1"],
	// agentEndedTransition() 的 provider_error NOTIFY："...请使用 /xdd-resume。"
	[/\/xdd-resume\b/g, "/normal-flow-resume"],
	// resumeTransition() 的 SEND_FOLLOWUP 前缀。
	[/\[xdd 自动推进\]/g, "[normal-flow 自动推进]"],
	// 其余所有 "[xdd]" 品牌前缀（run 启动/暂停、错误、gate 结果等 NOTIFY/SEND_FOLLOWUP）。
	[/\[xdd\]/g, "[normal-flow]"],
	// startTransition() 的 SEND_FOLLOWUP："[xdd] run ${runId} 启动。" 里的裸词 "xdd run"（防止大小写/无括号变体遗漏）。
	[/\bxdd run\b/g, "Normal Flow run"],
];

/** 把 xdd Controller 生成的 effect 文案改写成 Normal Flow 品牌 + 真实工具名。 */
export function translateXddText(text: string): string {
	let out = text;
	for (const [pattern, replacement] of TEXT_REWRITES) {
		out = out.replace(pattern, replacement);
	}
	return out;
}
