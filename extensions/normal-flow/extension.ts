import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { buildActiveNfStageSystemPrompt } from "./context.ts";
import { createNfTools } from "./tools/index.ts";
import { compileStageContracts } from "../xdd/core/stage-contract.ts";
import { agentEndCommandFromPi } from "../xdd/adapters/pi-controller.ts";
import { enforceToolCallPolicy } from "../xdd/policy/tool-policy.ts";
import { createNormalFlowRuntimeStore } from "./runtime-store.ts";
import { assistantFlowUsage } from "../xdd/flow-budget.ts";
import { archiveRun } from "../xdd/archive.ts";
import type { XddRunnerState } from "../xdd/types.ts";
import { dispatchNfCommand } from "./adapter.ts";
import { NF_DISPLAY_NAME, type NfStageName, planStageNamesAreNf } from "./types.ts";
import { NF_STAGES } from "./stages.ts";

/**
 * Module-level shared state。跟 extensions/xdd/extension.ts 的 stateRef 是各自
 * 独立的模块级变量（不同文件），两个 InlineExtension 可以在同一个 pi 进程里
 * 并存而不互相覆盖对方的 stateRef。真正的隔离边界是 cwd 上的 .xdd/normal-flow-runtime.json
 * ——见 planStageNamesAreNf() 和 flow.ts 里的启动/恢复冲突检查。
 */
let stateRef: XddRunnerState | null = null;

type NormalFlowCommandContext = {
	cwd: string;
	waitForIdle: () => Promise<void>;
	ui: { notify: (message: string, level?: "info" | "warning" | "error") => void };
} & Record<string, unknown>;

export function activateNormalFlowExtension(state: XddRunnerState): void {
	compileStageContracts(state.plan.map(({ stage }) => stage));
	stateRef = state;
}

export function deactivateNormalFlowExtension(): void {
	stateRef = null;
}

export function getState(): XddRunnerState {
	if (!stateRef) {
		throw new Error("[normal-flow] 无活跃 Normal Flow run（state 未注入）");
	}
	return stateRef;
}

/** Jump to one of Normal Flow's stages without submitting an agent turn. */
export function gotoNormalFlowStage(
	stageName: NfStageName,
	notify: (message: string, level?: "info" | "warning" | "error") => void,
): void {
	if (!stateRef) {
		notify(`[normal-flow-goto-${NF_DISPLAY_NAME[stageName]}] 无活跃 Normal Flow run。先用 /normal-flow <任务> 启动。`, "warning");
		return;
	}
	const targetIndex = stateRef.plan.findIndex(({ stage }) => stage.name === stageName);
	if (targetIndex < 0) {
		notify(`[normal-flow-goto-${NF_DISPLAY_NAME[stageName]}] 当前 run 不包含该阶段，状态未改变。`, "warning");
		return;
	}
	const from = stateRef.currentStageName() ?? "?";
	stateRef.planIndex = targetIndex;
	stateRef.runComplete = false;
	stateRef.status = "running";
	stateRef.paused = false;
	stateRef.stopRequested = false;
	stateRef.pauseNotified = false;
	stateRef.pendingGroupApproval = undefined;
	stateRef.continuationQueued = false;
	stateRef.continuationReason = undefined;
	stateRef.continuationStage = undefined;
	stateRef.clearSignals();
	stateRef.stageOutcome = "idle";
	stateRef.lastStageError = undefined;
	stateRef.stageEpoch = `${stateRef.runId}:${stageName}:${Date.now()}`;
	notify(`[normal-flow-goto-${NF_DISPLAY_NAME[stageName]}] 已从 ${from} 跳转到 ${stageName} 阶段 (${targetIndex + 1}/${stateRef.plan.length})；流程状态: running。`, "info");
}

/** cwd 上的 normal-flow-runtime.json 是否属于 Normal Flow（阶段名全部落在 NF 的 5 阶段集合内）。 */
export function isNfOwnedRuntime(cwd: string): boolean {
	const rt = createNormalFlowRuntimeStore(cwd).load();
	if (!rt) return false;
	return planStageNamesAreNf(rt.plan ?? []);
}


function toolResultText(event: { content?: Array<{ type?: string; text?: string }> }): string {
	return (event.content ?? [])
		.filter((part) => part.type === "text")
		.map((part) => part.text ?? "")
		.join("\n");
}

function isNfSubmitReadyToAdvance(event: { type?: string }, toolName: string, state: XddRunnerState): boolean {
	if (event.type !== "tool_result" || toolName !== "nf_submit_artifact") return false;
	if (state.runComplete || state.paused || state.stopRequested) return false;
	const stage = state.currentStage();
	if (!stage) return false;
	const signals = state.getSignals();
	return stage.exit === "verdict" ? signals.has("verdict_pass") : signals.has("complete");
}

