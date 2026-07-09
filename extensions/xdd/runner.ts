import type { AgentSession } from "../core/agent-session.ts";
import { buildReflectSeed, buildSeed, reflectAllowedTools, STAGE_ORCHESTRATION_TOOLS } from "./context.ts";
import { STAGES } from "./stages.ts";
import type {
	ActiveXddRun,
	XddEvent,
	XddEventListener,
	XddLedgerEntry,
	XddRunnerState,
	XddRunOptions,
	XddRunResult,
	XddStageName,
	XddStageSpec,
	XddStatus,
} from "./types.ts";

const TICK_MS = 1000;

/**
 * XddRunner is now a THIN host driver (architecture B). The stage-transition
 * logic lives in the tools `xdd_advance` / `xdd_rollback` (which mutate the
 * shared XddRunnerState and set `advanceOutcome` / `rollbackOutcome`). The
 * runner only owns turn boundaries: per stage it activates the stage's tool
 * set, slices context, prompts, then reads the outcome the tools recorded and
 * follows it. This keeps per-stage tool isolation + system prompt + context
 * slicing (turn-boundary concerns) while making the state machine tool-driven.
 */
export class XddRunner {
	private listeners = new Set<XddEventListener>();
	private rollbackCount = 0;
	private status: XddStatus = "running";
	private lastFailure: { layer: string; reason: string; at: string } | undefined;
	private stageStartedAt = new Date();
	private runStartedAt = new Date();
	private readonly session: AgentSession;
	private readonly state: XddRunnerState;

	constructor(session: AgentSession, state: XddRunnerState, opts: XddRunOptions) {
		this.session = session;
		this.state = state;
		state.maxRollbacksPerStage = opts.maxRollbacksPerStage ?? 2;
		state.maxSelfHealPerStage = opts.maxSelfHealPerStage ?? 3;
		state.plan = XddRunner.buildPlan(opts);
	}

	private static buildPlan(opts: XddRunOptions): Array<{ stage: XddStageSpec; originalIndex: number }> {
		let entries = STAGES.map((stage, originalIndex) => ({ stage, originalIndex }));
		if (opts.skipWire) {
			entries = entries.filter((e) => e.stage.name !== "wire");
		}
		if (opts.fromStage) {
			const fromIdx = entries.findIndex((e) => e.stage.name === opts.fromStage);
			if (fromIdx === -1) {
				throw new Error(`--from 未知阶段: ${opts.fromStage}`);
			}
			entries = entries.slice(fromIdx);
		}
		if (opts.onlyStage) {
			const only = entries.filter((e) => e.stage.name === opts.onlyStage);
			if (only.length === 0) {
				throw new Error(`--stage 未知或被排除的阶段: ${opts.onlyStage}`);
			}
			entries = only;
		}
		return entries;
	}

	subscribe(fn: XddEventListener): () => void {
		this.listeners.add(fn);
		return () => {
			this.listeners.delete(fn);
		};
	}

	private emit(event: XddEvent): void {
		for (const fn of this.listeners) {
			try {
				fn(event);
			} catch {
				// listener errors must not break the run
			}
		}
	}

	snapshotActiveRun(): ActiveXddRun | undefined {
		const stage = this.state.currentStage();
		if (!stage) return undefined;
		const now = Date.now();
		return {
			runId: this.state.runId,
			stage: stage.name,
			index: this.state.planIndex,
			total: this.state.plan.length,
			status: this.status,
			rollbacks: this.rollbackCount,
			attempt: this.state.currentAttempt(stage.name),
			allowedTools: stage.allowedTools,
			deliverable: stage.deliverablePaths,
			lastFailure: this.lastFailure,
			stageStartedAt: this.stageStartedAt.toISOString(),
			stageElapsedMs: now - this.stageStartedAt.getTime(),
			totalElapsedMs: now - this.runStartedAt.getTime(),
			tokensUsed: this.computeTokens(),
		};
	}

	/** Persist the ledger as a single custom entry. Called by runXdd finally. */
	persistLedger(status: "ok" | "failed"): void {
		this.append("xdd_ledger", {
			runId: this.state.runId,
			userInput: this.state.userInput,
			status,
			ledger: this.state.ledger,
			rollbacks: this.rollbackCount,
			finalStage: this.state.currentStageName(),
			at: new Date().toISOString(),
		});
	}

	private append(customType: string, data: unknown): void {
		this.session.sessionManager.appendCustomEntry(customType, data);
	}

	private computeTokens(): number {
		let total = 0;
		for (const m of this.session.agent.state.messages) {
			if (m.role === "assistant") {
				total += m.usage.totalTokens;
			}
		}
		return total;
	}

