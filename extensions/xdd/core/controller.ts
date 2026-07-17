import { RuntimeStore } from "../storage/runtime-store.ts";
import type { RuntimeStateV2 } from "../storage/runtime-migrations.ts";
import { RUNTIME_SCHEMA_VERSION } from "../storage/runtime-migrations.ts";
import { STAGES } from "../stages.ts";
import type { XddCheckpointData, XddEsgNodeType, XddSignal, XddStageName, XddStageOutcome, XddStageSpec } from "../types.ts";
import type { RunStatus, XddCommand } from "./commands.ts";
import type { XddEffect } from "./effects.ts";
import { projectAuditEvent } from "../audit/projector.ts";

export interface ControllerTransitionResult {
	state: RuntimeStateV2;
	effects: XddEffect[];
}

/** Pi's getContextUsage().percent is expressed on a 0..100 scale. */
export const COMPACTION_THRESHOLD_PERCENT = 70;

export class ControllerError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.name = "ControllerError";
		this.code = code;
	}
}

export class XddController {
	readonly store: RuntimeStore;
	readonly stages: readonly XddStageSpec[];

	constructor(store: RuntimeStore, stages: readonly XddStageSpec[] = STAGES) {
		this.store = store;
		this.stages = stages;
	}

	dispatch(command: XddCommand): ControllerTransitionResult {
		const current = this.store.load(defaultRuntime(command, this.store.cwd, this.stages))
			?? buildRuntimeFromCommand(command, this.store.cwd, this.stages);
		try {
			const result = transition(current, command, this.stages);
			projectAuditEvent(result.state, { type: "command_accepted", command: command.type, stage: currentStageName(result.state, this.stages) ?? "?" });
			this.store.save(result.state);
			return result;
		} catch (error) {
			const rejected = cloneRuntime(current);
			projectAuditEvent(rejected, {
				type: "command_rejected",
				command: command.type,
				stage: currentStageName(rejected, this.stages) ?? "?",
				code: error instanceof ControllerError ? error.code : "CONTROLLER_ERROR",
				message: error instanceof Error ? error.message : String(error),
			});
			this.store.save(rejected);
			throw error;
		}
	}
}

export function transition(
	state: RuntimeStateV2,
	command: XddCommand,
	stages: readonly XddStageSpec[] = STAGES,
): ControllerTransitionResult {
	const next = cloneRuntime(state);
	const effects: XddEffect[] = [];
	switch (command.type) {
		case "START":
			return startTransition(command, stages);
		case "STOP":
			return stopTransition(next, effects);
		case "RESUME":
			return resumeTransition(next, effects);
		case "AGENT_ENDED":
			return agentEndedTransition(next, command, stages, effects);
		case "SUBMIT":
			return submitTransition(next, command.submission.pass === true, command.submission.error, command.submission.gateKind, effects);
		case "ADVANCE":
			return advanceTransition(next, stages, effects);
		case "APPROVE":
			return approveTransition(next, stages, effects);
		case "ROLLBACK":
			return rollbackTransition(next, command.target, command.reason, stages, effects);
		case "RECORD_ARTIFACT_REVIEW":
			return recordArtifactReviewTransition(next, command.stage, command.artifacts, command.selfAttack, effects);
		case "RECORD_SIGNAL":
			return recordSignalTransition(next, command.signal, effects);
		case "RECORD_ESG":
			return recordEsgTransition(next, command.nodeType, command.stage, command.label, command.data, command.parentId, effects);
		case "RECORD_AUDIT_EVENT":
			projectAuditEvent(next, command.event);
			return { state: stamp(next), effects };
		case "RELEASE_CONTINUATION":
			next.continuationQueued = false;
			next.continuationReason = null;
			next.continuationStage = null;
			return { state: stamp(next), effects };
		case "DIAGNOSE":
			next.diagnose = command.diagnosis;
			next.status = "reflecting" as never;
			return { state: stamp(next), effects };
		case "COMPACTION_DONE":
			if (runtimeStatus(next) === "running" && !next.continuationQueued) {
				queueFollowUp(next, effects, next.stageOutcome ?? "idle", currentStageName(next, stages));
			}
			return { state: stamp(next), effects };
	}
}

