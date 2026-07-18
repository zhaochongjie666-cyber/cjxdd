import { describe, expect, it } from "vitest";
import { attachLease, heartbeatRun, isLeaseExpired } from "../lease.ts";
import type { XddSubagentRunRecord } from "../runtime-store.ts";

function makeRun(): XddSubagentRunRecord {
	return {
		id: "run-lease",
		mode: "single",
		status: "queued",
		agents: ["xdd-worker"],
		tasks: ["执行"],
		cwd: "/tmp/project",
		createdAt: "2026-07-18T00:00:00.000Z",
		updatedAt: "2026-07-18T00:00:00.000Z",
		artifactDir: "/tmp/project/.xdd/subagents/artifacts/run-lease",
		transcriptPath: "/tmp/project/.xdd/subagents/artifacts/run-lease/run.log",
		results: [],
	};
}

describe("xdd subagent leases", () => {
	it("attaches and refreshes run leases", () => {
		const run = attachLease(makeRun(), 1000);
		expect(run.lease?.owner).toContain("xdd-subagents-");
		expect(isLeaseExpired(run.lease)).toBe(false);
		const oldHeartbeat = run.lease!.heartbeatAt;
		heartbeatRun(run, 2000);
		expect(run.lease?.heartbeatAt >= oldHeartbeat).toBe(true);
	});

	it("detects expired leases", () => {
		expect(isLeaseExpired({ owner: "test", heartbeatAt: "2026-07-18T00:00:00.000Z", expiresAt: "2026-07-18T00:00:00.000Z" }, Date.parse("2026-07-18T00:00:01.000Z"))).toBe(true);
	});
});
