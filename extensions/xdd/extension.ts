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
import type { XddRunnerState, XddStageName, XddStageSpec } from "./types.ts";
import { resolveGlobs, hasGlobMeta } from "./glob-resolver.ts";
import { compileStageContracts } from "./core/stage-contract.ts";
import { agentEndCommandFromPi, PiControllerAdapter } from "./adapters/pi-controller.ts";
import { enforceToolCallPolicy } from "./policy/tool-policy.ts";
import { diffVerifySnapshot, ensureVerifySnapshot, formatVerifySnapshotDiff } from "./policy/verify-snapshot.ts";
import { evidenceFailureToGateResult, type EvidenceGateFailure } from "./evidence/verify-gate.ts";
import { isProvider429InsufficientBalance, XddController } from "./core/controller.ts";
import { RuntimeStore } from "./storage/runtime-store.ts";
import { projectAuditEvent } from "./audit/projector.ts";
import type { XddAuditEvent } from "./audit/events.ts";
import { HookRunner } from "./hooks/runner.ts";
import type { HookPayload, HookPoint, HookRunResult } from "./hooks/protocol.ts";
import { assistantFlowUsage } from "./flow-budget.ts";
import { buildXddCompaction } from "./xdd-compaction.ts";

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



function recordAuditEvent(event: XddAuditEvent): void {
	if (!stateRef) return;
	try {
		const store = new RuntimeStore(stateRef.cwd);
		const rt = store.load();
		if (!rt) return;
		projectAuditEvent(rt, event);
		store.save(rt);
	} catch {
		// Audit projection must never block lifecycle hooks.
	}
}

function recordControllerAudit(nodeType: "finding" | "evidence", stage: XddStageName | "?", label: string, data?: unknown): void {
	if (!stateRef) return;
	const safeStage = stage === "?" ? "init" : stage;
	const controller = new XddController(new RuntimeStore(stateRef.cwd), stateRef.plan.map(({ stage }) => stage));
	controller.dispatch({ type: "RECORD_ESG", nodeType, stage: safeStage, label, data });
}


function hookPayload(point: HookPoint, extra: Partial<HookPayload> = {}): HookPayload | null {
	if (!stateRef) return null;
	return {
		hook: point,
		runId: stateRef.runId,
		stage: stateRef.currentStageName() ?? "?",
		stageEpoch: stateRef.stageEpoch,
		cwd: stateRef.cwd,
		...extra,
	};
}

async function runProjectHooks(point: HookPoint, extra: Partial<HookPayload> = {}): Promise<HookRunResult | null> {
	const payload = hookPayload(point, extra);
	if (!stateRef || !payload) return null;
	const result = await new HookRunner(stateRef.cwd).run(point, payload);
	if (result.records.length > 0 || result.warnings.length > 0 || result.action !== "pass") {
		recordAuditEvent({
			type: "hook_result",
			stage: payload.stage,
			hook: point,
			action: result.action,
			warnings: result.warnings,
			data: {
				reason: result.reason,
				prompt: result.prompt,
				records: result.records.map((record) => ({ file: record.file, action: record.output.action, warning: record.warning, timedOut: record.timedOut })),
			},
		});
	}
	return result;
}

function toolResultText(event: { content?: Array<{ type?: string; text?: string }> }): string {
	return (event.content ?? [])
		.filter((part) => part.type === "text")
		.map((part) => part.text ?? "")
		.join("\n");
}

/**
 * A repair steer is issued only for a real unified-AIGate artifact verdict
 * with remaining budget. Degraded/model-unavailable reviews did not decide the
 * artifact verdict, and exhausted verdict stages must diagnose or roll back.
 */
function parseQueuedContinuationEpoch(text: string): number | null {
	const match = text.match(/\[xdd epoch:(\d+)\]/);
	if (!match) return null;
	const value = Number.parseInt(match[1] ?? "", 10);
	return Number.isFinite(value) ? value : null;
}

function isAIGateRepairFailure(
	event: { type?: string; content?: Array<{ type?: string; text?: string }> },
	toolName: string,
	state: XddRunnerState,
): boolean {
	if (event.type !== "tool_result" || toolName !== "xdd_submit_artifact") return false;
	const text = toolResultText(event);
	const stage = state.currentStageName();
	return Boolean(stage) &&
		/❌ \[AIGate \d+\/\d+\]/.test(text) &&
		text.includes("多角度攻击未通过") &&
		!text.includes("自愈预算耗尽") &&
		state.remainingAiGateBudget(stage!) > 0;
}

