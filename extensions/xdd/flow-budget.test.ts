import { describe, expect, it } from "vitest";
import { assistantFlowUsage, configuredFlowBudgetUsd, DEFAULT_FLOW_BUDGET_USD } from "./flow-budget.ts";

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
});
