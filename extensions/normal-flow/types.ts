/**
 * Normal Flow 自包含类型系统。
 *
 * 不 import 任何 xdd 符号。NF 的运行时 schema、阶段契约、命令、效果
 * 全部在这里定义，与 xdd 完全隔离。
 */
import type { Skill } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// ── 阶段名 ───────────────────────────────────────────────────────────────

export type NfStageName = "understand" | "architecture" | "spec" | "verify";

export const NF_STAGE_NAMES: readonly NfStageName[] = ["understand", "architecture", "spec", "verify"];

export const NF_DISPLAY_NAME: Readonly<Record<NfStageName, string>> = {
	understand: "design",
	architecture: "framework",
	spec: "scenarios",
	verify: "verify",
};

export function planStageNamesAreNf(plan: ReadonlyArray<{ stageName: string }>): boolean {
	return plan.length === NF_STAGE_NAMES.length
		&& plan.every((entry, index) => entry.stageName === NF_STAGE_NAMES[index]);
}

// ── 阶段契约 ─────────────────────────────────────────────────────────────

export type NfStageExit = "goal_complete" | "verdict";

export interface NfArtifactRule {
	pattern: string;
	required: boolean;
	minimumBytes?: number;
	description: string;
}

export interface NfRollbackPolicy {
	target: NfStageName | "none";
	reason: string;
}

export type NfGatePolicy = "hard" | "explicit-soft";

export interface NfGateResult {
	ok: boolean;
	reason?: string;
	soft?: boolean;
}

export type NfGate = (args: {
	cwd: string;
	summary: string;
	desiredState: readonly string[];
}) => Promise<NfGateResult>;

export interface NfStageSpec {
	name: NfStageName;
	role: string;
	skill: string;
	exit: NfStageExit;
	allowedTools: string[];
	deliverablePaths: string[];
	inputs?: readonly NfArtifactRule[];
	outputs?: readonly NfArtifactRule[];
	desiredState: readonly string[];
	gate: NfGate;
	aigateStandard: string;
	aiGate?: { enabled: boolean };
	gatePolicy?: NfGatePolicy;
	hardGate?: NfGate;
	readScopes?: readonly string[];
	writeScopes?: readonly string[];
	noCodeReading?: boolean;
	noCodeModification?: boolean;
	rollbackPolicy?: NfRollbackPolicy;
}

// ── 信号 / 审计 / 状态 ────────────────────────────────────────────────────

export type NfSignal = "complete" | "verdict_pass" | "verdict_fail";

export type NfEsgNodeType = "decision" | "evidence" | "review" | "finding" | "task" | "checkpoint";

export interface NfEsgNode {
	id: string;
	type: NfEsgNodeType;
	stage: string;
	label: string;
	data?: unknown;
	parentId?: string;
	at: string;
}

export interface NfLedgerEntry {
	stage: string;
	stageIndex: number;
	attempt: number;
	status: "pass" | "fail";
	superseded: boolean;
	at: string;
	artifacts?: string[];
}

export type NfStageOutcome =
	| "idle"
	| "working"
	| "hard_gate_failed"
	| "gate_passed"
	| "advanced"
	| "provider_error"
	| "paused"
	| "completed"
	| "failed";

export interface NfArtifactSubmission {
	summary: string;
	artifacts: string[];
	pass?: boolean;
	error?: string;
}

// ── Runtime schema ───────────────────────────────────────────────────────

export interface NfCheckpointData {
	runId: string;
	cwd: string;
	userInput: string;
	plan: Array<{ stageName: string; originalIndex: number }>;
	planIndex: number;
	mode: "stage";
	ledger: NfLedgerEntry[];
	attempts: Record<string, number>;
	selfHealUsed: Record<string, number>;
	maxRollbacksPerStage: number;
	maxSelfHealPerStage: number;
	flowRollbackCount: number;
	flowRollbackLimit: number;
	lifetimeRollbackCount: number;
	status: string;
	submittedArtifacts: Record<string, string[]>;
	esg: NfEsgNode[];
	signals: NfSignal[];
	at: string;
	lastStageError: string | null;
	advanceOutcome: { passed: boolean } | null;
	rollbackOutcome: { from: string; to: string; reason: string } | null;
	stageOutcome: NfStageOutcome;
	stageEpoch: string;
	continuationQueued: boolean;
	continuationEpoch: number;
	continuationReason: string | null;
	continuationStage: string | null;
	paused: boolean;
	stopRequested: boolean;
	pauseNotified: boolean;
	runComplete: boolean;
	archived: boolean;
	flowBudgetUsd: number;
	flowCostUsd: number;
	flowTokensUsed: number;
	lastSubmitAt: number;
	lastAgentEndAt: number;
	lastAgentEndPlanIndex: number;
	consecutiveStalls: number;
	rollbackCount: number;
	providerRetryCount: number;
	flowBudgetMessageTimestamps: number[];
}

