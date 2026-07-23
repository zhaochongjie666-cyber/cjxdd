import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canSoftPassExhaustedStage, NF_MAX_FLOW_RETRIES, NF_MAX_SELF_HEAL_PER_STAGE } from "./policy.ts";
import { NF_STAGES } from "./stages.ts";
import { XddRunnerState } from "./types.ts";

describe("Normal Flow prototype-to-iteration policy", () => {
	it("uses three local attempts and eight complete-flow retries", () => {
		const cwd = mkdtempSync(join(tmpdir(), "nf-policy-"));
		try {
			const state = new XddRunnerState({ runId: "nf-policy", cwd, userInput: "先做原型再迭代" });
			state.plan = NF_STAGES.map((stage, originalIndex) => ({ stage, originalIndex }));
			state.maxSelfHealPerStage = NF_MAX_SELF_HEAL_PER_STAGE;
			state.flowRollbackLimit = NF_MAX_FLOW_RETRIES;
			state.maxRollbacksPerStage = NF_MAX_FLOW_RETRIES;

			expect(state.maxSelfHealPerStage).toBe(3);
			expect(state.flowRollbackLimit).toBe(8);
			expect(state.maxRollbacksPerStage).toBe(8);
			expect(state.plan.map(({ stage }) => stage.name)).toEqual(["understand", "architecture", "spec", "verify"]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("never soft-passes an exhausted design gate", () => {
		expect(canSoftPassExhaustedStage("understand")).toBe(false);
		expect(canSoftPassExhaustedStage("architecture")).toBe(true);
		expect(canSoftPassExhaustedStage("spec")).toBe(true);
		expect(canSoftPassExhaustedStage("verify")).toBe(false);
	});

	it("keeps the forward stages one-way and exposes rollback only from verify", () => {
		expect(NF_STAGES.map((stage) => stage.rollbackPolicy?.target)).toEqual([
			"none", "understand", "architecture", "spec",
		]);
		expect(NF_STAGES.slice(0, 3).every((stage) => stage.name !== "verify")).toBe(true);
		expect(NF_STAGES[3]?.name).toBe("verify");
	});
});
