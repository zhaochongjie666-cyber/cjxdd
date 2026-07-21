import { RuntimeStore } from "../storage/runtime-store.ts";
import type { RuntimeStateV2 } from "../storage/runtime-migrations.ts";
import { RUNTIME_SCHEMA_VERSION } from "../storage/runtime-migrations.ts";
import { STAGES } from "../stages.ts";
import type { XddCheckpointData, XddEsgNodeType, XddSignal, XddStageName, XddStageOutcome, XddStageSpec } from "../types.ts";
import type { RunStatus, XddCommand } from "./commands.ts";
import type { XddEffect } from "./effects.ts";
import { projectAuditEvent } from "../audit/projector.ts";
import { captureHealingBaseline, healingSignature } from "../healing/healing-case.ts";
import { healingEnforced } from "../healing/mode.ts";

export interface ControllerTransitionResult {
	state: RuntimeStateV2;
	effects: XddEffect[];
}

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
			return submitTransition(next, command.submission.pass === true, command.submission.error, command.submission.gateKind, stages, effects);
		case "ADVANCE":
			return advanceTransition(next, stages, effects);
		case "APPROVE":
			return approveTransition(next, stages, effects);
		case "ROLLBACK":
			return rollbackTransition(next, command, stages, effects);
		case "RECORD_HEALING_CLOSURE":
			return recordHealingClosure(next, command.caseId, command.closure, effects);
		case "RECORD_VERIFY_RECEIPT":
			next.lastVerifyReceipt = command.receipt;
			return { state: stamp(next), effects };
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

export function isProvider429InsufficientBalance(error: string | null | undefined): boolean {
	const text = (error ?? "").toLowerCase();
	return /(?:^|\D)429(?:\D|$)/.test(text) && /(余额不足|用量上限|购买积分|insufficient[_\s-]*(?:balance|quota|credits?)|balance[_\s-]*not[_\s-]*enough|quota[_\s-]*exceeded|(?:usage|plan)[_\s-]*limit|credit)/i.test(error ?? "");
}

/** Errors that indicate an SSE stream ended without the provider's required terminal event. */
export function isProviderProtocolTermination(error: string | null | undefined): boolean {
	const text = (error ?? "").trim();
	return /^(?:stream ended without finish_reason|anthropic stream ended before message_stop)(?:\s|$|[.:;,-])/i.test(text);
}

export function provider429RetryDelayMs(retryCount: number): number {
	const safeCount = Math.max(1, Math.floor(retryCount));
	return Math.min(180_000, 3_000 * (2 ** (safeCount - 1)));
}

function formatDelay(delayMs: number): string {
	return delayMs >= 60_000 ? `${Math.round(delayMs / 60_000)} 分钟` : `${Math.round(delayMs / 1000)} 秒`;
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
		if (isProviderProtocolTermination(state.lastStageError)) {
			// A malformed/incomplete SSE stream is a provider compatibility problem,
			// not evidence that another identical model turn will succeed. Do not
			// create an unbounded retry loop: preserve the checkpoint and tell the
			// user to repair the provider protocol/model limit before resuming.
			effects.push({
				type: "NOTIFY",
				level: "warning",
				text: `[xdd] 提供商流协议未正常结束：${state.lastStageError}。请核对模型 api 与代理 SSE 格式，并适当降低模型 maxTokens；修复后使用 /xdd-resume，checkpoint 与已有产物已保留。`,
			});
			return { state: stamp(state), effects };
		}
		if (isProvider429InsufficientBalance(state.lastStageError)) {
			const retryCount = (state.provider429RetryCount ?? 0) + 1;
			state.provider429RetryCount = retryCount;
			state.continuationEpoch = (state.continuationEpoch ?? 0) + 1;
			state.continuationQueued = true;
			state.continuationReason = "provider_429_insufficient_balance_retry";
			state.continuationStage = currentStageName(state, stages) as XddStageName | null;
			const delayMs = provider429RetryDelayMs(retryCount);
			effects.push({
				type: "NOTIFY",
				level: "warning",
				text: `[xdd] 提供商请求遇到 429/余额不足：${state.lastStageError}。将继续第 ${retryCount} 次重试，等待 ${formatDelay(delayMs)}；达到 3 分钟后会一直每 3 分钟重试，不退出。`,
			});
			effects.push({
				type: "SEND_FOLLOWUP",
				text: `[xdd 自动重试] 提供商请求上次遇到 429/余额不足（${state.lastStageError}）。不要退出；继续当前 ${currentStageName(state, stages) ?? "阶段"} 阶段，从中断处重试。`,
				epoch: state.continuationEpoch,
				delayMs,
			});
			return { state: stamp(state), effects };
		}
		state.provider429RetryCount = 0;
		// Pi owns other provider retries. XDD deliberately does not enqueue another
		// model turn here: that could race Pi's retry/backoff policy. Make the
		// wait visible to the user so an exhausted Pi retry can be resumed.
		effects.push({ type: "NOTIFY", level: "warning", text: `[xdd] 模型提供商错误：${state.lastStageError}。等待 Pi 内建重试；若 Pi 未继续，请使用 /xdd-resume。` });
		return { state: stamp(state), effects };
	}
	state.provider429RetryCount = 0;
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
	// Pi alone owns context-window accounting, proactive/overflow compaction,
	// retries, and preservation of tool-call history. XDD only queues its next
	// workflow instruction.
	queueFollowUp(state, effects, state.stageOutcome ?? "idle", currentStageName(state, stages));
	return { state: stamp(state), effects };
}

