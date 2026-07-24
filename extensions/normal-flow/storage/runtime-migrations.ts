import type { NfCheckpointData } from "../types.ts";

export const RUNTIME_SCHEMA_VERSION = 4;

export type RuntimeStateV2 = NfCheckpointData & { schemaVersion: 4 };

export interface RuntimeMigrationResult {
	state: RuntimeStateV2;
	migratedFrom?: number;
}

export function migrateRuntimeState(raw: unknown, defaults: Partial<NfCheckpointData> = {}): RuntimeMigrationResult {
	if (!isRecord(raw)) throw new Error("[nf] runtime.json 不是 JSON object");
	const version = typeof raw.schemaVersion === "number" ? raw.schemaVersion : 1;
	if (version > RUNTIME_SCHEMA_VERSION) {
		throw new Error(`[nf] runtime schemaVersion ${version} 高于当前支持版本 ${RUNTIME_SCHEMA_VERSION}，拒绝覆盖。`);
	}
	const state = { ...defaults, ...raw, schemaVersion: RUNTIME_SCHEMA_VERSION } as RuntimeStateV2 & Record<string, unknown>;
	if (typeof state.flowRollbackLimit !== "number") state.flowRollbackLimit = 8;
	if (typeof state.maxSelfHealPerStage !== "number") state.maxSelfHealPerStage = 3;
	if (typeof state.maxRollbacksPerStage !== "number") state.maxRollbacksPerStage = 8;
	if (typeof state.lifetimeRollbackCount !== "number") state.lifetimeRollbackCount = state.flowRollbackCount ?? 0;
	if (typeof state.providerRetryCount !== "number") state.providerRetryCount = 0;
	if (!Array.isArray(state.esg)) state.esg = [];
	if (!Array.isArray(state.signals)) state.signals = [];
	if (!state.submittedArtifacts || typeof state.submittedArtifacts !== "object") state.submittedArtifacts = {};
	if (!state.selfHealUsed || typeof state.selfHealUsed !== "object") state.selfHealUsed = {};
	if (!state.attempts || typeof state.attempts !== "object") state.attempts = {};
	if (!Array.isArray(state.ledger)) state.ledger = [];
	if (!Array.isArray(state.flowBudgetMessageTimestamps)) state.flowBudgetMessageTimestamps = [];
	// 清理遗留的 xdd healing/aiGate 字段（NF 不使用）
	delete state.healingCases;
	delete state.activeHealingCaseId;
	delete state.healingSequence;
	delete state.verifyGeneration;
	delete state.aiGateFindings;
	delete state.selfAttackNotes;
	delete state.budgetResetHistory;
	delete state.qualityPipelineVersion;
	delete state.qualityPipelineLegacyEligible;
	delete state.pendingGroupApproval;
	delete state.lastSubmitFingerprint;
	delete state.lastAcceptedSubmissionFingerprint;
	delete state.lastFailedSubmissionFingerprint;
	delete state.provider429RetryCount;
	delete state.providerErrorResumeOutcome;
	delete state.blindJourneyVerdict;
	delete state.lastVerifyReceipt;
	if (version === RUNTIME_SCHEMA_VERSION) return { state: state as RuntimeStateV2 };
	return { state: state as RuntimeStateV2, migratedFrom: version };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