	async run(): Promise<XddRunResult> {
		if (this.state.plan.length === 0) {
			return this.failResult(undefined, "执行计划为空");
		}
		this.runStartedAt = new Date();
		this.state.startRun();
		this.emit({ type: "xdd_run_start", runId: this.state.runId, at: new Date().toISOString() });
		const timer = setInterval(() => {
			const now = Date.now();
			this.emit({
				type: "xdd_tick",
				runId: this.state.runId,
				stageElapsedMs: now - this.stageStartedAt.getTime(),
				totalElapsedMs: now - this.runStartedAt.getTime(),
			});
		}, TICK_MS);

		try {
			while (!this.state.runComplete) {
				const stage = this.state.currentStage();
				if (!stage) {
					return this.failResult(undefined, "无活跃阶段（计划越界）");
				}
				const stageIndex = this.state.currentIndex();
				const attempt = this.state.beginAttempt(stage.name);
				this.resetOutcomes();
				await this.runStage(stage, attempt);
				const advanced = this.state.advanceOutcome?.passed === true;
				// Fallback: if the model recorded the completion signal (gate passed)
				// but did not call xdd_advance, treat the stage as passed and advance
				// here. Prefers the explicit tool, stays robust if the model forgets.
				const signaled = this.completionSignalSet(stage);
				const passed = advanced || signaled;
				this.recordLedger(stage.name, stageIndex, attempt, passed);

				if (passed) {
					if (!advanced && signaled) {
						this.state.clearSignals();
						if (this.state.isLastStage()) {
							this.state.runComplete = true;
						} else {
							this.state.advancePlan();
						}
					}
					// xdd_advance (or the fallback) already advanced state.
					continue;
				}

				// Stuck: prompt a reflection turn. The model is expected to call
				// xdd_rollback (after optionally xdd_diagnose) to recover.
				this.resetOutcomes();
				await this.reflectTurn(stage, attempt);
				if (this.state.rollbackOutcome) {
					this.applyRollback();
					continue;
				}
				return this.failResult(stage, this.lastFailure?.reason ?? `阶段 ${stage.name} 未通过且反思未回退`);
			}
			this.status = "pass";
			return {
				runId: this.state.runId,
				status: "ok",
				finalStage: this.state.plan[this.state.plan.length - 1]?.stage.name,
				rollbacks: this.rollbackCount,
			};
		} catch (err) {
			this.status = "fail";
			return this.failResult(this.state.currentStage(), err instanceof Error ? err.message : String(err));
		} finally {
			clearInterval(timer);
			this.emit({
				type: "xdd_run_end",
				runId: this.state.runId,
				ok: this.status === "pass",
				at: new Date().toISOString(),
			});
		}
	}

	private async runStage(stage: XddStageSpec, attempt: number): Promise<void> {
		this.status = "running";
		this.state.mode = "stage";
		this.state.clearSignals();
		this.state.clearDiagnose();
		this.state.boundary = this.session.agent.state.messages.length;
		this.stageStartedAt = new Date();

		this.emit({
			type: "xdd_stage_start",
			runId: this.state.runId,
			stage: stage.name,
			index: this.state.planIndex,
			total: this.state.plan.length,
			attempt,
			stageStartedAt: this.stageStartedAt.toISOString(),
		});

		this.session.setActiveToolsByName([...stage.allowedTools, ...STAGE_ORCHESTRATION_TOOLS]);
		this.append("xdd_stage_boundary", {
			runId: this.state.runId,
			stage: stage.name,
			index: this.state.planIndex,
			total: this.state.plan.length,
			attempt,
		});

		await this.session.prompt(buildSeed(stage, this.state.userInput), { expandPromptTemplates: false });

		const passed = this.state.advanceOutcome?.passed === true || this.completionSignalSet(stage);
		this.emit({
			type: "xdd_stage_end",
			runId: this.state.runId,
			stage: stage.name,
			ok: passed,
			at: new Date().toISOString(),
		});
	}

	private async reflectTurn(stage: XddStageSpec, attempt: number): Promise<void> {
		this.status = "reflecting";
		this.state.mode = "reflect";
		this.state.clearDiagnose();
		const reason = stage.exit === "verdict" ? "verify verdict: fail 或未通过闸门" : "未产出完成信号或闸门未通过";
		this.emit({
			type: "xdd_reflect",
			runId: this.state.runId,
			failedStage: stage.name,
			at: new Date().toISOString(),
		});
		this.append("xdd_reflect_start", {
			runId: this.state.runId,
			failedStage: stage.name,
			attempt,
		});

		this.session.setActiveToolsByName(reflectAllowedTools());
		await this.session.prompt(buildReflectSeed(stage, reason), { expandPromptTemplates: false });

		const rollback = this.state.rollbackOutcome;
		this.append("xdd_reflect_end", {
			runId: this.state.runId,
			failedStage: stage.name,
			layer: this.state.getDiagnose()?.layer ?? "(none)",
			reason: this.state.getDiagnose()?.reason ?? "",
			rolled: rollback ? `${rollback.from}→${rollback.to}` : "(none)",
		});
	}

	/** Apply bookkeeping/events for a rollback the tool already performed in state. */
	private applyRollback(): void {
		const rb = this.state.rollbackOutcome;
		if (!rb) return;
		this.rollbackCount++;
		this.lastFailure = { layer: "(rollback)", reason: rb.reason, at: new Date().toISOString() };
		this.append("xdd_rollback", {
			runId: this.state.runId,
			from: rb.from,
			to: rb.to,
			reason: rb.reason,
		});
		this.emit({
			type: "xdd_rollback",
			runId: this.state.runId,
			from: rb.from,
			to: rb.to,
			reason: rb.reason,
			at: new Date().toISOString(),
		});
	}

	private completionSignalSet(stage: XddStageSpec): boolean {
		const signals = this.state.getSignals();
		return stage.exit === "verdict" ? signals.has("verdict_pass") : signals.has("complete");
	}

	private resetOutcomes(): void {
		this.state.advanceOutcome = undefined;
		this.state.rollbackOutcome = undefined;
	}

	private recordLedger(stage: XddStageName, index: number, attempt: number, passed: boolean): void {
		const entry: XddLedgerEntry = {
			stage,
			stageIndex: index,
			attempt,
			status: passed ? "pass" : "fail",
			superseded: false,
			at: new Date().toISOString(),
		};
		this.state.ledger.push(entry);
	}

	private failResult(stage: XddStageSpec | undefined, reason: string): XddRunResult {
		this.status = "fail";
		return {
			runId: this.state.runId,
			status: "failed",
			finalStage: stage?.name,
			rollbacks: this.rollbackCount,
			reason,
		};
	}
}
