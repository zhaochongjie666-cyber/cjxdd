import { describe, expect, it } from "vitest";
import { compileStageContracts } from "../xdd/core/stage-contract.ts";
import { NF_STAGES } from "./stages.ts";
import { NF_STAGE_NAMES } from "./types.ts";

describe("Normal Flow stage contracts", () => {
	it("has exactly the 5 NF stages in order, reusing xdd stage names", () => {
		expect(NF_STAGES.map((s) => s.name)).toEqual([...NF_STAGE_NAMES]);
	});

	it("passes compileStageContracts (inputs/outputs/hardGate/rollbackPolicy all populated)", () => {
		expect(() => compileStageContracts(NF_STAGES)).not.toThrow();
	});

	it("explore (understand) rolls back to none, not to a nonexistent init stage", () => {
		const explore = NF_STAGES.find((s) => s.name === "understand");
		expect(explore?.rollbackPolicy?.target).toBe("none");
	});

	it("plan rolls back to spec (NF has no architecture/wire/resilience stages)", () => {
		const plan = NF_STAGES.find((s) => s.name === "plan");
		expect(plan?.rollbackPolicy?.target).toBe("spec");
	});

	it("verify rolls back to execute (implement), matching xdd's convention", () => {
		const verify = NF_STAGES.find((s) => s.name === "verify");
		expect(verify?.rollbackPolicy?.target).toBe("execute");
	});

	it("every stage has a non-empty aigateStandard placeholder and does not enable AIGate", () => {
		for (const stage of NF_STAGES) {
			expect(stage.aigateStandard.length).toBeGreaterThan(0);
			expect(stage.aiGate?.enabled).not.toBe(true);
		}
	});

	it("every stage's required outputs are covered by its writeScopes", () => {
		// compileStageContracts() already asserts this and would throw above if
		// violated; this test pins the specific stages most likely to regress.
		const explore = NF_STAGES.find((s) => s.name === "understand");
		expect(explore?.writeScopes).toContain(".xdd/design/**");
		const verify = NF_STAGES.find((s) => s.name === "verify");
		expect(verify?.writeScopes).toContain(".xdd/runs/**/verify-report.md");
	});
});
