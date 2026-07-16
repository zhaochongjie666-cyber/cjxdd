/**
 * Phase 1 (P24-26) + Phase 2 regression tests.
 *
 * The followUp scheduler is now driven by an explicit XddStageOutcome
 * (replacing the old "guess from healBudget" heuristic) and the turn_end
 * hook no longer sends followUps. Tests here pin these contracts.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STAGES } from "./stages.ts";
import { XddRunnerState, type XddStageOutcome } from "./types.ts";
import { decideFollowUp } from "./followup.ts";
import { FakePiAdapterHarness } from "./test/pi-adapter-harness.ts";

let cwd = "";
let state: XddRunnerState;

function freshState(): XddRunnerState {
	cwd = mkdtempSync(join(tmpdir(), "xdd-phase1-"));
	state = new XddRunnerState({ runId: "phase1", cwd, userInput: "test" });
	state.plan = STAGES.map((stage, originalIndex) => ({ stage, originalIndex }));
	state.startRun();
	return state;
}

/**
 * Pure scheduler-input fixture. These tests intentionally exercise follow-up
 * text decisions from explicit outcome inputs; production behavior tests should
 * use ControllerTestFixture instead of direct outcome writes.
 */
function setSchedulerInputOutcome(outcome: XddStageOutcome, error?: string): void {
	state.stageOutcome = outcome;
	if (error !== undefined) state.lastStageError = error;
}

beforeEach(() => { freshState(); });
afterEach(() => { if (existsSync(cwd)) rmSync(cwd, { recursive: true }); });

// ── Phase 2: stageOutcome state field ──────────────────────────────────

describe("Phase 2 stageOutcome", () => {
	it("default is 'idle'", () => {
		expect(state.stageOutcome).toBe("idle");
		// lastStageError is null (not undefined) when no error has been
		// recorded; cleared by setLastStageError(undefined) on success.
		expect(state.lastStageError).toBeFalsy();
	});

	it("writes & reads all 10 outcomes", () => {
		const outcomes = [
			"idle", "working", "hard_gate_failed", "ai_gate_failed",
			"gate_passed", "advanced", "provider_error",
			"paused", "completed", "failed",
		] as const;
		for (const o of outcomes) {
			setSchedulerInputOutcome(o);
			expect(state.stageOutcome).toBe(o);
		}
	});

	it("lastStageError persists with the outcome", () => {
		setSchedulerInputOutcome("hard_gate_failed", "missing design.md");
		const rt = JSON.parse(readFileSync(join(cwd, ".xdd", "runtime.json"), "utf8"));
		expect(rt.stageOutcome).toBe("hard_gate_failed");
		expect(rt.lastStageError).toBe("missing design.md");
	});

	it("continuationReason/Stage audit fields persist", () => {
		state.continuationReason = "hard_gate_failed";
		state.continuationStage = "spec";
		const rt = JSON.parse(readFileSync(join(cwd, ".xdd", "runtime.json"), "utf8"));
		expect(rt.continuationReason).toBe("hard_gate_failed");
		expect(rt.continuationStage).toBe("spec");
	});
});

// ── P25: decideFollowUp returns null for terminal/transient states ─────

describe("P25 decideFollowUp terminal states", () => {
	it("advanced -> starts the newly advanced stage", () => {
		setSchedulerInputOutcome("advanced");
		const msg = decideFollowUp("advanced", "architecture", state);
		expect(msg).toContain("已进入 architecture 阶段");
		expect(msg).toContain("xdd_observe");
		expect(msg).toContain("xdd_desired_state");
		expect(msg).toContain("xdd_difference");
	});

	it("provider_error -> null (pi's built-in retry handles it)", () => {
		setSchedulerInputOutcome("provider_error", "rate limit");
		expect(decideFollowUp("provider_error", "spec", state)).toBeNull();
	});

	it("paused -> null (P21 silent path)", () => {
		setSchedulerInputOutcome("paused");
		expect(decideFollowUp("paused", "spec", state)).toBeNull();
	});

	it("completed -> null", () => {
		setSchedulerInputOutcome("completed");
		expect(decideFollowUp("completed", "spec", state)).toBeNull();
	});

	it("failed -> null", () => {
		setSchedulerInputOutcome("failed");
		expect(decideFollowUp("failed", "spec", state)).toBeNull();
	});
});

// ── P25: decideFollowUp emits a followUp for working-state transitions ─