// ── RunnerState ──────────────────────────────────────────────────────────

export const STAGE_ROLES: Readonly<Record<NfStageName, string>> = {
	understand: "Requirements Analyst",
	architecture: "System Architect",
	spec: "API Designer",
	verify: "Auditor",
};

function defaultRt(runId = ""): NfCheckpointData {
	return {
		runId, userInput: "", cwd: "",
		planIndex: -1, plan: [], mode: "stage",
		ledger: [], attempts: {}, selfHealUsed: {},
		maxRollbacksPerStage: 8, maxSelfHealPerStage: 3,
		flowRollbackCount: 0, flowRollbackLimit: 8, lifetimeRollbackCount: 0,
		status: "running", submittedArtifacts: {}, esg: [], signals: [],
		at: new Date().toISOString(),
		lastStageError: null, advanceOutcome: null, rollbackOutcome: null,
		stageOutcome: "idle", stageEpoch: "",
		continuationQueued: false, continuationEpoch: 0,
		continuationReason: null, continuationStage: null,
		paused: false, stopRequested: false, pauseNotified: false,
		runComplete: false, archived: false,
		flowBudgetUsd: 500, flowCostUsd: 0, flowTokensUsed: 0,
		lastSubmitAt: 0, lastAgentEndAt: 0, lastAgentEndPlanIndex: 0,
		consecutiveStalls: 0, rollbackCount: 0,
		providerRetryCount: 0,
		flowBudgetMessageTimestamps: [],
	};
}

/**
 * NF 的文件优先 RunnerState。每次属性读写都走 runtime.json，
 * 不保留内存态（除了 cwd/runId/userInput/skills/plan 这些不可序列化的）。
 */
export class NfRunnerState {
	readonly cwd: string;
	readonly runId: string;
	readonly userInput: string;
	readonly runtimeStoreOptions: { runtimeFileName?: string; legacyCheckpointFileName?: string | false; v1BackupFileName?: string };
	skills: Skill[] = [];
	plan: Array<{ stage: NfStageSpec; originalIndex: number }> = [];

	constructor(opts: { runId: string; cwd: string; userInput: string; runtimeStoreOptions?: { runtimeFileName?: string; legacyCheckpointFileName?: string | false; v1BackupFileName?: string } }) {
		this.runId = opts.runId;
		this.cwd = opts.cwd;
		this.userInput = opts.userInput;
		this.runtimeStoreOptions = opts.runtimeStoreOptions ?? {};
	}

	private get runtimePath(): string {
		return join(this.cwd, ".xdd", this.runtimeStoreOptions.runtimeFileName ?? "normal-flow-runtime.json");
	}
	private loadRt(): NfCheckpointData {
		try {
			const text = readFileSync(this.runtimePath, "utf8");
			if (!text.trim()) return defaultRt(this.runId);
			const raw = JSON.parse(text) as Record<string, unknown>;
			// 简单 migration：清理遗留的 xdd 字段
			delete raw.healingCases; delete raw.activeHealingCaseId; delete raw.aiGateFindings;
			delete raw.selfAttackNotes; delete raw.budgetResetHistory; delete raw.lastVerifyReceipt;
			return { ...defaultRt(this.runId), ...raw } as NfCheckpointData;
		} catch {
			return defaultRt(this.runId);
		}
	}
	private saveRt(data: NfCheckpointData): void {
		const next = { ...data, at: new Date().toISOString() } as NfCheckpointData;
		mkdirSync(dirname(this.runtimePath), { recursive: true });
		writeFileSync(this.runtimePath, JSON.stringify(next, null, 2) + "\n", "utf8");
	}
	private mutRt<K extends keyof NfCheckpointData>(key: K, value: NfCheckpointData[K]): void {
		const rt = this.loadRt(); rt[key] = value; this.saveRt(rt);
	}

