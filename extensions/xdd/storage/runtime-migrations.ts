import type { XddCheckpointData } from "../types.ts";

export const RUNTIME_SCHEMA_VERSION = 3;

export type RuntimeStateV2 = XddCheckpointData & { schemaVersion: 3 };

export interface RuntimeMigrationResult {
	state: RuntimeStateV2;
	migratedFrom?: number;
}

export function migrateRuntimeState(raw: unknown, defaults: Partial<XddCheckpointData> = {}): RuntimeMigrationResult {
	if (!isRecord(raw)) throw new Error("[xdd] runtime.json 不是 JSON object");
	const version = typeof raw.schemaVersion === "number" ? raw.schemaVersion : 1;
	if (version > RUNTIME_SCHEMA_VERSION) {
		throw new Error(`[xdd] runtime schemaVersion ${version} 高于当前支持版本 ${RUNTIME_SCHEMA_VERSION}，拒绝覆盖。`);
	}
	const state = { ...defaults, ...raw, schemaVersion: RUNTIME_SCHEMA_VERSION } as RuntimeStateV2 & Record<string, unknown>;
	// Do not silently backfill the feature marker: its absence is the durable
	// proof that a run predates mandatory quality artifacts. Fresh runs receive
	// qualityPipelineVersion=1 from defaultRt.
	if (!("qualityPipelineVersion" in raw)) {
		delete state.qualityPipelineVersion;
		state.qualityPipelineLegacyEligible = true;
	}
	// Schema v3 replaces the old tiered flow rollback controls with one durable
	// budget. Do not carry legacy fields forward: every controller caller must
	// observe and consume the same limit.
	if (typeof state.flowRollbackLimit !== "number") state.flowRollbackLimit = 7;
	delete state.flowRollbackLimitTier1;
	delete state.flowRollbackLimitTier2;
	if (version === RUNTIME_SCHEMA_VERSION) return { state: state as RuntimeStateV2 };
	return {
		state: state as RuntimeStateV2,
		migratedFrom: version,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