function isNfAdvanceNextStage(event: { type?: string; content?: Array<{ type?: string; text?: string }> }, toolName: string, state: XddRunnerState): boolean {
	if (event.type !== "tool_result" || toolName !== "nf_advance") return false;
	if (state.runComplete || state.paused || state.stopRequested) return false;
	const text = toolResultText(event);
	return text.includes("[nf_advance]") && text.includes("进入下一阶段");
}

async function sendNfSubmitAdvanceSteering(
	pi: { sendUserMessage?: (text: string, options?: unknown) => Promise<unknown> | unknown },
	state: XddRunnerState,
): Promise<void> {
	const stage = state.currentStageName() ?? "当前";
	await pi.sendUserMessage?.(
		`[normal-flow submit steering] ${stage} 阶段产物已通过。立即调用 nf_advance 推进；不要停下来只汇报已提交。`,
		{ deliverAs: "steer" },
	);
}

async function sendNfAdvanceNextStageSteering(
	pi: { sendUserMessage?: (text: string, options?: unknown) => Promise<unknown> | unknown },
	state: XddRunnerState,
): Promise<void> {
	const stage = state.currentStageName() ?? "当前";
	await pi.sendUserMessage?.(
		`[normal-flow advance steering] 已进入 ${stage} 阶段。立即自动执行下一步：调用 nf_observe、nf_desired_state、nf_difference，按差距完成阶段产物；不要停下来只汇报已推进。`,
		{ deliverAs: "steer" },
	);
}

