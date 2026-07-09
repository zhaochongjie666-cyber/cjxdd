import type { Skill } from "../core/skills.ts";

/** The 10 xdd software-development stages, in execution order. */
export type XddStageName =
	| "init"
	| "understand"
	| "spec"
	| "architecture"
	| "wire"
	| "resilience"
	| "plan"
	| "execute"
	| "cleanup"
	| "verify";

/** How a stage signals completion. */
export type XddStageExit = "goal_complete" | "verdict";

export interface XddGateResult {
	ok: boolean;
	/** Why the gate failed (when ok === false). */
	reason?: string;
	/** Soft pass: nothing hard was verified, but the stage may proceed. */
	soft?: boolean;
}

/** Per-stage deliverable check. Receives cwd and the model's completion summary. */
export type XddDeliverable = (cwd: string, summary: string) => Promise<XddGateResult>;

/**
 * reconcile-style gate: observes whether the declared desiredState is actually true.
 * Receives the stage's desiredState spec so the reason string can reference the
 * specific observation that failed.
 */
export type XddGate = (args: {
	cwd: string;
	summary: string;
	desiredState: readonly string[];
}) => Promise<XddGateResult>;

export interface XddStageSpec {
	name: XddStageName;
	/**
	 * reconcile-style responsibility decoupling. The same model plays this role for
	 * the duration of the stage (conceptual separation, not a multi-agent split).
	 * Lives on the spec rather than in a global map so the stage is the single
	 * source of truth.
	 */
	role: string;
	/** Skill name whose SKILL.md body is injected into the stage system prompt. */
	skill: string;
	exit: XddStageExit;
	/** Tools the model may use during this stage (active set). */
	allowedTools: string[];
	/** Artifact paths the hard gate looks for (any-of). */
	deliverablePaths: string[];
	/**
	 * reconcile-style declarative API: human-readable desired state observations for
	 * this stage. Injected into the stage system prompt and seed so the model
	 * reconciles toward this state instead of following a command script.
	 */
	desiredState: readonly string[];
	/**
	 * Hard gate executed inside the xdd_goal_complete / xdd_verdict tool. The
	 * stage's desiredState is passed in so the gate can reason against it
	 * (e.g. phrase its reason in the same vocabulary).
	 */
	gate: XddGate;
}

export type XddSignal = "complete" | "verdict_pass" | "verdict_fail";

export type XddDiagnoseLayer =
	| "intent-unclear"
	| "spec-gap"
	| "architecture-flaw"
	| "wiring-bug"
	| "implementation-bug"
	| "test-gap"
	| "cleanup-missed";

export const DIAGNOSE_LAYERS: readonly XddDiagnoseLayer[] = [
	"intent-unclear",
	"spec-gap",
	"architecture-flaw",
	"wiring-bug",
	"implementation-bug",
	"test-gap",
	"cleanup-missed",
];

export interface XddDiagnose {
	layer: XddDiagnoseLayer;
	reason: string;
}

export interface XddLedgerEntry {
	stage: XddStageName;
	stageIndex: number;
	attempt: number;
	status: "pass" | "fail";
	superseded: boolean;
	at: string;
}

export type XddRunnerMode = "stage" | "reflect";

/**
 * Per-stage role names (reconcile-style responsibility decoupling — conceptual, not
 * multi-agent). Lives here (no deps) to avoid the context.ts ↔ stages.ts cycle.
 */
export const STAGE_ROLES: Readonly<Record<XddStageName, string>> = {
	init: "Planner",
	understand: "Requirements Analyst",
	spec: "API Designer",
	architecture: "System Architect",
	wire: "Scaffolder / Integrator",
	resilience: "Reliability Engineer",
	plan: "Project Manager",
	execute: "Implementer",
	cleanup: "Refactorer / Janitor",
	verify: "Auditor",
};

export interface XddRunOptions {
	task: string;
	/** Max rollbacks per single stage before the run fails. */
	maxRollbacksPerStage?: number;
	/**
	 * reconcile-style self-heal budget: max local-fix attempts the model may do at
	 * the same stage via xdd_goal_complete / xdd_verdict before the runner
	 * forces reflection + rollback. Default 3.
	 */
	maxSelfHealPerStage?: number;
	/** Start from this stage name (inclusive) instead of "init". */
	fromStage?: XddStageName;
	/** Run only this single stage and exit. */
	onlyStage?: XddStageName;
	/** Skip the "wire" stage. */
	skipWire?: boolean;
}

export interface XddRunResult {
	runId: string;
	status: "ok" | "failed";
	finalStage: XddStageName | undefined;
	rollbacks: number;
	reason?: string;
}

/**
 * Shared mutable state between the orchestrator (XddRunner) and the extension's
 * tools / event handlers. The extension closes over a single module-level
 * instance (`stateRef`); runXdd injects it via activateXddExtension().
 */
export class XddRunnerState {
	readonly cwd: string;
	readonly runId: string;
	readonly userInput: string;
	skills: Skill[] = [];

	mode: XddRunnerMode = "stage";
	/** messages.length captured at stage start; on("context") slices from here. */
	boundary = 0;
	ledger: XddLedgerEntry[] = [];

	/** Effective ordered stages for this run (after --from/--stage/--skip-wire). */
	plan: Array<{ stage: XddStageSpec; originalIndex: number }> = [];
	/** Current position in `plan` (-1 before the run starts). */
	planIndex = -1;
	/** Max rollbacks per single stage before the run fails (set at activation). */
	maxRollbacksPerStage = 2;
	/** reconcile-style self-heal budget per stage: max xdd_goal_complete / xdd_verdict calls
	 *  for the same stage before the runner forces reflection. Set at activation. */
	maxSelfHealPerStage = 3;

