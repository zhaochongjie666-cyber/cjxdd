import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runAutoDrainIfEnabled } from "../auto-drain.ts";
import { XddSubagentRunStore, type XddSubagentRunRecord } from "../runtime-store.ts";

function makeRun(cwd: string): XddSubagentRunRecord {
	return {
		id: "run-auto-drain",
		mode: "single",
		status: "running",
		agents: ["xdd-worker"],
		tasks: ["执行"],
		cwd,
		createdAt: "2026-07-18T00:00:00.000Z",
		updatedAt: "2026-07-18T00:00:00.000Z",
		artifactDir: join(cwd, ".xdd", "subagents", "artifacts", "run-auto-drain"),
		transcriptPath: join(cwd, ".xdd", "subagents", "artifacts", "run-auto-drain", "run.log"),
		results: [],
	};
}

describe("xdd subagent auto drain", () => {
	it("skips when disabled and reconciles when enabled", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-auto-drain-"));
		try {
			new XddSubagentRunStore(cwd).upsert(makeRun(cwd));
			expect(runAutoDrainIfEnabled(cwd).enabled).toBe(false);
			mkdirSync(join(cwd, ".pi"), { recursive: true });
			writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ xddSubagents: { autoDrain: { enabled: true, notify: false } } }));
			const result = runAutoDrainIfEnabled(cwd);
			expect(result.enabled).toBe(true);
			expect(result.notify).toBe(false);
			expect(result.report?.updated).toBe(1);
			expect(new XddSubagentRunStore(cwd).find("run-auto-drain")?.status).toBe("failed");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