function startTransition(command: Extract<XddCommand, { type: "START" }>, stages: readonly XddStageSpec[]): ControllerTransitionResult {
	const runId = command.options.runId ?? `xdd-${Date.now()}`;
	const plan = (command.options.plan ?? stages.map((stage) => stage.name)).map((stageName) => ({ stageName, originalIndex: stages.findIndex((s) => s.name === stageName) }));
	const requestedInitialStage = command.options.initialStage;
	const initialIndex = requestedInitialStage ? plan.findIndex((entry) => entry.stageName === requestedInitialStage) : 0;
	if (initialIndex < 0) throw new ControllerError("INVALID_START_STAGE", `initial stage ${requestedInitialStage} is not in the execution plan`);
	const state = stamp({
		...minimalRuntime(runId, command.options.cwd, command.task),
		plan,
		planIndex: initialIndex,
		status: "running" as never,
		stageOutcome: "idle",
		stageEpoch: `${runId}:${plan[initialIndex]?.stageName ?? "?"}:0`,
	});
	return {
		state,
		effects: [
			{ type: "SET_ACTIVE_TOOLS", tools: stages[plan[initialIndex]?.originalIndex ?? initialIndex]?.allowedTools ?? [] },
			{ type: "SEND_FOLLOWUP", text: `[xdd] run ${runId} 启动。当前阶段: ${plan[initialIndex]?.stageName ?? "?"}。`, epoch: state.continuationEpoch ?? 0 },
		],
	};
}

function stopTransition(state: RuntimeStateV2, effects: XddEffect[]): ControllerTransitionResult {
	if (runtimeStatus(state) === "paused") return { state: stamp(state), effects };
	state.status = "paused" as never;
	state.paused = true;
	state.stopRequested = true;
	state.stageOutcome = "paused";
	state.continuationQueued = false;
	effects.push({ type: "ABORT_AGENT" });
	if (!state.pauseNotified) {
		state.pauseNotified = true;
		effects.push({ type: "NOTIFY", level: "warning", text: `[xdd] run 已暂停在 ${currentStageName(state, STAGES) ?? "?"} 阶段。` });
	}
	return { state: stamp(state), effects };
}

function resumeTransition(state: RuntimeStateV2, effects: XddEffect[]): ControllerTransitionResult {
	if (runtimeStatus(state) !== "paused" && !state.paused) throw new ControllerError("INVALID_RESUME", "run is not paused");
	state.status = "running" as never;
	state.paused = false;
	state.stopRequested = false;
	state.pauseNotified = false;
	state.continuationEpoch = (state.continuationEpoch ?? 0) + 1;
	state.continuationQueued = true;
	effects.push({ type: "SEND_FOLLOWUP", text: `[xdd 自动推进] 恢复 ${currentStageName(state, STAGES) ?? "当前"} 阶段。请调 xdd_next_task 继续。`, epoch: state.continuationEpoch });
	return { state: stamp(state), effects };
}

