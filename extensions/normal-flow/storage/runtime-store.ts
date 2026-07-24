/**
 * NF 自包含 RuntimeStore。不依赖 xdd 的 RuntimeStore。
 */
import { existsSync, mkdirSync, openSync, readFileSync, renameSync, closeSync, fsyncSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { NfCheckpointData } from "../types.ts";
import { migrateRuntimeState, RUNTIME_SCHEMA_VERSION, type RuntimeStateV2 } from "./runtime-migrations.ts";
import { compactRuntimeEsg } from "../audit/projector.ts";

export interface RuntimeStoreSaveOptions {
	simulateCrashBeforeRename?: boolean;
}

export interface RuntimeStoreOptions {
	runtimeFileName?: string;
	legacyCheckpointFileName?: string | false;
	v1BackupFileName?: string;
}

export class RuntimeStore {
	readonly cwd: string;
	readonly runtimePath: string;
	readonly legacyCheckpointPath: string;
	readonly v1BackupPath: string;

	constructor(cwd: string, options: RuntimeStoreOptions = {}) {
		this.cwd = cwd;
		this.runtimePath = join(cwd, ".xdd", options.runtimeFileName ?? "normal-flow-runtime.json");
		this.legacyCheckpointPath = options.legacyCheckpointFileName === false
			? ""
			: join(cwd, ".xdd", options.legacyCheckpointFileName ?? "checkpoint.json");
		this.v1BackupPath = join(cwd, ".xdd", options.v1BackupFileName ?? "normal-flow-runtime.v1.backup.json");
	}

	load(defaults: Partial<NfCheckpointData> = {}): RuntimeStateV2 | undefined {
		const source = existsSync(this.runtimePath)
			? this.runtimePath
			: this.legacyCheckpointPath && existsSync(this.legacyCheckpointPath)
				? this.legacyCheckpointPath
				: undefined;
		if (!source) return undefined;
		const rawText = readFileSync(source, "utf8");
		if (!rawText.trim()) return undefined;
		const raw = JSON.parse(rawText) as unknown;
		const migrated = migrateRuntimeState(raw, defaults);
		if (migrated.migratedFrom !== undefined && source === this.runtimePath) {
			if (!existsSync(this.v1BackupPath)) copyFileSync(this.runtimePath, this.v1BackupPath);
			this.save(migrated.state);
		}
		return migrated.state;
	}

	save(state: NfCheckpointData, options: RuntimeStoreSaveOptions = {}): RuntimeStateV2 {
		const next = { ...state, schemaVersion: RUNTIME_SCHEMA_VERSION, at: new Date().toISOString() } as RuntimeStateV2;
		compactRuntimeEsg(next);
		atomicWriteJson(this.runtimePath, next, options);
		return next;
	}

	update(mutator: (state: RuntimeStateV2) => NfCheckpointData | RuntimeStateV2 | void, defaults: Partial<NfCheckpointData> = {}): RuntimeStateV2 {
		const current = this.load(defaults) ?? ({ ...defaults, schemaVersion: RUNTIME_SCHEMA_VERSION } as RuntimeStateV2);
		const draft = structuredClone(current);
		const maybeNext = mutator(draft);
		return this.save((maybeNext ?? draft) as NfCheckpointData);
	}
}

export function atomicWriteJson(path: string, data: unknown, options: RuntimeStoreSaveOptions = {}): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp`;
	const fd = openSync(tmp, "w");
	try {
		writeFileSync(fd, `${JSON.stringify(data, null, 2)}\n`, "utf8");
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
	if (options.simulateCrashBeforeRename) throw new Error("[nf:test] simulated crash before runtime rename");
	renameSync(tmp, path);
}
