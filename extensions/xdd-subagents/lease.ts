import { randomUUID } from "node:crypto";
import type { XddSubagentRunRecord } from "./runtime-store.ts";

export type RunLease = {
	owner: string;
	heartbeatAt: string;
	expiresAt: string;
};

export function createRunLease(ttlMs = 120000): RunLease {
	return refreshRunLease({ owner: `xdd-subagents-${process.pid}-${randomUUID()}`, heartbeatAt: "", expiresAt: "" }, ttlMs);
}

export function refreshRunLease(lease: RunLease, ttlMs = 120000): RunLease {
	const now = Date.now();
	return { owner: lease.owner, heartbeatAt: new Date(now).toISOString(), expiresAt: new Date(now + ttlMs).toISOString() };
}

export function isLeaseExpired(lease: RunLease | undefined, now = Date.now()): boolean {
	if (!lease?.expiresAt) return true;
	return Date.parse(lease.expiresAt) <= now;
}

export function attachLease(run: XddSubagentRunRecord, ttlMs?: number): XddSubagentRunRecord {
	run.lease = createRunLease(ttlMs);
	return run;
}

export function heartbeatRun(run: XddSubagentRunRecord, ttlMs?: number): XddSubagentRunRecord {
	if (!run.lease) return attachLease(run, ttlMs);
	run.lease = refreshRunLease(run.lease, ttlMs);
	return run;
}
export function canClaimRun(run: XddSubagentRunRecord, now = Date.now()): boolean {
	return ["queued", "running"].includes(run.status) && isLeaseExpired(run.lease, now);
}

export function claimRun(run: XddSubagentRunRecord, ttlMs?: number): XddSubagentRunRecord {
	run.lease = createRunLease(ttlMs);
	run.updatedAt = new Date().toISOString();
	return run;
}
