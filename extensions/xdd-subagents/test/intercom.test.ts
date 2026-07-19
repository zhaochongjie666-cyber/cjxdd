import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { attachIntercomToRun, intercomPath, postSupervisorMessage, readIntercomMessages, supervisorIntercomInstructions } from "../intercom.ts";
import type { XddSubagentRunRecord } from "../runtime-store.ts";

function makeRun(cwd: string): XddSubagentRunRecord {
	return {
		id: "run-1",
		mode: "single",
		status: "queued",
		agents: ["xdd-worker"],
		tasks: ["执行"],
		cwd,
		createdAt: "2026-07-18T00:00:00.000Z",
		updatedAt: "2026-07-18T00:00:00.000Z",
		artifactDir: join(cwd, ".xdd", "subagents", "artifacts", "run-1"),
		transcriptPath: join(cwd, ".xdd", "subagents", "artifacts", "run-1", "run.log"),
		results: [],
	};
}

describe("xdd subagent intercom", () => {
	it("provides file-backed supervisor messages outside .pi", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-intercom-"));
		try {
			const run = attachIntercomToRun(cwd, makeRun(cwd));
			expect(run.intercomPath).toBe(intercomPath(cwd, "run-1"));
			expect(run.intercomPath).toContain(join(".xdd", "subagents", "intercom"));
			expect(run.intercomPath).not.toContain(join(".pi"));
			postSupervisorMessage(cwd, "run-1", "继续执行", "progress_update");
			const messages = readIntercomMessages(cwd, "run-1");
			expect(messages).toHaveLength(1);
			expect(messages[0].direction).toBe("supervisor_to_child");
			expect(messages[0].message).toBe("继续执行");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("renders child instructions with JSONL schema", () => {
		const instructions = supervisorIntercomInstructions("/tmp/run.jsonl");
		expect(instructions).toContain("Supervisor Intercom");
		expect(instructions).toContain("child_to_supervisor");
		expect(instructions).toContain("need_decision|progress_update|blocked|note");
	});

	it("rejects traversal and absolute run ids before reading or writing", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-intercom-traversal-"));
		try {
			const escaped = join(cwd, "escaped.jsonl");
			expect(() => postSupervisorMessage(cwd, "../../../escaped", "attack")).toThrow(/无效的 xdd subagent run id/);
			expect(() => readIntercomMessages(cwd, "/tmp/escaped")).toThrow(/无效的 xdd subagent run id/);
			expect(existsSync(escaped)).toBe(false);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
