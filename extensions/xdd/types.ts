import type { Skill } from "@earendil-works/pi-coding-agent";

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
	 * Hard gate executed inside the xdd_submit_artifact tool. The
	 * stage's desiredState is passed in so the gate can reason against it
	 * (e.g. phrase its reason in the same vocabulary).
	 */
	gate: XddGate;
	/** AIGate 审查标准（死标准，每阶段写死）。硬 Gate 通过后由 AI 审查产物质量。 */
	aigateStandard: string;
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
	tokensUsed?: number;
	artifacts?: string[];
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

// ============================================================================
// P7 Human Governance
// ============================================================================

export type XddApprovalEvent =
	| { type: "gate_failure"; stage: XddStageName; reason: string; attempt: number }
	| { type: "group_rollback"; from: XddStageName; to: XddStageName; reason: string }
	| { type: "verify_verdict"; pass: boolean; summary: string };

export type XddApprovalDecision =
	| { approved: true }
	| { approved: false; reason: string };

export interface XddRunOptions {
	task: string;
	/** Max rollbacks per single stage before the run fails. */
	maxRollbacksPerStage?: number;
	/**
	 * reconcile-style self-heal budget: max local-fix attempts the model may do at
	 * the same stage via xdd_submit_artifact before the runner soft-passes to
	 * the next stage (Layer 1: non-blocking after exhaustion). Default 5.
	 */
	maxSelfHealPerStage?: number;
	/** Start from this stage name (inclusive) instead of "init". */
	fromStage?: XddStageName;
	/** Run only this single stage and exit. */
	onlyStage?: XddStageName;
	/** Skip the "wire" stage. */
	skipWire?: boolean;
	/** Resume from <cwd>/.xdd/checkpoint.json if it exists (P5 Recoverability). */
	resumeFromCheckpoint?: boolean;
	/**
	 * P7 Human Governance: called at critical junctures (gate failure, group
	 * rollback, verify verdict). If provided, the run pauses until the hook
	 * resolves. A denied decision fails the run with the given reason.
	 */
	humanApprovalHook?: (event: XddApprovalEvent) => Promise<XddApprovalDecision>;
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
	/** ESG nodes: chronological graph of decisions, evidence, reviews, findings, tasks, checkpoints. */
	esg: XddEsgNode[] = [];

	/** Effective ordered stages for this run (after --from/--stage/--skip-wire). */
	plan: Array<{ stage: XddStageSpec; originalIndex: number }> = [];
	/** Current position in `plan` (-1 before the run starts). */
	planIndex = -1;
	/** Max rollbacks per single stage before the run fails (set at activation). */
	maxRollbacksPerStage = 2;
	/** reconcile-style self-heal budget per stage: max xdd_submit_artifact calls
	 *  for the same stage before the runner soft-passes to the next stage
	 *  (Layer 1: in-stage self-heal, non-blocking after exhaustion). Default 5. */
	maxSelfHealPerStage = 5;

	/** Set by xdd_advance when the model transitions to the next stage. */
	advanceOutcome: { passed: boolean } | undefined;
	/** Set by xdd_rollback when the model declares a rollback target. */
	rollbackOutcome: { from: XddStageName; to: XddStageName; reason: string } | undefined;
	/** Set by xdd_advance when the final plan stage is passed. */
	runComplete = false;
	/** Set by xdd_advance when a group gate passes; cleared by /xdd continue. */
	pendingGroupApproval?: { group: string; gateLabel: string };
	/** Auto-continue circuit breaker: tracks consecutive agent_end with no progress. */
	consecutiveStalls = 0;
	lastAgentEndPlanIndex = 0;
	lastSubmitAt = 0;
	lastAgentEndAt = 0;
	/** Set by run-completion auto-archive (or /xdd-archive command) to prevent re-archive. */
	archived = false;

	// ── Layer 2: flow-level rollback budget ──────────────────────────────
	/** Flow-level rollback count (group gate fail / verify verdict fail -> rollback). */
	flowRollbackCount = 0;
	/** Tier 1 soft limit: warn but allow. Default 5. */
	flowRollbackLimitTier1 = 5;
	/** Tier 2 hard limit: force runComplete. Default 10. */
	flowRollbackLimitTier2 = 10;

