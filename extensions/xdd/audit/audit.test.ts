import { describe, expect, it } from "vitest";
import { transition } from "../core/controller.ts";
import { buildAuditView, projectAuditEvent, renderAuditView } from "./projector.ts";

describe("audit projector", () => {
	it("projects gate results into ledger and ESG", () => {
		const state = transition({} as any, { type: "START", task: "t", options: { cwd: "/tmp/x", runId: "audit" } }).state;
		projectAuditEvent(state, { type: "gate_result", stage: "init", stageIndex: 0, passed: false, artifacts: [".xdd/design/intent.md"], reason: "missing" });
		expect(state.ledger.at(-1)).toMatchObject({ stage: "init", status: "fail", artifacts: [".xdd/design/intent.md"] });
		expect(state.esg.at(-1)).toMatchObject({ type: "finding", stage: "init" });
	});

	it("projects command rejection and effect failure as findings", () => {
		const state = transition({} as any, { type: "START", task: "t", options: { cwd: "/tmp/x", runId: "audit2" } }).state;
		projectAuditEvent(state, { type: "command_rejected", command: "ROLLBACK", stage: "spec", code: "INVALID_ROLLBACK", message: "bad" });
		projectAuditEvent(state, { type: "effect_fail", effect: "SEND_FOLLOWUP", stage: "spec", message: "closed" });
		expect(state.esg.at(-2)).toMatchObject({ type: "finding", stage: "spec", label: "command rejected: ROLLBACK" });
		expect(state.esg.at(-1)).toMatchObject({ type: "finding", stage: "spec", label: "effect failed: SEND_FOLLOWUP" });
	});

	it("renders a unified audit view with last gate code/message", () => {
		const state = transition({} as any, { type: "START", task: "t", options: { cwd: "/tmp/x", runId: "audit3" } }).state;
		projectAuditEvent(state, { type: "gate_result", stage: "verify", stageIndex: 9, passed: false, reason: "TRACE_GAP: spec RXX missing" });
		const text = renderAuditView(buildAuditView(state));
		expect(text).toContain("Audit: ledger=1 active");
		expect(text).toContain("Audit last gate: gate fail: verify");
		expect(text).toContain("TRACE_GAP: spec RXX missing");
	});
	it("projects task_result as a task ESG node", () => {
		const state = transition({} as any, { type: "START", task: "t", options: { cwd: "/tmp/x", runId: "audit4" } }).state;
		projectAuditEvent(state, { type: "task_result", stage: "verify", action: "run harness", met: 3, unmet: 1 });
		expect(state.esg.at(-1)).toMatchObject({ type: "task", stage: "verify" });
		expect(state.esg.at(-1)?.label).toContain("run harness");
	});

});
