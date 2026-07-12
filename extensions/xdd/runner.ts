import { readCheckpoint, removeCheckpoint, writeCheckpoint } from "./checkpoint.ts";
import { buildReflectSeed, buildSeed, reflectAllowedTools, STAGE_ORCHESTRATION_TOOLS } from "./context.ts";
import { STAGES } from "./stages.ts";
import type {
	ActiveXddRun,
	XddApprovalEvent,
	XddEvent,
	XddEventListener,
	XddLedgerEntry,
	XddRunnerState,
	XddRunOptions,
	XddRunResult,
	XddRuntime,
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
	private readonly runtime: XddRuntime;
	private readonly state: XddRunnerState;
	private readonly opts: XddRunOptions;

	constructor(runtime: XddRuntime, state: XddRunnerState, opts: XddRunOptions) {
		this.runtime = runtime;
		this.state = state;
		this.opts = opts;
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
		this.runtime.appendCustomEntry(customType, data);
	}

	private computeTokens(): number {
		let total = 0;
		for (const m of this.runtime.getMessages()) {
			if (m.role === "assistant" && m.usage) {
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
		const resumed = this.opts.resumeFromCheckpoint && this.tryResume();
		if (!resumed) {
			this.state.startRun();
		}
		this.emit({ type: "xdd_run_start", runId: this.state.runId, at: new Date().toISOString() });
		writeCheckpoint(this.state, "running", this.rollbackCount);
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
					writeCheckpoint(this.state, "running", this.rollbackCount);
					// xdd_advance (or the fallback) already advanced state.
					continue;
				}

			// Stuck: check if xdd_advance already set a forced rollback (e.g. group gate failure)
			if (this.state.rollbackOutcome) {
				const rolled = await this.applyRollback();
				if (!rolled) return this.failResult(stage, "人类拒绝组级回退");
				writeCheckpoint(this.state, "running", this.rollbackCount);
				continue;
			}

			// P7 Human Governance: pause for approval at critical junctures
			if (this.opts.humanApprovalHook) {
				const signals = this.state.getSignals();
				const isVerify = stage.exit === "verdict";
				const event: XddApprovalEvent = isVerify
					? { type: "verify_verdict", pass: signals.has("verdict_pass"), summary: this.state.submittedArtifacts.get(stage.name)?.join(", ") ?? "" }
					: { type: "gate_failure", stage: stage.name, reason: this.lastFailure?.reason ?? "Gate 未通过", attempt };
				const decision = await this.opts.humanApprovalHook(event);
				if (!decision.approved) {
					return this.failResult(stage, `人类拒绝继续：${decision.reason}`);
				}
			}

			// Stuck: prompt a reflection turn. The model is expected to call
			// xdd_rollback (after optionally xdd_diagnose) to recover.
			this.resetOutcomes();
			await this.reflectTurn(stage, attempt);
			if (this.state.rollbackOutcome) {
				const rolled = await this.applyRollback();
				if (!rolled) return this.failResult(stage, "人类拒绝回退");
				writeCheckpoint(this.state, "running", this.rollbackCount);
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
			if (this.status === "pass") {
				removeCheckpoint(this.state.cwd);
			} else {
				writeCheckpoint(this.state, this.status, this.rollbackCount);
			}
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
		this.state.boundary = this.runtime.getMessages().length;
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

		this.runtime.setActiveToolsByName([...stage.allowedTools, ...STAGE_ORCHESTRATION_TOOLS]);
		this.append("xdd_stage_boundary", {
			runId: this.state.runId,
			stage: stage.name,
			index: this.state.planIndex,
			total: this.state.plan.length,
			attempt,
		});

		await this.runtime.prompt(buildSeed(stage, this.state.userInput), { expandPromptTemplates: false });

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

		this.runtime.setActiveToolsByName(reflectAllowedTools());
		await this.runtime.prompt(buildReflectSeed(stage, reason), { expandPromptTemplates: false });

		const rollback = this.state.rollbackOutcome;
		this.append("xdd_reflect_end", {
			runId: this.state.runId,
			failedStage: stage.name,
			layer: this.state.getDiagnose()?.layer ?? "(none)",
			reason: this.state.getDiagnose()?.reason ?? "",
			rolled: rollback ? `${rollback.from}→${rollback.to}` : "(none)",
		});
	}

	/** Apply bookkeeping/events for a rollback the tool already performed in state.
	 *  Returns false if human governance blocked the rollback. */
	private async applyRollback(): Promise<boolean> {
		const rb = this.state.rollbackOutcome;
		if (!rb) return false;

		if (this.opts.humanApprovalHook) {
			const decision = await this.opts.humanApprovalHook({
				type: "group_rollback",
				from: rb.from,
				to: rb.to,
				reason: rb.reason,
			});
			if (!decision.approved) {
				this.state.rollbackOutcome = undefined;
				return false;
			}
		}

		this.rollbackCount++;
		this.state.recordEsgNode("decision", rb.to, `rollback ${rb.from} -> ${rb.to}: ${rb.reason}`);
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
		return true;
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
			tokensUsed: this.computeTokens(),
			artifacts: this.state.submittedArtifacts.get(stage) ?? undefined,
		};
		this.state.ledger.push(entry);
		this.state.recordEsgNode("evidence", stage, `${stage} attempt ${attempt}: ${passed ? "pass" : "fail"}`, { artifacts: entry.artifacts, tokensUsed: entry.tokensUsed });
	}

	/** Attempt to restore run state from <cwd>/.xdd/checkpoint.json (P5). */
	private tryResume(): boolean {
		const cp = readCheckpoint(this.state.cwd);
		if (!cp || cp.runId !== this.state.runId) return false;
		this.state.restoreFromCheckpoint(cp);
		this.rollbackCount = cp.rollbackCount;
		return true;
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