	/** Artifacts submitted via xdd_submit_artifact per stage (observability). */
	submittedArtifacts = new Map<XddStageName, string[]>();
	/** Self-attack notes submitted via xdd_submit_artifact per stage (evidence). */
	selfAttackNotes = new Map<XddStageName, string>();

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
		// Explicitly reset self-heal budget for the new stage. The Map key
		// already isolates stages, so this is belt-and-suspenders for
		// advance; the real reason it lives here is to keep the contract
		// symmetric with goToStageName (rollback) -- which MUST reset,
		// because rollback re-enters the same stage name whose key already
		// holds a non-zero used count.
		const newStage = this.plan[this.planIndex].stage;
		this.resetSelfHealBudget(newStage.name);
		return newStage;
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
		// Reset self-heal budget on rollback: rollback re-enters a stage
		// whose Map key already holds the previous attempt count, so
		// without this reset the very first submit after rollback would
		// burn the rest of the budget and immediately trip the exhaustion
		// error.
		this.resetSelfHealBudget(name);
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
	/** Disk fingerprint from the last xdd_submit_artifact call per stage.
	 *  Used to detect zero-change retries (agent resubmits without modifying
	 *  any artifact files). Runtime-only: NOT serialized to checkpoint --
	 *  a restart should allow a fresh attempt. */
	private _lastSubmitFingerprint = new Map<XddStageName, string>();
	beginSelfHealAttempt(stage: XddStageName): number {
		const used = this._selfHealUsed.get(stage) ?? 0;
		// Cap at maxSelfHealPerStage. Without this cap, the counter keeps
		// incrementing past the budget and all subsequent user-visible
		// messages show nonsense like "自愈预算耗尽（40/3）". Returning
		// maxSelfHealPerStage (instead of the inflated value) keeps every
		// `${used}/${state.maxSelfHealPerStage}` display coherent.
		if (used >= this.maxSelfHealPerStage) {
			return this.maxSelfHealPerStage;
		}
		const next = used + 1;
		this._selfHealUsed.set(stage, next);
		return next;
	}
	remainingSelfHealBudget(stage: XddStageName): number {
		return Math.max(0, this.maxSelfHealPerStage - (this._selfHealUsed.get(stage) ?? 0));
	}
	resetSelfHealBudget(stage: XddStageName): void {
		this._selfHealUsed.set(stage, 0);
		this._lastSubmitFingerprint.delete(stage);
	}

