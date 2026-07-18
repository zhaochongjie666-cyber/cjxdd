import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPiArgs, normalizeRunParams } from "../scheduler.ts";
import { XddSubagentRunStore, type XddSubagentRunRecord } from "../runtime-store.ts";
import { buildResumePlan } from "../session.ts";
import { appendSubagentEvent, readSubagentEvents } from "../event-stream.ts";
import { collectLspDiagnostics, renderLspDiagnostics } from "../lsp-diagnostics.ts";

function tmp() { return mkdtempSync(join(tmpdir(), "xdd-prod-")); }
function run(cwd: string): XddSubagentRunRecord {
	return {
		id: "run-1", mode: "chain", status: "failed", agents: ["xdd-scout"], tasks: ["scan"], cwd,
		createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", artifactDir: join(cwd, ".xdd/subagents/artifacts/run-1"), transcriptPath: join(cwd, ".xdd/subagents/artifacts/run-1/run.log"),
		session: { id: "run-1", resumeToken: "xdd-resume:run-1", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
		chainOutputs: [{ index: 0, agent: "xdd-scout", status: "failed", transcriptPath: "a.log", artifactPath: "a.json", summary: "missing fallback", error: "boom" }],
		results: [{ agent: "xdd-scout", task: "scan", status: "failed", transcriptPath: "a.log", artifactPath: "a.json", summary: "missing fallback", error: "boom" }],
	};
}

describe("production parity enhancements", () => {
	it("passes thinking fallbackModels and modelScope into pi args", () => {
		expect(buildPiArgs("hi", { provider: "minimax-cn", model: "MiniMax-M3", thinking: "high", fallbackModels: ["a", "b"], modelScope: "agent" })).toEqual(["--provider", "minimax-cn", "--model", "MiniMax-M3", "--thinking", "high", "--model-scope", "agent", "--fallback-model", "a", "--fallback-model", "b", "-p", "hi"]);
		expect(normalizeRunParams({ agent: "xdd-scout", task: "scan", fallbackModels: ["a"] }).fallbackModels).toEqual(["a"]);
	});

	it("builds resume prompt with session tree and structured chain outputs", () => {
		const cwd = tmp(); mkdirSync(join(cwd, ".xdd/subagents/artifacts/run-1"), { recursive: true });
		const store = new XddSubagentRunStore(cwd); store.upsert(run(cwd));
		const plan = buildResumePlan(cwd, "run-1");
		expect(plan.resumable).toBe(true);
		expect(plan.prompt).toContain("Resume xdd subagent session");
		expect(plan.prompt).toContain("Structured Previous Outputs");
		expect(plan.prompt).toContain("missing fallback");
	});

	it("records supervisor events as jsonl", () => {
		const cwd = tmp();
		appendSubagentEvent(cwd, { runId: "r", type: "status", message: "started" });
		expect(readSubagentEvents(cwd)[0].message).toBe("started");
	});

	it("renders lsp diagnostics with a fallback when language server is absent", () => {
		const cwd = tmp(); writeFileSync(join(cwd, "tsconfig.json"), "{}");
		const rendered = renderLspDiagnostics(collectLspDiagnostics(cwd));
		expect(rendered).toContain("LSP Diagnostics");
	});
});
