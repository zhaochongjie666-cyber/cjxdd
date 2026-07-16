import type { XddCheckpointData } from "../types.ts";

export const RUNTIME_SCHEMA_VERSION = 2;

export type RuntimeStateV2 = XddCheckpointData & { schemaVersion: 2 };

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
	if (version === RUNTIME_SCHEMA_VERSION) {
		return { state: { ...defaults, ...raw, schemaVersion: RUNTIME_SCHEMA_VERSION } as RuntimeStateV2 };
	}
	return {
		state: { ...defaults, ...raw, schemaVersion: RUNTIME_SCHEMA_VERSION } as RuntimeStateV2,
		migratedFrom: version,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
