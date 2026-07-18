import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claimExpiredRun, claimExpiredRuns } from "../supervisor.ts";
import { XddSubagentRunStore, type XddSubagentRunRecord } from "../runtime-store.ts";

function run(id: string, expiresAt: string): XddSubagentRunRecord {
	return {
		id,
		mode: "single",
		status: "running",
		agents: ["xdd-worker"],
		tasks: ["执行"],
		cwd: "/tmp/project",
		createdAt: "2026-07-18T00:00:00.000Z",
		updatedAt: "2026-07-18T00:00:00.000Z",
		artifactDir: `/tmp/project/.xdd/subagents/artifacts/${id}`,
		transcriptPath: `/tmp/project/.xdd/subagents/artifacts/${id}/run.log`,
		lease: { owner: "old", heartbeatAt: "2026-07-18T00:00:00.000Z", expiresAt },
		results: [],
	};
}

describe("xdd subagent supervisor claims", () => {
	it("claims expired run leases and leaves active leases alone", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-supervisor-"));
		try {
			const store = new XddSubagentRunStore(cwd);
			store.upsert(run("expired", "2020-01-01T00:00:00.000Z"));
			store.upsert(run("active", "2999-01-01T00:00:00.000Z"));
			expect(claimExpiredRun(cwd, "active").claimed).toBe(false);
			expect(claimExpiredRun(cwd, "expired").claimed).toBe(true);
			expect(store.find("expired")?.lease?.owner).toContain("xdd-subagents-");
			expect(claimExpiredRuns(cwd)).toHaveLength(0);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
