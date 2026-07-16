import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HeadlessXddController } from "../adapters/headless-controller.ts";
import { HookRunner } from "../hooks/runner.ts";
import { controllerInitScaffold } from "../init-scaffold.ts";

function tmpCwd(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error("condition timed out");
}

describe("T13 recovery regression", () => {
	it("recovers runtime state after a process restart and does not duplicate queued continuations", () => {
		const cwd = tmpCwd("xdd-recovery-runtime-");
		try {
			controllerInitScaffold(cwd);
			const first = new HeadlessXddController(cwd);
			first.dispatch({ type: "START", task: "recover", options: { cwd, runId: "recover" } });
			first.dispatch({ type: "SUBMIT", submission: { summary: "done", artifacts: [], selfAttack: "fixture checked", pass: true } });

			const restarted = new HeadlessXddController(cwd);
			expect(restarted.load()?.stageOutcome).toBe("gate_passed");
			const queued = restarted.dispatch({ type: "AGENT_ENDED", stopReason: "stop" });
			expect(queued.state.continuationQueued).toBe(true);
			expect(queued.effects.filter((effect) => effect.type === "SEND_FOLLOWUP")).toHaveLength(1);

			const restartedAgain = new HeadlessXddController(cwd);
			const duplicate = restartedAgain.dispatch({ type: "AGENT_ENDED", stopReason: "stop" });
			expect(duplicate.effects.filter((effect) => effect.type === "SEND_FOLLOWUP")).toHaveLength(0);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("resumes paused runtime after restart through Controller RESUME", () => {
		const cwd = tmpCwd("xdd-recovery-resume-");
		try {
			controllerInitScaffold(cwd);
			const first = new HeadlessXddController(cwd);
			first.dispatch({ type: "START", task: "resume", options: { cwd, runId: "resume" } });
			const stopped = first.dispatch({ type: "STOP", source: "command" });
			expect(stopped.state.paused).toBe(true);

			const restarted = new HeadlessXddController(cwd);
			const resumed = restarted.dispatch({ type: "RESUME" });
			expect(resumed.state.paused).toBe(false);
			expect(resumed.state.status).toBe("running");
			expect(resumed.state.continuationQueued).toBe(true);
			expect(resumed.effects.filter((effect) => effect.type === "SEND_FOLLOWUP")).toHaveLength(1);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("records hook timeout as a recoverable pass-with-warning", async () => {
		const cwd = tmpCwd("xdd-recovery-hook-timeout-");
		try {
			controllerInitScaffold(cwd);
			writeFileSync(join(cwd, ".xdd", "hooks", "before_tools", "01-timeout.cjs"), "setInterval(() => {}, 10000);", "utf8");

			const result = await new HookRunner(cwd, { timeoutMs: 50 }).run("before_tools", {
				hook: "before_tools",
				runId: "hook-timeout",
				stage: "verify",
				stageEpoch: "hook-timeout:verify:0",
				cwd,
			});

			expect(result.action).toBe("pass");
			expect(result.records[0].timedOut).toBe(true);
			expect(result.records[0].warning).toContain("timed out");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("kills hook process groups when aborted", async () => {
		const cwd = tmpCwd("xdd-recovery-hook-abort-");
		try {
			controllerInitScaffold(cwd);
			const pidFile = join(cwd, "hook.pid");
			writeFileSync(
				join(cwd, ".xdd", "hooks", "before_tools", "01-abort.cjs"),
				`const { writeFileSync } = require("node:fs");\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetInterval(() => {}, 10000);`,
				"utf8",
			);

			const ac = new AbortController();
			const running = new HookRunner(cwd, { timeoutMs: 10000, signal: ac.signal }).run("before_tools", {
				hook: "before_tools",
				runId: "hook-abort",
				stage: "verify",
				stageEpoch: "hook-abort:verify:0",
				cwd,
			});
			await waitFor(() => existsSync(pidFile));
			const pid = Number(readFileSync(pidFile, "utf8"));
			expect(alive(pid)).toBe(true);

			ac.abort();
			const result = await running;
			expect(result.action).toBe("pass");
			expect(result.records[0].warning).toContain("aborted");
			await waitFor(() => !alive(pid));
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("releases continuation locks after failed followup delivery", () => {
		const cwd = tmpCwd("xdd-recovery-release-");
		try {
			controllerInitScaffold(cwd);
			const headless = new HeadlessXddController(cwd);
			headless.dispatch({ type: "START", task: "release", options: { cwd, runId: "release" } });
			headless.dispatch({ type: "SUBMIT", submission: { summary: "done", artifacts: [], selfAttack: "fixture checked", pass: true } });
			const queued = headless.dispatch({ type: "AGENT_ENDED", stopReason: "stop" });
			expect(queued.state.continuationQueued).toBe(true);

			const released = headless.dispatch({ type: "RELEASE_CONTINUATION", reason: "send failed" });
			expect(released.state.continuationQueued).toBe(false);
			expect(released.state.continuationReason).toBeNull();
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