	/** Set by xdd_advance when the model transitions to the next stage. */
	advanceOutcome: { passed: boolean } | undefined;
	/** Set by xdd_rollback when the model declares a rollback target. */
	rollbackOutcome: { from: XddStageName; to: XddStageName; reason: string } | undefined;
	/** Set by xdd_advance when the final plan stage is passed. */
	runComplete = false;

	private _signals = new Set<XddSignal>();
	private _diagnose: XddDiagnose | null = null;
	private _attempts = new Map<string, number>();

	constructor(opts: { runId: string; cwd: string; userInput: string }) {
		this.runId = opts.runId;
		this.cwd = opts.cwd;
		this.userInput = opts.userInput;
	}

	/** Begin the run at the first plan stage. */
	startRun(): void {
		this.planIndex = 0;
	}

	currentStage(): XddStageSpec | undefined {
		return this.plan[this.planIndex]?.stage;
	}

	/** STAGES-original index of the current stage (stable across plan filtering). */
	currentIndex(): number {
		return this.plan[this.planIndex]?.originalIndex ?? -1;
	}

	currentStageName(): XddStageName | undefined {
		return this.plan[this.planIndex]?.stage.name;
	}

	isLastStage(): boolean {
		return this.planIndex === this.plan.length - 1;
	}

	/** Advance to the next plan stage. Returns the new stage, or undefined when the run completes. */
	advancePlan(): XddStageSpec | undefined {
		this.planIndex++;
		if (this.planIndex >= this.plan.length) {
			this.runComplete = true;
			return undefined;
		}
		return this.plan[this.planIndex].stage;
	}

	/** Jump to a named stage strictly before the current one. */
	goToStageName(name: XddStageName): { ok: true; originalIndex: number } | { ok: false; reason: string } {
		const idx = this.plan.findIndex((e) => e.stage.name === name);
		if (idx === -1) {
			return { ok: false, reason: `目标阶段 ${name} 不在执行计划内` };
		}
		if (idx >= this.planIndex) {
			return { ok: false, reason: `回退目标 ${name} 必须早于当前阶段` };
		}
		this.planIndex = idx;
		return { ok: true, originalIndex: this.plan[idx].originalIndex };
	}

	/** Mark ledger entries at/after `targetOriginalIndex` as superseded. */
	markSuperseded(targetOriginalIndex: number): void {
		for (const entry of this.ledger) {
			if (entry.stageIndex >= targetOriginalIndex && !entry.superseded) {
				entry.superseded = true;
			}
		}
	}

	/** reconcile-style self-heal budget tracking. Increments on each gate call for the
	 *  same stage; resets (to 0) when advance / rollback moves the cursor. */
	private _selfHealUsed = new Map<XddStageName, number>();
	beginSelfHealAttempt(stage: XddStageName): number {
		const next = (this._selfHealUsed.get(stage) ?? 0) + 1;
		this._selfHealUsed.set(stage, next);
		return next;
	}
	remainingSelfHealBudget(stage: XddStageName): number {
		return Math.max(0, this.maxSelfHealPerStage - (this._selfHealUsed.get(stage) ?? 0));
	}
	resetSelfHealBudget(stage: XddStageName): void {
		this._selfHealUsed.set(stage, 0);
	}

	clearSignals(): void {
		this._signals.clear();
	}

	recordSignal(signal: XddSignal): void {
		this._signals.add(signal);
	}

	getSignals(): ReadonlySet<XddSignal> {
		return this._signals;
	}

	clearDiagnose(): void {
		this._diagnose = null;
	}

	setDiagnose(diagnose: XddDiagnose): void {
		this._diagnose = diagnose;
	}

	getDiagnose(): XddDiagnose | null {
		return this._diagnose;
	}

	/** Start a new attempt for a stage; returns the 1-based attempt number. */
	beginAttempt(stage: XddStageName): number {
		const next = (this._attempts.get(stage) ?? 0) + 1;
		this._attempts.set(stage, next);
		return next;
	}

	currentAttempt(stage: XddStageName): number {
		return this._attempts.get(stage) ?? 0;
	}
}

export type XddEvent =
	| { type: "xdd_run_start"; runId: string; at: string }
	| {
			type: "xdd_stage_start";
			runId: string;
			stage: XddStageName;
			index: number;
			total: number;
			attempt: number;
			stageStartedAt: string;
	  }
	| { type: "xdd_stage_end"; runId: string; stage: XddStageName; ok: boolean; at: string }
	| { type: "xdd_reflect"; runId: string; failedStage: XddStageName; at: string }
	| {
			type: "xdd_rollback";
			runId: string;
			from: XddStageName;
			to: XddStageName;
			reason: string;
			at: string;
	  }
	| { type: "xdd_run_end"; runId: string; ok: boolean; at: string }
	| { type: "xdd_tick"; runId: string; stageElapsedMs: number; totalElapsedMs: number };

export type XddEventListener = (event: XddEvent) => void;

export type XddStatus = "running" | "reflecting" | "pass" | "fail";

/** Snapshot of an in-flight xdd run, consumed by the TUI footer. */
export interface ActiveXddRun {
	runId: string;
	stage: XddStageName;
	index: number;
	total: number;
	status: XddStatus;
	rollbacks: number;
	attempt: number;
	allowedTools: string[];
	deliverable: string[];
	lastFailure?: { layer: string; reason: string; at: string };
	stageStartedAt: string;
	stageElapsedMs: number;
	totalElapsedMs: number;
	tokensUsed: number;
}
