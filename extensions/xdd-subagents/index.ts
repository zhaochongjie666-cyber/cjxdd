import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverXddSubagents, findXddSubagent, renderDelegationPrompt } from "./registry.ts";
import { PI_SUBAGENTS_PARITY, summarizeParity } from "./parity.ts";
import { startXddSubagentRun, type XddSubagentRunParams } from "./scheduler.ts";
import { XddSubagentRunStore } from "./runtime-store.ts";
import { stopRun, summarizeFleet, waitForRun } from "./fleet.ts";
import { collectWatchdogDiff, runWatchdogReview } from "./watchdog.ts";
import { loadXddSubagentsSettings } from "./settings.ts";
import { postSupervisorMessage, readIntercomMessages } from "./intercom.ts";
import { reconcileSubagentRuns } from "./reconciler.ts";
import { runAutoDrainIfEnabled } from "./auto-drain.ts";
import { recommendWatchdogModel } from "./watchdog-model.ts";
import { runChildWatchdog } from "./child-watchdog.ts";
import { loadRunTree, renderRunTree } from "./lineage.ts";
import { claimExpiredRun, claimExpiredRuns } from "./supervisor.ts";
import { buildResumePlan } from "./session.ts";
import { readSubagentEvents } from "./event-stream.ts";

const stringSchema = (description: string) => ({ type: "string", description });

