import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { diagnosePiFailureTranscript, normalizeRunParams } from "../scheduler.ts";
import { XddSubagentRunStore, type XddSubagentRunRecord } from "../runtime-store.ts";

describe("xdd subagent scheduler", () => {
	it("normalizes single, parallel, and chain tasks", () => {
		expect(normalizeRunParams({ agent: "xdd-scout", task: "侦察" }).mode).toBe("single");
		expect(normalizeRunParams({ tasks: [{ agent: "xdd-reviewer", task: "复核" }] }).mode).toBe("parallel");
		expect(normalizeRunParams({ chain: [{ agent: "xdd-planner", task: "计划" }, { agent: "xdd-worker", task: "执行" }] }).tasks).toHaveLength(2);
	});

	it("rejects unknown agents before spawning pi", () => {
		expect(() => normalizeRunParams({ agent: "unknown", task: "nope" })).toThrow(/未知 xdd subagent/);
	});

	it("turns incomplete provider streams into actionable child-run diagnostics", () => {
		expect(diagnosePiFailureTranscript("Error: Stream ended without finish_reason")).toContain("model api matches the proxy SSE format");
		expect(diagnosePiFailureTranscript("Error: Anthropic stream ended before message_stop")).toContain("lower maxTokens");
		expect(diagnosePiFailureTranscript("Error: terminated")).toBeUndefined();
	});

	it("persists run records outside .pi", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-subagents-"));
		try {
			const store = new XddSubagentRunStore(cwd);
			const run: XddSubagentRunRecord = {
				id: "run-1",
				mode: "single",
				status: "queued",
				agents: ["xdd-scout"],
				tasks: ["侦察"],
				cwd,
				createdAt: "2026-07-18T00:00:00.000Z",
				updatedAt: "2026-07-18T00:00:00.000Z",
				artifactDir: join(cwd, ".xdd", "subagents", "artifacts", "run-1"),
				transcriptPath: join(cwd, ".xdd", "subagents", "artifacts", "run-1", "run.log"),
				results: [],
			};
			store.upsert(run);
			expect(store.filePath).toContain(join(".xdd", "subagents", "runs.json"));
			expect(store.filePath).not.toContain(join(".pi"));
			expect(store.find("run-1")?.status).toBe("queued");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
