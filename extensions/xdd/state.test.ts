import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STAGES } from "./stages.ts";
import { XddRunnerState } from "./types.ts";

/** Each state gets its own temp dir so file-backed state doesn't collide. */
let dirCounter = 0;
function tmpCwd(): string {
	return mkdtempSync(join(tmpdir(), `xdd-test-${Date.now()}-${dirCounter++}-`));
}

function makeState(): XddRunnerState {
	const state = new XddRunnerState({ runId: "test", cwd: tmpCwd(), userInput: "test" });
	state.plan = STAGES.map((stage, originalIndex) => ({ stage, originalIndex }));
	return state;
}

describe("XddRunnerState basics", () => {
	it("starts at planIndex -1", () => {
		const state = new XddRunnerState({ runId: "t", cwd: tmpCwd(), userInput: "u" });
		expect(state.planIndex).toBe(-1);
	});

	it("startRun sets planIndex to 0", () => {
		const state = makeState();
		state.startRun();
		expect(state.planIndex).toBe(0);
		expect(state.currentStage()?.name).toBe("init");
	});

	it("isLastStage detects final plan entry", () => {
		const state = makeState();
		state.startRun();
		state.planIndex = state.plan.length - 1;
		expect(state.isLastStage()).toBe(true);
	});
});

describe("XddRunnerState advancePlan", () => {
	it("moves to next stage", () => {
		const state = makeState();
		state.startRun();
		const next = state.advancePlan();
		expect(next?.name).toBe("understand");
		expect(state.planIndex).toBe(1);
	});

	it("returns undefined and sets runComplete at end", () => {
		const state = makeState();
		state.startRun();
		for (let i = 0; i < state.plan.length; i++) state.advancePlan();
		expect(state.runComplete).toBe(true);
	});
});

describe("XddRunnerState goToStageName", () => {
	it("rejects forward targets", () => {
		const state = makeState();
		state.startRun();
		state.advancePlan();
		const result = state.goToStageName("verify");
		expect(result.ok).toBe(false);
	});

	it("accepts backward targets", () => {
		const state = makeState();
		state.startRun();
		state.advancePlan();
		state.advancePlan();
		const result = state.goToStageName("init");
		expect(result.ok).toBe(true);
		expect(state.planIndex).toBe(0);
	});

	it("rejects unknown stage", () => {
		const state = makeState();
		state.startRun();
		const result = state.goToStageName("unknown" as never);
		expect(result.ok).toBe(false);
	});

	it("resets self-heal budget of the rollback target (Bug 3)", () => {
		const state = makeState();
		state.maxSelfHealPerStage = 3;
		state.startRun();
		state.advancePlan(); // -> understand
		state.advancePlan(); // -> spec
		// burn the budget for "init" before we got here
		state.beginSelfHealAttempt("init");
		state.beginSelfHealAttempt("init");
		state.beginSelfHealAttempt("init");
		expect(state.remainingSelfHealBudget("init")).toBe(0);
		// now rollback to init
		const result = state.goToStageName("init");
		expect(result.ok).toBe(true);
		expect(state.remainingSelfHealBudget("init")).toBe(3);
	});
});

describe("XddRunnerState flow rollback (Layer 2)", () => {
	it("defaults: tier1=5, tier2=10", () => {
		const state = new XddRunnerState({ runId: "t", cwd: tmpCwd(), userInput: "u" });
		expect(state.flowRollbackCount).toBe(0);
		expect(state.flowRollbackLimitTier1).toBe(5);
		expect(state.flowRollbackLimitTier2).toBe(10);
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

	it("records self-attack notes", () => {
		const state = makeState();
		state.recordSelfAttack("spec", "checked edge cases");
		expect(state.getSelfAttackNoteForStage("spec")).toBe("checked edge cases");
	});
});

describe("XddRunnerState checkpoint", () => {
	it("serializes to checkpoint and back", () => {
		const state = makeState();
		state.startRun();
		state.advancePlan();
		state.recordArtifact("init", ["README.md"]);
		state.recordSelfAttack("init", "checked edge cases");
		const cp = state.toCheckpoint("running", 0);
		expect(cp.planIndex).toBe(1);
		expect(cp.submittedArtifacts.init).toEqual(["README.md"]);
		expect(cp.selfAttackNotes.init).toBe("checked edge cases");
		expect(cp.status).toBe("running");

		const restored = XddRunnerState.fromCheckpoint(cp);
		expect(restored.planIndex).toBe(1);
		expect(restored.runId).toBe("test");
		expect(restored.getSubmittedArtifacts()[0].paths).toEqual(["README.md"]);
		expect(restored.getSelfAttackNoteForStage("init")).toBe("checked edge cases");
	});

	it("persists flowRollbackCount across checkpoint (Layer 2)", () => {
		const state = makeState();
		state.startRun();
		state.flowRollbackCount = 7;
		const cp = state.toCheckpoint("running", 0);
		expect(cp.flowRollbackCount).toBe(7);
		const restored = XddRunnerState.fromCheckpoint(cp);
		expect(restored.flowRollbackCount).toBe(7);
	});
});
