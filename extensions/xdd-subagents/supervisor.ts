import { canClaimRun, claimRun } from "./lease.ts";
import { XddSubagentRunStore, type XddSubagentRunRecord } from "./runtime-store.ts";

export type ClaimRunResult = { claimed: boolean; run?: XddSubagentRunRecord; reason?: string };

export function claimExpiredRun(cwd: string, id: string, ttlMs?: number): ClaimRunResult {
	const store = new XddSubagentRunStore(cwd);
	const run = store.find(id);
	if (!run) return { claimed: false, reason: "run not found" };
	if (!canClaimRun(run)) return { claimed: false, run, reason: "run lease is still active or run is terminal" };
	claimRun(run, ttlMs);
	store.upsert(run);
	return { claimed: true, run };
}

export function claimExpiredRuns(cwd: string, ttlMs?: number): ClaimRunResult[] {
	const store = new XddSubagentRunStore(cwd);
	const state = store.load();
	const results: ClaimRunResult[] = [];
	for (const run of state.runs) {
		if (!canClaimRun(run)) continue;
		claimRun(run, ttlMs);
		results.push({ claimed: true, run });
	}
	if (results.length > 0) store.save(state);
	return results;
}
