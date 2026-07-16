import type { Skill } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
 *
 * FILE-FIRST: no in-memory Maps or mutable fields. Every read loads from
 * `.xdd/runtime.json`; every write saves to it. The file IS the state.
 * Only `cwd`/`runId`/`userInput` (immutable construction params) and
 * `plan`/`skills` (contain gate/Skill function refs, not serializable)
 * stay in memory.
 */
export class XddRunnerState {
	readonly cwd: string;
	readonly runId: string;
	readonly userInput: string;
	skills: Skill[] = [];
	plan: Array<{ stage: XddStageSpec; originalIndex: number }> = [];

	constructor(opts: { runId: string; cwd: string; userInput: string }) {
		this.runId = opts.runId;
		this.cwd = opts.cwd;
		this.userInput = opts.userInput;
	}

	// ── File I/O ─────────────────────────────────────────────────────────
	private get rtPath(): string { return join(this.cwd, ".xdd", "runtime.json"); }

	private loadRt(): XddCheckpointData {
		for (const name of ["runtime.json", "checkpoint.json"] as const) {
			const p = join(this.cwd, ".xdd", name);
			if (existsSync(p)) {
				try { return { ...defaultRt(), ...JSON.parse(readFileSync(p, "utf8")) }; } catch { /* fall through */ }
			}
		}
		return defaultRt();
	}

	private saveRt(data: XddCheckpointData): void {
		const dir = join(this.cwd, ".xdd");
		mkdirSync(dir, { recursive: true });
		data.at = new Date().toISOString();
		writeFileSync(join(dir, "runtime.json"), JSON.stringify(data, null, 2), "utf8");
	}

	private mutRt<K extends keyof XddCheckpointData>(key: K, value: XddCheckpointData[K]): void {
		const rt = this.loadRt();
		rt[key] = value;
		this.saveRt(rt);
	}

