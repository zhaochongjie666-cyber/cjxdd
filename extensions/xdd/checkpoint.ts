import { existsSync, unlinkSync } from "node:fs";
import type { XddCheckpointData, XddRunnerState, XddStatus } from "./types.ts";
import { RuntimeStore } from "./storage/runtime-store.ts";

/**
 * Write checkpoint. With file-first state, runtime.json is kept current by
 * state mutations; this facade now delegates persistence to RuntimeStore so
 * writes are schema-stamped and atomic.
 */
export function writeCheckpoint(state: XddRunnerState, status: XddStatus, rollbackCount: number): void {
	const data = state.toCheckpoint(status, rollbackCount);
	new RuntimeStore(state.cwd).save(data);
}

/**
 * Read the runtime state file. RuntimeStore prefers runtime.json, falls back to
 * legacy checkpoint.json, migrates v1/no-version runtime to v2, and rejects
 * unsupported future schema versions.
 */
export function readCheckpoint(cwd: string): XddCheckpointData | undefined {
	const data = new RuntimeStore(cwd).load();
	if (!data || data.runComplete) return undefined;
	return data;
}

/** Remove runtime files (run completed successfully). */
export function removeCheckpoint(cwd: string): void {
	const store = new RuntimeStore(cwd);
	for (const p of [store.runtimePath, store.legacyCheckpointPath]) {
		if (existsSync(p)) {
			try { unlinkSync(p); } catch { /* ignore */ }
		}
	}
}
