import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStateFixture, startStateFixture } from "../test/state-fixture.ts";
import { createXddResetBudgetTool } from "./xdd-reset-budget.ts";
import { RuntimeStore } from "../storage/runtime-store.ts";

let dirCounter = 0;
function tmpCwd(): string {
	return mkdtempSync(join(tmpdir(), `xdd-reset-budget-${Date.now()}-${dirCounter++}-`));
}

describe("xdd_reset_budget", () => {
	it("resets usage and stage budgets without erasing rollback history by default", async () => {
		const state = createStateFixture({ runId: "reset", cwd: tmpCwd(), userInput: "test" });
		startStateFixture(state, "spec");
		state.recordFlowUsage([{ timestamp: 1, tokens: 1000, costUsd: 1.23 }]);
		expect(state.consumeFlowRollbackBudget()).toBe(true);
		state.beginSelfHealAttempt("spec");
		state.beginAiGateAttempt("spec");
		state.beginSelfHealAttempt("understand");

		const tool = createXddResetBudgetTool(() => state);
		const result = await tool.execute("reset", { reason: "人工恢复阶段预算但保留流程回退累计历史记录" });

		expect(result.content[0]?.type).toBe("text");
		expect(result.content[0]?.text).toContain("已重置预算");
		expect(state.flowCostUsd).toBe(0);
		expect(state.flowTokensUsed).toBe(0);
		expect(state.remainingFlowRollbackBudget()).toBe(state.flowRollbackLimit - 1);
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
		await tool.execute("reset", { stageScope: "all", reason: "人工恢复所有阶段预算并保留流程回退累计历史" });

		expect(state.remainingSelfHealBudget("spec")).toBe(state.maxSelfHealPerStage);
		expect(state.remainingAiGateBudget("understand")).toBe(state.maxSelfHealPerStage);
	});

	it("requires explicit risk acknowledgement for flow rollback recovery", async () => {
		const state = createStateFixture({ runId: "reset-risk", cwd: tmpCwd(), userInput: "test" });
		startStateFixture(state, "spec");
		state.consumeFlowRollbackBudget();
		const tool = createXddResetBudgetTool(() => state);
		await expect(tool.execute("reset", { resetFlowRollback: true, reason: "人工确认需要开启新的流程回退 allowance 继续恢复" })).rejects.toThrow(/acknowledgeRisk/);
		await tool.execute("reset", { resetFlowRollback: true, acknowledgeRisk: true, reason: "人工确认需要开启新的流程回退 allowance 继续恢复" });
		expect(state.remainingFlowRollbackBudget()).toBe(state.flowRollbackLimit);
		expect(state.toCheckpoint(state.status, state.rollbackCount).budgetResetHistory).toHaveLength(1);
	});

	it("rejects flow rollback recovery while a HealingCase is active", async () => {
		const state = createStateFixture({ runId: "reset-active", cwd: tmpCwd(), userInput: "test" });
		startStateFixture(state, "spec");
		new RuntimeStore(state.cwd).update((runtime) => { runtime.activeHealingCaseId = "HC-001"; });
		const tool = createXddResetBudgetTool(() => state);
		await expect(tool.execute("reset", { resetFlowRollback: true, acknowledgeRisk: true, reason: "人工确认风险但当前修复工作单仍处于未关闭状态" })).rejects.toThrow(/active HealingCase/);
	});
});
