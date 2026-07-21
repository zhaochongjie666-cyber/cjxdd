import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildChildWatchdogTask } from "../child-watchdog.ts";
import type { XddSubagentRunRecord } from "../runtime-store.ts";

function makeRun(cwd: string, transcriptPath: string): XddSubagentRunRecord {
	return {
		id: "run-child",
		mode: "single",
		status: "succeeded",
		agents: ["xdd-worker"],
		tasks: ["执行"],
		cwd,
		createdAt: "2026-07-18T00:00:00.000Z",
		updatedAt: "2026-07-18T00:00:00.000Z",
		artifactDir: join(cwd, ".xdd", "subagents", "artifacts", "run-child"),
		transcriptPath: join(cwd, ".xdd", "subagents", "artifacts", "run-child", "run.log"),
		results: [{ agent: "xdd-worker", task: "执行", status: "succeeded", transcriptPath }],
	};
}

describe("xdd child watchdog", () => {
	it("builds a transcript-focused adversarial review task", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-child-watchdog-"));
		try {
			const transcriptPath = join(cwd, ".xdd", "subagents", "artifacts", "run-child", "worker.log");
			mkdirSync(join(cwd, ".xdd", "subagents", "artifacts", "run-child"), { recursive: true });
			writeFileSync(transcriptPath, "Implemented without tests");
			const task = buildChildWatchdogTask(makeRun(cwd, transcriptPath));
			expect(task).toContain("child watchdog 攻击检查");
			expect(task).toContain("遗漏验证");
			expect(task).toContain("Implemented without tests");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("rejects a project-forged transcript path outside the artifact root", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-child-watchdog-escape-"));
		try {
			const secretPath = join(cwd, "secret.txt");
			mkdirSync(join(cwd, ".xdd", "subagents", "artifacts"), { recursive: true });
			writeFileSync(secretPath, "DO_NOT_EXFILTRATE");
			const task = buildChildWatchdogTask(makeRun(cwd, secretPath));
			expect(task).toContain("<rejected transcript outside xdd artifacts>");
			expect(task).not.toContain("DO_NOT_EXFILTRATE");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
