import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type EmptyDetails, type GetXddState, ok } from "./index.ts";

const schema = Type.Object({
	stageScope: Type.Optional(Type.Union([Type.Literal("current"), Type.Literal("all")], { description: "阶段预算重置范围；默认 current。" })),
	resetFlowRollback: Type.Optional(Type.Boolean({ description: "是否显式恢复流程回退 allowance；默认 false。" })),
	reason: Type.String({ minLength: 20, description: "人工恢复原因（至少 20 字符），写入不可删除审计。" }),
	acknowledgeRisk: Type.Optional(Type.Boolean({ description: "恢复流程回退 allowance 时必须为 true。" })),
});

export function createXddResetBudgetTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_reset_budget",
		label: "xdd: reset flow and stage budgets",
		description: "安全重置 flow usage 与阶段预算。默认不恢复流程回退 allowance；显式恢复需要风险确认且不能存在 active HealingCase。",
		parameters: schema,
		async execute(_toolCallId: string, params: { stageScope?: "current" | "all"; resetFlowRollback?: boolean; reason?: string; acknowledgeRisk?: boolean }): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			if (!params?.reason || params.reason.trim().length < 20) throw new Error("[xdd_reset_budget] reason 至少需要 20 个字符，以便审计和人工恢复。");
			const stage = state.currentStage();
			if (!stage) throw new Error("[xdd_reset_budget] 无活跃阶段");
			const previousFlowRollbackCount = state.flowRollbackCount;
			const beforeFlowRollback = `${state.remainingFlowRollbackBudget()}/${state.flowRollbackLimit}`;
			const beforeFlowUsage = `$${state.flowCostUsd.toFixed(2)} / $${state.flowBudgetUsd.toFixed(2)} (${state.flowTokensUsed} tokens)`;
			const scope = params.stageScope ?? "current";
			state.resetFlowBudgetUsage();
			if (params.resetFlowRollback) {
				if (!params.acknowledgeRisk) throw new Error("[xdd_reset_budget] 重置流程回退预算必须 acknowledgeRisk=true；请确认会开启新的 rollback allowance。");
				if (state.hasActiveHealingCase()) throw new Error("[xdd_reset_budget] active HealingCase 尚未关闭，拒绝重置流程回退预算；请先按 xdd_next_task 完成定向修复和复验。");
				state.resetFlowRollbackBudget();
			}
			state.recordBudgetReset(params.reason.trim(), previousFlowRollbackCount);
			if (scope === "all") state.resetAllStageBudgets();
			else state.resetSelfHealBudget(stage.name);
			return ok([
				`[xdd_reset_budget] 已重置预算（阶段范围: ${scope}）。`,
				`流程用量预算: ${beforeFlowUsage} -> $${state.flowCostUsd.toFixed(2)} / $${state.flowBudgetUsd.toFixed(2)} (${state.flowTokensUsed} tokens)`,
				`流程回退预算: ${beforeFlowRollback} -> ${state.remainingFlowRollbackBudget()}/${state.flowRollbackLimit}（${params.resetFlowRollback ? "已显式恢复" : "默认保留"}；lifetime 历史不清零）`,
				`阶段预算(${scope === "all" ? "全部阶段" : stage.name}): hard-Gate/AIGate 已重置。`,
			].join("\n"));
		},
	};
}
