import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HeadlessXddController } from "./adapters/headless-controller.ts";

describe("headless controller adapter", () => {
	it("uses the same Controller transition path for start, submit, advance and rollback", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-headless-"));
		try {
			const headless = new HeadlessXddController(cwd);
			let result = headless.dispatch({ type: "START", task: "build me a tiny auth service", options: { cwd, runId: "headless" } });
			expect(result.state.runId).toBe("headless");
			expect(result.state.planIndex).toBe(0);
			expect(headless.effects.map((effect) => effect.type)).toContain("SEND_FOLLOWUP");

			result = headless.dispatch({ type: "SUBMIT", submission: { summary: "done", artifacts: [], selfAttack: "checked", pass: true } });
			expect(result.state.stageOutcome).toBe("gate_passed");
			expect(result.state.ledger.at(-1)).toMatchObject({ stage: "init", status: "pass" });

			result = headless.dispatch({ type: "ADVANCE" });
			expect(result.state.planIndex).toBe(1);
			expect(result.state.stageOutcome).toBe("advanced");

			result = headless.dispatch({ type: "ADVANCE" });
			expect(result.state.status).toBe("awaiting_approval");

			result = headless.dispatch({ type: "APPROVE", approvalId: "understand" });
			expect(result.state.planIndex).toBe(2);

			result = headless.dispatch({ type: "ROLLBACK", target: "understand", reason: "redo" });
			expect(result.state.planIndex).toBe(1);
			expect(result.state.rollbackOutcome).toMatchObject({ to: "understand", reason: "redo" });
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("persists rejected commands through the audit projector", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-headless-reject-"));
		try {
			const headless = new HeadlessXddController(cwd);
			headless.dispatch({ type: "START", task: "x", options: { cwd, runId: "reject" } });
			expect(() => headless.dispatch({ type: "ROLLBACK", target: "verify", reason: "bad" })).toThrow();
			const state = headless.load();
			expect(state?.esg.some((node) => node.label === "command rejected: ROLLBACK")).toBe(true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
