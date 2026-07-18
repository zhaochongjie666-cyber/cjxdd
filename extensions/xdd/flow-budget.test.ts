import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assistantFlowUsage, configuredFlowBudgetUsd, DEFAULT_FLOW_BUDGET_USD } from "./flow-budget.ts";
import { XddRunnerState } from "./types.ts";

describe("flow budget", () => {
	it("defaults to a $500 whole-flow cap and accepts an override", () => {
		expect(configuredFlowBudgetUsd({})).toBe(DEFAULT_FLOW_BUDGET_USD);
		expect(configuredFlowBudgetUsd({ XDD_FLOW_BUDGET_USD: "75.5" })).toBe(75.5);
	});

	it("rejects invalid configured limits", () => {
		expect(() => configuredFlowBudgetUsd({ XDD_FLOW_BUDGET_USD: "0" })).toThrow("XDD_FLOW_BUDGET_USD");
	});

	it("extracts only billable assistant usage", () => {
		expect(assistantFlowUsage([
			{ role: "user", timestamp: 1 },
			{ role: "assistant", timestamp: 2, usage: { totalTokens: 120, cost: { total: 0.42 } } },
		])).toEqual([{ timestamp: 2, tokens: 120, costUsd: 0.42 }]);
	});
	it("resets consumed flow usage for explicit /xdd-continue", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-flow-budget-"));
		try {
			const state = new XddRunnerState({ runId: "budget-reset", cwd, userInput: "t" });
			state.recordFlowUsage([{ timestamp: 1, tokens: 100, costUsd: 12.5 }]);

			state.resetFlowBudgetUsage();

			expect(state.flowCostUsd).toBe(0);
			expect(state.flowTokensUsed).toBe(0);
			state.recordFlowUsage([{ timestamp: 1, tokens: 100, costUsd: 12.5 }]);
			expect(state.flowCostUsd).toBe(12.5);
			expect(state.flowTokensUsed).toBe(100);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

});
