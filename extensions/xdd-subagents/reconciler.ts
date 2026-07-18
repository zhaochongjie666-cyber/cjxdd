import { XddSubagentRunStore, type XddSubagentRunRecord } from "./runtime-store.ts";
import { readIntercomMessages } from "./intercom.ts";
import { isLeaseExpired } from "./lease.ts";

export type ReconcileReport = {
	checked: number;
	updated: number;
	childMessages: number;
	runs: XddSubagentRunRecord[];
};

export function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export function reconcileSubagentRuns(cwd: string): ReconcileReport {
	const store = new XddSubagentRunStore(cwd);
	const state = store.load();
	let updated = 0;
	let childMessages = 0;
	const runs = state.runs.map((run) => {
		const messages = readIntercomMessages(cwd, run.id).filter((message) => message.direction === "child_to_supervisor");
		childMessages += messages.length;
		if (!["queued", "running"].includes(run.status)) return run;
		if (run.pid && isPidAlive(run.pid) && !isLeaseExpired(run.lease)) return run;
		updated += 1;
		return {
			...run,
			status: "failed" as const,
			updatedAt: new Date().toISOString(),
			error: run.pid && isPidAlive(run.pid) ? "stale run: lease expired" : run.pid ? `stale run: recorded pid ${run.pid} is not alive` : "stale run: no pid recorded",
			results: run.results.map((task) => ["queued", "running"].includes(task.status) ? { ...task, status: "failed" as const, error: "stale run reconciled" } : task),
		};
	});
	if (updated > 0) store.save({ schemaVersion: 1, runs });
	return { checked: state.runs.length, updated, childMessages, runs };
}