	/**
	 * Disk fingerprint guard (Bug 2). Compares the given fingerprint with
	 * the last one recorded for this stage. Returns true if different (or
	 * first call), false if identical (zero-change retry). Always stores
	 * the new fingerprint so the NEXT call is compared against THIS one.
	 */
	checkAndRecordSubmitFingerprint(stage: XddStageName, fingerprint: string): boolean {
		const last = this._lastSubmitFingerprint.get(stage);
		this._lastSubmitFingerprint.set(stage, fingerprint);
		return last !== fingerprint;
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

	recordArtifact(stage: XddStageName, paths: string[]): void {
		this.submittedArtifacts.set(stage, paths);
	}

	recordSelfAttack(stage: XddStageName, note: string): void {
		this.selfAttackNotes.set(stage, note);
	}

	recordEsgNode(type: XddEsgNodeType, stage: XddStageName, label: string, data?: unknown, parentId?: string): string {
		const id = `esg-${this.esg.length + 1}`;
		this.esg.push({ id, type, stage, label, data, parentId, at: new Date().toISOString() });
		return id;
	}

	getSubmittedArtifacts(): Array<{ stage: XddStageName; paths: string[] }> {
		return [...this.submittedArtifacts.entries()].map(([stage, paths]) => ({ stage, paths }));
	}

	/** Serialize the full run state for checkpoint persistence (P5 Recoverability). */
	toCheckpoint(status: XddStatus, rollbackCount: number): XddCheckpointData {
		const attempts: Record<string, number> = {};
		for (const [k, v] of this._attempts) attempts[k] = v;
		const selfHealUsed: Record<string, number> = {};
		for (const [k, v] of this._selfHealUsed) selfHealUsed[k] = v;
		const submittedArtifacts: Record<string, string[]> = {};
		for (const [k, v] of this.submittedArtifacts) submittedArtifacts[k] = v;
		const selfAttackNotes: Record<string, string> = {};
		for (const [k, v] of this.selfAttackNotes) selfAttackNotes[k] = v;
		return {
			runId: this.runId,
			userInput: this.userInput,
			cwd: this.cwd,
			planIndex: this.planIndex,
			plan: this.plan.map((e) => ({ stageName: e.stage.name, originalIndex: e.originalIndex })),
			mode: this.mode,
			ledger: this.ledger,
			attempts,
			selfHealUsed,
			maxRollbacksPerStage: this.maxRollbacksPerStage,
			maxSelfHealPerStage: this.maxSelfHealPerStage,
			flowRollbackCount: this.flowRollbackCount,
			flowRollbackLimitTier1: this.flowRollbackLimitTier1,
			flowRollbackLimitTier2: this.flowRollbackLimitTier2,
			rollbackCount,
			status,
			submittedArtifacts,
			selfAttackNotes,
			esg: this.esg,
			at: new Date().toISOString(),
		};
	}

	/** Restore run state from a previously persisted checkpoint. */
	static fromCheckpoint(data: XddCheckpointData): XddRunnerState {
		const state = new XddRunnerState({ runId: data.runId, cwd: data.cwd, userInput: data.userInput });
		state.planIndex = data.planIndex;
		state.mode = data.mode;
		state.ledger = data.ledger;
		state.maxRollbacksPerStage = data.maxRollbacksPerStage;
		state.maxSelfHealPerStage = data.maxSelfHealPerStage;
		state.flowRollbackCount = data.flowRollbackCount ?? 0;
		state.flowRollbackLimitTier1 = data.flowRollbackLimitTier1 ?? 5;
		state.flowRollbackLimitTier2 = data.flowRollbackLimitTier2 ?? 10;
		for (const [k, v] of Object.entries(data.attempts)) state._attempts.set(k as XddStageName, v);
		for (const [k, v] of Object.entries(data.selfHealUsed)) state._selfHealUsed.set(k as XddStageName, v);
		for (const [k, v] of Object.entries(data.submittedArtifacts)) state.submittedArtifacts.set(k as XddStageName, v);
		for (const [k, v] of Object.entries(data.selfAttackNotes)) state.selfAttackNotes.set(k as XddStageName, v);
		state.esg = data.esg;
		return state;
	}

	/** Restore mutable fields from a checkpoint onto an existing instance (keeps plan/skills). */
	restoreFromCheckpoint(data: XddCheckpointData): void {
		this.planIndex = data.planIndex;
		this.mode = data.mode;
		this.ledger = data.ledger;
		this.maxRollbacksPerStage = data.maxRollbacksPerStage;
		this.maxSelfHealPerStage = data.maxSelfHealPerStage;
		this.flowRollbackCount = data.flowRollbackCount ?? 0;
		this.flowRollbackLimitTier1 = data.flowRollbackLimitTier1 ?? 5;
		this.flowRollbackLimitTier2 = data.flowRollbackLimitTier2 ?? 10;
		for (const [k, v] of Object.entries(data.attempts)) this._attempts.set(k as XddStageName, v);
		for (const [k, v] of Object.entries(data.selfHealUsed)) this._selfHealUsed.set(k as XddStageName, v);
		for (const [k, v] of Object.entries(data.submittedArtifacts)) this.submittedArtifacts.set(k as XddStageName, v);
		for (const [k, v] of Object.entries(data.selfAttackNotes)) this.selfAttackNotes.set(k as XddStageName, v);
		this.esg = data.esg;
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

// ============================================================================
// Controller cycle types (Observe -> Compare -> Reconcile -> Update)
// ============================================================================

/** xdd_next_task 工具返回的唯一下一步指令 (Reconcile)。 */
export interface XddTaskInstruction {
	stage: XddStageName;
	role: string;
	desiredState: readonly string[];
	gaps: string[];
	action: string;
	selfHealRemaining: number;
	groupGatePending: boolean;
}

/** xdd_submit_artifact 工具提交的产物信息。 */
export interface XddArtifactSubmission {
	summary: string;
	artifacts: string[];
	selfAttack: string;
	pass?: boolean;
}

// ============================================================================
// Stage groups (Package D - macro Gates)
// ============================================================================

export type XddStageGroupName = "discovery" | "architecture" | "implementation" | "verification";

export interface XddStageGroup {
	name: XddStageGroupName;
	label: string;
	stages: readonly XddStageName[];
	gate: XddGate;
	rollbackTarget: XddStageName;
	gateLabel: string;
}

// ============================================================================
// Checkpoint persistence (Package C - Recoverability)
// ============================================================================

export interface XddCheckpointData {
	runId: string;
	userInput: string;
	cwd: string;
	planIndex: number;
	plan: Array<{ stageName: XddStageName; originalIndex: number }>;
	mode: XddRunnerMode;
	ledger: XddLedgerEntry[];
	attempts: Record<string, number>;
	selfHealUsed: Record<string, number>;
	maxRollbacksPerStage: number;
	maxSelfHealPerStage: number;
	flowRollbackCount: number;
	flowRollbackLimitTier1: number;
	flowRollbackLimitTier2: number;
	rollbackCount: number;
	status: XddStatus;
	submittedArtifacts: Record<string, string[]>;
	selfAttackNotes: Record<string, string>;
	esg: XddEsgNode[];
	at: string;
}

// ============================================================================
// Runtime abstraction (P6 Runtime Independence)
// ============================================================================

export interface XddRuntimeMessage {
	role: string;
	usage?: { totalTokens: number };
}

export interface XddRuntime {
	appendCustomEntry(type: string, data: unknown): void;
	getMessages(): ReadonlyArray<XddRuntimeMessage>;
	setActiveToolsByName(tools: string[]): void;
	prompt(seed: string, opts?: { expandPromptTemplates?: boolean }): Promise<void>;
}

// ============================================================================
// ESG (Engineering State Graph) - P3 Evidence First
// ============================================================================

export type XddEsgNodeType = "decision" | "evidence" | "review" | "finding" | "task" | "checkpoint";

export interface XddEsgNode {
	id: string;
	type: XddEsgNodeType;
	stage: XddStageName;
	label: string;
	data?: unknown;
	parentId?: string;
	at: string;
}