function isContinuationBoundary(outcome: XddStageOutcome | undefined): boolean {
	return outcome === "gate_passed" || outcome === "advanced";
}


function submitTransition(state: RuntimeStateV2, passed: boolean, error: string | undefined, gateKind: "hard_gate" | "ai_gate" | undefined, stages: readonly XddStageSpec[], effects: XddEffect[]): ControllerTransitionResult {
	const stage = currentStageName(state, stages) ?? "init";
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
	const healing = state.healingCases?.find((item) => item.id === state.activeHealingCaseId);
	if (healingEnforced() && healing && current?.name === healing.targetStage && healing.status !== "ready-for-reverify") {
		throw new ControllerError("HEALING_CLOSURE_REQUIRED", `HealingCase ${healing.id} 尚未 ready-for-reverify；请按 xdd_next_task 提交负责范围变化、原 failure 机械检查和 closure evidence。`);
	}
	if (healingEnforced() && healing && current?.name === "verify") {
		if (!state.lastVerifyReceipt || state.lastVerifyReceipt.generation !== state.verifyGeneration || state.lastVerifyReceipt.healingCaseId !== healing.id) throw new ControllerError("VERIFY_RECEIPT_STALE", `HealingCase ${healing.id} 缺少当前 generation 的 Controller VerifyReceipt；请重跑 Harness。`);
		healing.status = "closed";
		healing.closedAt = new Date().toISOString();
		delete state.activeHealingCaseId;
	}
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

function rollbackTransition(state: RuntimeStateV2, command: Extract<XddCommand, { type: "ROLLBACK" }>, stages: readonly XddStageSpec[], effects: XddEffect[]): ControllerTransitionResult {
	const { target, reason } = command;
	const from = currentStageName(state, stages) ?? "init";
	if (from !== "verify") {
		throw new ControllerError("ROLLBACK_ONLY_FROM_VERIFY", `rollback can only be triggered from verify stage; current stage is ${from}`);
	}
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
	state.lifetimeRollbackCount = (state.lifetimeRollbackCount ?? 0) + 1;
	state.verifyGeneration = (state.verifyGeneration ?? 0) + 1;
	state.healingSequence = (state.healingSequence ?? 0) + 1;
	if (!state.healingCases) state.healingCases = [];
	const files = command.failure?.files ?? [];
	const signature = healingSignature({ code: command.failure?.code ?? "VERIFY_FAILURE", reason, files }, targetName);
	const recurring = [...state.healingCases].reverse().find((item) => item.failure.signature === signature);
	const priorActive = state.healingCases.find((item) => item.id === state.activeHealingCaseId);
	if (priorActive) priorActive.status = "abandoned";
	const sequence = state.healingSequence;
	const id = `HC-${String(sequence).padStart(3, "0")}`;
	state.healingCases.push({
		id, sequence, sourceStage: "verify", targetStage: targetName, openedAt: new Date().toISOString(), status: "open",
		failure: { code: command.failure?.code ?? "VERIFY_FAILURE", gateKind: command.failure?.gateKind ?? "verdict", summary: command.failure?.summary ?? reason, reason, files, remediation: command.failure?.remediation ?? `在 ${targetName} 修复后重新验证`, signature },
		ownerScopes: command.ownerScopes ?? defaultOwnerScopes(targetName),
		closureCriteria: command.closureCriteria ?? [`原 verify failure ${command.failure?.code ?? "VERIFY_FAILURE"} 不再出现`, "提交负责范围的实质内容变化和验证证据"],
		baseline: command.baseline ?? captureHealingBaseline(state.cwd, command.ownerScopes ?? defaultOwnerScopes(targetName)),
		recurrenceCount: (recurring?.recurrenceCount ?? 0) + 1,
	});
	state.activeHealingCaseId = id;
	delete state.lastVerifyReceipt;
	for (const entry of state.plan.slice(idx)) {
		delete state.submittedArtifacts?.[entry.stageName];
		delete state.lastSubmitFingerprint?.[entry.stageName];
		delete state.lastAcceptedSubmissionFingerprint?.[entry.stageName];
		delete state.lastFailedSubmissionFingerprint?.[entry.stageName];
	}
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

function recordHealingClosure(state: RuntimeStateV2, caseId: string, closure: import("../types.ts").HealingClosureEvidence, effects: XddEffect[]): ControllerTransitionResult {
	const healing = state.healingCases?.find((item) => item.id === caseId && item.id === state.activeHealingCaseId);
	if (!healing) throw new ControllerError("HEALING_CASE_NOT_ACTIVE", `HealingCase ${caseId} 不存在或不是 active case`);
	if (closure.stage !== healing.targetStage) throw new ControllerError("HEALING_STAGE_MISMATCH", `closure stage ${closure.stage} 不属于 ${healing.targetStage}`);
	healing.closure = closure;
	healing.status = "ready-for-reverify";
	projectAuditEvent(state, { type: "esg_record", nodeType: "evidence", stage: closure.stage, label: `healing closure: ${caseId}`, data: closure });
	return { state: stamp(state), effects };
}

function resetStageAttemptState(state: RuntimeStateV2, targetName: XddStageName): void {
	if (!state.selfHealUsed) state.selfHealUsed = {};
	state.selfHealUsed[targetName] = 0;
	if (state.aiGateUsed) state.aiGateUsed[targetName] = 0;
	if (state.lastSubmitFingerprint) delete state.lastSubmitFingerprint[targetName];
	if (state.lastAcceptedSubmissionFingerprint) delete state.lastAcceptedSubmissionFingerprint[targetName];
	if (state.lastFailedSubmissionFingerprint) delete state.lastFailedSubmissionFingerprint[targetName];
}

function defaultOwnerScopes(stage: XddStageName): string[] {
	if (stage === "execute") return ["src/**", "lib/**", "app/**", "test/**", "tests/**"];
	if (stage === "plan") return [".xdd/runs/xdd_run/plan/**", ".xdd/runs/xdd_run/qa-plan*", ".xdd/runs/xdd_run/plan.md"];
	return [`.xdd/design/${stage}/**`];
}

function recordArtifactReviewTransition(state: RuntimeStateV2, stage: XddStageName, artifacts: string[], selfAttack: string | undefined, effects: XddEffect[]): ControllerTransitionResult {
	if (!state.submittedArtifacts) state.submittedArtifacts = {};
	state.submittedArtifacts[stage] = artifacts;
	if (selfAttack) {
		state.runSelfAttack = selfAttack;
		projectAuditEvent(state, { type: "esg_record", nodeType: "review", stage, label: `self-attack: ${selfAttack.slice(0, 100)}` });
	}
	state.stageEpoch = `${state.runId}:${stage}:${state.attempts?.[stage] ?? 0}`;
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
		lifetimeRollbackCount: 0,
		healingSequence: 0,
		healingCases: [],
		verifyGeneration: 0,
		budgetResetHistory: [],
		aiGateFindings: {},
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