export default function xddSubagents(pi: ExtensionAPI) {
	pi.registerTool({
		name: "xdd_list_subagents",
		label: "List xdd subagents",
		description: "列出 xdd 内置 subagent 角色、适用阶段、工具边界和是否允许编辑。",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		async execute() {
			const agents = discoverXddSubagents();
			const lines = agents.map((agent) => `- ${agent.name}: ${agent.description} [${agent.canEdit ? "edit" : "read-only"}; stages=${agent.stageAffinity.join(",")}]`);
			return { content: [{ type: "text", text: lines.join("\n") || "未发现 xdd subagents" }], details: { agents } };
		},
	});

	pi.registerTool({
		name: "xdd_delegate_prompt",
		label: "Build xdd delegation prompt",
		description: "为指定 xdd subagent 生成可交给子会话执行的完整委派提示词。",
		parameters: {
			type: "object",
			properties: { agent: stringSchema("subagent 名称，如 xdd-scout/xdd-planner/xdd-worker/xdd-reviewer"), task: stringSchema("要委派的具体任务") },
			required: ["agent", "task"],
			additionalProperties: false,
		},
		async execute(_toolCallId, params: { agent: string; task: string }) {
			const agent = findXddSubagent(params.agent);
			if (!agent) {
				return { content: [{ type: "text", text: `未知 xdd subagent: ${params.agent}` }], details: { ok: false } };
			}
			return { content: [{ type: "text", text: renderDelegationPrompt(agent, params.task) }], details: { ok: true, agent } };
		},
	});

	pi.registerTool({
		name: "xdd_subagent_run",
		label: "Run xdd subagent",
		description: "启动 xdd subagent 子会话执行器；支持 single/parallel/chain，以及 async 后台运行。",
		parameters: {
			type: "object",
			properties: {
				mode: { type: "string", enum: ["single", "parallel", "chain"], description: "执行模式；省略时按传入字段推断" },
				agent: stringSchema("single 模式 agent 名称"),
				task: stringSchema("single 模式任务"),
				tasks: { type: "array", description: "parallel 模式任务列表", items: { type: "object", properties: { agent: stringSchema("agent 名称"), task: stringSchema("任务") }, required: ["agent", "task"] } },
				chain: { type: "array", description: "chain 模式任务列表，按顺序执行", items: { type: "object", properties: { agent: stringSchema("agent 名称"), task: stringSchema("任务") }, required: ["agent", "task"] } },
				async: { type: "boolean", description: "true 时后台运行并立即返回 run id" },
				model: stringSchema("可选 Pi model override"),
				provider: stringSchema("可选 Pi provider override，例如 minimax-cn"),
				parentRunId: stringSchema("可选 parent run id，用于 session tree/lineage"),
				thinking: stringSchema("可选 thinking override"),
				fallbackModels: { type: "array", description: "可选 fallback model 列表", items: { type: "string" } },
				modelScope: stringSchema("可选 model scope override"),
			},
			additionalProperties: false,
		},
		async execute(_toolCallId, params: XddSubagentRunParams, _onUpdate, ctx) {
			const cwd = String(ctx?.cwd ?? process.cwd());
			const run = await startXddSubagentRun(cwd, params);
			return { content: [{ type: "text", text: `xdd subagent run ${run.id}: ${run.status}\nartifactDir=${run.artifactDir}` }], details: { run } };
		},
	});

	pi.registerTool({
		name: "xdd_subagent_status",
		label: "Show xdd subagent runs",
		description: "查看 xdd subagent run store 中的 run 状态；可传 run id 查看单个 run。",
		parameters: { type: "object", properties: { id: stringSchema("可选 run id") }, additionalProperties: false },
		async execute(_toolCallId, params: { id?: string }, _onUpdate, ctx) {
			const store = new XddSubagentRunStore(String(ctx?.cwd ?? process.cwd()));
			const runs = params.id ? [store.find(params.id)].filter(Boolean) : store.load().runs.slice(0, 20);
			const text = runs.map((run) => `${run!.id} ${run!.mode} ${run!.status} ${run!.agents.join(",")}`).join("\n") || "暂无 xdd subagent runs";
			return { content: [{ type: "text", text }], details: { runs } };
		},
	});

	pi.registerTool({
		name: "xdd_subagent_wait",
		label: "Wait for xdd subagent run",
		description: "等待指定 xdd subagent run 结束，返回最终或超时后的当前状态。",
		parameters: { type: "object", properties: { id: stringSchema("run id"), timeoutMs: { type: "number", description: "等待超时毫秒数，默认 30000" } }, required: ["id"], additionalProperties: false },
		async execute(_toolCallId, params: { id: string; timeoutMs?: number }, _onUpdate, ctx) {
			const run = await waitForRun(String(ctx?.cwd ?? process.cwd()), params.id, params.timeoutMs ?? 30000);
			return { content: [{ type: "text", text: run ? `${run.id} ${run.status}` : `未找到 run: ${params.id}` }], details: { run } };
		},
	});

	pi.registerTool({
		name: "xdd_subagent_stop",
		label: "Stop xdd subagent run",
		description: "停止指定 xdd subagent run；若记录了 pid，会发送 SIGTERM，并把运行中任务标记为 stopped。",
		parameters: { type: "object", properties: { id: stringSchema("run id") }, required: ["id"], additionalProperties: false },
		async execute(_toolCallId, params: { id: string }, _onUpdate, ctx) {
			const run = stopRun(String(ctx?.cwd ?? process.cwd()), params.id);
			return { content: [{ type: "text", text: run ? `${run.id} ${run.status}` : `未找到 run: ${params.id}` }], details: { run } };
		},
	});

	pi.registerTool({
		name: "xdd_subagent_tree",
		label: "Show xdd subagent run tree",
		description: "按 parentRunId 渲染 xdd subagent run tree / lineage。",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		async execute(_toolCallId, _params, _onUpdate, ctx) {
			const tree = loadRunTree(String(ctx?.cwd ?? process.cwd()));
			const text = renderRunTree(tree) || "暂无 xdd subagent runs";
			return { content: [{ type: "text", text }], details: { tree } };
		},
	});

	pi.registerTool({
		name: "xdd_subagent_resume",
		label: "Resume xdd subagent session",
		description: "为指定 run 构造 resume prompt，包含 session tree、结构化 chain outputs 和失败恢复目标。",
		parameters: { type: "object", properties: { id: stringSchema("run id") }, required: ["id"], additionalProperties: false },
		async execute(_toolCallId, params: { id: string }, _onUpdate, ctx) {
			const plan = buildResumePlan(String(ctx?.cwd ?? process.cwd()), params.id);
			return { content: [{ type: "text", text: plan.prompt }], details: { plan } };
		},
	});

	pi.registerTool({
		name: "xdd_subagent_events",
		label: "Read xdd subagent event stream",
		description: "读取实时/准实时 supervisor event JSONL，用于状态推送和外部 watcher。",
		parameters: { type: "object", properties: { limit: { type: "number", description: "默认 50" } }, additionalProperties: false },
		async execute(_toolCallId, params: { limit?: number }, _onUpdate, ctx) {
			const events = readSubagentEvents(String(ctx?.cwd ?? process.cwd()), params.limit ?? 50);
			const text = events.map((event) => `${event.ts} ${event.runId} ${event.type}: ${event.message}`).join("\n") || "暂无 xdd subagent events";
			return { content: [{ type: "text", text }], details: { events } };
		},
	});

	pi.registerTool({
		name: "xdd_subagent_fleet",
		label: "Show xdd subagent fleet",
		description: "汇总最近 xdd subagent runs，按 queued/running/succeeded/failed/stopped 计数。",
		parameters: { type: "object", properties: { limit: { type: "number", description: "最多展示多少条 run，默认 20" } }, additionalProperties: false },
		async execute(_toolCallId, params: { limit?: number }, _onUpdate, ctx) {
			const fleet = summarizeFleet(String(ctx?.cwd ?? process.cwd()), params.limit ?? 20);
			const text = `total=${fleet.total} queued=${fleet.queued} running=${fleet.running} succeeded=${fleet.succeeded} failed=${fleet.failed} stopped=${fleet.stopped}`;
			return { content: [{ type: "text", text }], details: { fleet } };
		},
	});

	pi.registerTool({
		name: "xdd_subagent_message",
		label: "Send xdd subagent intercom message",
		description: "向指定 subagent run 的 JSONL intercom channel 追加父会话消息。",
		parameters: {
			type: "object",
			properties: { id: stringSchema("run id"), message: stringSchema("发送给 child 的消息"), reason: { type: "string", enum: ["need_decision", "progress_update", "blocked", "note"], description: "消息原因" } },
			required: ["id", "message"],
			additionalProperties: false,
		},
		async execute(_toolCallId, params: { id: string; message: string; reason?: "need_decision" | "progress_update" | "blocked" | "note" }, _onUpdate, ctx) {
			const payload = postSupervisorMessage(String(ctx?.cwd ?? process.cwd()), params.id, params.message, params.reason ?? "note");
			return { content: [{ type: "text", text: `intercom message queued for ${params.id}: ${payload.reason}` }], details: { message: payload } };
		},
	});

	pi.registerTool({
		name: "xdd_subagent_messages",
		label: "Read xdd subagent intercom messages",
		description: "读取指定 subagent run 的 JSONL intercom channel。",
		parameters: { type: "object", properties: { id: stringSchema("run id") }, required: ["id"], additionalProperties: false },
		async execute(_toolCallId, params: { id: string }, _onUpdate, ctx) {
			const messages = readIntercomMessages(String(ctx?.cwd ?? process.cwd()), params.id);
			const text = messages.map((message) => `${message.ts} ${message.direction} ${message.reason}: ${message.message}`).join("\n") || "暂无 intercom messages";
			return { content: [{ type: "text", text }], details: { messages } };
		},
	});

	pi.registerTool({
		name: "xdd_subagent_claim",
		label: "Claim expired xdd subagent runs",
		description: "接管 lease 已过期的 queued/running run；可传 id 接管单个，省略则接管全部过期 runs。",
		parameters: { type: "object", properties: { id: stringSchema("可选 run id"), ttlMs: { type: "number", description: "新 lease TTL，默认 120000ms" } }, additionalProperties: false },
		async execute(_toolCallId, params: { id?: string; ttlMs?: number }, _onUpdate, ctx) {
			const cwd = String(ctx?.cwd ?? process.cwd());
			const result = params.id ? [claimExpiredRun(cwd, params.id, params.ttlMs)] : claimExpiredRuns(cwd, params.ttlMs);
			const claimed = result.filter((entry) => entry.claimed).length;
			return { content: [{ type: "text", text: `claimed=${claimed}` }], details: { result } };
		},
	});

	pi.registerTool({
		name: "xdd_subagent_drain",
		label: "Drain xdd subagent runs",
		description: "对 run store 做一次 reconcile：标记 stale running runs，并统计 child_to_supervisor 消息。",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		async execute(_toolCallId, _params, _onUpdate, ctx) {
			const report = reconcileSubagentRuns(String(ctx?.cwd ?? process.cwd()));
			const text = `checked=${report.checked} updated=${report.updated} childMessages=${report.childMessages}`;
			return { content: [{ type: "text", text }], details: { report } };
		},
	});

	pi.registerTool({
		name: "xdd_subagent_watchdog_check",
		label: "Run xdd subagent watchdog",
		description: "用 xdd-reviewer 对当前 git diff 发起只读 watchdog 攻击检查；默认 async。",
		parameters: {
			type: "object",
			properties: { async: { type: "boolean", description: "默认 true，后台运行" }, model: stringSchema("可选 watchdog model override"), maxDiffBytes: { type: "number", description: "diff 最大字节数，默认 60000" } },
			additionalProperties: false,
		},
		async execute(_toolCallId, params: { async?: boolean; model?: string; maxDiffBytes?: number }, _onUpdate, ctx) {
			const cwd = String(ctx?.cwd ?? process.cwd());
			const diff = collectWatchdogDiff(cwd, params.maxDiffBytes);
			if (diff.changedFiles.length === 0) return { content: [{ type: "text", text: "watchdog skipped: 当前 HEAD diff 为空" }], details: { skipped: true } };
			const run = await runWatchdogReview(cwd, params);
			return { content: [{ type: "text", text: run ? `watchdog run ${run.id}: ${run.status}` : "watchdog skipped" }], details: { run, changedFiles: diff.changedFiles } };
		},
	});

	pi.registerTool({
		name: "xdd_subagent_watchdog_recommend_model",
		label: "Recommend xdd watchdog model",
		description: "根据当前主模型给出互补的 watchdog 强模型建议。",
		parameters: { type: "object", properties: { currentModel: stringSchema("当前主会话模型，可选") }, additionalProperties: false },
		async execute(_toolCallId, params: { currentModel?: string }) {
			const model = recommendWatchdogModel(params.currentModel ?? "");
			return { content: [{ type: "text", text: model }], details: { model } };
		},
	});

	pi.registerTool({
		name: "xdd_subagent_child_watchdog",
		label: "Run xdd child watchdog",
		description: "用 xdd-reviewer 审查指定 child run 的 transcript，检查伪成功、遗漏验证和兜底缺口。",
		parameters: {
			type: "object",
			properties: { id: stringSchema("被审查的 run id"), async: { type: "boolean", description: "默认 true，后台运行" }, model: stringSchema("可选 watchdog model override"), maxTranscriptBytes: { type: "number", description: "每个 transcript 最大字节数，默认 60000" } },
			required: ["id"],
			additionalProperties: false,
		},
		async execute(_toolCallId, params: { id: string; async?: boolean; model?: string; maxTranscriptBytes?: number }, _onUpdate, ctx) {
			const run = await runChildWatchdog(String(ctx?.cwd ?? process.cwd()), params.id, params);
			return { content: [{ type: "text", text: run ? `child watchdog run ${run.id}: ${run.status}` : `未找到 run: ${params.id}` }], details: { run } };
		},
	});

	pi.registerTool({
		name: "xdd_subagents_doctor",
		label: "Audit xdd subagent parity",
		description: "审查 xdd-subagents 与 nicobailon/pi-subagents 的能力差距，明确是否完全复刻。",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		async execute() {
			return { content: [{ type: "text", text: summarizeParity() }], details: { parity: PI_SUBAGENTS_PARITY } };
		},
	});

	pi.on("agent_end", async (_event, ctx) => {
		const cwd = String(ctx?.cwd ?? process.cwd());
		const autoDrain = runAutoDrainIfEnabled(cwd);
		if (autoDrain.enabled && autoDrain.notify && autoDrain.report && (autoDrain.report.updated > 0 || autoDrain.report.childMessages > 0)) {
			ctx.ui.notify(`xdd-subagents drain: updated=${autoDrain.report.updated}, childMessages=${autoDrain.report.childMessages}`, "info");
		}
		const watchdog = loadXddSubagentsSettings(cwd).watchdog;
		if (!watchdog?.enabled) return;
		try {
			const run = await runWatchdogReview(cwd, { async: true, model: watchdog.model, maxDiffBytes: watchdog.maxDiffBytes });
			if (run) ctx.ui.notify(`xdd-subagents watchdog started: ${run.id}`, "info");
		} catch (error) {
			ctx.ui.notify(`xdd-subagents watchdog failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
		}
	});

	pi.registerCommand("xdd-subagents", {
		description: "列出 xdd subagent 插件角色",
		handler: async (_args, ctx) => {
			const agents = discoverXddSubagents();
			ctx.ui.notify(`xdd subagents: ${agents.map((agent) => agent.name).join(", ")}`, "info");
		},
	});
}

export { discoverXddSubagents, findXddSubagent, renderDelegationPrompt } from "./registry.ts";
export { PI_SUBAGENTS_PARITY, summarizeParity } from "./parity.ts";
export { startXddSubagentRun, normalizeRunParams, buildPiArgs } from "./scheduler.ts";
export { XddSubagentRunStore } from "./runtime-store.ts";
export { stopRun, summarizeFleet, waitForRun } from "./fleet.ts";
export { loadXddSubagentsSettings, resolveTaskModel, resolvePiInvocation } from "./settings.ts";
export { buildWatchdogReviewTask, collectWatchdogDiff, runWatchdogReview } from "./watchdog.ts";
export { intercomPath, postSupervisorMessage, readIntercomMessages, supervisorIntercomInstructions } from "./intercom.ts";
export { reconcileSubagentRuns, isPidAlive } from "./reconciler.ts";
export { runAutoDrainIfEnabled } from "./auto-drain.ts";
export { recommendWatchdogModel } from "./watchdog-model.ts";
export { collectStaticDiagnostics, renderStaticDiagnostics } from "./diagnostics.ts";
export { buildChildWatchdogTask, runChildWatchdog } from "./child-watchdog.ts";
export { buildRunTree, loadRunTree, renderRunTree } from "./lineage.ts";
export { attachLease, canClaimRun, claimRun, createRunLease, heartbeatRun, isLeaseExpired } from "./lease.ts";
export { claimExpiredRun, claimExpiredRuns } from "./supervisor.ts";
export { buildResumePlan } from "./session.ts";
export { appendSubagentEvent, readSubagentEvents, eventStreamPath } from "./event-stream.ts";
export { collectLspDiagnostics, renderLspDiagnostics } from "./lsp-diagnostics.ts";