function agentEndedTransition(
	state: RuntimeStateV2,
	command: Extract<XddCommand, { type: "AGENT_ENDED" }>,
	stages: readonly XddStageSpec[],
	effects: XddEffect[],
): ControllerTransitionResult {
	if (command.stopReason === "error") {
		state.stageOutcome = "provider_error";
		state.lastStageError = command.providerError ?? "LLM provider error";
		projectAuditEvent(state, { type: "provider_error", stage: currentStageName(state, stages) ?? "?", message: state.lastStageError });
		// Pi owns provider retries. XDD deliberately does not enqueue another
		// model turn here: that could race Pi's retry/backoff policy. Make the
		// wait visible to the user so an exhausted Pi retry can be resumed.
		effects.push({ type: "NOTIFY", level: "warning", text: `[xdd] 模型提供商错误：${state.lastStageError}。等待 Pi 内建重试；若 Pi 未继续，请使用 /xdd-resume。` });
		return { state: stamp(state), effects };
	}
	if (command.stopReason === "aborted") return stopTransition(state, effects);
	if (command.hasPendingMessages) return { state: stamp(state), effects };
	// A terminating tool result makes Pi report `toolUse` as the stop reason.
	// Do not treat that as an in-progress turn when the tool has already
	// reached a scheduler-owned boundary (for example AIGate passed, or its
	// retry budget was exhausted and the stage was soft-passed).  The old
	// unconditional `toolUse` return left the run with gate_passed persisted
	// but no follow-up queued, so it silently stopped after AIGate.
	if (command.stopReason === "toolUse" && !isContinuationBoundary(state.stageOutcome)) {
		return { state: stamp(state), effects };
	}
	if (state.continuationQueued) return { state: stamp(state), effects };
	if (shouldCompactBeforeContinuation(state, command.contextUsagePercent)) {
		state.lastCompactionAt = Date.now();
		effects.push({ type: "COMPACT", instructions: buildControllerCompactionInstructions(state, stages) });
		return { state: stamp(state), effects };
	}
	queueFollowUp(state, effects, state.stageOutcome ?? "idle", currentStageName(state, stages));
	return { state: stamp(state), effects };
}

function isContinuationBoundary(outcome: XddStageOutcome | undefined): boolean {
	return outcome === "gate_passed" || outcome === "advanced";
}


function shouldCompactBeforeContinuation(state: RuntimeStateV2, contextUsagePercent: number | null | undefined): boolean {
	if (!Number.isFinite(contextUsagePercent) || contextUsagePercent < COMPACTION_THRESHOLD_PERCENT) return false;
	const last = state.lastCompactionAt ?? 0;
	return Date.now() - last >= 30_000;
}

function buildControllerCompactionInstructions(state: RuntimeStateV2, stages: readonly XddStageSpec[]): string {
	const stage = currentStageName(state, stages) ?? "?";
	const lines = [
		"[xdd compaction instructions]",
		`目标: ${state.userInput ?? ""}`,
		`当前阶段: ${stage}`,
		`stageEpoch: ${state.stageEpoch ?? ""}`,
		"必须保留: 当前目标、阶段、已修改文件、Gate 失败原因、未完成任务、Harness 变化。",
		"不要复制整份设计正文；设计已落盘，只保留文件路径和关键决策索引。",
		"保持 assistant tool_call 与 tool result 配对，不要删除单侧工具消息。",
	];
	if (state.lastStageError) lines.push(`Gate 失败原因: ${state.lastStageError}`);
	if (state.submittedArtifacts?.[stage as XddStageName]?.length) {
		lines.push(`当前阶段产物: ${state.submittedArtifacts[stage as XddStageName]?.join(", ")}`);
	}
	return lines.join("\n");
}

function submitTransition(state: RuntimeStateV2, passed: boolean, error: string | undefined, gateKind: "hard_gate" | "ai_gate" | undefined, effects: XddEffect[]): ControllerTransitionResult {
	const stage = currentStageName(state, STAGES) ?? "init";
	const stageIndex = state.plan[state.planIndex]?.originalIndex ?? state.planIndex;
	if (passed) {
		state.stageOutcome = "gate_passed";
		state.lastStageError = null;
		projectAuditEvent(state, { type: "gate_result", stage: stage as XddStageName, stageIndex, passed: true, artifacts: state.submittedArtifacts?.[stage as XddStageName] });
		return { state: stamp(state), effects };
	}
	state.stageOutcome = gateKind === "ai_gate" ? "ai_gate_failed" : "hard_gate_failed";
	state.lastStageError = error ?? "artifact submission failed hard gate";
	projectAuditEvent(state, { type: "gate_result", stage: stage as XddStageName, stageIndex, passed: false, artifacts: state.submittedArtifacts?.[stage as XddStageName], reason: state.lastStageError });
	return { state: stamp(state), effects };
}

