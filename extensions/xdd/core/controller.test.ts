import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeStore } from "../storage/runtime-store.ts";
import { STAGES } from "../stages.ts";
import { COMPACTION_THRESHOLD_PERCENT, transition, XddController, schedulerText, ControllerError } from "./controller.ts";
import type { RuntimeStateV2 } from "../storage/runtime-migrations.ts";

function started(): RuntimeStateV2 {
	return transition({} as RuntimeStateV2, { type: "START", task: "build", options: { cwd: "/tmp/x", runId: "r1" } }).state;
}

describe("XddController transition", () => {
	it("START creates a running v2 runtime and kickoff effects", () => {
		const result = transition({} as RuntimeStateV2, { type: "START", task: "build", options: { cwd: "/tmp/x", runId: "r1" } });
		expect(result.state.schemaVersion).toBe(3);
		expect(result.state.status).toBe("running");
		expect(result.state.planIndex).toBe(0);
		expect(result.effects.map((effect) => effect.type)).toEqual(["SET_ACTIVE_TOOLS", "SEND_FOLLOWUP"]);
	});

	it("START can choose an observable initial stage", () => {
		const result = transition({} as RuntimeStateV2, { type: "START", task: "t", options: { cwd: "/tmp/x", runId: "r-start", initialStage: "understand" } });
		expect(result.state.planIndex).toBe(1);
		expect(result.state.stageEpoch).toBe("r-start:understand:0");
		expect(result.effects[0]).toMatchObject({ type: "SET_ACTIVE_TOOLS" });
		expect(result.effects[1]?.type === "SEND_FOLLOWUP" ? result.effects[1].text : "").toContain("understand");
	});

	it("STOP is idempotent and notifies only once", () => {
		const first = transition(started(), { type: "STOP", source: "command" });
		expect(first.state.paused).toBe(true);
		expect(first.effects.map((effect) => effect.type)).toEqual(["ABORT_AGENT", "NOTIFY"]);
		const second = transition(first.state, { type: "STOP", source: "command" });
		expect(second.effects).toHaveLength(0);
	});

	it("provider errors do not queue followups and make Pi retry ownership visible", () => {
		const result = transition(started(), { type: "AGENT_ENDED", stopReason: "error", providerError: "rate limit" });
		expect(result.state.stageOutcome).toBe("provider_error");
		expect(result.effects).toEqual([expect.objectContaining({ type: "NOTIFY", text: expect.stringContaining("等待 Pi 内建重试") })]);
	});

	it("SUBMIT records pass/fail outcomes through the Controller", () => {
		const failed = transition(started(), {
			type: "SUBMIT",
			submission: { summary: "s", artifacts: [], selfAttack: "specific risk note", pass: false, error: "missing output" },
		});
		expect(failed.state.stageOutcome).toBe("hard_gate_failed");
		expect(failed.state.lastStageError).toBe("missing output");
		const passed = transition(failed.state, {
			type: "SUBMIT",
			submission: { summary: "s", artifacts: [], selfAttack: "specific risk note", pass: true },
		});
		expect(passed.state.stageOutcome).toBe("gate_passed");
	});

	it("record commands persist artifact review, signals, and ESG audit nodes", () => {
		let state = started();
		state = transition(state, { type: "RECORD_ARTIFACT_REVIEW", stage: "init", artifacts: [".xdd/design/intent.md"], selfAttack: "specific risk note for audit" }).state;
		expect(state.submittedArtifacts?.init).toEqual([".xdd/design/intent.md"]);
		expect(state.selfAttackNotes?.init).toBe("specific risk note for audit");
		expect(state.stageEpoch).toBe("r1:init:0");
		expect(state.esg?.at(-1)).toMatchObject({ type: "review", stage: "init" });
		state = transition(state, { type: "RECORD_SIGNAL", signal: "complete" }).state;
		state = transition(state, { type: "RECORD_SIGNAL", signal: "complete" }).state;
		expect(state.signals).toEqual(["complete"]);
		state = transition(state, { type: "RECORD_ESG", nodeType: "task", stage: "init", label: "next task" }).state;
		expect(state.esg?.at(-1)).toMatchObject({ type: "task", stage: "init", label: "next task" });
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

	it("queues an advance followup when a terminating gate tool ends with toolUse", () => {
		const state = started();
		state.stageOutcome = "gate_passed";
		const result = transition(state, { type: "AGENT_ENDED", stopReason: "toolUse" });
		expect(result.state.continuationQueued).toBe(true);
		expect(result.effects[0]).toMatchObject({ type: "SEND_FOLLOWUP" });
		expect(result.effects[0]?.type === "SEND_FOLLOWUP" ? result.effects[0].text : "").toContain("xdd_advance");
	});

	it("does not schedule while an ordinary toolUse turn is still working", () => {
		const result = transition(started(), { type: "AGENT_ENDED", stopReason: "toolUse" });
		expect(result.effects).toHaveLength(0);
		expect(result.state.continuationQueued).toBe(false);
	});


	it("high context usage requests compaction before continuation", () => {
		const state = started();
		state.stageOutcome = "gate_passed";
		const result = transition(state, { type: "AGENT_ENDED", stopReason: "stop", contextUsagePercent: 71 });
		expect(result.effects[0]).toMatchObject({ type: "COMPACT" });
		expect(result.effects[0]?.type === "COMPACT" ? result.effects[0].instructions : "").toContain("tool_call 与 tool result 配对");
		expect(result.state.continuationQueued).toBeFalsy();
		expect(result.state.lastCompactionAt).toBeGreaterThan(0);
	});

	it("does not compact a short session when Pi reports fractional usage", () => {
		const state = started();
		state.stageOutcome = "gate_passed";
		const result = transition(state, { type: "AGENT_ENDED", stopReason: "stop", contextUsagePercent: 0.72 });
		expect(COMPACTION_THRESHOLD_PERCENT).toBe(70);
		expect(result.effects[0]).toMatchObject({ type: "SEND_FOLLOWUP" });
	});

	it("recent compaction does not loop and queues the normal continuation", () => {
		const state = started();
		state.stageOutcome = "gate_passed";
		state.lastCompactionAt = Date.now();
		const result = transition(state, { type: "AGENT_ENDED", stopReason: "stop", contextUsagePercent: 99 });
		expect(result.effects[0]).toMatchObject({ type: "SEND_FOLLOWUP" });
		expect(result.state.continuationQueued).toBe(true);
	});


	it("COMPACTION_DONE queues continuation even when compaction failed", () => {
		const state = started();
		state.stageOutcome = "gate_passed";
		const result = transition(state, { type: "COMPACTION_DONE", success: false });
		expect(result.effects[0]).toMatchObject({ type: "SEND_FOLLOWUP" });
		expect(result.state.continuationQueued).toBe(true);
	});

	it("ADVANCE moves standard understand -> spec without a confirmation pause", () => {
		const state = started();
		state.planIndex = 1; // understand
		const result = transition(state, { type: "ADVANCE" });
		expect(result.state.status).toBe("running");
		expect(result.state.planIndex).toBe(2);
		expect(result.state.stageOutcome).toBe("advanced");
	});

	it("APPROVE moves past an awaiting human approval without looping", () => {
		const state = started();
		state.planIndex = 1; // understand
		state.status = "awaiting_approval";
		state.pendingGroupApproval = { group: "understand", gateLabel: "fixture approval" };
		const approved = transition(state, { type: "APPROVE", approvalId: "understand" });
		expect(approved.state.status).toBe("running");
		expect(approved.state.planIndex).toBe(2);
		expect(approved.state.stageOutcome).toBe("advanced");
	});

	it("ROLLBACK rejects non-earlier targets", () => {
		const state = started();
		expect(() => transition(state, { type: "ROLLBACK", target: "verify", reason: "bad" })).toThrow(ControllerError);
	});

	it("ROLLBACK moves to an earlier stage and stamps the target epoch", () => {
		const state = started();
		state.planIndex = 3; // architecture
		const result = transition(state, { type: "ROLLBACK", target: "spec", reason: "redo spec" });
		expect(result.state.planIndex).toBe(2);
		expect(result.state.rollbackOutcome).toMatchObject({ from: "architecture", to: "spec" });
		expect(result.state.stageOutcome).toBe("advanced");
		expect(result.state.stageEpoch).toContain(":spec:");
	});
	it("ROLLBACK resets target stage attempt counters and fingerprints", () => {
		const state = started();
		state.planIndex = 3; // architecture
		state.selfHealUsed = { spec: 4 };
		state.aiGateUsed = { spec: 2 };
		state.lastSubmitFingerprint = { spec: "same-files" };
		const result = transition(state, { type: "ROLLBACK", target: "spec", reason: "retry with fresh budget" });
		expect(result.state.selfHealUsed.spec).toBe(0);
		expect(result.state.aiGateUsed?.spec).toBe(0);
		expect(result.state.lastSubmitFingerprint?.spec).toBeUndefined();
	});

	it("ROLLBACK enforces a controller-owned per-target limit for every caller", () => {
		let state = started();
		state.maxRollbacksPerStage = 2;
		state.planIndex = 3; // architecture
		state = transition(state, { type: "ROLLBACK", target: "spec", reason: "first" }).state;
		expect(state.rollbackAttempts?.spec).toBe(1);
		state.planIndex = 3; // simulate re-entering architecture after repair
		state = transition(state, { type: "ROLLBACK", target: "spec", reason: "second" }).state;
		expect(state.rollbackAttempts?.spec).toBe(2);
		state.planIndex = 3;
		expect(() => transition(state, { type: "ROLLBACK", target: "spec", reason: "third" }))
			.toThrow(/ROLLBACK_LIMIT_REACHED|reached its limit/);
	});

	it("consumes the single flow rollback budget on rollbacks 1 through 7", () => {
		let state = started();
		state.maxRollbacksPerStage = 20;
		for (let attempt = 1; attempt <= 7; attempt += 1) {
			state.planIndex = 3; // architecture; the controller must own each increment
			state = transition(state, { type: "ROLLBACK", target: "spec", reason: `retry ${attempt}` }).state;
			expect(state.flowRollbackLimit).toBe(7);
			expect(state.flowRollbackCount).toBe(attempt);
			expect(state.status).toBe("running");
		}
	});

	it("terminates the runtime instead of allowing an eighth flow rollback", () => {
		const state = started();
		state.planIndex = 3;
		state.maxRollbacksPerStage = 20;
		state.flowRollbackCount = 7;
		state.continuationQueued = true;
		const result = transition(state, { type: "ROLLBACK", target: "spec", reason: "eighth retry" });
		expect(result.state.flowRollbackCount).toBe(7);
		expect(result.state.status).toBe("failed");
		expect(result.state.stageOutcome).toBe("failed");
		expect(result.state.continuationQueued).toBe(false);
		expect(result.state.lastStageError).toContain("流程预算耗尽，流程退出");
		expect(result.effects).toEqual([expect.objectContaining({ type: "NOTIFY", text: expect.stringContaining("流程预算耗尽，流程退出") })]);
	});

	it("applies the flow budget to a group Gate's automatic ROLLBACK command", () => {
		const state = started();
		state.planIndex = 2; // spec, whose discovery group rolls back to init
		state.flowRollbackCount = 7;
		const result = transition(state, { type: "ROLLBACK", target: "init", reason: "Gate 1 failed" });
		expect(result.state.status).toBe("failed");
		expect(result.state.planIndex).toBe(2);
		expect(result.state.lastStageError).toContain("流程预算耗尽，流程退出");
	});

	it("RELEASE_CONTINUATION clears a persisted continuation lock", () => {
		const state = started();
		state.continuationQueued = true;
		state.continuationReason = "idle";
		state.continuationStage = "init";
		const result = transition(state, { type: "RELEASE_CONTINUATION", reason: "send failed" });
		expect(result.state.continuationQueued).toBe(false);
		expect(result.state.continuationReason).toBeNull();
		expect(result.state.continuationStage).toBeNull();
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