	// ── File-backed properties ───────────────────────────────────────────
	get mode(): XddRunnerMode { return this.loadRt().mode ?? "stage"; }
	set mode(v: XddRunnerMode) { this.mutRt("mode", v); }
	get boundary(): number { return this.loadRt().boundary ?? 0; }
	set boundary(v: number) { this.mutRt("boundary", v); }
	get planIndex(): number { return this.loadRt().planIndex ?? -1; }
	set planIndex(v: number) { this.mutRt("planIndex", v); }
	get runComplete(): boolean { return this.loadRt().runComplete ?? false; }
	set runComplete(v: boolean) { this.mutRt("runComplete", v); }
	get archived(): boolean { return this.loadRt().archived ?? false; }
	set archived(v: boolean) { this.mutRt("archived", v); }
	get consecutiveStalls(): number { return this.loadRt().consecutiveStalls ?? 0; }
	set consecutiveStalls(v: number) { this.mutRt("consecutiveStalls", v); }
	get lastAgentEndPlanIndex(): number { return this.loadRt().lastAgentEndPlanIndex ?? 0; }
	set lastAgentEndPlanIndex(v: number) { this.mutRt("lastAgentEndPlanIndex", v); }
	get lastSubmitAt(): number { return this.loadRt().lastSubmitAt ?? 0; }
	set lastSubmitAt(v: number) { this.mutRt("lastSubmitAt", v); }
	get lastAgentEndAt(): number { return this.loadRt().lastAgentEndAt ?? 0; }
	set lastAgentEndAt(v: number) { this.mutRt("lastAgentEndAt", v); }
	get flowRollbackCount(): number { return this.loadRt().flowRollbackCount ?? 0; }
	set flowRollbackCount(v: number) { this.mutRt("flowRollbackCount", v); }
	get flowRollbackLimitTier1(): number { return this.loadRt().flowRollbackLimitTier1 ?? 5; }
	set flowRollbackLimitTier1(v: number) { this.mutRt("flowRollbackLimitTier1", v); }
	get flowRollbackLimitTier2(): number { return this.loadRt().flowRollbackLimitTier2 ?? 10; }
	set flowRollbackLimitTier2(v: number) { this.mutRt("flowRollbackLimitTier2", v); }
	get maxRollbacksPerStage(): number { return this.loadRt().maxRollbacksPerStage ?? 2; }
	set maxRollbacksPerStage(v: number) { this.mutRt("maxRollbacksPerStage", v); }
	get maxSelfHealPerStage(): number { return this.loadRt().maxSelfHealPerStage ?? 5; }
	set maxSelfHealPerStage(v: number) { this.mutRt("maxSelfHealPerStage", v); }
	get status(): XddStatus { return this.loadRt().status ?? "running"; }
	set status(v: XddStatus) { this.mutRt("status", v); }
	get rollbackCount(): number { return this.loadRt().rollbackCount ?? 0; }
	set rollbackCount(v: number) { this.mutRt("rollbackCount", v); }
	get advanceOutcome(): { passed: boolean } | undefined { return this.loadRt().advanceOutcome ?? undefined; }
	set advanceOutcome(v: { passed: boolean } | undefined) { this.mutRt("advanceOutcome", v ?? null); }
	get blindJourneyVerdict(): "pass" | "fail" | "pending" | "skipped" { return this.loadRt().blindJourneyVerdict ?? "pending"; }
	set blindJourneyVerdict(v: "pass" | "fail" | "pending" | "skipped") { this.mutRt("blindJourneyVerdict", v); }
	get stopRequested(): boolean { return this.loadRt().stopRequested ?? false; }
	set stopRequested(v: boolean) { this.mutRt("stopRequested", v); }
	// ── Phase 0 (P20-23): stop-message storm prevention ──────────────────
	// `paused` is the SINGLE source of truth for "run is paused". When true,
	// agent_end / turn_end / auto-continue paths MUST be silent. `stopRequested`
	// remains as the input signal (Esc / xdd-stop); `paused` is set once
	// in /xdd-stop and cleared only by /xdd-resume.
	get paused(): boolean { return this.loadRt().paused ?? false; }
	set paused(v: boolean) { this.mutRt("paused", v); }
	// `pauseNotified` guards against duplicate pause notifications. The first
	// agent_end after /xdd-stop sets this to true and emits a single
	// ctx.ui.notify. Subsequent agent_ends return early silently.
	get pauseNotified(): boolean { return this.loadRt().pauseNotified ?? false; }
	set pauseNotified(v: boolean) { this.mutRt("pauseNotified", v); }
	// `continuationEpoch` is incremented on /xdd-resume. Any continuation
	// followUp queued with an old epoch is filtered out by the input hook
	// (P22). This solves the "stop 之前已经入队的 followUp, stop 后还继续被
	// 投递" problem.
	get continuationEpoch(): number { return this.loadRt().continuationEpoch ?? 0; }
	set continuationEpoch(v: number) { this.mutRt("continuationEpoch", v); }
	// `continuationQueued` prevents the auto-continue scheduler from queueing
	// two followUps in the same agent_end cycle. Set when a continuation is
	// queued, cleared when it's consumed (next agent_start or input hook).
	get continuationQueued(): boolean { return this.loadRt().continuationQueued ?? false; }
	set continuationQueued(v: boolean) { this.mutRt("continuationQueued", v); }
	get rollbackOutcome(): { from: XddStageName; to: XddStageName; reason: string } | undefined { return this.loadRt().rollbackOutcome ?? undefined; }
	set rollbackOutcome(v: { from: XddStageName; to: XddStageName; reason: string } | undefined) { this.mutRt("rollbackOutcome", v ?? null); }
	get pendingGroupApproval(): { group: string; gateLabel: string } | undefined { return this.loadRt().pendingGroupApproval ?? undefined; }
	set pendingGroupApproval(v: { group: string; gateLabel: string } | undefined) { this.mutRt("pendingGroupApproval", v ?? null); }

	// ── Collection accessors ─────────────────────────────────────────────
	get ledger(): XddLedgerEntry[] { return this.loadRt().ledger ?? []; }
	get esg(): XddEsgNode[] { return this.loadRt().esg ?? []; }

	// ── Stage navigation ─────────────────────────────────────────────────
	startRun(): void { this.planIndex = 0; }
	currentStage(): XddStageSpec | undefined { return this.plan[this.planIndex]?.stage; }
	currentIndex(): number { return this.plan[this.planIndex]?.originalIndex ?? -1; }
	currentStageName(): XddStageName | undefined { return this.plan[this.planIndex]?.stage.name; }
	isLastStage(): boolean { return this.planIndex === this.plan.length - 1; }

	advancePlan(): XddStageSpec | undefined {
		const rt = this.loadRt();
		rt.planIndex++;
		if (rt.planIndex >= this.plan.length) { rt.runComplete = true; this.saveRt(rt); return undefined; }
		this.saveRt(rt);
		const newStage = this.plan[rt.planIndex].stage;
		this.resetSelfHealBudget(newStage.name);
		return newStage;
	}

	goToStageName(name: XddStageName): { ok: true; originalIndex: number } | { ok: false; reason: string } {
		const idx = this.plan.findIndex((e) => e.stage.name === name);
		if (idx === -1) return { ok: false, reason: `目标阶段 ${name} 不在执行计划内` };
		const rt = this.loadRt();
		if (idx >= rt.planIndex) return { ok: false, reason: `回退目标 ${name} 必须早于当前阶段` };
		rt.planIndex = idx;
		this.saveRt(rt);
		this.resetSelfHealBudget(name);
		return { ok: true, originalIndex: this.plan[idx].originalIndex };
	}

