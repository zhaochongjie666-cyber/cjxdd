import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { buildActiveStageSystemPrompt } from "./context.ts";
import { renderReflectEnd, renderReflectStart, renderRollback, renderStageBoundary } from "./renderers.ts";
import { createXddTools } from "./tools/index.ts";
import { readCheckpoint } from "./checkpoint.ts";
import { setLLMRef } from "./llm-ref.ts";
import { STAGES } from "./stages.ts";
import { archiveRun } from "./archive.ts";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import type { XddRunnerState, XddStageSpec } from "./types.ts";

/**
 * Module-level shared state. The InlineExtension factory registers tools and
 * handlers that close over `stateRef`. runXdd injects the live state via
 * activateXddExtension(); when no run is active, stateRef is null and every
 * handler is a no-op (before_agent_start returns no override, context returns
 * messages unchanged) and every tool throws.
 */
let stateRef: XddRunnerState | null = null;

export function activateXddExtension(state: XddRunnerState): void {
	stateRef = state;
}

export function deactivateXddExtension(): void {
	stateRef = null;
}

export function getState(): XddRunnerState {
	if (!stateRef) {
		throw new Error("[xdd] 无活跃 xdd run（state 未注入）");
	}
	return stateRef;
}

/**
 * xdd InlineExtension. Registered via main.ts extensionFactories (and
 * createHarness({ extensionFactories: [xddInlineExtension] }) in tests).
 *
 * Relies on the existing `agent.transformContext → runner.emitContext` wiring
 * (sdk.ts:359) to trigger `on("context")` each turn; it does NOT install any
 * transformContext bridge.
 */
/** Build a stage-aware summary for pi's session_before_tree hook. */
function buildStageSummary(cwd: string, state: XddRunnerState, stage: XddStageSpec): string {
	const lines: string[] = [];
	lines.push(`# xdd Stage Summary -- ${stage.name}`);
	lines.push(`Run: ${state.runId}`);
	lines.push(`Stage: ${stage.name} (${state.planIndex + 1}/${state.plan.length})`);
	lines.push(`Role: ${stage.role}`);
	lines.push("");
	lines.push("## Deliverables");
	for (const p of stage.deliverablePaths) {
		const abs = join(cwd, p);
		if (existsSync(abs)) {
			const size = statSync(abs).size;
			lines.push(`- ✅ ${p} (${size} bytes)`);
		} else {
			lines.push(`- ⬜ ${p} (missing)`);
		}
	}
	lines.push("");
	lines.push("## DesiredState checklist");
	for (let i = 0; i < stage.desiredState.length; i++) {
		lines.push(`${i + 1}. ${stage.desiredState[i]}`);
	}
	lines.push("");
	lines.push("## Ledger (this stage)");
	const stageEntries = state.ledger.filter((e) => e.stage === stage.name);
	for (const e of stageEntries) {
		lines.push(`- attempt ${e.attempt}: ${e.status} (${e.at})`);
	}
	return lines.join("\n");
}

