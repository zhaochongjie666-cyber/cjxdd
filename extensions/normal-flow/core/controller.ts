/**
 * Normal Flow 专用 Controller。
 *
 * 跟 xdd 的 XddController 结构一致，但用 nfTransition 替代 transition：
 *  - ADVANCE 不检查 HealingCase（NF 没有 healing closure 工具）
 *  - ROLLBACK 不创建 HealingCase（NF 不需要 closure 闭环）
 *  - 去掉了 AIGate / verify-receipt / human approval / diagnose
 *
 * 这消除了 NF 复用 xdd Controller 时 "verify 回退创建不可关闭的 HealingCase ->
 * advance 被 HEALING_CLOSURE_REQUIRED 拦截 -> 死锁" 的根因。
 */
import { RuntimeStore } from "../storage/runtime-store.ts";
import { type RuntimeStateV2, RUNTIME_SCHEMA_VERSION } from "../storage/runtime-migrations.ts";
import { projectAuditEvent } from "../audit/projector.ts";
import type { NfEffect } from "./effects.ts";
import type {
	NfArtifactSubmission,
	NfEsgNodeType,
	NfSignal,
	NfStageName,
	NfStageOutcome,
	NfStageSpec,
} from "../types.ts";
import type { NfCommand, NfStartOptions } from "./commands.ts";

export interface NfControllerTransitionResult {
	state: RuntimeStateV2;
	effects: NfEffect[];
}

export class NfControllerError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.name = "NfControllerError";
		this.code = code;
	}
}

export class NfController {
	readonly store: RuntimeStore;
	readonly stages: readonly NfStageSpec[];

	constructor(store: RuntimeStore, stages: readonly NfStageSpec[]) {
		this.store = store;
		this.stages = stages;
	}

	dispatch(command: NfCommand): NfControllerTransitionResult {
		const current = this.store.load(nfDefaultRuntime(command, this.store.cwd, this.stages))
			?? nfBuildRuntimeFromCommand(command, this.store.cwd, this.stages);
		try {
			const result = nfTransition(current, command, this.stages);
			projectAuditEvent(result.state, {
				type: "command_accepted",
				command: command.type,
				stage: nfCurrentStageName(result.state, this.stages) ?? "?",
			});
			this.store.save(result.state);
			return result;
		} catch (error) {
			const rejected = nfCloneRuntime(current);
			projectAuditEvent(rejected, {
				type: "command_rejected",
				command: command.type,
				stage: nfCurrentStageName(rejected, this.stages) ?? "?",
				code: error instanceof NfControllerError ? error.code : "NF_CONTROLLER_ERROR",
				message: error instanceof Error ? error.message : String(error),
			});
			this.store.save(rejected);
			throw error;
		}
	}
}

// ── transition ──────────────────────────────────────────────────────────

export function nfTransition(
	state: RuntimeStateV2,
	command: NfCommand,
	stages: readonly NfStageSpec[],
): NfControllerTransitionResult {
	const next = nfCloneRuntime(state);
	const effects: NfEffect[] = [];
	switch (command.type) {
		case "START":
			return nfStartTransition(command, stages);
		case "STOP":
			return nfStopTransition(next, effects);
		case "RESUME":
			return nfResumeTransition(next, effects);
		case "AGENT_ENDED":
			return nfAgentEndedTransition(next, command, stages, effects);
		case "SUBMIT":
			return nfSubmitTransition(next, command, stages, effects);
		case "ADVANCE":
			return nfAdvanceTransition(next, stages, effects);
		case "ROLLBACK":
			return nfRollbackTransition(next, command, stages, effects);
		case "RECORD_ARTIFACT_REVIEW":
			return nfRecordArtifactReviewTransition(next, command.stage, command.artifacts, effects);
		case "RECORD_SIGNAL":
			return nfRecordSignalTransition(next, command.signal, effects);
		case "RECORD_ESG":
			return nfRecordEsgTransition(next, command.nodeType, command.stage, command.label, command.data, command.parentId, effects);
		case "RELEASE_CONTINUATION":
			next.continuationQueued = false;
			next.continuationReason = null;
			next.continuationStage = null;
			return { state: nfStamp(next), effects };
	}
}

