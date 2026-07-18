import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { XddRunnerState } from "./types.ts";
import { createStateFixture, setStateFixturePlanIndex, startStateFixture } from "./test/state-fixture.ts";
import { ControllerTestFixture } from "./test/controller-fixture.ts";

/** Each state gets its own temp dir so file-backed state doesn't collide. */
let dirCounter = 0;
function tmpCwd(): string {
	return mkdtempSync(join(tmpdir(), `xdd-test-${Date.now()}-${dirCounter++}-`));
}

function makeState(): XddRunnerState {
	return createStateFixture({ runId: "test", cwd: tmpCwd(), userInput: "test" });
}

describe("XddRunnerState basics", () => {
	it("starts at planIndex -1", () => {
		const state = new XddRunnerState({ runId: "t", cwd: tmpCwd(), userInput: "u" });
		expect(state.planIndex).toBe(-1);
	});

	it("Controller fixture starts at init", () => {
		const state = makeState();
		startStateFixture(state);
		expect(state.planIndex).toBe(0);
		expect(state.currentStage()?.name).toBe("init");
	});


	it("startRun resets stale budgets when starting a new run in an existing .xdd directory", () => {
		const cwd = tmpCwd();
		const oldState = createStateFixture({ runId: "old-run", cwd, userInput: "old" });
		new ControllerTestFixture(oldState).startAt("understand");
		for (let i = 0; i < oldState.maxSelfHealPerStage; i++) oldState.beginSelfHealAttempt("understand");
		for (let i = 0; i < oldState.maxSelfHealPerStage; i++) oldState.beginAiGateAttempt("understand");
		expect(oldState.remainingSelfHealBudget("understand")).toBe(0);
		expect(oldState.remainingAiGateBudget("understand")).toBe(0);

		const newState = createStateFixture({ runId: "new-run", cwd, userInput: "new" });
		new ControllerTestFixture(newState).startAt("init");

		expect(newState.planIndex).toBe(0);
		expect(newState.remainingSelfHealBudget("understand")).toBe(5);
		expect(newState.remainingAiGateBudget("understand")).toBe(5);
		expect(newState.stageOutcome).toBe("idle");
	});

	it("isLastStage detects final plan entry", () => {
		const state = makeState();
		startStateFixture(state);
		setStateFixturePlanIndex(state, state.plan.length - 1);
		expect(state.isLastStage()).toBe(true);
	});
});

describe("XddRunnerState navigation compatibility", () => {
	it("does not expose runner-owned advancement helpers", () => {
		const state = makeState() as unknown as Record<string, unknown>;
		expect(state.advancePlan).toBeUndefined();
		expect(state.goToStageName).toBeUndefined();
	});
});

describe("XddRunnerState flow rollback (Layer 2)", () => {
	it("defaults to a single persisted limit of 7", () => {
		const state = new XddRunnerState({ runId: "t", cwd: tmpCwd(), userInput: "u" });
		expect(state.flowRollbackCount).toBe(0);
		expect(state.flowRollbackLimit).toBe(7);
	});
});

describe("XddRunnerState self-heal budget", () => {
	it("increments and tracks remaining", () => {
		const state = makeState();
		state.maxSelfHealPerStage = 3;
		expect(state.beginSelfHealAttempt("spec")).toBe(1);
		expect(state.beginSelfHealAttempt("spec")).toBe(2);
		expect(state.remainingSelfHealBudget("spec")).toBe(1);
	});

	it("caps at maxSelfHealPerStage (Bug 2)", () => {
		const state = makeState();
		state.maxSelfHealPerStage = 3;
		expect(state.beginSelfHealAttempt("spec")).toBe(1);
		expect(state.beginSelfHealAttempt("spec")).toBe(2);
		expect(state.beginSelfHealAttempt("spec")).toBe(3);
		// past the cap -- must not grow
		expect(state.beginSelfHealAttempt("spec")).toBe(3);
		expect(state.beginSelfHealAttempt("spec")).toBe(3);
		expect(state.beginSelfHealAttempt("spec")).toBe(3);
		expect(state.remainingSelfHealBudget("spec")).toBe(0);
	});

	it("resets budget", () => {
		const state = makeState();
		state.maxSelfHealPerStage = 3;
		state.beginSelfHealAttempt("spec");
		state.beginSelfHealAttempt("spec");
		state.resetSelfHealBudget("spec");
		expect(state.remainingSelfHealBudget("spec")).toBe(3);
	});

	it("refunds a provisional submit attempt after AIGate infrastructure failure", () => {
		const state = makeState();
		state.beginSelfHealAttempt("spec");
		state.refundSelfHealAttempt("spec");
		expect(state.remainingSelfHealBudget("spec")).toBe(state.maxSelfHealPerStage);
	});

	it("defaults to 5 (Layer 1 budget)", () => {
		const state = new XddRunnerState({ runId: "t", cwd: tmpCwd(), userInput: "u" });
		expect(state.maxSelfHealPerStage).toBe(5);
	});
});

describe("XddRunnerState artifacts and self-attack", () => {
	it("records and retrieves artifacts", () => {
		const state = makeState();
		state.recordArtifact("spec", ["docs/spec.md"]);
		const arts = state.getSubmittedArtifacts();
		expect(arts).toHaveLength(1);
		expect(arts[0].stage).toBe("spec");
		expect(arts[0].paths).toEqual(["docs/spec.md"]);
	});

	it("records the latest AIGate-coupled self-attack", () => {
		const state = makeState();
		state.recordRunSelfAttack("checked cross-stage assumptions and failure paths");
		expect(state.getRunSelfAttack()).toBe("checked cross-stage assumptions and failure paths");
	});
});

describe("XddRunnerState checkpoint", () => {
	it("serializes to checkpoint and back", () => {
		const state = makeState();
		startStateFixture(state);
		setStateFixturePlanIndex(state, 1);
		state.recordArtifact("init", ["README.md"]);
		state.recordRunSelfAttack("checked edge cases");
		const cp = state.toCheckpoint("running", 0);
		expect(cp.planIndex).toBe(1);
		expect(cp.submittedArtifacts.init).toEqual(["README.md"]);
		expect(cp.runSelfAttack).toBe("checked edge cases");
		expect(cp.status).toBe("running");

		const restored = XddRunnerState.fromCheckpoint(cp);
		expect(restored.planIndex).toBe(1);
		expect(restored.runId).toBe("test");
		expect(restored.getSubmittedArtifacts()[0].paths).toEqual(["README.md"]);
		expect(restored.getRunSelfAttack()).toBe("checked edge cases");
	});

	it("persists flowRollbackCount across checkpoint (Layer 2)", () => {
		const state = makeState();
		startStateFixture(state);
		state.flowRollbackCount = 7;
		const cp = state.toCheckpoint("running", 0);
		expect(cp.flowRollbackCount).toBe(7);
		const restored = XddRunnerState.fromCheckpoint(cp);
		expect(restored.flowRollbackCount).toBe(7);
	});
});
