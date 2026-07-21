import { existsSync, mkdirSync, openSync, readFileSync, renameSync, closeSync, fsyncSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { XddCheckpointData } from "../types.ts";
import { migrateRuntimeState, RUNTIME_SCHEMA_VERSION, type RuntimeStateV2 } from "./runtime-migrations.ts";
import { compactRuntimeEsg } from "../audit/projector.ts";

export interface RuntimeStoreSaveOptions {
	/** Test hook: write + fsync the tmp file but throw before rename. */
	simulateCrashBeforeRename?: boolean;
}

export interface RuntimeStoreOptions {
	/** Runtime JSON file name under .xdd/. Defaults to xdd's runtime.json. */
	runtimeFileName?: string;
	/** Optional legacy checkpoint file name under .xdd/ for fallback migration. */
	legacyCheckpointFileName?: string | false;
	/** Optional v1 backup file name under .xdd/ for migrated runtime files. */
	v1BackupFileName?: string;
}

export class RuntimeStore {
	readonly cwd: string;
	readonly runtimePath: string;
	readonly legacyCheckpointPath: string;
	readonly v1BackupPath: string;

	constructor(cwd: string, options: RuntimeStoreOptions = {}) {
		this.cwd = cwd;
		this.runtimePath = join(cwd, ".xdd", options.runtimeFileName ?? "runtime.json");
		this.legacyCheckpointPath = options.legacyCheckpointFileName === false
			? ""
			: join(cwd, ".xdd", options.legacyCheckpointFileName ?? "checkpoint.json");
		this.v1BackupPath = join(cwd, ".xdd", options.v1BackupFileName ?? "runtime.v1.backup.json");
	}

	load(defaults: Partial<XddCheckpointData> = {}): RuntimeStateV2 | undefined {
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

	save(state: XddCheckpointData, options: RuntimeStoreSaveOptions = {}): RuntimeStateV2 {
		const next = { ...state, schemaVersion: RUNTIME_SCHEMA_VERSION, at: new Date().toISOString() } as RuntimeStateV2;
		compactRuntimeEsg(next);
		atomicWriteJson(this.runtimePath, next, options);
		return next;
	}

	update(mutator: (state: RuntimeStateV2) => XddCheckpointData | RuntimeStateV2 | void, defaults: Partial<XddCheckpointData> = {}): RuntimeStateV2 {
		const current = this.load(defaults) ?? ({ ...defaults, schemaVersion: RUNTIME_SCHEMA_VERSION } as RuntimeStateV2);
		const draft = structuredClone(current);
		const maybeNext = mutator(draft);
		return this.save((maybeNext ?? draft) as XddCheckpointData);
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
	if (options.simulateCrashBeforeRename) {
		throw new Error("[xdd:test] simulated crash before runtime rename");
	}
	renameSync(tmp, path);
}
