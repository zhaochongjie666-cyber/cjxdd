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

		// registerEntryRenderer is only in newer pi (>=0.81 dev); guard so xdd
		// works on the published 0.80.3 too. TUI extras degrade gracefully.
		if (typeof pi.registerEntryRenderer === "function") {
			pi.registerEntryRenderer("xdd_stage_boundary", renderStageBoundary);
			pi.registerEntryRenderer("xdd_reflect_start", renderReflectStart);
			pi.registerEntryRenderer("xdd_reflect_end", renderReflectEnd);
			pi.registerEntryRenderer("xdd_rollback", renderRollback);
		}
		// xdd_ledger intentionally not rendered (audit only).

		// Disable auto-compaction for the duration of any xdd run.
		pi.on("session_before_compact", async () => {
			if (!stateRef) return undefined;
			return { cancel: true };
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
		pi.on("agent_end", async () => {
			if (!stateRef) return;
			if (stateRef.runComplete) return;
			const idx = stateRef.planIndex;
			const submittedSinceLastEnd = stateRef.lastSubmitAt > stateRef.lastAgentEndAt;
			if (idx !== stateRef.lastAgentEndPlanIndex || submittedSinceLastEnd) {
				stateRef.consecutiveStalls = 0;
			} else {
				stateRef.consecutiveStalls++;
			}
			stateRef.lastAgentEndPlanIndex = idx;
			stateRef.lastAgentEndAt = Date.now();
			const stage = stateRef.currentStage();
			if (stage) {
				const stalls = stateRef.consecutiveStalls;
				const msg = stalls < 3
					? `[xdd 自动推进] 继续 ${stage.name} 阶段。`
					: stalls < 6
						? `[xdd] 已连续 ${stalls} 轮无进展。请改变策略：调 xdd_diagnose 诊断根因，或 xdd_rollback 回退。不要重复之前的做法。`
						: `[xdd] 已连续 ${stalls} 轮无进展，严重卡住。必须 xdd_rollback 回退，或直接向用户提问求助。`;
				try {
					await pi.sendUserMessage(msg);
				} catch {
					// ignore send errors (e.g., session shutting down)
				}
			}
			// Stage-advance nudge: if planIndex just moved forward this turn,
			// a stage completed successfully. Tell the user they can commit the
			// summary into the session tree via /xdd-commit.
			const prevIdx = stateRef.lastAgentEndPlanIndex;
			if (!stateRef.runComplete && idx > prevIdx && prevIdx >= 0) {
				const advanced = STAGES[prevIdx];
				try {
					await pi.sendUserMessage(
						`[xdd] 阶段 ${advanced?.name ?? "?"} 完成，进 ${stage.name}。输入 /xdd-commit 可把 ${advanced?.name ?? "当前"} 摘要 commit 到 session tree（/tree 查看）。`,
					);
				} catch { /* ignore */ }
			}
		});

		// Checkpoint detection: if pi restarts with an unfinished xdd run,
		// notify the user they can resume.
		pi.on("session_start", async (event) => {
			if (event.reason !== "startup" && event.reason !== "reload") return;
			try {
				const cp = readCheckpoint(process.cwd());
				if (cp) {
					await pi.sendUserMessage(
						`[xdd] 检测到未完成的 xdd run（${cp.runId}）。输入 /xdd-resume 恢复，或忽略开始新对话。`,
					);
				}
			} catch {
				// ignore
			}
		});

		// Run completion: auto-archive (first time only -- `archived` flag prevents re-run).
		pi.on("agent_end", async () => {
			if (!stateRef) return;
			if (!stateRef.runComplete) return;
			if (stateRef.archived) return;
			stateRef.archived = true;
			try {
				// Archive the most recent runs/<*>/* by mtime. design/ is read-only (never modified).
				const result = archiveRun(process.cwd());
				await pi.sendUserMessage(
					`[xdd 自动归档] run ${stateRef.runId} 完成。写入 ${result.archivePath}（删 ${result.deletedPaths.length} 个 runs/ 文件，design/ 仅读取不改，记录 ${result.keptPaths.length} 项读取）。`,
				);
			} catch (e) {
				await pi.sendUserMessage(`[xdd 归档失败] ${e instanceof Error ? e.message : String(e)}`);
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