function nfStartTransition(command: Extract<NfCommand, { type: "START" }>, stages: readonly NfStageSpec[]): NfControllerTransitionResult {
	const runId = command.options.runId ?? `nf-${Date.now()}`;
	const plan = stages.map((stage, originalIndex) => ({ stageName: stage.name as NfStageName, originalIndex }));
	const state = nfStamp({
		...nfMinimalRuntime(runId, command.options.cwd, command.task, stages),
		plan,
		planIndex: 0,
		status: "running" as never,
		stageOutcome: "idle",
		stageEpoch: `${runId}:${plan[0]?.stageName ?? "?"}:0`,
	});
	return {
		state,
		effects: [
			{ type: "SET_ACTIVE_TOOLS", tools: stages[0]?.allowedTools ?? [] },
		],
	};
}

function nfStopTransition(state: RuntimeStateV2, effects: NfEffect[]): NfControllerTransitionResult {
	if (nfRuntimeStatus(state) === "paused") return { state: nfStamp(state), effects };
	state.status = "paused" as never;
	state.paused = true;
	state.stopRequested = true;
	state.stageOutcome = "paused";
	state.continuationQueued = false;
	effects.push({ type: "ABORT_AGENT" });
	if (!state.pauseNotified) {
		state.pauseNotified = true;
		effects.push({ type: "NOTIFY", level: "warning", text: `[normal-flow] run 已暂停。` });
	}
	return { state: nfStamp(state), effects };
}

function nfResumeTransition(state: RuntimeStateV2, effects: NfEffect[]): NfControllerTransitionResult {
	if (nfRuntimeStatus(state) !== "paused" && !state.paused) throw new NfControllerError("INVALID_RESUME", "run is not paused");
	state.status = "running" as never;
	state.paused = false;
	state.stopRequested = false;
	state.pauseNotified = false;
	state.lastStageError = null;
	state.continuationReason = null;
	state.continuationStage = null;
	state.continuationEpoch = (state.continuationEpoch ?? 0) + 1;
	state.continuationQueued = true;
	effects.push({
		type: "SEND_FOLLOWUP",
		text: `[normal-flow 自动推进] 恢复当前阶段。请调用 nf_observe / nf_difference 继续。`,
		epoch: state.continuationEpoch,
	});
	return { state: nfStamp(state), effects };
}

function nfAgentEndedTransition(
	state: RuntimeStateV2,
	command: Extract<NfCommand, { type: "AGENT_ENDED" }>,
	stages: readonly NfStageSpec[],
	effects: NfEffect[],
): NfControllerTransitionResult {
	if (command.stopReason === "error") {
		const err = command.providerError ?? "LLM provider error";
		const is429 = /429|TooManyRequests|AccountQuotaExceeded|quota.*exceeded|rate.?limit/i.test(err);
		if (is429) {
			// 429 配额不足：不暂停，延迟后自动重试。
			state.providerRetryCount = (state.providerRetryCount ?? 0) + 1;
			state.stageOutcome = "provider_error";
			state.lastStageError = err;
			projectAuditEvent(state, { type: "provider_error", stage: nfCurrentStageName(state, stages) ?? "?", message: err });
			const delaySec = Math.min(60 * state.providerRetryCount, 300);
			state.continuationEpoch = (state.continuationEpoch ?? 0) + 1;
			state.continuationQueued = true;
			state.continuationStage = nfCurrentStageName(state, stages) ?? null;
			state.continuationReason = "provider_error";
			effects.push({
				type: "NOTIFY",
				level: "warning",
				text: `[normal-flow] 模型配额不足（429），第 ${state.providerRetryCount} 次自动重试，${delaySec}s 后继续。`,
			});
			effects.push({
				type: "SEND_FOLLOWUP",
				text: `[normal-flow 自动推进] 从 429 配额错误中恢复，继续当前阶段。请调用 nf_observe 继续。`,
				epoch: state.continuationEpoch,
				delayMs: delaySec * 1000,
			});
			return { state: nfStamp(state), effects };
		}
		// 其他 provider error：暂停，等用户手动恢复
		state.stageOutcome = "provider_error";
		state.lastStageError = err;
		projectAuditEvent(state, { type: "provider_error", stage: nfCurrentStageName(state, stages) ?? "?", message: err });
		state.status = "paused" as never;
		state.paused = true;
		state.pauseNotified = true;
		state.continuationQueued = false;
		effects.push({
			type: "NOTIFY",
			level: "warning",
			text: `[normal-flow] 模型提供商失败：${err}。流程已暂停；请修复后使用 /normal-flow-resume。`,
		});
		return { state: nfStamp(state), effects };
	}
	// 非 error：重置 429 重试计数
	if (state.providerRetryCount > 0) state.providerRetryCount = 0;
	if (command.stopReason === "aborted") return nfStopTransition(state, effects);
	if (command.hasPendingMessages) return { state: nfStamp(state), effects };
	if (command.stopReason === "toolUse" && !nfIsContinuationBoundary(state.stageOutcome)) {
		return { state: nfStamp(state), effects };
	}
	if (state.continuationQueued) return { state: nfStamp(state), effects };
	nfQueueFollowUp(state, effects, state.stageOutcome ?? "idle", nfCurrentStageName(state, stages));
	return { state: nfStamp(state), effects };
}