export const xddInlineExtension: InlineExtension = {
	name: "xdd",
	factory(pi) {
		for (const tool of createXddTools(getState)) {
			pi.registerTool(tool);
		}

		// Slash commands: /xdd <task>, /xdd continue, /xdd resume, /xdd status
		pi.registerCommand("xdd", {
			description: "启动 xdd 流程: /xdd <任务描述>",
			handler: async (args, ctx) => {
				const { runXdd } = await import("./run.ts");
				await runXdd(args, ctx.cwd, pi);
				await ctx.waitForIdle();
			},
		});
		pi.registerCommand("xdd-continue", {
			description: "确认组级 Gate 通过，推进到下一阶段组",
			handler: async (_args, ctx) => {
				const { continueXdd } = await import("./run.ts");
				await continueXdd(_args, ctx.cwd, pi);
				await ctx.waitForIdle();
			},
		});
		pi.registerCommand("xdd-resume", {
			description: "从 checkpoint 恢复中断的 xdd run",
			handler: async (_args, ctx) => {
				const { resumeXdd } = await import("./run.ts");
				await resumeXdd(_args, ctx.cwd, pi);
				await ctx.waitForIdle();
			},
		});
		pi.registerCommand("xdd-status", {
			description: "查看当前 xdd 流水线状态",
			handler: async (_args, ctx) => {
				const { xddStatus } = await import("./run.ts");
				await xddStatus(_args, ctx.cwd, pi);
				await ctx.waitForIdle();
			},
		});
		pi.registerCommand("xdd-archive", {
			description: "归档当前 run 的设计产物（总结 + 删过时设计）",
			handler: async (args, ctx) => {
				const { archiveXdd } = await import("./run.ts");
				await archiveXdd(args, ctx.cwd, pi);
				await ctx.waitForIdle();
			},
		});
		pi.registerCommand("xdd-stop", {
			description: "中断当前 xdd run（支持 Esc Esc 后恢复）",
			handler: async (_args, ctx) => {
				if (!stateRef) {
					await pi.sendUserMessage("[xdd] 无活跃 xdd run。");
					return;
				}
				stateRef.stopRequested = true;
				// Abort the current turn if the agent is streaming.
				ctx.abort();
				await pi.sendUserMessage(
					`[xdd] 用户中断。run 已暂停在 ${stateRef.currentStageName() ?? "?"} 阶段。输入 /xdd-resume 恢复。`,
				);
			},
		});

		// registerEntryRenderer is only in newer pi (>=0.81 dev); guard so xdd
		// works on the published 0.80.3 too. TUI extras degrade gracefully.
		if (typeof pi.registerEntryRenderer === "function") {
			pi.registerEntryRenderer("xdd_stage_boundary", renderStageBoundary);
			pi.registerEntryRenderer("xdd_reflect_start", renderReflectStart);
			pi.registerEntryRenderer("xdd_reflect_end", renderReflectEnd);
			pi.registerEntryRenderer("xdd_rollback", renderRollback);
		}
		// xdd_ledger intentionally not rendered (audit only).

		// P15: bash tool default timeout -- prevent runaway commands (e.g.
		// `find /` scanning the entire filesystem for 12 hours). The bash tool's
		// timeout parameter is optional with no default. We intercept tool_call
		// and inject timeout=300 (5 min) when the LLM didn't provide one.
		pi.on("tool_call", async (event) => {
			if (event.toolName === "bash" && event.input) {
				const input = event.input as { timeout?: number };
				if (input.timeout === undefined || input.timeout <= 0) {
					input.timeout = 300;
				}
			}
		});

		// PRIMARY auto-continue: use turn_end (not agent_end) to queue the
		// followUp. turn_end fires INSIDE the agent loop, BEFORE the
		// getFollowUpMessages check. The followUp is picked up by the agent
		// loop directly -- no dependency on _handlePostAgentRun ->
		// hasQueuedMessages, which breaks when auto-compaction triggers at
		// 99%+ context usage.
		//
		// Only fire when the agent produced NO tool calls this turn (it's
		// done working, just text/summary). If tool calls were made, the
		// agent loop continues naturally.
		pi.on("turn_end", async (event) => {
			if (!stateRef) return;
			if (stateRef.runComplete) return;
			if (stateRef.stopRequested) return;
			// Only auto-continue when the agent made no tool calls (done for this turn)
			const toolResults = event.toolResults ?? [];
			if (toolResults.length > 0) return;
			const stage = stateRef.currentStage();
			if (!stage) return;
			const idx = stateRef.planIndex;
			const submittedSinceLastEnd = stateRef.lastSubmitAt > stateRef.lastAgentEndAt;
			if (idx !== stateRef.lastAgentEndPlanIndex || submittedSinceLastEnd) {
				stateRef.consecutiveStalls = 0;
			} else {
				stateRef.consecutiveStalls++;
			}
			stateRef.lastAgentEndPlanIndex = idx;
			stateRef.lastAgentEndAt = Date.now();
			// Stall hard terminate
			if (stateRef.consecutiveStalls >= 6) {
				stateRef.runComplete = true;
				return;
			}
			const stalls = stateRef.consecutiveStalls;
			const healBudget = stateRef.remainingSelfHealBudget(stage.name);
			const healMax = stateRef.maxSelfHealPerStage;
			const healUsed = healMax - healBudget;
			const signals = stateRef.getSignals();
			const isVerifyFail = stage.exit === "verdict" && signals.has("verdict_fail") && !stateRef.rollbackOutcome;
			const msg = isVerifyFail
				? `[xdd] verify 验证未通过。请调 xdd_rollback("execute", "verify 验证失败，主动返回 execute 修复后重跑")。不要问用户，不要重复 verify。`
				: healBudget > 0 && stalls > 0
					? `[xdd 自动推进] 继续 ${stage.name} 阶段。上轮闸门/AIGate 未通过，剩余自愈预算 ${healBudget}/${healMax}（已用 ${healUsed}）。请根据上轮反馈修复产物，重新调 xdd_submit_artifact。`
					: `[xdd 自动推进] 继续 ${stage.name} 阶段。`;
			try {
				await pi.sendUserMessage(msg, { deliverAs: "followUp" });
			} catch { /* ignore */ }
		});

		// xdd uses per-stage context slicing (on "context" event) to keep only
		// the current stage's messages. Runtime state is in runtime.json, not in
		// the conversation. So compaction is safe -- do NOT cancel it. Cancelling
		// causes "Error: Compaction cancelled" when context fills up during long
		// runs (10 stages × many tool calls).

		// Fresh per-stage system prompt. Group gates auto-advance (no human pause).
		pi.on("before_agent_start", async (_event, ctx) => {
			// Capture model + modelRegistry for AIGate LLM calls.
			setLLMRef(ctx.model ?? null, ctx.modelRegistry ?? null);
			if (!stateRef) return undefined;
			const systemPrompt = buildActiveStageSystemPrompt(stateRef);
			return systemPrompt === undefined ? undefined : { systemPrompt };
		});

		// Fresh per-stage context: drop messages before the stage boundary.
		// During reflection this keeps the failed stage's own context (seed +
		// assistant + tool results), which is exactly what the model needs to
		// diagnose — instead of the entire run transcript.
		pi.on("context", async (event) => {
			if (!stateRef) return undefined;
			const start = Math.min(stateRef.boundary, event.messages.length);
			if (start <= 0) return undefined;
			return { messages: event.messages.slice(start) };


		// agent_end (interrupt-only): the primary auto-continue now lives in
		// turn_end above (picks up followUp inside the agent loop without
		// going through _handlePostAgentRun -> hasQueuedMessages, which breaks
		// when auto-compaction triggers at 99%+ context usage). This handler
		// only handles user interrupt detection (Esc or /xdd-stop) and the
		// stall hard-terminate safety net.
		pi.on("agent_end", async (_event, ctx) => {
			if (!stateRef) return;
			if (stateRef.runComplete) return;
			// Interrupt: /xdd-stop (explicit) or Esc (abort signal).
			let signalAborted = false;
			try {
				signalAborted = ctx.signal?.aborted ?? false;
			} catch { /* ctx.signal getter can throw on stale context */ }
			if (stateRef.stopRequested || signalAborted) {
				stateRef.stopRequested = true;
				try {
					await pi.sendUserMessage(
						`[xdd] 用户中断。run 已暂停在 ${stateRef.currentStageName() ?? "?"} 阶段。输入 /xdd-resume 恢复，或继续对话做其他事。`,
						{ deliverAs: "followUp" },
					);
				} catch { /* ignore */ }
				return;
			}
			// Stall hard terminate (safety net -- turn_end already handles
			// the nudges; this catches the case where turn_end didn't fire
			// or auto-continue is stuck).
			const idx = stateRef.planIndex;
			const submittedSinceLastEnd = stateRef.lastSubmitAt > stateRef.lastAgentEndAt;
			if (idx !== stateRef.lastAgentEndPlanIndex || submittedSinceLastEnd) {
				stateRef.consecutiveStalls = 0;
			} else {
				stateRef.consecutiveStalls++;
			}
			stateRef.lastAgentEndPlanIndex = idx;
			stateRef.lastAgentEndAt = Date.now();
			if (stateRef.consecutiveStalls >= 6) {
				stateRef.runComplete = true;
				try {
					await pi.sendUserMessage(
						`[xdd] 连续 ${stateRef.consecutiveStalls} 轮僵死，强制终止 run。请人工检查产物后重新 /xdd <任务>。`,
						{ deliverAs: "followUp" },
					);
				} catch { /* ignore */ }
			}
		});
		// Checkpoint detection: if pi restarts with an unfinished xdd run,
		// notify the user they can resume. Use ctx.ui.notify (UI only,
		// does NOT inject a user message or trigger a turn) -- do NOT use
		// pi.sendUserMessage here: it always triggers a turn and the agent
		// would auto-restore the run, which the user does not want.
		pi.on("session_start", async (event, ctx) => {
			if (event.reason !== "startup" && event.reason !== "reload") return;
			try {
				const cp = readCheckpoint(process.cwd());
				if (cp) {
					ctx.ui.notify(
						`[xdd] 检测到未完成的 xdd run（${cp.runId}）。输入 /xdd-resume 恢复，或忽略开始新对话。`,
						"info",
					);
				}
			} catch {
				// ignore
			}
		});

		// Run completion: auto-archive (first time only -- `archived` flag prevents re-run).
		// Skip archiving when the user interrupted (stopRequested) -- the run is
		// paused, not finished; the user may /xdd-resume to continue.
		pi.on("agent_end", async () => {
			if (!stateRef) return;
			if (!stateRef.runComplete) return;
			if (stateRef.stopRequested) return;
			if (stateRef.archived) return;
			stateRef.archived = true;
			try {
				// Archive the most recent runs/<*>/* by mtime. design/ is read-only (never modified).
				const result = archiveRun(process.cwd());
				await pi.sendUserMessage(
					`[xdd 自动归档] run ${stateRef.runId} 完成。写入 ${result.archivePath}（删 ${result.deletedPaths.length} 个 runs/ 文件，design/ 仅读取不改，记录 ${result.keptPaths.length} 项读取）。`,
					{ deliverAs: "followUp" },
				);
			} catch (e) {
				await pi.sendUserMessage(
					`[xdd 归档失败] ${e instanceof Error ? e.message : String(e)}`,
					{ deliverAs: "followUp" },
				);
			}
		});

		// Stage summary via pi /tree: inject a stage-aware summary when the
		// user navigates the session tree. Triggered by session_before_tree event.
		pi.on("session_before_tree", async (event) => {
			if (!stateRef) return undefined;
			const stage = stateRef.currentStage();
			if (!stage) return undefined;
			const summary = buildStageSummary(process.cwd(), stateRef, stage);
			return {
				summary: { summary, details: { readFiles: stage.deliverablePaths, modifiedFiles: [] } },
				label: `xdd ${stage.name}`,
			};
		});
	},
};