function isMainTurnAIGateReviewRequest(
	event: { type?: string; content?: Array<{ type?: string; text?: string }> },
	toolName: string,
): boolean {
	return event.type === "tool_result" && toolName === "xdd_submit_artifact" &&
		toolResultText(event).includes("[AIGate 主 turn 待审]");
}

async function sendMainTurnAIGateReviewSteering(
	pi: { sendUserMessage?: (text: string, options?: unknown) => Promise<unknown> | unknown },
	state: XddRunnerState,
): Promise<void> {
	const stage = state.currentStageName() ?? "当前";
	await pi.sendUserMessage?.(
		`[xdd aigate steering] ${stage} 阶段硬 Gate 已通过。不要启动独立 LLM：在当前主 turn 读取 xdd_submit_artifact 返回的 review summary、真实产物和跨阶段契约，逐项攻击工具列出的全部必审角度及其正向路径与兜底路径；每个角度写证据或 N/A 理由，然后携带原 reviewToken 和 mainTurnReview 重新调用 xdd_submit_artifact。未完成审查前禁止 xdd_advance。`,
		{ deliverAs: "steer" },
	);
}

async function sendAIGateRepairSteering(
	pi: { sendUserMessage?: (text: string, options?: unknown) => Promise<unknown> | unknown },
	state: XddRunnerState,
): Promise<void> {
	const stage = state.currentStageName() ?? "当前";
	const reason = state.lastStageError ?? "AIGate 未说明失败原因";
	try {
		await pi.sendUserMessage?.(
			[
				`[xdd aigate steering] ${stage} 阶段统一 AIGate 未通过：${reason}。`,
				"这是修复指令，不是重提指令：禁止立刻再次调用 xdd_submit_artifact。",
				"必须先完成 repair turn loop：读取上一条 AIGate 审查反馈和修改建议 -> 调 xdd_observe/xdd_difference 定位差距 -> 检查并修改相关产物/代码 -> 运行正向验证和兜底/攻击检查 -> 在 summary/selfAttack 中写明证据。",
				"只有确认至少完成了上述修复与验证闭环后，才重新调用 xdd_submit_artifact；不要推进下一阶段。",
			].join(""),
			{ deliverAs: "steer" },
		);
	} catch (error) {
		recordControllerAudit("finding", stage, "AIGate repair steering send failed", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}


function isXddAdvanceNextStage(event: { type?: string; content?: Array<{ type?: string; text?: string }> }, toolName: string, state: XddRunnerState): boolean {
	if (event.type !== "tool_result" || toolName !== "xdd_advance") return false;
	if (state.runComplete || state.pendingGroupApproval || state.paused || state.stopRequested) return false;
	const text = toolResultText(event);
	return text.includes("[xdd_advance]") && text.includes("进入下一阶段");
}

async function sendAdvanceNextStageSteering(
	pi: { sendUserMessage?: (text: string, options?: unknown) => Promise<unknown> | unknown },
	state: XddRunnerState,
): Promise<void> {
	const stage = state.currentStageName() ?? "当前";
	try {
		await pi.sendUserMessage?.(
			`[xdd advance steering] 已进入 ${stage} 阶段。立即自动执行下一步：调用 xdd_observe、xdd_desired_state、xdd_difference，按差距完成阶段产物；不要停下来只汇报已推进。`,
			{ deliverAs: "steer" },
		);
	} catch (error) {
		recordControllerAudit("finding", stage, "xdd_advance next-stage steering send failed", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

async function sendHookContinuePrompt(pi: { sendUserMessage?: (text: string, options?: unknown) => Promise<unknown> | unknown }, prompt: string): Promise<void> {
	try {
		await pi.sendUserMessage?.(`[xdd hook continue] ${prompt}`, { deliverAs: "followUp" });
	} catch (error) {
		recordControllerAudit("finding", stateRef?.currentStageName() ?? "init", "hook continue prompt send failed", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

/**
 * xdd InlineExtension. Registered via main.ts extensionFactories (and
 * createHarness({ extensionFactories: [xddInlineExtension] }) in tests).
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
		let pendingProviderError: {
			command: NonNullable<ReturnType<typeof agentEndCommandFromPi>>;
			runId: string;
			stageEpoch: string;
		} | null = null;
		for (const tool of createXddTools(getState)) {
			pi.registerTool(tool);
		}

		// Slash commands: /xdd <task> plus lifecycle controls.
		pi.registerCommand("xdd", {
			description: "启动或控制 xdd: /xdd <任务> | status | reset [all]",
			handler: async (args, ctx) => {
				const command = args.trim();
				const { runXdd, xddRest, xddStatus } = await import("./run.ts");
				const notify = (message: string, level?: "info" | "warning" | "error") => ctx.ui.notify(message, level);
				if (command === "status") {
					await xddStatus("", ctx.cwd, pi, notify);
					return;
				}
				const reset = command.match(/^reset(?:\s+(all))?$/);
				if (reset) {
					await xddRest(reset[1] ?? "", ctx.cwd, pi, notify);
					return;
				}
				await runXdd(args, ctx.cwd, pi);
				await ctx.waitForIdle();
			},
		});
		for (const stage of STAGES) {
			pi.registerCommand(`xdd-goto-${stage.name}`, {
				description: `跳转到 xdd ${stage.name} 阶段`,
				handler: async (_args, ctx) => {
					const { xddGoToStage } = await import("./run.ts");
					xddGoToStage(stage.name, (message, level) => ctx.ui.notify(message, level));
				},
			});
		}
		pi.registerCommand("xdd-continue", {
			description: "确认组级 Gate 通过，推进到下一阶段组",
			handler: async (args, ctx) => {
				if (stateRef?.pendingGroupApproval) {
					const adapter = new PiControllerAdapter({ pi, ctx, getState: () => stateRef });
					await adapter.dispatch({ type: "APPROVE", approvalId: stateRef.pendingGroupApproval.group }, args);
					await ctx.waitForIdle();
					return;
				}
				const { continueXdd } = await import("./run.ts");
				await continueXdd(args, ctx.cwd, pi);
				await ctx.waitForIdle();
			},
		});
		pi.registerCommand("xdd-resume", {
			description: "从 checkpoint 恢复中断的 xdd run",
			handler: async (args, ctx) => {
				if (stateRef?.paused) {
					const adapter = new PiControllerAdapter({ pi, ctx, getState: () => stateRef });
					await adapter.dispatch({ type: "RESUME" }, args);
					await ctx.waitForIdle();
					return;
				}
				const { resumeXdd } = await import("./run.ts");
				await resumeXdd(args, ctx.cwd, pi);
				await ctx.waitForIdle();
			},
		});
		pi.registerCommand("xdd-status", {
			description: "查看当前 xdd 流水线状态",
			handler: async (_args, ctx) => {
				const { xddStatus } = await import("./run.ts");
				await xddStatus(_args, ctx.cwd, pi, (message, level) => ctx.ui.notify(message, level));
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
		pi.registerCommand("xdd-rest", {
			description: "重置当前 xdd run 的流程预算和阶段预算；传 all 重置全部阶段预算",
			handler: async (args, ctx) => {
				const { xddRest } = await import("./run.ts");
				await xddRest(args, ctx.cwd, pi, (message, level) => ctx.ui.notify(message, level));
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

		// T6: stage-aware tool policy. Enforce allowed xdd tools, read/write
		// scopes, protected paths, and bash defaults/dangerous-command blocks
		// before pi executes the tool.
		pi.on("tool_call", async (event) => {
			if (!stateRef) return;
			const toolName = String(event.toolName ?? event.name ?? "?");
			const hookResult = await runProjectHooks("before_tools", { toolCalls: [{ name: toolName, input: event.input }] });
			if (hookResult?.action === "block") {
				throw new Error(`[xdd hook] before_tools blocked ${toolName}: ${hookResult.reason ?? "no reason"}`);
			}
			if (hookResult?.action === "continue" && hookResult.prompt) {
				await sendHookContinuePrompt(pi, hookResult.prompt);
			}
			try {
				enforceToolCallPolicy(stateRef, event);
			} catch (error) {
				recordControllerAudit("finding", stateRef.currentStageName() ?? "init", "policy block", {
					toolName: event.toolName ?? event.name,
					input: event.input,
					error: error instanceof Error ? error.message : String(error),
				});
				throw error;
			}
		});

		// Phase 7 (G.3): bash tool result telemetry. Record exit status,
		// timeout, and error info into the ESG for post-mortem analysis.
		// isError=true means the command failed (non-zero exit, timeout,
		// or abort). The content text tells us which; we record both.
		pi.on("tool_result", async (event) => {
			if (!stateRef) return;
			const toolName = String(event.toolName ?? event.name ?? "?");
			if (isMainTurnAIGateReviewRequest(event, toolName)) {
				await sendMainTurnAIGateReviewSteering(pi, stateRef);
			}
			// The unified AIGate owns the branching decision: a passing verdict enters
			// normal stage advancement, while a repairable failed verdict steers the
			// next model call to fix the reviewed artifacts.
			if (isAIGateRepairFailure(event, toolName, stateRef)) {
				await sendAIGateRepairSteering(pi, stateRef);
			}
			if (isXddAdvanceNextStage(event, toolName, stateRef)) {
				await sendAdvanceNextStageSteering(pi, stateRef);
			}
			const hookResult = await runProjectHooks("tool_use_done", { toolCalls: [{ name: toolName, input: event.input }], toolResult: event });
			if (hookResult?.action === "continue" && hookResult.prompt) {
				await sendHookContinuePrompt(pi, hookResult.prompt);
			}
			if (stateRef.currentStageName() === "verify") {
				const diff = diffVerifySnapshot(stateRef.cwd);
				const mutated = diff.changed.length + diff.added.length + diff.deleted.length;
				if (mutated > 0) {
					const failure: EvidenceGateFailure = {
						code: "VERIFY_MUTATED_CONTRACT",
						message: "verify Gate: verify 阶段修改了源码或设计契约文件",
						files: [...diff.changed, ...diff.added, ...diff.deleted],
						remediation: `回滚到 execute 或对应设计阶段修复；verify 只允许写当前 run 的 report/evidence。变更: ${formatVerifySnapshotDiff(diff)}`,
					};
					recordControllerAudit("finding", "verify", failure.message, { diff, failure });
					const controller = new XddController(new RuntimeStore(stateRef.cwd), stateRef.plan.map(({ stage }) => stage));
					controller.dispatch({
						type: "SUBMIT",
						submission: { summary: "verify mutated source/design", artifacts: [], selfAttack: "verify snapshot diff detected source or design mutation", pass: false, error: evidenceFailureToGateResult(failure).reason },
					});
				}
			}
			if (event.type !== "tool_result" || event.toolName !== "bash") return;
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
				recordControllerAudit("evidence", stageName,
					isTimeout
						? `bash timeout: ${cmdShort}`
						: `bash failed: ${cmdShort}`,
					{ command: cmd, timeout: input.timeout, error: errText.slice(0, 500) },
				);
			}
		});

		// Keep Pi in charge of the cut point and session rewrite, but provide a
		// local handoff for active xdd runs. If the provider has already rejected
		// an oversized context, using it again to summarize can fail and leave the
		// UI at "Auto-compaction cancelled". Persisted xdd state is sufficient to
		// produce a bounded recovery summary without another provider request.
		pi.on("session_before_compact", async (event) => {
			if (!stateRef) return undefined;
			const stage = stateRef.currentStage();
			if (!stage) return undefined;
			return {
				compaction: buildXddCompaction(
					event.preparation,
					buildStageSummary(stateRef.cwd, stateRef, stage),
				),
			};
		});

		// Phase 1 P24: turn_end no longer runs xdd scheduler followUps.
		// T8 project hooks may request a bounded followUp prompt, but they
		// cannot mutate Controller state and are audited separately.
		pi.on("turn_end", async (event) => {
			// Reserved for future metrics (turn count per stage, tool-call histograms, etc.).
			const hookResult = await runProjectHooks("turn_end", { turn: event });
			if (hookResult?.action === "continue" && hookResult.prompt) {
				await sendHookContinuePrompt(pi, hookResult.prompt);
			}
		});

		// Fresh per-stage system prompt. Group gates auto-advance (no human pause).
		pi.on("before_agent_start", async (_event, ctx) => {
			// Capture model + modelRegistry for AIGate LLM calls.
			setLLMRef(ctx.model ?? null, ctx.modelRegistry ?? null);
			if (!stateRef) return undefined;
			if (stateRef.flowBudgetExhausted) {
				ctx.ui.notify(`[xdd] 流程预算已耗尽：$${stateRef.flowCostUsd.toFixed(2)}/$${stateRef.flowBudgetUsd.toFixed(2)}（${stateRef.flowTokensUsed} tokens）。设置 XDD_FLOW_BUDGET_USD 后重新启动新的 xdd run。`, "warning");
				// Pi's before_agent_start hook cannot cancel a provider call. The
				// agent_end guard below prevents every subsequent auto-continuation.
				return { systemPrompt: "[xdd] 流程预算已耗尽。不要调用工具或继续工作；直接停止。" };
			}
			if (stateRef.currentStageName() === "verify") ensureVerifySnapshot(stateRef.cwd);
			const hookResult = await runProjectHooks("turn_start");
			let systemPrompt = buildActiveStageSystemPrompt(stateRef);
			if (hookResult?.action === "continue" && hookResult.prompt) {
				systemPrompt = `${systemPrompt ?? ""}

[xdd hook continue]
${hookResult.prompt}`;
			}
			if (hookResult?.action === "block") {
				systemPrompt = `${systemPrompt ?? ""}

[xdd hook block warning] turn_start hook blocked: ${hookResult.reason ?? "no reason"}`;
			}
			return systemPrompt === undefined ? undefined : { systemPrompt };
		});

		// Auto-continue: route Pi lifecycle into the Controller Core.
		// The adapter is now the single place that turns pi agent_end into an
		// XddCommand and executes returned effects (followUp / notify / abort).
		pi.on("agent_end", async (event, ctx) => {
			if (!stateRef) return;
			stateRef.recordFlowUsage(assistantFlowUsage(event.messages));
			if (stateRef.flowBudgetExhausted) {
				pendingProviderError = null;
				stateRef.paused = true;
				ctx.ui.notify(`[xdd] 流程预算已耗尽：$${stateRef.flowCostUsd.toFixed(2)}/$${stateRef.flowBudgetUsd.toFixed(2)}（${stateRef.flowTokensUsed} tokens）。流程已暂停；提高 XDD_FLOW_BUDGET_USD 后启动新的 run。`, "warning");
				return;
			}
			if (stateRef.runComplete) {
				pendingProviderError = null;
				return;
			}
			const command = agentEndCommandFromPi(event);
			if (!command) return;
			if (command.type === "AGENT_ENDED" && command.stopReason === "error") {
				if (isProvider429InsufficientBalance(command.providerError)) {
					pendingProviderError = null;
					const adapter = new PiControllerAdapter({ pi, ctx, getState: () => stateRef });
					await adapter.dispatch(command);
					return;
				}
				pendingProviderError = { command, runId: stateRef.runId, stageEpoch: stateRef.stageEpoch };
				return;
			}
			pendingProviderError = null;
			if (typeof ctx.hasPendingMessages === "function") {
				command.hasPendingMessages = ctx.hasPendingMessages();
			}
			const adapter = new PiControllerAdapter({ pi, ctx, getState: () => stateRef });
			await adapter.dispatch(command);
		});

		pi.on("agent_settled", async (_event, ctx) => {
			if (!stateRef || stateRef.runComplete || !pendingProviderError) return;
			if (stateRef.paused || stateRef.stopRequested || pendingProviderError.runId !== stateRef.runId || pendingProviderError.stageEpoch !== stateRef.stageEpoch) {
				pendingProviderError = null;
				return;
			}
			const { command } = pendingProviderError;
			pendingProviderError = null;
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
		pi.on("input", async (event) => {
			if (!stateRef) return { action: "continue" };
			if (event.source !== "extension") return { action: "continue" };
			const text = event.text ?? "";
			const isAIGateSteering = text.startsWith("[xdd aigate steering]");
			// Steering deliberately does not release the follow-up lock.
			const isXddContinuation =
				text.startsWith("[xdd 自动推进]") ||
				text.startsWith("[xdd 自动重试]") ||
				text.startsWith("[xdd] 阶段") || // stage-advance nudge (kept for legacy)
				text.startsWith("[xdd] 连续"); // stall terminate nudge
			if (!isAIGateSteering && !isXddContinuation) return { action: "continue" };
			// Drop queued repair and continuation instructions while paused: the model
			// must not receive additional work until /xdd-resume.
			if (stateRef.paused) return { action: "handled" };
			if (isAIGateSteering) return { action: "continue" };
			const queuedEpoch = parseQueuedContinuationEpoch(text);
			// Clean old auto-continue/retry prompts out of Pi's queued input stream.
			// Returning handled drops the stale message before it reaches the model,
			// so repeated 429 retries do not accumulate hundreds of token-wasting
			// continuation prompts. Legacy messages without an epoch are allowed so
			// old persisted queues remain recoverable.
			if (queuedEpoch !== null && queuedEpoch !== stateRef.continuationEpoch) return { action: "handled" };
			// P26 lock cycle complete: the current queued continuation has been
			// delivered to the agent. Clear the lock so the next agent_end can queue
			// a fresh one.
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
