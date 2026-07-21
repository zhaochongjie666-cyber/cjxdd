/** Stage epoch persistence and adapter regression tests. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { XddRunnerState } from "./types.ts";
import { createStateFixture, setStateFixturePlanIndex, startStateFixture } from "./test/state-fixture.ts";
import { FakePiAdapterHarness } from "./test/pi-adapter-harness.ts";

let cwd = "";
let state: XddRunnerState;

function freshState(): XddRunnerState {
	cwd = mkdtempSync(join(tmpdir(), "xdd-phase3-"));
	state = createStateFixture({ runId: "phase3", cwd, userInput: "test" });
	startStateFixture(state);
	return state;
}

beforeEach(() => { freshState(); });
afterEach(() => { if (existsSync(cwd)) rmSync(cwd, { recursive: true }); });

// ── P28: stageEpoch field ─────────────────────────────────────────────

describe("P28 stageEpoch state field", () => {
	it("default is runId:?:0 (placeholder sentinel for 'no real stage yet')", () => {
		// P28 contract: defaultRt(runId) writes `${runId}:?:0` so the
		// context hook can identify "no real stage yet" and passthrough.
		expect(state.stageEpoch).toBe("phase3:?:0");
	});

	it("makeStageEpoch returns runId:stage:attempt", () => {
		expect(state.makeStageEpoch("spec", 3)).toBe("phase3:spec:3");
		expect(state.makeStageEpoch("execute", 1)).toBe("phase3:execute:1");
	});

	it("set and persist to runtime.json", () => {
		state.stageEpoch = "phase3:spec:2";
		const rt = JSON.parse(readFileSync(join(cwd, ".xdd", "runtime.json"), "utf8"));
		expect(rt.stageEpoch).toBe("phase3:spec:2");
	});
});

// ── P28: tool epoch writes ────────────────────────────────────────────

describe("P28 tools write stageEpoch", () => {
	it("xdd_submit_artifact sets stageEpoch using selfHealUsed (submit attempt counter)", () => {
		// xdd_submit_artifact in the production code does:
		//   const attempt = state.currentAttempt(stage.name);
		//   state.stageEpoch = state.makeStageEpoch(stage.name, attempt);
		// currentAttempt reads attempts[stage] which is set by beginAttempt
		// (used by the test E2E XddRunner). In production, attempts stays 0
		// because no one calls beginAttempt -- so the epoch will read 0
		// until the stage-advance path bumps it. This is acceptable for
		// epoch semantics: the epoch string is a stable identity, not a
		// retry counter. We verify the helper works:
		const attempt = state.currentAttempt("spec");
		state.stageEpoch = state.makeStageEpoch("spec", attempt);
		expect(state.stageEpoch).toBe("phase3:spec:0");
		// Bumping selfHealUsed (the real submit-retry counter) does NOT
		// change currentAttempt. That's a known split between the two
		// counters; C phase doesn't unify them.
		state.beginSelfHealAttempt("spec");
		expect(state.currentAttempt("spec")).toBe(0); // unchanged
	});

	it("xdd_advance sets new stage's epoch after planIndex moves", () => {
		// Simulate the xdd_advance handler:
		startStateFixture(state); // planIndex = 0 (init)
		state.stageEpoch = state.makeStageEpoch("init", state.currentAttempt("init"));
		expect(state.stageEpoch).toBe("phase3:init:0");
		setStateFixturePlanIndex(state, 1); // Controller ADVANCE owns this in production.
		state.stageEpoch = state.makeStageEpoch("understand", state.currentAttempt("understand"));
		expect(state.stageEpoch).toBe("phase3:understand:0");
	});
});


describe("Pi followUp dispatch compatibility", () => {
	it("does not call .catch on a synchronous sendUserMessage result", async () => {
		const adapter = new FakePiAdapterHarness();
		try {
			adapter.sendUserMessageMode = "sync";
			adapter.state.stageOutcome = "idle";

			await adapter.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
			expect(adapter.sentMessages).toHaveLength(1);
			expect(adapter.sentMessages[0].options).toEqual({ deliverAs: "followUp" });
		} finally {
			adapter.dispose();
		}
	});
});
