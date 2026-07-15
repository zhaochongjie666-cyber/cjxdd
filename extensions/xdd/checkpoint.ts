import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { XddCheckpointData, XddRunnerState, XddStatus } from "./types.ts";

const DIR = ".xdd";
const RT_FILE = "runtime.json";
const OLD_FILE = "checkpoint.json";

function rtPath(cwd: string): string { return join(cwd, DIR, RT_FILE); }
function oldPath(cwd: string): string { return join(cwd, DIR, OLD_FILE); }

/**
 * Write checkpoint. With file-first state, the runtime.json is kept current
 * by every state mutation; this call just syncs `status` and `rollbackCount`
 * (runner-owned fields that aren't mutated through state setters) and writes
 * a snapshot to runtime.json.
 */
export function writeCheckpoint(state: XddRunnerState, status: XddStatus, rollbackCount: number): void {
	state.toCheckpoint(status, rollbackCount); // saves to runtime.json internally
}

/**
 * Read the runtime state file. Tries runtime.json first, falls back to the
 * legacy checkpoint.json for runs started before the file-first refactor.
 */
export function readCheckpoint(cwd: string): XddCheckpointData | undefined {
	for (const p of [rtPath(cwd), oldPath(cwd)]) {
		if (existsSync(p)) {
			const raw = readFileSync(p, "utf8");
			if (raw.trim()) return JSON.parse(raw) as XddCheckpointData;
		}
	}
	return undefined;
}

/** Remove the runtime state file (run completed successfully). */
export function removeCheckpoint(cwd: string): void {
	for (const p of [rtPath(cwd), oldPath(cwd)]) {
		if (existsSync(p)) {
			try { unlinkSync(p); } catch { /* ignore */ }
		}
	}
}
