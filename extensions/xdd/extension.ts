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
import { sliceByEpoch, EPOCH_MARKER_PREFIX } from "./epoch-slicer.ts";
import { resolveGlobs, hasGlobMeta } from "./glob-resolver.ts";
import { compileStageContracts } from "./core/stage-contract.ts";
import { agentEndCommandFromPi, PiControllerAdapter } from "./adapters/pi-controller.ts";

/**
 * Module-level shared state. The InlineExtension factory registers tools and
 * handlers that close over `stateRef`. runXdd injects the live state via
 * activateXddExtension(); when no run is active, stateRef is null and every
 * handler is a no-op (before_agent_start returns no override, context returns
 * messages unchanged) and every tool throws.
 */
let stateRef: XddRunnerState | null = null;

export function activateXddExtension(state: XddRunnerState): void {
	compileStageContracts(state.plan.map(({ stage }) => stage));
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
	// Phase 8 (H.3): use the shared glob resolver so glob patterns in
	// deliverablePaths expand to all matching files, not just one.
	// (Previously existsSync on a glob literal returned false.)
	const allPaths = resolveGlobs(cwd, stage.deliverablePaths);
	const seen = new Set<string>();
	for (const p of stage.deliverablePaths) {
		const abs = join(cwd, p);
		if (existsSync(abs) && statSync(abs).isFile()) {
			const size = statSync(abs).size;
			lines.push(`- ✅ ${p} (${size} bytes)`);
			seen.add(p);
		} else if (hasGlobMeta(p)) {
			// Glob pattern -- check if any matches found
			const matches = allPaths.filter((m) => m === p || allPaths.includes(m));
			if (matches.length > 0) {
				lines.push(`- ✅ ${p} → ${matches.length} file(s)`);
				matches.forEach((m) => seen.add(m));
			} else {
				lines.push(`- ⬜ ${p} (no files match)`);
			}
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
				if (stateRef?.pendingGroupApproval) {
					const adapter = new PiControllerAdapter({ pi, ctx, getState: () => stateRef });
					await adapter.dispatch({ type: "APPROVE", approvalId: stateRef.pendingGroupApproval.group });
					await ctx.waitForIdle();
					return;
				}
				const { continueXdd } = await import("./run.ts");
				await continueXdd(_args, ctx.cwd, pi);
				await ctx.waitForIdle();
			},
		});
		pi.registerCommand("xdd-resume", {
			description: "从 checkpoint 恢复中断的 xdd run",
			handler: async (_args, ctx) => {
				if (stateRef?.paused) {
					const adapter = new PiControllerAdapter({ pi, ctx, getState: () => stateRef });
					await adapter.dispatch({ type: "RESUME" });
					await ctx.waitForIdle();
					return;
				}
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
				const adapter = new PiControllerAdapter({ pi, ctx, getState: () => stateRef });
				await adapter.dispatch({ type: "STOP", source: "command" });
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

		// Phase 7 (G.1 + G.2): bash tool guard.
		// G.1: inject a default 300s timeout (5 min) when the LLM doesn't
		// set one. pi's bash tool uses this timeout to call killProcessTree
		// (SIGTERM, then SIGKILL after grace) -- so the entire child
		// process group is reaped on timeout, not just the shell.
		// G.2: block forbidden patterns (`find /`, `rm -rf /`, etc.)
		// before they run. These don't have a meaningful timeout -- a
		// 12-hour `find /` will keep burning wall-clock even if killed,
		// and `rm -rf /` should never run regardless.
		pi.on("tool_call", async (event) => {
			if (event.toolName !== "bash" || !event.input) return;
			const input = event.input as {
				timeout?: number;
				command?: string;
				description?: string;
			};
			// G.1: default timeout
			if (input.timeout === undefined || input.timeout <= 0) {
				input.timeout = 300;
			}
			// G.2: forbidden patterns. These commands are dangerous enough
			// that the agent should be told to scope them, not just timed out.
			const cmd = String(input.command ?? "");
			const forbidden: Array<{ pattern: RegExp; reason: string }> = [
				{ pattern: /\bfind\s+\/\s*(?!-)/, reason: "find / 会扫描整个文件系统" },
				{ pattern: /\bfind\s+\/\s*-/, reason: "find /<args> 会扫描整个文件系统" },
				{ pattern: /\brm\s+(-[a-zA-Z]*\s+)*\/\s*(?:-|$|\.)/, reason: "rm -rf / 会删除整个系统" },
				{ pattern: /\bdd\s+if=\/dev\/(zero|urandom)\s+of=\/dev\//, reason: "dd 到设备会清空磁盘" },
				{ pattern: /\bmkfs(\.\w+)?\s+\/dev\//, reason: "mkfs 会格式化磁盘" },
			];
			for (const f of forbidden) {
				if (f.pattern.test(cmd)) {
					throw new Error(
						`[xdd] 禁止的 bash 命令 (${f.reason}): ${cmd.slice(0, 120)}${cmd.length > 120 ? "..." : ""}。请限定到 cwd 子目录或明确白名单根。`,
					);
				}
			}
		});

		// Phase 7 (G.3): bash tool result telemetry. Record exit status,
		// timeout, and error info into the ESG for post-mortem analysis.
		// isError=true means the command failed (non-zero exit, timeout,
		// or abort). The content text tells us which; we record both.
		pi.on("tool_result", (event) => {
			if (event.type !== "tool_result" || event.toolName !== "bash") return;
			if (!stateRef) return;
			const input = event.input as { command?: string; timeout?: number };
			const cmd = String(input.command ?? "").slice(0, 200);
			const cmdShort = cmd.length > 80 ? cmd.slice(0, 77) + "..." : cmd;
			if (event.isError) {
				// Detect timeout vs other errors. Pi's error text on timeout
				// is "timeout:N". We surface the failure reason in the ESG
				// node so the audit trail shows "this command timed out"
				// rather than just "error".
				const errText = event.content
					.filter((c: { type?: string; text?: string }) => c.type === "text")
					.map((c: { text?: string }) => c.text ?? "")
					.join(" ");
				const isTimeout = /timeout:\d+/.test(errText);
				const stageName = stateRef.currentStageName() ?? "?";
				stateRef.recordEsgNode("evidence", stageName,
					isTimeout
						? `bash timeout: ${cmdShort}`
						: `bash failed: ${cmdShort}`,
					{ command: cmd, timeout: input.timeout, error: errText.slice(0, 500) },
				);
			}
		});

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
		// Phase 3 (C) P28: also inject the current stageEpoch marker so the
		// context hook (and the model itself) can identify which messages
		// belong to the current stage. The marker is a special user message
		// that pi sees as a normal user turn but the slicer recognizes by
		// its EPOCH_MARKER_PREFIX.
		pi.on("before_agent_start", async (_event, ctx) => {
			// Capture model + modelRegistry for AIGate LLM calls.
			setLLMRef(ctx.model ?? null, ctx.modelRegistry ?? null);
			if (!stateRef) return undefined;
			const systemPrompt = buildActiveStageSystemPrompt(stateRef);
			const epoch = stateRef.stageEpoch;
			// Inject a user message with the epoch marker so the context
			// hook can find it on the next compaction. We append to the
			// system prompt instead of sending a separate user message --
			// a user message would change the conversation flow; the marker
			// is a system-only annotation.
			const finalPrompt = systemPrompt
				? `${systemPrompt}\n\n${EPOCH_MARKER_PREFIX} ${epoch}`
				: undefined;
			return finalPrompt === undefined ? undefined : { systemPrompt: finalPrompt };
		});

		// Fresh per-stage context: drop messages before the stage epoch.
		// Phase 3 (C) P28: replaced the numeric boundary (which broke
		// under compaction because message indices shift) with a string
		// stageEpoch marker. The slicer finds the marker in the message
		// stream and keeps only messages from that point forward, plus
		// the most recent compaction summary if it postdates the marker.
		pi.on("context", async (event) => {
			if (!stateRef) return undefined;
			const sliced = sliceByEpoch(event.messages, stateRef.stageEpoch);
			if (sliced === event.messages) return undefined;
			return { messages: sliced };
		});

		// Auto-continue: route Pi lifecycle into the Controller Core.
		// The adapter is now the single place that turns pi agent_end into an
		// XddCommand and executes returned effects (followUp / notify / abort).
		pi.on("agent_end", async (event, ctx) => {
			if (!stateRef) return;
			if (stateRef.runComplete) return;
			const command = agentEndCommandFromPi(event);
			if (!command) return;
			if (typeof ctx.hasPendingMessages === "function") {
				command.hasPendingMessages = ctx.hasPendingMessages();
			}
			const adapter = new PiControllerAdapter({ pi, ctx, getState: () => stateRef });
			await adapter.dispatch(command);
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
			// prefix. (P25/P26: the prefixes are emitted by controller scheduler text).
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

