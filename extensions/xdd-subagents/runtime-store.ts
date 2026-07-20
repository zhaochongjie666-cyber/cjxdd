import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type XddSubagentRunStatus = "queued" | "running" | "succeeded" | "failed" | "stopped";
export type XddSubagentRunMode = "single" | "parallel" | "chain";

export type XddSubagentRunLease = { owner: string; heartbeatAt: string; expiresAt: string };
export type XddSubagentSession = { id: string; parentId?: string; resumeToken: string; createdAt: string; updatedAt: string };
export type XddSubagentChainOutput = { index: number; agent: string; status: XddSubagentRunStatus; transcriptPath: string; artifactPath: string; summary: string; error?: string };

export type XddSubagentRunRecord = {
	id: string;
	mode: XddSubagentRunMode;
	parentRunId?: string;
	status: XddSubagentRunStatus;
	agents: string[];
	tasks: string[];
	cwd: string;
	createdAt: string;
	updatedAt: string;
	artifactDir: string;
	transcriptPath: string;
	intercomPath?: string;
	lease?: XddSubagentRunLease;
	exitCode?: number | null;
	pid?: number;
	session?: XddSubagentSession;
	chainOutputs?: XddSubagentChainOutput[];
	error?: string;
	results: Array<{ agent: string; task: string; status: XddSubagentRunStatus; transcriptPath: string; sessionId?: string; exitCode?: number | null; error?: string; artifactPath?: string; summary?: string }>;
};

export type XddSubagentRuntimeState = {
	schemaVersion: 1;
	runs: XddSubagentRunRecord[];
};

export function normalizeRuntimeState(value: unknown): XddSubagentRuntimeState {
	const input = value && typeof value === "object" ? value as Partial<XddSubagentRuntimeState> : {};
	return { schemaVersion: 1, runs: Array.isArray(input.runs) ? input.runs : [] };
}

export function subagentsRoot(cwd: string): string {
	return join(cwd, ".xdd", "subagents");
}

export function artifactsRoot(cwd: string): string {
	return join(subagentsRoot(cwd), "artifacts");
}

export class XddSubagentRunStore {
	readonly cwd: string;
	readonly filePath: string;

	constructor(cwd: string) {
		this.cwd = cwd;
		this.filePath = join(subagentsRoot(cwd), "runs.json");
	}

	load(): XddSubagentRuntimeState {
		if (!existsSync(this.filePath)) return { schemaVersion: 1, runs: [] };
		try {
			return normalizeRuntimeState(JSON.parse(readFileSync(this.filePath, "utf8")));
		} catch {
			const backup = `${this.filePath}.corrupt.${Date.now()}`;
			try {
				copyFileSync(this.filePath, backup);
			} catch {
				// best effort backup; corrupted runtime must not crash the extension
			}
			return { schemaVersion: 1, runs: [] };
		}
	}

	save(state: XddSubagentRuntimeState): void {
		mkdirSync(dirname(this.filePath), { recursive: true });
		const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
		writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
		renameSync(tmp, this.filePath);
	}

	upsert(run: XddSubagentRunRecord): void {
		const state = this.load();
		const index = state.runs.findIndex((entry) => entry.id === run.id);
		if (index >= 0) state.runs[index] = run;
		else state.runs.unshift(run);
		this.save(state);
	}

	find(id: string): XddSubagentRunRecord | undefined {
		return this.load().runs.find((run) => run.id === id);
	}
}
