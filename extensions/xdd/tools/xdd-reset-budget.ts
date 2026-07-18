import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type EmptyDetails, type GetXddState, ok } from "./index.ts";

const schema = Type.Object({
	stageScope: Type.Optional(Type.Union([Type.Literal("current"), Type.Literal("all")], { description: "阶段预算重置范围；默认 current。" })),
});

export function createXddResetBudgetTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_reset_budget",
		label: "xdd: reset flow and stage budgets",
		description: "重置 xdd 预算：清零流程用量预算、流程回退预算，并重置当前阶段或全部阶段的 hard-Gate/AIGate 自愈预算。",
		parameters: schema,
		async execute(params: { stageScope?: "current" | "all" } = {}): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			const stage = state.currentStage();
			if (!stage) throw new Error("[xdd_reset_budget] 无活跃阶段");
			const beforeFlowRollback = `${state.remainingFlowRollbackBudget()}/${state.flowRollbackLimit}`;
			const beforeFlowUsage = `$${state.flowCostUsd.toFixed(2)} / $${state.flowBudgetUsd.toFixed(2)} (${state.flowTokensUsed} tokens)`;
			const scope = params.stageScope ?? "current";
			state.resetFlowBudgetUsage();
			state.resetFlowRollbackBudget();
			if (scope === "all") state.resetAllStageBudgets();
			else state.resetSelfHealBudget(stage.name);
			return ok([
				`[xdd_reset_budget] 已重置预算（阶段范围: ${scope}）。`,
				`流程用量预算: ${beforeFlowUsage} -> $${state.flowCostUsd.toFixed(2)} / $${state.flowBudgetUsd.toFixed(2)} (${state.flowTokensUsed} tokens)`,
				`流程回退预算: ${beforeFlowRollback} -> ${state.remainingFlowRollbackBudget()}/${state.flowRollbackLimit}`,
				`阶段预算(${scope === "all" ? "全部阶段" : stage.name}): hard-Gate/AIGate 已重置。`,
			].join("\n"));
		},
	};
}
