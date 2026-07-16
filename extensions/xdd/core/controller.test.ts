import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeStore } from "../storage/runtime-store.ts";
import { STAGES } from "../stages.ts";
import { transition, XddController, schedulerText, ControllerError } from "./controller.ts";
import type { RuntimeStateV2 } from "../storage/runtime-migrations.ts";

function started(): RuntimeStateV2 {
	return transition({} as RuntimeStateV2, { type: "START", task: "build", options: { cwd: "/tmp/x", runId: "r1" } }).state;
}

describe("XddController transition", () => {
	it("START creates a running v2 runtime and kickoff effects", () => {
		const result = transition({} as RuntimeStateV2, { type: "START", task: "build", options: { cwd: "/tmp/x", runId: "r1" } });
		expect(result.state.schemaVersion).toBe(2);
		expect(result.state.status).toBe("running");
		expect(result.state.planIndex).toBe(0);
		expect(result.effects.map((effect) => effect.type)).toEqual(["SET_ACTIVE_TOOLS", "SEND_FOLLOWUP"]);
	});

	it("STOP is idempotent and notifies only once", () => {
		const first = transition(started(), { type: "STOP", source: "command" });
		expect(first.state.paused).toBe(true);
		expect(first.effects.map((effect) => effect.type)).toEqual(["ABORT_AGENT", "NOTIFY"]);
		const second = transition(first.state, { type: "STOP", source: "command" });
		expect(second.effects).toHaveLength(0);
	});

	it("provider errors do not queue followups", () => {
		const result = transition(started(), { type: "AGENT_ENDED", stopReason: "error", providerError: "rate limit" });
		expect(result.state.stageOutcome).toBe("provider_error");
		expect(result.effects).toHaveLength(0);
	});

	it("gate_passed agent_end queues exactly one advance followup", () => {
		const state = started();
		state.stageOutcome = "gate_passed";
		const first = transition(state, { type: "AGENT_ENDED", stopReason: "stop" });
		expect(first.state.continuationQueued).toBe(true);
		expect(first.effects[0]).toMatchObject({ type: "SEND_FOLLOWUP" });
		expect(first.effects[0]?.type === "SEND_FOLLOWUP" ? first.effects[0].text : "").toContain("xdd_advance");
		const second = transition(first.state, { type: "AGENT_ENDED", stopReason: "stop" });
		expect(second.effects).toHaveLength(0);
	});

	it("ADVANCE respects human approval before understand -> spec", () => {
		const state = started();
		state.planIndex = 1; // understand
		const result = transition(state, { type: "ADVANCE" });
		expect(result.state.status).toBe("awaiting_approval");
		expect(result.effects[0]).toMatchObject({ type: "NOTIFY" });
	});

	it("ROLLBACK rejects non-earlier targets", () => {
		const state = started();
		expect(() => transition(state, { type: "ROLLBACK", target: "verify", reason: "bad" })).toThrow(ControllerError);
	});

	it("dispatch persists the next state before returning effects", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-controller-"));
		try {
			const store = new RuntimeStore(cwd);
			const controller = new XddController(store, STAGES);
			const result = controller.dispatch({ type: "START", task: "persist", options: { cwd, runId: "r2" } });
			expect(store.load()?.runId).toBe(result.state.runId);
			expect(result.effects.length).toBeGreaterThan(0);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("scheduler keeps advanced as an explicit new-stage kickoff", () => {
		expect(schedulerText("advanced", "architecture")).toContain("已进入 architecture 阶段");
	});
});
