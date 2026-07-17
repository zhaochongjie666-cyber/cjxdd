import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { buildActiveNfStageSystemPrompt } from "./context.ts";
import { pruneContextMessages } from "../xdd/context-prune.ts";
import { sliceByEpoch, EPOCH_MARKER_PREFIX } from "../xdd/epoch-slicer.ts";
import { createNfTools } from "./tools/index.ts";
import { compileStageContracts } from "../xdd/core/stage-contract.ts";
import { agentEndCommandFromPi } from "../xdd/adapters/pi-controller.ts";
import { enforceToolCallPolicy } from "../xdd/policy/tool-policy.ts";
import { XddController } from "../xdd/core/controller.ts";
import { RuntimeStore } from "../xdd/storage/runtime-store.ts";
import { assistantFlowUsage } from "../xdd/flow-budget.ts";
import { archiveRun } from "../xdd/archive.ts";
import type { XddRunnerState } from "../xdd/types.ts";
import { dispatchNfCommand } from "./adapter.ts";
import { planStageNamesAreNf } from "./types.ts";

/**
 * Module-level shared state。跟 extensions/xdd/extension.ts 的 stateRef 是各自
 * 独立的模块级变量（不同文件），两个 InlineExtension 可以在同一个 pi 进程里
 * 并存而不互相覆盖对方的 stateRef。真正的隔离边界是 cwd 上的 .xdd/runtime.json
 * ——见 planStageNamesAreNf() 和 flow.ts 里的启动/恢复冲突检查。
 */
let stateRef: XddRunnerState | null = null;

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

/** cwd 上的 runtime.json 是否属于 Normal Flow（阶段名全部落在 NF 的 5 阶段集合内）。 */
export function isNfOwnedRuntime(cwd: string): boolean {
	const rt = new RuntimeStore(cwd).load();
	if (!rt) return false;
	return planStageNamesAreNf(rt.plan ?? []);
}

export const normalFlowInlineExtension: InlineExtension = {
	name: "normal-flow",
	factory(pi) {
		for (const tool of createNfTools(getState)) {
			pi.registerTool(tool);
		}

		pi.registerCommand("normal-flow", {
			description: "启动 Normal Flow: /normal-flow <任务描述>",
			handler: async (args, ctx) => {
				const { startNormalFlow } = await import("./flow.ts");
				await startNormalFlow(args, ctx.cwd, pi);
				await ctx.waitForIdle();
			},
		});
		pi.registerCommand("normal-flow-resume", {
			description: "从 checkpoint 恢复中断的 Normal Flow run",
			handler: async (args, ctx) => {
				const { resumeNormalFlow } = await import("./flow.ts");
				await resumeNormalFlow(args, ctx.cwd, pi);
				await ctx.waitForIdle();
			},
		});
		pi.registerCommand("normal-flow-stop", {
			description: "中断当前 Normal Flow run（可用 /normal-flow-resume 恢复）",
			handler: async (_args, ctx) => {
				if (!stateRef) {
					await pi.sendUserMessage("[normal-flow] 无活跃 run。");
					return;
				}
				await dispatchNfCommand(stateRef, { type: "STOP", source: "command" }, {
					pi,
					ctx,
					getState: () => stateRef,
				});
			},
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
			const epoch = stateRef.stageEpoch;
			const finalPrompt = systemPrompt ? `${systemPrompt}\n\n${EPOCH_MARKER_PREFIX} ${epoch}` : undefined;
			return finalPrompt === undefined ? undefined : { systemPrompt: finalPrompt };
		});

		// 按 stageEpoch 截取上下文 + 裁剪大工具输出，跟 stage 名无关，直接复用。
		pi.on("context", async (event) => {
			if (!stateRef) return undefined;
			const sliced = sliceByEpoch(event.messages, stateRef.stageEpoch);
			const pruned = pruneContextMessages(sliced);
			if (sliced === event.messages && pruned === sliced) return undefined;
			return { messages: pruned };
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
			if (typeof ctx.getContextUsage === "function") {
				command.contextUsagePercent = ctx.getContextUsage()?.percent ?? null;
			}
			await dispatchNfCommand(stateRef, command, { pi, ctx, getState: () => stateRef });
		});

		pi.on("session_compact", async (event, ctx) => {
			if (!stateRef) return;
			if (stateRef.runComplete) return;
			const success = typeof event?.success === "boolean" ? event.success : !event?.error;
			await dispatchNfCommand(stateRef, { type: "COMPACTION_DONE", success }, { pi, ctx, getState: () => stateRef });
		});

		// Checkpoint 检测：只在 runtime.json 属于 Normal Flow 时才提示
		// /normal-flow-resume，避免对 xdd 建的 checkpoint 误报（Docs/normal-flow.md §13）。
		pi.on("session_start", async (event, ctx) => {
			if (event.reason !== "startup" && event.reason !== "reload") return;
			try {
				const cwd = process.cwd();
				if (!isNfOwnedRuntime(cwd)) return;
				const rt = new RuntimeStore(cwd).load();
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
