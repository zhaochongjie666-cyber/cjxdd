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
import { decideFollowUp } from "./followup.ts";

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
				// Phase 0 P20: /xdd-stop is an IDEMPOTENT control op. Calling it
				// 5 times in a row must produce ONE notification and ZERO new
				// LLM turns. Rules:
				//   - stateRef is null          → ui.notify only, no sendUserMessage
				//   - stateRef.paused already   → return silently (no abort, no notify)
				//   - running → paused          → set paused+stopRequested FIRST
				//                                   (so a racing agent_end sees paused),
				//                                   then ctx.abort, then ui.notify.
				// NEVER call pi.sendUserMessage here: it always triggers a turn,
				// and ctx.abort() leaves the agent in "processing" state, so
				// the message collides with "Agent is already processing"
				// and can re-enter agent_end → re-send pause message → loop.
				if (!stateRef) {
					ctx.ui.notify("[xdd] 无活跃 xdd run。", "warning");
					return;
				}
				if (stateRef.paused) {
					// Already paused -- idempotent no-op.
					return;
				}
				// Flip paused BEFORE abort so the next agent_end sees the
				// signal and returns silently (P21).
				stateRef.paused = true;
				stateRef.stopRequested = true;
				stateRef.pauseNotified = false;
				// Abort only when the agent is actually streaming. If idle,
				// abort() is a no-op anyway but skipping saves a race window.
				if (!ctx.isIdle()) {
					ctx.abort();
				}
				ctx.ui.notify(
					`[xdd] run 已暂停在 ${stateRef.currentStageName() ?? "?"} 阶段。输入 /xdd-resume 恢复。`,
					"warning",
				);
				return;
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

		// xdd uses per-stage context slicing (on "context" event) to keep only
		// the current stage's messages. Runtime state is in runtime.json, not in
		// the conversation. So compaction is safe -- do NOT cancel it. Cancelling
		// causes "Error: Compaction cancelled" when context fills up during long
		// runs (10 stages × many tool calls).

		// Phase 1 P24: turn_end no longer sends followUps. The previous
		// double-source (turn_end + agent_end) was the root cause of
		// "two hooks each send followUp" -> double-advance. agent_end is
		// the SINGLE continuation scheduler; turn_end only records
		// metrics (no message dispatch).
		pi.on("turn_end", (_event) => {
			// Reserved for future metrics (turn count per stage, tool-call
			// histograms, etc.). Currently a no-op; the real state machine
			// lives in agent_end and in the xdd_submit_artifact /
			// xdd_advance tools, which write stageOutcome to runtime.json.
		});

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
		});

		// Auto-continue: when the agent finishes a turn and the run is still
		// active (not complete, not pending group approval), automatically drive
		// the next turn so the pipeline NEVER stalls. After 3 consecutive turns
		// with no progress, escalate the nudge (diagnose/rollback/ask-user)
		// instead of blindly repeating "继续" -- never stop, always continue.
		//
		// INTERRUPT SUPPORT: if the user ran /xdd-stop (stateRef.stopRequested),
		// do NOT queue a followUp -- this breaks the auto-continue loop so the
		// user regains control. Esc detection via ctx.signal?.aborted is wrapped
		// in try/catch because ctx.signal is a getter that can throw if the
		// extension runner context is stale -- an uncaught throw here would
		// break the entire agent_end flow (no followUp -> no auto-continue).
		pi.on("agent_end", async (event, ctx) => {
			if (!stateRef) return;
			if (stateRef.runComplete) return;
			// Phase 0 P21: paused / stopRequested path is SILENT.
			let signalAborted = false;
			try {
				signalAborted = ctx.signal?.aborted ?? false;
			} catch { /* ctx.signal getter can throw on stale context */ }
			if (stateRef.paused || stateRef.stopRequested || signalAborted) {
				if (!stateRef.paused) {
					stateRef.paused = true;
					stateRef.stopRequested = true;
				}
				// Phase 2 (B): record the pause so post-mortem tools can see
				// why the run stopped. Don't overwrite a terminal "completed".
				if (stateRef.stageOutcome !== "completed") {
					stateRef.stageOutcome = "paused";
				}
				if (!stateRef.pauseNotified) {
					stateRef.pauseNotified = true;
					ctx.ui.notify(
						`[xdd] 用户中断。run 已暂停在 ${stateRef.currentStageName() ?? "?"} 阶段。输入 /xdd-resume 恢复，或继续对话做其他事。`,
						"warning",
					);
				}
				return;
			}

			// Phase 1 P25: classify the end of this turn by reading the last
			// assistant message's stopReason. Provider errors and aborts are
			// pi-internal -- we MUST NOT treat them as a gate failure.
			const messages = event.messages ?? [];
			const lastMsg = messages[messages.length - 1];
			const lastAssistant =
				lastMsg && lastMsg.role === "assistant" ? (lastMsg as { stopReason?: string; errorMessage?: string }) : null;
			const stopReason = lastAssistant?.stopReason;
			if (stopReason === "error") {
				// LLM call failed (network, auth, rate limit, etc.). Don't
				// pretend the gate ran; don't burn a self-heal attempt. Just
				// mark provider_error and let pi's built-in retry / compaction
				// handle the situation. We do NOT queue a followUp here.
				stateRef.stageOutcome = "provider_error";
				stateRef.lastStageError = lastAssistant?.errorMessage ?? "LLM provider error";
				stateRef.consecutiveStalls = 0; // not a stall, just a transient
				return;
			}
			if (stopReason === "aborted") {
				// User pressed Esc / aborted the turn but didn't yet go through
				// the paused path (rare race). Treat as paused silently.
				stateRef.stageOutcome = "paused";
				return;
			}
			// stopReason in {stop, length, toolUse} -- normal end of turn.
			// length = output truncated; toolUse = agent called a tool (no
			// followUp needed). For "stop" we consult stageOutcome to decide.

			// Phase 1 P26: continuation idempotency lock. NEVER queue if
			// another followUp is already pending or one was just queued.
			if (stateRef.continuationQueued) return;
			if (typeof ctx.hasPendingMessages === "function" && ctx.hasPendingMessages()) return;

			// Phase 2 (B): read stageOutcome to decide what to send. No more
			// guessing from healBudget / consecutiveStalls.
			const stage = stateRef.currentStage();
			if (!stage) return;
			const outcome = stateRef.stageOutcome;
			const stageName = stage.name;

			// Decide the followUp text + whether to queue.
			const decision = decideFollowUp(outcome, stageName, stateRef);
			if (decision === null) return; // no followUp needed

			// P26: set the lock BEFORE queuing so a re-entrant agent_end
			// (rare but possible) will see it and bail.
			stateRef.continuationQueued = true;
			stateRef.continuationReason = outcome;
			stateRef.continuationStage = stageName;
			try {
				await pi.sendUserMessage(decision, { deliverAs: "followUp" });
			} catch {
				// Send failed (e.g. session shutting down). Clear the lock
				// so the next agent_end can retry.
				stateRef.continuationQueued = false;
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

		// Phase 0 P22: input hook that drops stale xdd continuations.
		//
		// Problem: agent_end may have queued a followUp "继续 ${stage}" message
		// BEFORE the user ran /xdd-stop. The followUp sits in pi's queue. After
		// /xdd-resume, that old followUp would be delivered and cause confusion
		// ("why is the agent continuing an old plan?").
		//
		// Solution: intercept input events with source="extension" and a
		// recognizable xdd continuation prefix; if the run is paused or the
		// epoch is stale, return { action: "handled" } to drop the message.
		pi.on("input", (event) => {
			if (!stateRef) return { action: "continue" };
			if (event.source !== "extension") return { action: "continue" };
			const text = event.text ?? "";
			// Recognize xdd continuation messages by their distinguishing
			// prefix. (P25/P26: the prefixes are emitted by decideFollowUp().)
			const isXddContinuation =
				text.startsWith("[xdd 自动推进]") ||
				text.startsWith("[xdd] 阶段") || // stage-advance nudge (kept for legacy)
				text.startsWith("[xdd] 连续"); // stall terminate nudge
			if (!isXddContinuation) return { action: "continue" };
			// Drop while paused: agent must not receive a "继续" while the
			// user is reading the pause notification.
			if (stateRef.paused) return { action: "handled" };
			// P26 lock cycle complete: a queued continuation has been
			// delivered to the agent. Clear the lock so the next agent_end
			// can queue a fresh continuation if needed.
			stateRef.continuationQueued = false;
			return { action: "continue" };
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