	markSuperseded(targetOriginalIndex: number): void {
		const rt = this.loadRt();
		for (const entry of rt.ledger) { if (entry.stageIndex >= targetOriginalIndex && !entry.superseded) entry.superseded = true; }
		this.saveRt(rt);
	}

	addLedgerEntry(entry: XddLedgerEntry): void {
		const rt = this.loadRt();
		rt.ledger.push(entry);
		this.saveRt(rt);
	}

	// ── Self-heal budget ─────────────────────────────────────────────────
	beginSelfHealAttempt(stage: XddStageName): number {
		const rt = this.loadRt();
		const used = rt.selfHealUsed[stage] ?? 0;
		const max = rt.maxSelfHealPerStage ?? 5;
		if (used >= max) return max;
		rt.selfHealUsed[stage] = used + 1;
		this.saveRt(rt);
		return used + 1;
	}
	remainingSelfHealBudget(stage: XddStageName): number {
		const rt = this.loadRt();
		return Math.max(0, (rt.maxSelfHealPerStage ?? 5) - (rt.selfHealUsed[stage] ?? 0));
	}
	resetSelfHealBudget(stage: XddStageName): void {
		const rt = this.loadRt();
		rt.selfHealUsed[stage] = 0;
		if (rt.lastSubmitFingerprint) delete rt.lastSubmitFingerprint[stage];
		this.saveRt(rt);
	}
	checkAndRecordSubmitFingerprint(stage: XddStageName, fingerprint: string): boolean {
		const rt = this.loadRt();
		if (!rt.lastSubmitFingerprint) rt.lastSubmitFingerprint = {};
		const last = rt.lastSubmitFingerprint[stage];
		rt.lastSubmitFingerprint[stage] = fingerprint;
		this.saveRt(rt);
		return last !== fingerprint;
	}

	// ── Signals ──────────────────────────────────────────────────────────
	clearSignals(): void { this.mutRt("signals", []); }
	recordSignal(signal: XddSignal): void {
		const rt = this.loadRt();
		if (!rt.signals) rt.signals = [];
		if (!rt.signals.includes(signal)) rt.signals.push(signal);
		this.saveRt(rt);
	}
	getSignals(): ReadonlySet<XddSignal> { return new Set(this.loadRt().signals ?? []); }

	// ── Diagnose ─────────────────────────────────────────────────────────
	clearDiagnose(): void { this.mutRt("diagnose", null); }
	setDiagnose(diagnose: XddDiagnose): void { this.mutRt("diagnose", diagnose); }
	getDiagnose(): XddDiagnose | null { return this.loadRt().diagnose ?? null; }

	// ── Attempts ─────────────────────────────────────────────────────────
	beginAttempt(stage: XddStageName): number {
		const rt = this.loadRt();
		const next = (rt.attempts[stage] ?? 0) + 1;
		rt.attempts[stage] = next;
		this.saveRt(rt);
		return next;
	}
	currentAttempt(stage: XddStageName): number { return this.loadRt().attempts[stage] ?? 0; }

	// ── Artifacts & ESG ──────────────────────────────────────────────────
	recordArtifact(stage: XddStageName, paths: string[]): void {
		const rt = this.loadRt();
		if (!rt.submittedArtifacts) rt.submittedArtifacts = {};
		rt.submittedArtifacts[stage] = paths;
		this.saveRt(rt);
	}
	recordSelfAttack(stage: XddStageName, note: string): void {
		const rt = this.loadRt();
		if (!rt.selfAttackNotes) rt.selfAttackNotes = {};
		rt.selfAttackNotes[stage] = note;
		this.saveRt(rt);
	}
	recordEsgNode(type: XddEsgNodeType, stage: XddStageName, label: string, data?: unknown, parentId?: string): string {
		const rt = this.loadRt();
		if (!rt.esg) rt.esg = [];
		const id = `esg-${rt.esg.length + 1}`;
		rt.esg.push({ id, type, stage, label, data, parentId, at: new Date().toISOString() });
		this.saveRt(rt);
		return id;
	}
	getSubmittedArtifacts(): Array<{ stage: XddStageName; paths: string[] }> {
		return Object.entries(this.loadRt().submittedArtifacts ?? {}).map(([stage, paths]) => ({ stage: stage as XddStageName, paths }));
	}
	getSubmittedArtifactsForStage(stage: XddStageName): string[] | undefined {
		return this.loadRt().submittedArtifacts?.[stage];
	}
	getSelfAttackNoteForStage(stage: XddStageName): string | undefined {
		return this.loadRt().selfAttackNotes?.[stage];
	}
	getSelfAttackNotes(): Array<[XddStageName, string]> {
		return Object.entries(this.loadRt().selfAttackNotes ?? {}) as Array<[XddStageName, string]>;
	}

