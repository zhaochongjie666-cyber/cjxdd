import { XddSubagentRunStore, type XddSubagentRunRecord } from "./runtime-store.ts";

export type FleetSummary = {
	total: number;
	queued: number;
	running: number;
	succeeded: number;
	failed: number;
	stopped: number;
	runs: XddSubagentRunRecord[];
};

export function summarizeFleet(cwd: string, limit = 20): FleetSummary {
	const runs = new XddSubagentRunStore(cwd).load().runs.slice(0, limit);
	return {
		total: runs.length,
		queued: runs.filter((run) => run.status === "queued").length,
		running: runs.filter((run) => run.status === "running").length,
		succeeded: runs.filter((run) => run.status === "succeeded").length,
		failed: runs.filter((run) => run.status === "failed").length,
		stopped: runs.filter((run) => run.status === "stopped").length,
		runs,
	};
}

export async function waitForRun(cwd: string, id: string, timeoutMs = 30000, intervalMs = 500): Promise<XddSubagentRunRecord | undefined> {
	const store = new XddSubagentRunStore(cwd);
	const deadline = Date.now() + timeoutMs;
	while (Date.now() <= deadline) {
		const run = store.find(id);
		if (!run || !["queued", "running"].includes(run.status)) return run;
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
	return store.find(id);
}

export function stopRun(cwd: string, id: string): XddSubagentRunRecord | undefined {
	const store = new XddSubagentRunStore(cwd);
	const run = store.find(id);
	if (!run) return undefined;
	if (run.pid && ["queued", "running"].includes(run.status)) {
		try {
			process.kill(run.pid, "SIGTERM");
		} catch (error) {
			run.error = error instanceof Error ? error.message : String(error);
		}
	}
	run.status = "stopped";
	run.updatedAt = new Date().toISOString();
	run.results = run.results.map((task) => ["queued", "running"].includes(task.status) ? { ...task, status: "stopped" } : task);
	store.upsert(run);
	return run;
}