function advanceTransition(state: RuntimeStateV2, stages: readonly XddStageSpec[], effects: XddEffect[]): ControllerTransitionResult {
	const current = stages[state.plan[state.planIndex]?.originalIndex ?? state.planIndex];
	state.advanceOutcome = { passed: true };
	state.signals = [];
	if (current?.requiresHumanApproval) {
		state.status = "awaiting_approval" as never;
		state.pendingGroupApproval = { group: current.name, gateLabel: `人类确认: ${current.name}` };
		effects.push({ type: "NOTIFY", level: "info", text: `[xdd] ${current.name} 阶段需要人工确认后才能推进。` });
		return { state: stamp(state), effects };
	}
	state.planIndex += 1;
	if (state.planIndex >= state.plan.length) {
		state.runComplete = true;
		state.status = "completed" as never;
		state.stageOutcome = "completed";
		return { state: stamp(state), effects };
	}
	state.stageOutcome = "advanced";
	state.stageEpoch = `${state.runId}:${currentStageName(state, stages) ?? "?"}:${state.attempts?.[currentStageName(state, stages) ?? ""] ?? 0}`;
	effects.push({ type: "SET_ACTIVE_TOOLS", tools: currentStage(state, stages)?.allowedTools ?? [] });
	return { state: stamp(state), effects };
}

function approveTransition(state: RuntimeStateV2, stages: readonly XddStageSpec[], effects: XddEffect[]): ControllerTransitionResult {
	if (runtimeStatus(state) !== "awaiting_approval") throw new ControllerError("INVALID_APPROVE", "run is not awaiting approval");
	state.pendingGroupApproval = null;
	state.status = "running" as never;
	state.advanceOutcome = { passed: true };
	state.signals = [];
	state.planIndex += 1;
	if (state.planIndex >= state.plan.length) {
		state.runComplete = true;
		state.status = "completed" as never;
		state.stageOutcome = "completed";
		return { state: stamp(state), effects };
	}
	state.stageOutcome = "advanced";
	state.stageEpoch = `${state.runId}:${currentStageName(state, stages) ?? "?"}:${state.attempts?.[currentStageName(state, stages) ?? ""] ?? 0}`;
	effects.push({ type: "SET_ACTIVE_TOOLS", tools: currentStage(state, stages)?.allowedTools ?? [] });
	return { state: stamp(state), effects };
}

export const MAX_FLOW_ROLLBACKS = 7;

function rollbackTransition(state: RuntimeStateV2, target: XddStageName | undefined, reason: string, stages: readonly XddStageSpec[], effects: XddEffect[]): ControllerTransitionResult {
	const targetName = target ?? defaultRollbackTarget(state, stages);
	const idx = state.plan.findIndex((entry) => entry.stageName === targetName);
	if (idx < 0 || idx >= state.planIndex) throw new ControllerError("INVALID_ROLLBACK", `rollback target ${targetName} must be earlier than current stage`);
	const flowRollbackCount = state.flowRollbackCount ?? 0;
	const flowRollbackLimit = state.flowRollbackLimit ?? 7;
	if (flowRollbackCount >= flowRollbackLimit) {
		const message = "流程预算耗尽，流程退出";
		state.status = "failed" as never;
		state.stageOutcome = "failed";
		state.lastStageError = `${message}（已使用 ${flowRollbackCount}/${flowRollbackLimit} 次回退）`;
		state.stopRequested = true;
		state.continuationQueued = false;
		state.continuationReason = null;
		state.continuationStage = null;
		// Invalidate a continuation that was already queued before this command.
		state.continuationEpoch = (state.continuationEpoch ?? 0) + 1;
		effects.push({ type: "NOTIFY", level: "error", text: `[xdd] ${state.lastStageError}。` });
		return { state: stamp(state), effects };
	}
	const used = state.rollbackAttempts?.[targetName] ?? 0;
	const limit = state.maxRollbacksPerStage ?? 2;
	if (used >= limit) {
		throw new ControllerError("ROLLBACK_LIMIT_REACHED", `rollback target ${targetName} reached its limit (${used}/${limit})`);
	}
	const targetOriginalIndex = state.plan[idx]?.originalIndex ?? idx;
	for (const entry of state.ledger ?? []) {
		if (entry.stageIndex >= targetOriginalIndex && !entry.superseded) entry.superseded = true;
	}
	state.planIndex = idx;
	if (!state.rollbackAttempts) state.rollbackAttempts = {};
	state.rollbackAttempts[targetName] = used + 1;
	state.flowRollbackCount = flowRollbackCount + 1;
	state.rollbackOutcome = { from: from as XddStageName, to: targetName, reason };
	resetStageAttemptState(state, targetName);
	state.status = "running" as never;
	state.stageOutcome = "advanced";
	state.lastStageError = reason;
	projectAuditEvent(state, { type: "esg_record", nodeType: "finding", stage: from as XddStageName, label: `rollback: ${from} -> ${targetName}`, data: { reason } });
	state.stageEpoch = `${state.runId}:${targetName}:${state.attempts?.[targetName] ?? 0}`;
	effects.push({ type: "SET_ACTIVE_TOOLS", tools: currentStage(state, stages)?.allowedTools ?? [] });
	return { state: stamp(state), effects };
}