	// ── Checkpoint compat (thin wrappers around load/save) ──────────────
	toCheckpoint(status: XddStatus, rollbackCount: number): XddCheckpointData {
		const rt = this.loadRt();
		// Merge identity + non-serializable fields from memory (they're not
		// in the file because they're readonly/functional).
		rt.runId = this.runId;
		rt.cwd = this.cwd;
		rt.userInput = this.userInput;
		rt.plan = this.plan.map((e) => ({ stageName: e.stage.name, originalIndex: e.originalIndex }));
		rt.status = status;
		rt.rollbackCount = rollbackCount;
		this.saveRt(rt);
		return rt;
	}
	static fromCheckpoint(data: XddCheckpointData): XddRunnerState {
		const state = new XddRunnerState({ runId: data.runId, cwd: data.cwd, userInput: data.userInput });
		state.saveRt({ ...defaultRt(), ...data });
		return state;
	}
	restoreFromCheckpoint(data: XddCheckpointData): void {
		this.saveRt({ ...defaultRt(), ...data });
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

// ============================================================================
// Blind Journey Validation (black-box user acceptance)
// ============================================================================

export type XddBlindJourneyVerdict =
	| "PASS"
	| "PASS_WITH_FRICTION"
	| "FAIL"
	| "BLOCKED"
	| "INCONCLUSIVE";

export type XddBlindJourneySeverity = "P0" | "P1" | "P2" | "P3" | "P4";

export interface XddBlindJourneyIssue {
	id: string;
	severity: XddBlindJourneySeverity;
	role: string;
	location: string;
	expected: string;
	actual: string;
	impact: string;
	evidence: string[];
}

export interface XddBlindJourneyResult {
	scenarioId: string;
	featurePath: string;
	roleId: string;
	roleName: string;
	verdict: XddBlindJourneyVerdict;
	severity: XddBlindJourneySeverity | null;
	confidence: "High" | "Medium" | "Low";
	issues: XddBlindJourneyIssue[];
	evidencePaths: string[];
	reportPath: string;
	at: string;
}

/** Parsed Gherkin scenario -- Given/When/Then split for actor/judge isolation. */
export interface XddParsedScenario {
	featureName: string;
	scenarioName: string;
	tags: string[];
	given: string[];
	when: string[];
	then: string[];
}

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
	// ── Runtime-only fields (file-first: persisted to runtime.json, optional
	//    for backward compat with old checkpoint.json files that lack them) ──
	signals?: XddSignal[];
	diagnose?: XddDiagnose | null;
	lastSubmitFingerprint?: Record<string, string>;
	consecutiveStalls?: number;
	lastAgentEndPlanIndex?: number;
	lastSubmitAt?: number;
	lastAgentEndAt?: number;
	advanceOutcome?: { passed: boolean } | null;
	rollbackOutcome?: { from: XddStageName; to: XddStageName; reason: string } | null;
	pendingGroupApproval?: { group: string; gateLabel: string } | null;
	archived?: boolean;
	boundary?: number;
	runComplete?: boolean;
	blindJourneyVerdict?: "pass" | "fail" | "pending" | "skipped";
	stopRequested?: boolean;
	// Phase 0 (P20-23): stop-message storm prevention
	paused?: boolean;
	pauseNotified?: boolean;
	continuationEpoch?: number;
	continuationQueued?: boolean;
}

/** Default runtime data for a fresh run. */
function defaultRt(): XddCheckpointData {
	return {
		runId: "", userInput: "", cwd: "",
		planIndex: -1, plan: [], mode: "stage",
		ledger: [], attempts: {}, selfHealUsed: {},
		maxRollbacksPerStage: 2, maxSelfHealPerStage: 5,
		flowRollbackCount: 0, flowRollbackLimitTier1: 5, flowRollbackLimitTier2: 10,
		rollbackCount: 0, status: "running",
		submittedArtifacts: {}, selfAttackNotes: {}, esg: [],
		at: new Date().toISOString(),
		signals: [], diagnose: null, lastSubmitFingerprint: {},
		consecutiveStalls: 0, lastAgentEndPlanIndex: 0,
		lastSubmitAt: 0, lastAgentEndAt: 0,
		advanceOutcome: null, rollbackOutcome: null,
		pendingGroupApproval: null, archived: false,
		boundary: 0, runComplete: false,
		blindJourneyVerdict: "pending",
		stopRequested: false,
		paused: false, pauseNotified: false,
		continuationEpoch: 0, continuationQueued: false,
	};
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