export const normalFlowInlineExtension: InlineExtension = {
	name: "normal-flow",
	factory(pi) {
		for (const tool of createNfTools(getState)) {
			pi.registerTool(tool);
		}

		const startNormalFlowCommand = async (args: string, ctx: NormalFlowCommandContext) => {
			const { startNormalFlow } = await import("./flow.ts");
			await startNormalFlow(args, ctx.cwd, pi);
			await ctx.waitForIdle();
		};
		pi.registerCommand("normal-flow", {
			description: "启动 Normal Flow: /normal-flow <任务描述>",
			handler: startNormalFlowCommand,
		});
		pi.registerCommand("nf", {
			description: "Normal Flow 快捷命令: /nf <任务描述>；无参数时恢复 checkpoint",
			handler: async (args, ctx) => {
				if (args.trim()) {
					await startNormalFlowCommand(args, ctx);
					return;
				}
				const { resumeNormalFlow } = await import("./flow.ts");
				await resumeNormalFlow(args, ctx.cwd, pi);
				await ctx.waitForIdle();
			},
		});
		for (const stage of NF_STAGES) {
			const stageName = stage.name as NfStageName;
			const displayName = NF_DISPLAY_NAME[stageName];
			const gotoStage = async (_args: string, ctx: NormalFlowCommandContext) => {
				gotoNormalFlowStage(stageName, (message, level) => ctx.ui.notify(message, level));
			};
			pi.registerCommand(`normal-flow-goto-${displayName}`, {
				description: `跳转到 Normal Flow ${displayName} 阶段`,
				handler: gotoStage,
			});
			pi.registerCommand(`nf-goto-${displayName}`, {
				description: `跳转到 Normal Flow ${displayName} 阶段（快捷命令）`,
				handler: gotoStage,
			});
		}
		const resumeNormalFlowCommand = async (args: string, ctx: NormalFlowCommandContext) => {
			const { resumeNormalFlow } = await import("./flow.ts");
			await resumeNormalFlow(args, ctx.cwd, pi);
			await ctx.waitForIdle();
		};
		pi.registerCommand("normal-flow-resume", {
			description: "从 checkpoint 恢复中断的 Normal Flow run",
			handler: resumeNormalFlowCommand,
		});
		pi.registerCommand("nf-resume", {
			description: "从 checkpoint 恢复中断的 Normal Flow run（/normal-flow-resume 快捷命令）",
			handler: resumeNormalFlowCommand,
		});
		const stopNormalFlowCommand = async (_args: string, ctx: NormalFlowCommandContext) => {
			if (!stateRef) {
				await pi.sendUserMessage("[normal-flow] 无活跃 run。");
				return;
			}
			await dispatchNfCommand(stateRef, { type: "STOP", source: "command" }, {
				pi,
				ctx,
				getState: () => stateRef,
			});
		};
		pi.registerCommand("normal-flow-stop", {
			description: "中断当前 Normal Flow run（可用 /normal-flow-resume 恢复）",
			handler: stopNormalFlowCommand,
		});
		pi.registerCommand("nf-stop", {
			description: "中断当前 Normal Flow run（/normal-flow-stop 快捷命令）",
			handler: stopNormalFlowCommand,
		});

		pi.on("tool_result", async (event) => {
			if (!stateRef) return;
			const toolName = String(event.toolName ?? event.name ?? "?");
			if (isNfSubmitReadyToAdvance(event, toolName, stateRef)) {
				await sendNfSubmitAdvanceSteering(pi, stateRef);
			}
			if (isNfAdvanceNextStage(event, toolName, stateRef)) {
				await sendNfAdvanceNextStageSteering(pi, stateRef);
			}
		});

		// 阶段感知的工具/路径/bash 策略，直接复用 xdd 的实现（跟 stage 名无关，
		// 只依赖传入的 XddStageSpec）。
		pi.on("tool_call", async (event) => {
			if (!stateRef) return;
			enforceToolCallPolicy(stateRef, event);
		});

		pi.on("before_agent_start", async (_event, ctx) => {
			if (!stateRef) return undefined;
			if (stateRef.flowBudgetExhausted) {
				ctx.ui.notify(
					`[normal-flow] 流程预算已耗尽：$${stateRef.flowCostUsd.toFixed(2)}/$${stateRef.flowBudgetUsd.toFixed(2)}（${stateRef.flowTokensUsed} tokens）。设置 XDD_FLOW_BUDGET_USD 后重新启动新的 run。`,
					"warning",
				);
				return { systemPrompt: "[normal-flow] 流程预算已耗尽。不要调用工具或继续工作；直接停止。" };
			}
			const systemPrompt = buildActiveNfStageSystemPrompt(stateRef);
			return systemPrompt === undefined ? undefined : { systemPrompt };
		});

		pi.on("agent_end", async (event, ctx) => {
			if (!stateRef) return;
			stateRef.recordFlowUsage(assistantFlowUsage(event.messages));
			if (stateRef.flowBudgetExhausted) {
				stateRef.paused = true;
				ctx.ui.notify(
					`[normal-flow] 流程预算已耗尽：$${stateRef.flowCostUsd.toFixed(2)}/$${stateRef.flowBudgetUsd.toFixed(2)}（${stateRef.flowTokensUsed} tokens）。流程已暂停；提高 XDD_FLOW_BUDGET_USD 后启动新的 run。`,
					"warning",
				);
				return;
			}
			if (stateRef.runComplete) return;
			const command = agentEndCommandFromPi(event);
			if (!command) return;
			if (typeof ctx.hasPendingMessages === "function") {
				command.hasPendingMessages = ctx.hasPendingMessages();
			}
			await dispatchNfCommand(stateRef, command, { pi, ctx, getState: () => stateRef });
		});

		// Checkpoint 检测：只在 normal-flow-runtime.json 属于 Normal Flow 时才提示
		// /normal-flow-resume，避免对 xdd 建的 checkpoint 误报（Docs/normal-flow.md §13）。
		pi.on("session_start", async (event, ctx) => {
			if (event.reason !== "startup" && event.reason !== "reload") return;
			try {
				const cwd = process.cwd();
				if (!isNfOwnedRuntime(cwd)) return;
				const rt = createNormalFlowRuntimeStore(cwd).load();
				if (rt && !rt.runComplete) {
					ctx.ui.notify(
						`[normal-flow] 检测到未完成的 Normal Flow run（${rt.runId}）。输入 /normal-flow-resume 恢复，或忽略开始新对话。`,
						"info",
					);
				}
			} catch {
				// ignore
			}
		});

		// 丢弃暂停期间残留的自动续跑 followUp（跟 xdd 的 input hook 同样的目的）。
		pi.on("input", async (event) => {
			if (!stateRef) return { action: "continue" };
			if (event.source !== "extension") return { action: "continue" };
			const text = event.text ?? "";
			const isNfContinuation = text.startsWith("[normal-flow 自动推进]");
			if (!isNfContinuation) return { action: "continue" };
			if (stateRef.paused) return { action: "handled" };
			stateRef.continuationQueued = false;
			return { action: "continue" };
		});

		// Run 完成后自动归档（首次一次；用户中断的 run 不归档，可 resume）。
		pi.on("agent_end", async () => {
			if (!stateRef) return;
			if (!stateRef.runComplete) return;
			if (stateRef.stopRequested) return;
			if (stateRef.archived) return;
			stateRef.archived = true;
			try {
				archiveRun(stateRef.cwd);
			} catch {
				// 归档失败绝不能让 agent loop 崩溃。
			}
		});
	},
};