function resetStageAttemptState(state: RuntimeStateV2, targetName: XddStageName): void {
	if (!state.selfHealUsed) state.selfHealUsed = {};
	state.selfHealUsed[targetName] = 0;
	if (state.aiGateUsed) state.aiGateUsed[targetName] = 0;
	if (state.lastSubmitFingerprint) delete state.lastSubmitFingerprint[targetName];
	if (state.artifactFingerprints) delete state.artifactFingerprints[targetName];
}

function recordArtifactReviewTransition(state: RuntimeStateV2, stage: XddStageName, artifacts: string[], selfAttack: string, effects: XddEffect[]): ControllerTransitionResult {
	if (!state.submittedArtifacts) state.submittedArtifacts = {};
	if (!state.selfAttackNotes) state.selfAttackNotes = {};
	state.submittedArtifacts[stage] = artifacts;
	state.selfAttackNotes[stage] = selfAttack;
	state.stageEpoch = `${state.runId}:${stage}:${state.attempts?.[stage] ?? 0}`;
	projectAuditEvent(state, { type: "esg_record", nodeType: "review", stage, label: `self-attack: ${selfAttack.slice(0, 100)}` });
	return { state: stamp(state), effects };
}

function recordSignalTransition(state: RuntimeStateV2, signal: XddSignal, effects: XddEffect[]): ControllerTransitionResult {
	if (!state.signals) state.signals = [];
	if (!state.signals.includes(signal)) state.signals.push(signal);
	return { state: stamp(state), effects };
}

function recordEsgTransition(state: RuntimeStateV2, nodeType: XddEsgNodeType, stage: XddStageName, label: string, data: unknown, parentId: string | undefined, effects: XddEffect[]): ControllerTransitionResult {
	projectAuditEvent(state, { type: "esg_record", nodeType, stage, label, data, parentId });
	return { state: stamp(state), effects };
}


function defaultRuntime(command: XddCommand, cwd: string, stages: readonly XddStageSpec[]): Partial<XddCheckpointData> {
	if (command.type === "START") return buildRuntimeFromCommand(command, cwd, stages);
	return minimalRuntime("xdd-runtime", cwd, "");
}

function buildRuntimeFromCommand(command: XddCommand, cwd: string, stages: readonly XddStageSpec[]): RuntimeStateV2 {
	if (command.type === "START") {
		return startTransition(command, stages).state;
	}
	return stamp(minimalRuntime("xdd-runtime", cwd, ""));
}