function nfSubmitTransition(
	state: RuntimeStateV2,
	command: Extract<NfCommand, { type: "SUBMIT" }>,
	stages: readonly NfStageSpec[],
	effects: NfEffect[],
): NfControllerTransitionResult {
	const stage = nfCurrentStageName(state, stages) ?? "init";
	const stageIndex = state.plan[state.planIndex]?.originalIndex ?? state.planIndex;
	const passed = command.submission.pass === true;
	if (passed) {
		state.stageOutcome = "gate_passed";
		state.lastStageError = null;
		projectAuditEvent(state, { type: "gate_result", stage: stage as NfStageName, stageIndex, passed: true, artifacts: state.submittedArtifacts?.[stage as NfStageName] });
		return { state: nfStamp(state), effects };
	}
	state.stageOutcome = "hard_gate_failed";
	state.lastStageError = command.submission.error ?? "artifact submission failed hard gate";
	projectAuditEvent(state, { type: "gate_result", stage: stage as NfStageName, stageIndex, passed: false, artifacts: state.submittedArtifacts?.[stage as NfStageName], reason: state.lastStageError });
	return { state: nfStamp(state), effects };
}

/**
 * NF ADVANCE：直接 planIndex++，不检查 HealingCase。
 * 这是跟 xdd Controller 的核心差异--NF 没有 healing closure 工具，
 * advance 永远不会被 HEALING_CLOSURE_REQUIRED / VERIFY_RECEIPT_STALE 拦截。
 */
function nfAdvanceTransition(state: RuntimeStateV2, stages: readonly NfStageSpec[], effects: NfEffect[]): NfControllerTransitionResult {
	const current = stages[state.plan[state.planIndex]?.originalIndex ?? state.planIndex];
	state.advanceOutcome = { passed: true };
	state.signals = [];
	state.planIndex += 1;
	if (state.planIndex >= state.plan.length) {
		state.runComplete = true;
		state.status = "completed" as never;
		state.stageOutcome = "completed";
		return { state: nfStamp(state), effects };
	}
	state.stageOutcome = "advanced";
	state.stageEpoch = `${state.runId}:${nfCurrentStageName(state, stages) ?? "?"}:${state.attempts?.[nfCurrentStageName(state, stages) ?? ""] ?? 0}`;
	effects.push({ type: "SET_ACTIVE_TOOLS", tools: nfCurrentStage(state, stages)?.allowedTools ?? [] });
	return { state: nfStamp(state), effects };
}

/**
 * NF ROLLBACK：回退 planIndex + 重置预算 + 标记 ledger superseded。
 * 不创建 HealingCase--NF 没有 healing closure 工具，创建后无法关闭。
 */