	// ── 文件优先属性 ───────────────────────────────────────────────────
	get planIndex(): number { return this.loadRt().planIndex ?? -1; }
	set planIndex(v: number) { this.mutRt("planIndex", v); }
	get mode(): string { return this.loadRt().mode ?? "stage"; }
	get runComplete(): boolean { return this.loadRt().runComplete ?? false; }
	set runComplete(v: boolean) { this.mutRt("runComplete", v); }
	get archived(): boolean { return this.loadRt().archived ?? false; }
	set archived(v: boolean) { this.mutRt("archived", v); }
	get consecutiveStalls(): number { return this.loadRt().consecutiveStalls ?? 0; }
	set consecutiveStalls(v: number) { this.mutRt("consecutiveStalls", v); }
	get providerRetryCount(): number { return this.loadRt().providerRetryCount ?? 0; }
	set providerRetryCount(v: number) { this.mutRt("providerRetryCount", v); }
	get lastAgentEndPlanIndex(): number { return this.loadRt().lastAgentEndPlanIndex ?? 0; }
	set lastAgentEndPlanIndex(v: number) { this.mutRt("lastAgentEndPlanIndex", v); }
	get lastSubmitAt(): number { return this.loadRt().lastSubmitAt ?? 0; }
	set lastSubmitAt(v: number) { this.mutRt("lastSubmitAt", v); }
	get lastAgentEndAt(): number { return this.loadRt().lastAgentEndAt ?? 0; }
	set lastAgentEndAt(v: number) { this.mutRt("lastAgentEndAt", v); }
	get flowRollbackCount(): number { return this.loadRt().flowRollbackCount ?? 0; }
	set flowRollbackCount(v: number) { this.mutRt("flowRollbackCount", v); }
	get flowRollbackLimit(): number { return this.loadRt().flowRollbackLimit ?? 8; }
	set flowRollbackLimit(v: number) { this.mutRt("flowRollbackLimit", v); }
	get maxRollbacksPerStage(): number { return this.loadRt().maxRollbacksPerStage ?? 8; }
	set maxRollbacksPerStage(v: number) { this.mutRt("maxRollbacksPerStage", v); }
	get maxSelfHealPerStage(): number { return this.loadRt().maxSelfHealPerStage ?? 3; }
	set maxSelfHealPerStage(v: number) { this.mutRt("maxSelfHealPerStage", v); }
	get status(): string { return this.loadRt().status ?? "running"; }
	set status(v: string) { this.mutRt("status", v); }
	get rollbackCount(): number { return this.loadRt().rollbackCount ?? 0; }
	set rollbackCount(v: number) { this.mutRt("rollbackCount", v); }
	get advanceOutcome(): { passed: boolean } | undefined { return this.loadRt().advanceOutcome ?? undefined; }
	set advanceOutcome(v: { passed: boolean } | undefined) { this.mutRt("advanceOutcome", v ?? null); }
	get stageOutcome(): NfStageOutcome { return this.loadRt().stageOutcome ?? "idle"; }
	set stageOutcome(v: NfStageOutcome) { this.mutRt("stageOutcome", v); }
	get lastStageError(): string | undefined { return this.loadRt().lastStageError ?? undefined; }
	set lastStageError(v: string | undefined) { this.mutRt("lastStageError", v ?? null); }
	get continuationReason(): string | undefined { return this.loadRt().continuationReason ?? undefined; }
	set continuationReason(v: string | undefined) { this.mutRt("continuationReason", v ?? null); }
	get continuationStage(): string | undefined { return this.loadRt().continuationStage ?? undefined; }
	set continuationStage(v: string | undefined) { this.mutRt("continuationStage", v ?? null); }
	get stageEpoch(): string { return this.loadRt().stageEpoch ?? `${this.runId}:?:0`; }
	set stageEpoch(v: string) { this.mutRt("stageEpoch", v); }
	get continuationEpoch(): number { return this.loadRt().continuationEpoch ?? 0; }
	set continuationEpoch(v: number) { this.mutRt("continuationEpoch", v); }
	get continuationQueued(): boolean { return this.loadRt().continuationQueued ?? false; }
	set continuationQueued(v: boolean) { this.mutRt("continuationQueued", v); }
	get paused(): boolean { return this.loadRt().paused ?? false; }
	set paused(v: boolean) { this.mutRt("paused", v); }
	get stopRequested(): boolean { return this.loadRt().stopRequested ?? false; }
	set stopRequested(v: boolean) { this.mutRt("stopRequested", v); }
	get pauseNotified(): boolean { return this.loadRt().pauseNotified ?? false; }
	set pauseNotified(v: boolean) { this.mutRt("pauseNotified", v); }
	get rollbackOutcome(): { from: string; to: string; reason: string } | undefined { return this.loadRt().rollbackOutcome ?? undefined; }
	set rollbackOutcome(v: { from: string; to: string; reason: string } | undefined) { this.mutRt("rollbackOutcome", v ?? null); }
	get pendingGroupApproval(): unknown | undefined { return undefined; }
	set pendingGroupApproval(_v: unknown) { /* NF 没有 group approval */ }

