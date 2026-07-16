import { RuntimeStore } from "../storage/runtime-store.ts";
import type { RuntimeStateV2 } from "../storage/runtime-migrations.ts";
import { RUNTIME_SCHEMA_VERSION } from "../storage/runtime-migrations.ts";
import { STAGES } from "../stages.ts";
import type { XddCheckpointData, XddStageName, XddStageOutcome, XddStageSpec } from "../types.ts";
import type { RunStatus, XddCommand } from "./commands.ts";
import type { XddEffect } from "./effects.ts";

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
		const result = transition(current, command, this.stages);
		this.store.save(result.state);
		return result;
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
			return submitTransition(next, command.submission.pass === true, effects);
		case "ADVANCE":
			return advanceTransition(next, stages, effects);
		case "APPROVE":
			return approveTransition(next, stages, effects);
		case "ROLLBACK":
			return rollbackTransition(next, command.target, command.reason, stages, effects);
		case "DIAGNOSE":
			next.diagnose = command.diagnosis;
			next.status = "reflecting" as never;
			return { state: stamp(next), effects };
		case "COMPACTION_DONE":
			if (command.success && runtimeStatus(next) === "running" && !next.continuationQueued) {
				queueFollowUp(next, effects, next.stageOutcome ?? "idle", currentStageName(next, stages));
			}
			return { state: stamp(next), effects };
	}
}

