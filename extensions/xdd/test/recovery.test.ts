import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HeadlessXddController } from "../adapters/headless-controller.ts";
import { controllerInitScaffold } from "../init-scaffold.ts";

function tmpCwd(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
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
