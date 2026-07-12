import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { XddCheckpointData, XddRunnerState, XddStatus } from "./types.ts";

const CHECKPOINT_DIR = ".xdd";
const CHECKPOINT_FILE = "checkpoint.json";

function checkpointPath(cwd: string): string {
	return join(cwd, CHECKPOINT_DIR, CHECKPOINT_FILE);
}

export function writeCheckpoint(state: XddRunnerState, status: XddStatus, rollbackCount: number): void {
	const dir = join(state.cwd, CHECKPOINT_DIR);
	mkdirSync(dir, { recursive: true });
	const data = state.toCheckpoint(status, rollbackCount);
	writeFileSync(checkpointPath(state.cwd), JSON.stringify(data, null, 2), "utf8");
}

export function readCheckpoint(cwd: string): XddCheckpointData | undefined {
	const path = checkpointPath(cwd);
	if (!existsSync(path)) return undefined;
	const raw = readFileSync(path, "utf8");
	return JSON.parse(raw) as XddCheckpointData;
}

export function removeCheckpoint(cwd: string): void {
	const path = checkpointPath(cwd);
	if (existsSync(path)) {
		writeFileSync(path, "", "utf8");
	}
}
