import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { postSupervisorMessage, appendIntercomMessage, type IntercomMessage, intercomPath } from "../intercom.ts";
import { reconcileSubagentRuns } from "../reconciler.ts";
import { XddSubagentRunStore, type XddSubagentRunRecord } from "../runtime-store.ts";

function makeRun(cwd: string): XddSubagentRunRecord {
	return {
		id: "run-stale",
		mode: "single",
		status: "running",
		agents: ["xdd-worker"],
		tasks: ["执行"],
		cwd,
		createdAt: "2026-07-18T00:00:00.000Z",
		updatedAt: "2026-07-18T00:00:00.000Z",
		artifactDir: join(cwd, ".xdd", "subagents", "artifacts", "run-stale"),
		transcriptPath: join(cwd, ".xdd", "subagents", "artifacts", "run-stale", "run.log"),
		pid: 99999999,
		results: [{ agent: "xdd-worker", task: "执行", status: "running", transcriptPath: join(cwd, "task.log") }],
	};
}

describe("xdd subagent reconciler", () => {
	it("marks stale running runs as failed and counts child messages", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-reconcile-"));
		try {
			new XddSubagentRunStore(cwd).upsert(makeRun(cwd));
			postSupervisorMessage(cwd, "run-stale", "父消息", "note");
			const child: IntercomMessage = { ts: "2026-07-18T00:00:00.000Z", runId: "run-stale", direction: "child_to_supervisor", reason: "blocked", message: "需要决策" };
			appendIntercomMessage(intercomPath(cwd, "run-stale"), child);
			const report = reconcileSubagentRuns(cwd);
			expect(report.updated).toBe(1);
			expect(report.childMessages).toBe(1);
			expect(new XddSubagentRunStore(cwd).find("run-stale")?.status).toBe("failed");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