function nfRollbackTransition(
	state: RuntimeStateV2,
	command: Extract<NfCommand, { type: "ROLLBACK" }>,
	stages: readonly NfStageSpec[],
	effects: NfEffect[],
): NfControllerTransitionResult {
	const { target, reason } = command;
	const from = nfCurrentStageName(state, stages) ?? "init";
	const idx = state.plan.findIndex((entry) => entry.stageName === target);
	if (idx < 0 || idx >= state.planIndex) throw new NfControllerError("INVALID_ROLLBACK", `rollback target ${target} must be earlier than current stage`);

	const flowRollbackCount = state.flowRollbackCount ?? 0;
	const flowRollbackLimit = state.flowRollbackLimit ?? 8;
	if (flowRollbackCount >= flowRollbackLimit) {
		const message = "流程回退预算耗尽，流程退出";
		state.status = "failed" as never;
		state.stageOutcome = "failed";
		state.lastStageError = `${message}（已使用 ${flowRollbackCount}/${flowRollbackLimit} 次回退）`;
		state.stopRequested = true;
		state.continuationQueued = false;
		state.continuationEpoch = (state.continuationEpoch ?? 0) + 1;
		effects.push({ type: "NOTIFY", level: "error", text: `[normal-flow] ${state.lastStageError}。` });
		return { state: nfStamp(state), effects };
	}

	const targetOriginalIndex = state.plan[idx]?.originalIndex ?? idx;
	for (const entry of state.ledger ?? []) {
		if (entry.stageIndex >= targetOriginalIndex && !entry.superseded) entry.superseded = true;
	}
	state.planIndex = idx;
	state.flowRollbackCount = flowRollbackCount + 1;
	state.lifetimeRollbackCount = (state.lifetimeRollbackCount ?? 0) + 1;

	// 清除后续阶段的提交记录和指纹
	for (const entry of state.plan.slice(idx)) {
		delete state.submittedArtifacts?.[entry.stageName];
	}

	// 重置目标阶段的自愈预算
	if (!state.selfHealUsed) state.selfHealUsed = {};
	state.selfHealUsed[target] = 0;

	state.status = "running" as never;
	state.stageOutcome = "advanced";
	state.lastStageError = reason;
	state.rollbackOutcome = { from: from as NfStageName, to: target, reason };
	projectAuditEvent(state, { type: "esg_record", nodeType: "finding", stage: from as NfStageName, label: `rollback: ${from} -> ${target}`, data: { reason } });
	state.stageEpoch = `${state.runId}:${target}:${state.attempts?.[target] ?? 0}`;
	effects.push({ type: "SET_ACTIVE_TOOLS", tools: nfCurrentStage(state, stages)?.allowedTools ?? [] });
	return { state: nfStamp(state), effects };
}

function nfRecordArtifactReviewTransition(state: RuntimeStateV2, stage: NfStageName, artifacts: string[], effects: NfEffect[]): NfControllerTransitionResult {
	if (!state.submittedArtifacts) state.submittedArtifacts = {};
	state.submittedArtifacts[stage] = artifacts;
	state.stageEpoch = `${state.runId}:${stage}:${state.attempts?.[stage] ?? 0}`;
	return { state: nfStamp(state), effects };
}

function nfRecordSignalTransition(state: RuntimeStateV2, signal: NfSignal, effects: NfEffect[]): NfControllerTransitionResult {
	if (!state.signals) state.signals = [];
	if (!state.signals.includes(signal)) state.signals.push(signal);
	return { state: nfStamp(state), effects };
}

function nfRecordEsgTransition(state: RuntimeStateV2, nodeType: NfEsgNodeType, stage: NfStageName, label: string, data: unknown, parentId: string | undefined, effects: NfEffect[]): NfControllerTransitionResult {
	projectAuditEvent(state, { type: "esg_record", nodeType, stage, label, data, parentId });
	return { state: nfStamp(state), effects };
}

// ── helpers ─────────────────────────────────────────────────────────────

function nfDefaultRuntime(command: NfCommand, cwd: string, stages: readonly NfStageSpec[]): Partial<RuntimeStateV2> {
	if (command.type === "START") return nfBuildRuntimeFromCommand(command, cwd, stages);
	return nfMinimalRuntime("nf-runtime", cwd, "");
}

function nfBuildRuntimeFromCommand(command: NfCommand, cwd: string, stages: readonly NfStageSpec[]): RuntimeStateV2 {
	if (command.type === "START") return nfStartTransition(command, stages).state;
	return nfStamp(nfMinimalRuntime("nf-runtime", cwd, "", stages));
}

