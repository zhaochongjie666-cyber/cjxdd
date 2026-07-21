import { describe, expect, it } from "vitest";
import { transition, ControllerError } from "../core/controller.ts";
import type { RuntimeStateV2 } from "../storage/runtime-migrations.ts";

function verifyState(): RuntimeStateV2 {
	const state = transition({} as RuntimeStateV2, { type: "START", task: "heal", options: { cwd: "/tmp/nonexistent-xdd-healing", runId: "healing", initialStage: "verify" } }).state;
	state.maxRollbacksPerStage = 7;
	return state;
}

describe("verify rollback healing flow", () => {
	it("requires closure before leaving owner stage and fresh receipt before closing", () => {
		let state = transition(verifyState(), { type: "ROLLBACK", target: "execute", reason: "trace missing", failure: { code: "TRACE_GAP", gateKind: "hard_gate", summary: "R04 missing", reason: "trace missing", files: ["src/a.ts"], remediation: "implement R04" }, ownerScopes: ["src/**"], closureCriteria: ["trace green"] }).state;
		const id = state.activeHealingCaseId!;
		expect(() => transition(state, { type: "ADVANCE" })).toThrowError(ControllerError);
		state = transition(state, { type: "RECORD_HEALING_CLOSURE", caseId: id, closure: { submittedAt: new Date().toISOString(), stage: "execute", changedPaths: ["src/a.ts"], ownerScopeDigest: "sha256:new", commands: ["test"], evidencePaths: ["evidence.md"], summary: "implemented and attacked R04 fallback" } }).state;
		expect(state.healingCases[0].status).toBe("ready-for-reverify");
		state.planIndex = state.plan.findIndex((entry) => entry.stageName === "verify");
		expect(() => transition(state, { type: "ADVANCE" })).toThrow(/VerifyReceipt/);
		state = transition(state, { type: "RECORD_VERIFY_RECEIPT", receipt: { generation: state.verifyGeneration, healingCaseId: id, capturedAt: new Date().toISOString(), productionDigest: "sha256:p", designDigest: "sha256:d", planDigest: "sha256:l", commands: [{ command: "test", exitCode: 0, outputDigest: "sha256:o" }] } }).state;
		state = transition(state, { type: "ADVANCE" }).state;
		expect(state.healingCases[0].status).toBe("closed");
		expect(state.activeHealingCaseId).toBeUndefined();
	});

	it("keeps lifetime rollback history and accumulates recurrence for the same signature", () => {
		let state = verifyState();
		const command = { type: "ROLLBACK" as const, target: "execute" as const, reason: "same trace failure", failure: { code: "TRACE_GAP", gateKind: "hard_gate" as const, summary: "trace", reason: "same trace failure", files: ["src/a.ts"], remediation: "fix trace" } };
		state = transition(state, command).state;
		state.planIndex = state.plan.findIndex((entry) => entry.stageName === "verify");
		state = transition(state, command).state;
		expect(state.flowRollbackCount).toBe(2);
		expect(state.lifetimeRollbackCount).toBe(2);
		expect(state.healingCases[1].recurrenceCount).toBe(2);
		expect(state.healingCases[0].status).toBe("abandoned");
	});
});