function startTransition(command: Extract<XddCommand, { type: "START" }>, stages: readonly XddStageSpec[]): ControllerTransitionResult {
	const runId = command.options.runId ?? `xdd-${Date.now()}`;
	const plan = (command.options.plan ?? stages.map((stage) => stage.name)).map((stageName) => ({ stageName, originalIndex: stages.findIndex((s) => s.name === stageName) }));
	const state = stamp({
		...minimalRuntime(runId, command.options.cwd, command.task),
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
			{ type: "SEND_FOLLOWUP", text: `[xdd] run ${runId} 启动。当前阶段: ${plan[0]?.stageName ?? "?"}。`, epoch: state.continuationEpoch ?? 0 },
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
		return { state: stamp(state), effects };
	}
	if (command.stopReason === "aborted") return stopTransition(state, effects);
	if (command.stopReason === "toolUse" || command.hasPendingMessages) return { state: stamp(state), effects };
	if (state.continuationQueued) return { state: stamp(state), effects };
	queueFollowUp(state, effects, state.stageOutcome ?? "idle", currentStageName(state, stages));
	return { state: stamp(state), effects };
}

function submitTransition(state: RuntimeStateV2, passed: boolean, effects: XddEffect[]): ControllerTransitionResult {
	if (passed) {
		state.stageOutcome = "gate_passed";
		state.lastStageError = null;
		return { state: stamp(state), effects };
	}
	state.stageOutcome = "hard_gate_failed";
	state.lastStageError = "artifact submission failed hard gate";
	return { state: stamp(state), effects };
}

function advanceTransition(state: RuntimeStateV2, stages: readonly XddStageSpec[], effects: XddEffect[]): ControllerTransitionResult {
	const current = stages[state.plan[state.planIndex]?.originalIndex ?? state.planIndex];
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
	return advanceTransition(state, stages, effects);
}

function rollbackTransition(state: RuntimeStateV2, target: XddStageName | undefined, reason: string, stages: readonly XddStageSpec[], effects: XddEffect[]): ControllerTransitionResult {
	const targetName = target ?? defaultRollbackTarget(state, stages);
	const idx = state.plan.findIndex((entry) => entry.stageName === targetName);
	if (idx < 0 || idx >= state.planIndex) throw new ControllerError("INVALID_ROLLBACK", `rollback target ${targetName} must be earlier than current stage`);
	const from = currentStageName(state, stages) ?? "?";
	state.planIndex = idx;
	state.rollbackOutcome = { from: from as XddStageName, to: targetName, reason };
	state.stageOutcome = "advanced";
	effects.push({ type: "SET_ACTIVE_TOOLS", tools: currentStage(state, stages)?.allowedTools ?? [] });
	return { state: stamp(state), effects };
}

function queueFollowUp(state: RuntimeStateV2, effects: XddEffect[], outcome: XddStageOutcome, stageName: XddStageName | undefined): void {
	if (runtimeStatus(state) !== "running" || !stageName) return;
	const text = schedulerText(outcome, stageName, state.lastStageError ?? undefined);
	if (!text) return;
	state.continuationQueued = true;
	state.continuationReason = outcome;
	state.continuationStage = stageName;
	effects.push({ type: "SEND_FOLLOWUP", text, epoch: state.continuationEpoch ?? 0 });
}

export function schedulerText(outcome: XddStageOutcome, stageName: XddStageName, error?: string): string | null {
	const err = error ? `\n原因：${error}` : "";
	switch (outcome) {
		case "gate_passed": return `[xdd 自动推进] ${stageName} 闸门已通过。调 xdd_advance 推进到下一阶段。`;
		case "hard_gate_failed": return `[xdd 自动推进] ${stageName} 闸门未通过。${err}请修复产物后重新调 xdd_submit_artifact。`;
		case "ai_gate_failed": return `[xdd 自动推进] ${stageName} AIGate 未通过。${err}请根据反馈修复产物后重新调 xdd_submit_artifact。`;
		case "idle":
		case "working": return `[xdd 自动推进] 继续 ${stageName} 阶段。请调 xdd_next_task，根据 Difference 工作。`;
		case "advanced": return `[xdd 自动推进] 已进入 ${stageName} 阶段。请调 xdd_observe、xdd_desired_state、xdd_difference，按差距完成阶段产物。`;
		case "provider_error":
		case "paused":
		case "completed":
		case "failed": return null;
	}
}

function currentStage(state: RuntimeStateV2, stages: readonly XddStageSpec[]): XddStageSpec | undefined {
	const entry = state.plan[state.planIndex];
	return stages[entry?.originalIndex ?? state.planIndex];
}

function currentStageName(state: RuntimeStateV2, stages: readonly XddStageSpec[]): XddStageName | undefined {
	return state.plan[state.planIndex]?.stageName ?? currentStage(state, stages)?.name;
}

function defaultRollbackTarget(state: RuntimeStateV2, stages: readonly XddStageSpec[]): XddStageName {
	return currentStage(state, stages)?.rollbackPolicy?.target !== "none" && currentStage(state, stages)?.rollbackPolicy?.target
		? currentStage(state, stages)?.rollbackPolicy?.target as XddStageName
		: "init";
}

function runtimeStatus(state: RuntimeStateV2): RunStatus {
	if (state.paused) return "paused";
	if (state.runComplete || state.status === "pass") return "completed";
	return (state.status as unknown as RunStatus) ?? "idle";
}

function buildRuntimeFromCommand(command: XddCommand, cwd: string, stages: readonly XddStageSpec[]): RuntimeStateV2 {
	if (command.type === "START") return startTransition(command, stages).state;
	return stamp(minimalRuntime("", cwd, ""));
}

function defaultRuntime(command: XddCommand, cwd: string, stages: readonly XddStageSpec[]): Partial<XddCheckpointData> {
	return command.type === "START" ? buildRuntimeFromCommand(command, cwd, stages) : minimalRuntime("", cwd, "");
}

function minimalRuntime(runId: string, cwd: string, userInput: string): RuntimeStateV2 {
	return stamp({
		schemaVersion: RUNTIME_SCHEMA_VERSION,
		runId,
		userInput,
		cwd,
		planIndex: -1,
		plan: [],
		mode: "stage",
		ledger: [],
		attempts: {},
		selfHealUsed: {},
		maxRollbacksPerStage: 2,
		maxSelfHealPerStage: 5,
		flowRollbackCount: 0,
		flowRollbackLimitTier1: 5,
		flowRollbackLimitTier2: 10,
		rollbackCount: 0,
		status: "idle" as never,
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
		archived: false,
		boundary: 0,
		runComplete: false,
		blindJourneyVerdict: "pending",
		stopRequested: false,
		paused: false,
		pauseNotified: false,
		continuationEpoch: 0,
		continuationQueued: false,
		stageOutcome: "idle",
		lastStageError: null,
		continuationReason: null,
		continuationStage: null,
		stageEpoch: runId ? `${runId}:?:0` : "",
		lastCompactionAt: 0,
		aiGateUsed: {},
	});
}

function cloneRuntime(state: RuntimeStateV2): RuntimeStateV2 {
	return JSON.parse(JSON.stringify(state)) as RuntimeStateV2;
}

function stamp(state: XddCheckpointData): RuntimeStateV2 {
	return { ...state, schemaVersion: RUNTIME_SCHEMA_VERSION, at: new Date().toISOString() } as RuntimeStateV2;
}