	// ── Flow budget ────────────────────────────────────────────────────
	get flowBudgetUsd(): number { return this.loadRt().flowBudgetUsd ?? 500; }
	set flowBudgetUsd(v: number) { this.mutRt("flowBudgetUsd", v); }
	get flowCostUsd(): number { return this.loadRt().flowCostUsd ?? 0; }
	set flowCostUsd(v: number) { this.mutRt("flowCostUsd", v); }
	get flowTokensUsed(): number { return this.loadRt().flowTokensUsed ?? 0; }
	set flowTokensUsed(v: number) { this.mutRt("flowTokensUsed", v); }
	get flowBudgetExhausted(): boolean { return this.flowCostUsd >= this.flowBudgetUsd; }
	get flowBudgetMessageTimestamps(): number[] { return this.loadRt().flowBudgetMessageTimestamps ?? []; }
	set flowBudgetMessageTimestamps(v: number[]) { this.mutRt("flowBudgetMessageTimestamps", v); }

	recordFlowUsage(usage: Array<{ timestamp: number; tokens: number; costUsd: number }>): void {
		if (!usage || usage.length === 0) return;
		const rt = this.loadRt();
		for (const u of usage) {
			rt.flowCostUsd = (rt.flowCostUsd ?? 0) + u.costUsd;
			rt.flowTokensUsed = (rt.flowTokensUsed ?? 0) + u.tokens;
		}
		this.saveRt(rt);
	}

	// ── 信号 ───────────────────────────────────────────────────────────
	getSignals(): ReadonlySet<NfSignal> { return new Set(this.loadRt().signals ?? []); }
	clearSignals(): void { this.mutRt("signals", []); }

	// ── 自愈预算 ───────────────────────────────────────────────────────
	beginSelfHealAttempt(stage: string): number {
		const rt = this.loadRt();
		if (!rt.selfHealUsed) rt.selfHealUsed = {};
		const used = (rt.selfHealUsed[stage] ?? 0) + 1;
		rt.selfHealUsed[stage] = used;
		this.saveRt(rt);
		return used;
	}
	remainingSelfHealBudget(stage: string): number {
		const rt = this.loadRt();
		const used = rt.selfHealUsed?.[stage] ?? 0;
		const max = rt.maxSelfHealPerStage ?? 3;
		return Math.max(0, max - used);
	}
	stageSelfHealBudget(stage: string, _kind: string): { used: number; limit: number; remaining: number; exhausted: boolean } {
		const rt = this.loadRt();
		const used = rt.selfHealUsed?.[stage] ?? 0;
		const limit = rt.maxSelfHealPerStage ?? 3;
		const remaining = Math.max(0, limit - used);
		return { used, limit, remaining, exhausted: remaining <= 0 };
	}

	// ── Flow 回退预算 ──────────────────────────────────────────────────
	remainingFlowRollbackBudget(): number {
		return Math.max(0, this.flowRollbackLimit - this.flowRollbackCount);
	}

	// ── 产物 ───────────────────────────────────────────────────────────
	getSubmittedArtifacts(): Array<{ stage: string; paths: string[] }> {
		const rt = this.loadRt();
		return Object.entries(rt.submittedArtifacts ?? {}).map(([stage, paths]) => ({ stage, paths }));
	}
	getSubmittedArtifactsForStage(stage: string): string[] | undefined {
		return this.loadRt().submittedArtifacts?.[stage];
	}

	// ── 阶段查询 ───────────────────────────────────────────────────────
	currentStage(): NfStageSpec | undefined {
		const entry = this.plan?.[this.planIndex];
		return entry?.stage;
	}
	currentStageName(): string | undefined {
		return this.loadRt().plan?.[this.planIndex]?.stageName;
	}

	// ── 恢复 ───────────────────────────────────────────────────────────
	restoreFromCheckpoint(rt: NfCheckpointData): void {
		// NF 不做任何特殊恢复逻辑；runtime.json 已经是 SSOT。
		// 这个方法保留是为了 API 兼容（flow.ts 调它）。
	}
}
