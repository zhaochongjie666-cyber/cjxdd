import { existsSync, mkdirSync, openSync, readFileSync, renameSync, closeSync, fsyncSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { XddCheckpointData } from "../types.ts";
import { migrateRuntimeState, RUNTIME_SCHEMA_VERSION, type RuntimeStateV2 } from "./runtime-migrations.ts";

export interface RuntimeStoreSaveOptions {
	/** Test hook: write + fsync the tmp file but throw before rename. */
	simulateCrashBeforeRename?: boolean;
}

export class RuntimeStore {
	readonly cwd: string;
	readonly runtimePath: string;
	readonly legacyCheckpointPath: string;
	readonly v1BackupPath: string;

	constructor(cwd: string) {
		this.cwd = cwd;
		this.runtimePath = join(cwd, ".xdd", "runtime.json");
		this.legacyCheckpointPath = join(cwd, ".xdd", "checkpoint.json");
		this.v1BackupPath = join(cwd, ".xdd", "runtime.v1.backup.json");
	}

	load(defaults: Partial<XddCheckpointData> = {}): RuntimeStateV2 | undefined {
		const source = existsSync(this.runtimePath)
			? this.runtimePath
			: existsSync(this.legacyCheckpointPath)
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
		atomicWriteJson(this.runtimePath, next, options);
		return next;
	}

	update(mutator: (state: RuntimeStateV2) => XddCheckpointData | RuntimeStateV2 | void, defaults: Partial<XddCheckpointData> = {}): RuntimeStateV2 {
		const current = this.load(defaults) ?? ({ ...defaults, schemaVersion: RUNTIME_SCHEMA_VERSION } as RuntimeStateV2);
		const maybeNext = mutator({ ...current });
		return this.save((maybeNext ?? current) as XddCheckpointData);
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
