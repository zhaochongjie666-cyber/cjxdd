import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { stopRun, summarizeFleet, waitForRun } from "../fleet.ts";
import { XddSubagentRunStore, type XddSubagentRunRecord } from "../runtime-store.ts";
import { resolvePiInvocation, resolveTaskModel } from "../settings.ts";
import { buildPiArgs, normalizeRunParams } from "../scheduler.ts";

function makeRun(cwd: string, id: string, status: XddSubagentRunRecord["status"]): XddSubagentRunRecord {
	return {
		id,
		mode: "single",
		status,
		agents: ["xdd-scout"],
		tasks: ["侦察"],
		cwd,
		createdAt: "2026-07-18T00:00:00.000Z",
		updatedAt: "2026-07-18T00:00:00.000Z",
		artifactDir: join(cwd, ".xdd", "subagents", "artifacts", id),
		transcriptPath: join(cwd, ".xdd", "subagents", "artifacts", id, "run.log"),
		results: [{ agent: "xdd-scout", task: "侦察", status, transcriptPath: join(cwd, "task.log") }],
	};
}

describe("xdd subagent fleet and settings", () => {
	it("summarizes and stops runs in the run store", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-subagents-fleet-"));
		try {
			const store = new XddSubagentRunStore(cwd);
			store.upsert(makeRun(cwd, "run-queued", "queued"));
			store.upsert(makeRun(cwd, "run-ok", "succeeded"));
			expect(summarizeFleet(cwd).queued).toBe(1);
			expect((await waitForRun(cwd, "run-ok", 10))?.status).toBe("succeeded");
			expect(stopRun(cwd, "run-queued")?.status).toBe("stopped");
			expect(summarizeFleet(cwd).stopped).toBe(1);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("resolves project settings model override without writing .pi", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-subagents-settings-"));
		try {
			mkdirSync(join(cwd, ".pi"), { recursive: true });
			writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ xddSubagents: { defaultModel: "default-model", defaultProvider: "minimax-cn", agentOverrides: { "xdd-worker": { model: "worker-model", provider: "openai" } } } }));
			expect(resolveTaskModel(cwd, "xdd-scout")).toBe("default-model");
			expect(resolveTaskModel(cwd, "xdd-worker")).toBe("worker-model");
			expect(resolveTaskModel(cwd, "xdd-worker", "explicit-model")).toBe("explicit-model");
			expect(resolvePiInvocation(cwd, "xdd-scout")).toEqual({ model: "default-model", provider: "minimax-cn" });
			expect(resolvePiInvocation(cwd, "xdd-worker")).toEqual({ model: "worker-model", provider: "openai" });
			expect(resolvePiInvocation(cwd, "xdd-worker", { model: "explicit-model", provider: "minimax-cn" })).toEqual({ model: "explicit-model", provider: "minimax-cn" });
			expect(buildPiArgs("hi", resolvePiInvocation(cwd, "xdd-scout"))).toEqual(["--provider", "minimax-cn", "--model", "default-model", "-p", "hi"]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
	it("preserves explicit provider override in normalized run params", () => {
		const normalized = normalizeRunParams({ agent: "xdd-scout", task: "侦察", provider: "minimax-cn", model: "MiniMax-M3" });
		expect(normalized.provider).toBe("minimax-cn");
		expect(normalized.model).toBe("MiniMax-M3");
	});

	it("does not signal a PID forged in the project runtime file", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-subagents-forged-pid-"));
		const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
		try {
			const run = { ...makeRun(cwd, "forged", "running"), pid: 1 };
			new XddSubagentRunStore(cwd).upsert(run);
			expect(stopRun(cwd, "forged")?.status).toBe("stopped");
			expect(kill).not.toHaveBeenCalled();
		} finally {
			kill.mockRestore();
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