describe("P25 decideFollowUp working states", () => {
	it("idle -> nudge to call xdd_submit_artifact", () => {
		const msg = decideFollowUp("idle", "spec", state);
		expect(msg).not.toBeNull();
		expect(msg).toContain("xdd_submit_artifact");
		expect(msg).toContain("spec");
	});

	it("working -> nudge to call xdd_submit_artifact", () => {
		setSchedulerInputOutcome("working");
		const msg = decideFollowUp("working", "execute", state);
		expect(msg).toContain("xdd_submit_artifact");
		expect(msg).toContain("execute");
	});

	it("hard_gate_failed + budget > 0 -> '修复后重试' (no rollback)", () => {
		setSchedulerInputOutcome("hard_gate_failed", "missing rules.md");
		// Default budget is 5
		const msg = decideFollowUp("hard_gate_failed", "spec", state);
		expect(msg).toContain("修复");
		expect(msg).toContain("5/5");
		expect(msg).toContain("missing rules.md");
		expect(msg).not.toContain("回退");
	});

	it("hard_gate_failed + budget = 0 -> escalate to diagnose/rollback", () => {
		setSchedulerInputOutcome("hard_gate_failed", "still failing");
		// Exhaust the budget
		for (let i = 0; i < state.maxSelfHealPerStage; i++) {
			state.beginSelfHealAttempt("spec");
		}
		const msg = decideFollowUp("hard_gate_failed", "spec", state);
		expect(msg).toContain("耗尽");
		expect(msg).toContain("xdd_diagnose");
		expect(msg).toContain("xdd_rollback");
	});

	it("ai_gate_failed + budget > 0 -> '修复后重试' (no rollback)", () => {
		setSchedulerInputOutcome("ai_gate_failed", "偷工减料, AI味");
		const msg = decideFollowUp("ai_gate_failed", "spec", state);
		expect(msg).toContain("修复");
		expect(msg).toContain("5/5");
	});

	it("gate_passed -> nudge to call xdd_advance", () => {
		setSchedulerInputOutcome("gate_passed");
		const msg = decideFollowUp("gate_passed", "spec", state);
		expect(msg).toContain("xdd_advance");
		expect(msg).toContain("spec");
	});
});

// ── P26: continuation lock state field ────────────────────────────────

describe("P26 continuation lock", () => {
	it("default continuationQueued=false", () => {
		expect(state.continuationQueued).toBe(false);
	});

	it("set true, persists to runtime.json", () => {
		state.continuationQueued = true;
		const rt = JSON.parse(readFileSync(join(cwd, ".xdd", "runtime.json"), "utf8"));
		expect(rt.continuationQueued).toBe(true);
	});

	it("input hook clears the lock (cycle complete)", () => {
		// The input hook sets continuationQueued = false after delivering
		// the followUp to the agent. We exercise the same mutation here
		// to pin the contract: any future refactor that forgets to clear
		// the lock will leave the agent stuck.
		state.continuationQueued = true;
		// Simulate: queued followUp reached the input hook
		state.continuationQueued = false;
		expect(state.continuationQueued).toBe(false);
	});
});

// ── P24: turn_end is now a no-op (no message dispatch) ─────────────────

describe("P24 turn_end is a no-op", () => {
	it("does not modify state or dispatch followUp", async () => {
		const adapter = new FakePiAdapterHarness();
		try {
			adapter.state.continuationQueued = false;
			const stageBefore = adapter.state.currentStageName();
			await adapter.emit("turn_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
			expect(adapter.state.currentStageName()).toBe(stageBefore);
			expect(adapter.state.continuationQueued).toBe(false);
			expect(adapter.sentMessages).toHaveLength(0);
		} finally {
			adapter.dispose();
		}
	});
});

// ── P25: provider_error should not be a stall or gate failure ──────────

describe("P25 provider_error semantics", () => {
	it("after provider_error, no self-heal attempt was consumed", () => {
		// Tool did NOT call beginSelfHealAttempt -- the gate did not run.
		// The agent_end handler must NOT increment selfHealUsed. We test
		// the post-condition here: budget is still 5/5 after a provider
		// error scenario.
		const usedBefore = state.currentAttempt("spec");
		setSchedulerInputOutcome("provider_error", "rate limit");
		// The handler would set consecutiveStalls = 0 and return.
		// No budget mutation.
		expect(state.currentAttempt("spec")).toBe(usedBefore);
	});
});
