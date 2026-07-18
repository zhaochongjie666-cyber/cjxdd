export type ParityStatus = "implemented" | "partial" | "missing";

export type ParityItem = {
	feature: string;
	piSubagents: string;
	xddSubagents: string;
	status: ParityStatus;
	nextStep: string;
};

export const PI_SUBAGENTS_PARITY: ParityItem[] = [
	{
		feature: "子会话执行器",
		piSubagents: "启动独立 Pi child session，前台流式返回或后台继续运行。",
		xddSubagents: "已用 pi CLI 启动 child process、写 transcript，并注入 AGENTS.md/cwd/git status fork context；已支持 parentRunId lineage/tree、session resume token 和 resume prompt；仍不是 Pi 内部原生 session tree。",
		status: "partial",
		nextStep: "继续对齐 Pi 内部原生 session tree/resume API（如果上游暴露）。",
	},
	{
		feature: "执行模式",
		piSubagents: "single / parallel / chain，并支持 previous 输出串联。",
		xddSubagents: "已支持 single/parallel/chain 参数归一化和调度，chain 会写每步 JSON artifact，并把结构化 previous output 注入后续任务。",
		status: "partial",
		nextStep: "继续增强失败自动重试和更强并发隔离。",
	},
	{
		feature: "后台任务",
		piSubagents: "async runs、status/wait/fleet、结果 watcher、自动 drain。",
		xddSubagents: "已支持 async 返回、runs.json、status/wait/stop/fleet/drain、stale reconciliation、run lease/heartbeat、expired lease claim、opt-in agent_end autoDrain，以及 JSONL supervisor event stream。",
		status: "partial",
		nextStep: "继续增强跨 Pi 进程恢复调度和外部 watcher。",
	},
	{
		feature: "角色资源",
		piSubagents: "内置 scout/researcher/planner/worker/reviewer/context-builder/oracle/delegate。",
		xddSubagents: "内置 xdd-scout/xdd-researcher/xdd-planner/xdd-worker/xdd-reviewer/xdd-context-builder/xdd-oracle/xdd-delegate。",
		status: "implemented",
		nextStep: "继续按 xdd 语义调优各角色提示词。",
	},
	{
		feature: "配置覆盖",
		piSubagents: "支持 defaultModel、agentOverrides、thinking、fallbackModels、modelScope。",
		xddSubagents: "已读取用户/项目 settings 的 defaultProvider/defaultModel/thinking/fallbackModels/modelScope 与 agentOverrides.<agent>.provider/model/disabled/thinking/fallbackModels/modelScope，以及 watchdog 配置。",
		status: "implemented",
		nextStep: "继续按 Pi CLI 实际支持的 flag 调整命名兼容。",
	},
	{
		feature: "监督与 watchdog",
		piSubagents: "agent_end watchdog、LSP diagnostics、推荐强模型、child watchdog。",
		xddSubagents: "已新增 opt-in agent_end/manual diff watchdog，会用 xdd-reviewer 审查当前 git diff，并对 TypeScript 项目附带 tsc 静态诊断和 LSP diagnostics fallback；已提供互补强模型推荐；已新增 child transcript watchdog。",
		status: "partial",
		nextStep: "继续接入真正 language-server protocol request/response 级 diagnostics（当前为 CLI probe + tsc fallback）。",
	},
	{
		feature: "插件资源/工作流 prompts",
		piSubagents: "npm 包声明 pi.extensions / pi.skills / pi.prompts，并提供常见 prompt workflows。",
		xddSubagents: "extensions/package.json 已声明 extension、skills、prompts，并补齐常见 xdd workflow prompts。",
		status: "implemented",
		nextStep: "发布前补 package metadata、bin install 或沿用仓库软链接安装。",
	},
];

export function summarizeParity(items = PI_SUBAGENTS_PARITY): string {
	const counts = items.reduce<Record<ParityStatus, number>>((acc, item) => {
		acc[item.status] += 1;
		return acc;
	}, { implemented: 0, partial: 0, missing: 0 });
	const lines = [
		"xdd-subagents parity audit against nicobailon/pi-subagents",
		`implemented=${counts.implemented}, partial=${counts.partial}, missing=${counts.missing}`,
		"结论：没有完全复刻 pi-subagents 的内部原生 session tree；但已达到 cjxdd 可投产复刻面。",
		"",
	];
	for (const item of items) {
		lines.push(`- [${item.status}] ${item.feature}`);
		lines.push(`  pi-subagents: ${item.piSubagents}`);
		lines.push(`  xdd-subagents: ${item.xddSubagents}`);
		lines.push(`  next: ${item.nextStep}`);
	}
	return lines.join("\n");
}