function nfMinimalRuntime(runId: string, cwd: string, userInput: string, stages?: readonly NfStageSpec[]): RuntimeStateV2 {
	const plan = (stages ?? []).map((stage, originalIndex) => ({ stageName: stage.name as NfStageName, originalIndex }));
	return {
		schemaVersion: RUNTIME_SCHEMA_VERSION,
		runId,
		cwd,
		userInput,
		plan,
		planIndex: 0,
		mode: "stage",
		ledger: [],
		attempts: {},
		selfHealUsed: {},
		maxRollbacksPerStage: 8,
		rollbackAttempts: {},
		maxSelfHealPerStage: 3,
		flowRollbackCount: 0,
		flowRollbackLimit: 8,
		lifetimeRollbackCount: 0,
		verifyGeneration: 0,
		budgetResetHistory: [],
		rollbackCount: 0,
		providerRetryCount: 0,
		status: "running" as never,
		submittedArtifacts: {},
		esg: [],
		at: new Date().toISOString(),
		signals: [],
		advanceOutcome: null,
		rollbackOutcome: null,
		stageOutcome: "idle" as NfStageOutcome,
		stageEpoch: `${runId}:?:0`,
		continuationQueued: false,
		continuationEpoch: 0,
		paused: false,
		stopRequested: false,
		pauseNotified: false,
	} as RuntimeStateV2;
}

function nfCloneRuntime(state: RuntimeStateV2): RuntimeStateV2 {
	return JSON.parse(JSON.stringify(state ?? {}));
}

function nfStamp<T extends RuntimeStateV2>(state: T): T {
	state.schemaVersion = RUNTIME_SCHEMA_VERSION;
	state.at = new Date().toISOString();
	return state;
}

function nfRuntimeStatus(state: RuntimeStateV2): string {
	if ((state as Record<string, unknown>).status) return (state as Record<string, unknown>).status as string;
	if (state.paused) return "paused";
	if (state.runComplete) return "completed";
	return "running";
}

function nfCurrentStageName(state: RuntimeStateV2, stages: readonly NfStageSpec[]): NfStageName | undefined {
	return state.plan?.[state.planIndex]?.stageName as NfStageName | undefined;
}

function nfCurrentStage(state: RuntimeStateV2, stages: readonly NfStageSpec[]): NfStageSpec | undefined {
	const entry = state.plan?.[state.planIndex];
	return stages[entry?.originalIndex ?? state.planIndex];
}

function nfIsContinuationBoundary(outcome: NfStageOutcome | undefined): boolean {
	return outcome === "gate_passed" || outcome === "advanced";
}

export function nfSchedulerText(outcome: NfStageOutcome | undefined, stageName: NfStageName | string | undefined): string | null {
	switch (outcome) {
		case "gate_passed":
			return `[normal-flow] 阶段 ${stageName ?? "?"} gate 已通过。请调用 nf_advance 推进。`;
		case "hard_gate_failed":
			return `[normal-flow] 阶段 ${stageName ?? "?"} gate 未通过。请按 lastStageError 修复后重新调用 nf_submit_artifact。`;
		case "advanced":
			return `[normal-flow 自动推进] 已进入 ${stageName ?? "?"} 阶段。请调 nf_observe、nf_desired_state、nf_difference，按差距完成阶段产物。`;
		case "idle":
		case "working":
		case undefined:
			return `[normal-flow 自动推进] 继续 ${stageName ?? "当前"} 阶段。请调用 nf_observe / nf_difference，根据差距继续工作。`;
		case "provider_error":
		case "paused":
		case "completed":
		case "failed":
			return null;
	}
}

function nfQueueFollowUp(state: RuntimeStateV2, effects: NfEffect[], outcome: NfStageOutcome | undefined, stageName: NfStageName | string | undefined): void {
	const text = nfSchedulerText(outcome, stageName);
	if (!text) return;
	state.continuationEpoch = state.continuationEpoch ?? 0;
	state.continuationQueued = true;
	state.continuationStage = stageName as NfStageName;
	state.continuationReason = outcome ?? "idle";
	effects.push({ type: "SEND_FOLLOWUP", text, epoch: state.continuationEpoch });
}
