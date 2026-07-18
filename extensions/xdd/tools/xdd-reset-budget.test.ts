import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStateFixture, startStateFixture } from "../test/state-fixture.ts";
import { createXddResetBudgetTool } from "./xdd-reset-budget.ts";

let dirCounter = 0;
function tmpCwd(): string {
	return mkdtempSync(join(tmpdir(), `xdd-reset-budget-${Date.now()}-${dirCounter++}-`));
}

describe("xdd_reset_budget", () => {
	it("resets flow usage, flow rollback, and current stage budgets", async () => {
		const state = createStateFixture({ runId: "reset", cwd: tmpCwd(), userInput: "test" });
		startStateFixture(state, "spec");
		state.recordFlowUsage([{ timestamp: 1, tokens: 1000, costUsd: 1.23 }]);
		expect(state.consumeFlowRollbackBudget()).toBe(true);
		state.beginSelfHealAttempt("spec");
		state.beginAiGateAttempt("spec");
		state.beginSelfHealAttempt("understand");

		const tool = createXddResetBudgetTool(() => state);
		const result = await tool.execute({});

		expect(result.content[0]?.type).toBe("text");
		expect(result.content[0]?.text).toContain("已重置预算");
		expect(state.flowCostUsd).toBe(0);
		expect(state.flowTokensUsed).toBe(0);
		expect(state.remainingFlowRollbackBudget()).toBe(state.flowRollbackLimit);
		expect(state.remainingSelfHealBudget("spec")).toBe(state.maxSelfHealPerStage);
		expect(state.remainingAiGateBudget("spec")).toBe(state.maxSelfHealPerStage);
		expect(state.remainingSelfHealBudget("understand")).toBe(state.maxSelfHealPerStage - 1);
	});

	it("can reset all stage budgets", async () => {
		const state = createStateFixture({ runId: "reset-all", cwd: tmpCwd(), userInput: "test" });
		startStateFixture(state, "spec");
		state.beginSelfHealAttempt("spec");
		state.beginAiGateAttempt("understand");

		const tool = createXddResetBudgetTool(() => state);
		await tool.execute({ stageScope: "all" });

		expect(state.remainingSelfHealBudget("spec")).toBe(state.maxSelfHealPerStage);
		expect(state.remainingAiGateBudget("understand")).toBe(state.maxSelfHealPerStage);
	});
});
