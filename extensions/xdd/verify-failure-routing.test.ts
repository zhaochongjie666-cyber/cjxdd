import { describe, expect, it } from "vitest";
import { MAX_FLOW_ROLLBACKS, transition } from "./core/controller.ts";
import type { RuntimeStateV2 } from "./storage/runtime-migrations.ts";
import { routeVerifyFailure } from "./verify-failure-routing.ts";

describe("verify failure routing", () => {
	it("routes Harness implementation failures to execute", () => {
		const route = routeVerifyFailure({ summary: "verify failed", failure: { code: "VERIFY_COMMAND_FAILED", message: "npm test failed", files: [".xdd/harness.yml"], remediation: "fix tests" } });
		expect(route.target).toBe("execute");
		expect(route.reason).toContain("VERIFY_COMMAND_FAILED");
		expect(routeVerifyFailure({ summary: "API endpoint /orders returns 404" }).target).toBe("execute");
	});

	it("routes rule gaps to spec", () => {
		expect(routeVerifyFailure({ summary: "规则缺口：验收标准没有定义退款边界" }).target).toBe("spec");
	});

	it("routes architecture and resilience gaps to their owning design stage", () => {
		expect(routeVerifyFailure({ summary: "architecture component boundary is missing" }).target).toBe("architecture");
		expect(routeVerifyFailure({ summary: "resilience timeout retry policy is missing" }).target).toBe("resilience");
	});

	it("uses execute as the safe default when no failure can be classified", () => {
		const route = routeVerifyFailure({ summary: "verification did not pass" });
		expect(route.target).toBe("execute");
		expect(route.reason).toContain("安全默认");
	});

	it("Controller terminates the run after the seven rollback budget is used", () => {
		let state = transition({} as RuntimeStateV2, { type: "START", task: "t", options: { cwd: "/tmp/x", runId: "route-budget", initialStage: "verify" } }).state;
		state.maxRollbacksPerStage = 99;
		for (let attempt = 1; attempt <= MAX_FLOW_ROLLBACKS; attempt++) {
			state = transition(state, { type: "ROLLBACK", target: "execute", reason: `failure ${attempt}` }).state;
			state.planIndex = 9; // simulate completing execute..verify before the next failed verdict
		}
		const exhausted = transition(state, { type: "ROLLBACK", target: "execute", reason: "failure 8" });
		expect(exhausted.state.flowRollbackCount).toBe(MAX_FLOW_ROLLBACKS);
		expect(exhausted.state.status).toBe("failed");
		expect(exhausted.state.stageOutcome).toBe("failed");
		expect(exhausted.state.lastStageError).toContain("预算耗尽");
	});
});