function minimalRuntime(runId: string, cwd: string, userInput: string): RuntimeStateV2 {
	return {
		schemaVersion: RUNTIME_SCHEMA_VERSION,
		runId,
		cwd,
		userInput,
		plan: STAGES.map((stage, originalIndex) => ({ stageName: stage.name, originalIndex })),
		planIndex: 0,
		mode: "stage",
		ledger: [],
		attempts: {},
		selfHealUsed: {},
		maxRollbacksPerStage: MAX_FLOW_ROLLBACKS,
		rollbackAttempts: {},
		maxSelfHealPerStage: 5,
		flowRollbackCount: 0,
		flowRollbackLimit: 7,
		rollbackCount: 0,
		status: "running" as never,
		submittedArtifacts: {},
		selfAttackNotes: {},
		esg: [],
		at: new Date().toISOString(),
		signals: [],
		diagnose: null,
		lastSubmitFingerprint: {},
		advanceOutcome: null,
		rollbackOutcome: null,
		pendingGroupApproval: null,
		stageOutcome: "idle" as XddStageOutcome,
		stageEpoch: `${runId}:?:0`,
		lastCompactionAt: 0,
		continuationQueued: false,
		continuationEpoch: 0,
		paused: false,
		stopRequested: false,
		pauseNotified: false,
	} as RuntimeStateV2;
}

function cloneRuntime(state: RuntimeStateV2): RuntimeStateV2 {
	return JSON.parse(JSON.stringify(state ?? {}));
}

function stamp<T extends RuntimeStateV2>(state: T): T {
	state.schemaVersion = RUNTIME_SCHEMA_VERSION;
	state.at = new Date().toISOString();
	return state;
}

function runtimeStatus(state: RuntimeStateV2): RunStatus {
	if ((state as any).status) return (state as any).status;
	if ((state as any).paused) return "paused";
	if ((state as any).runComplete) return "completed";
	return "running";
}

function currentStageName(state: RuntimeStateV2, _stages: readonly XddStageSpec[] = STAGES): XddStageName | undefined {
	return state.plan?.[state.planIndex]?.stageName as XddStageName | undefined;
}

function currentStage(state: RuntimeStateV2, stages: readonly XddStageSpec[] = STAGES): XddStageSpec | undefined {
	const entry = state.plan?.[state.planIndex];
	return stages[entry?.originalIndex ?? state.planIndex];
}

export function schedulerText(outcome: XddStageOutcome | undefined, stageName: XddStageName | string | undefined): string | null {
	switch (outcome) {
		case "gate_passed":
			return `[xdd] 阶段 ${stageName ?? "?"} gate 已通过。请调用 xdd_advance 推进。`;
		case "hard_gate_failed":
		case "ai_gate_failed":
			return `[xdd] 阶段 ${stageName ?? "?"} gate 未通过。请按 lastStageError 修复后重新调用 xdd_submit_artifact。`;
		case "advanced":
			return `[xdd 自动推进] 已进入 ${stageName ?? "?"} 阶段。请调 xdd_observe、xdd_desired_state、xdd_difference，按差距完成阶段产物。`;
		case "idle":
		case "working":
		case undefined:
			return `[xdd 自动推进] 继续 ${stageName ?? "当前"} 阶段。请调用 xdd_next_task，根据 Difference 工作。`;
		case "provider_error":
		case "paused":
		case "completed":
		case "failed":
			return null;
	}
}

function queueFollowUp(state: RuntimeStateV2, effects: XddEffect[], outcome: XddStageOutcome | undefined, stageName: XddStageName | string | undefined): void {
	const text = schedulerText(outcome, stageName);
	if (!text) return;
	state.continuationEpoch = state.continuationEpoch ?? 0;
	state.continuationQueued = true;
	state.continuationStage = stageName as XddStageName;
	state.continuationReason = outcome ?? "idle";
	effects.push({ type: "SEND_FOLLOWUP", text, epoch: state.continuationEpoch });
}

function defaultRollbackTarget(state: RuntimeStateV2, _stages: readonly XddStageSpec[]): XddStageName {
	const current = currentStageName(state) ?? "verify";
	if (current === "verify") return "execute";
	const previous = state.plan?.[Math.max(0, state.planIndex - 1)]?.stageName;
	return (previous ?? "understand") as XddStageName;
}
