import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../../core/extensions/types.ts";
import type { XddRunnerState } from "../types.ts";
import { type EmptyDetails, type GetXddState, ok } from "./index.ts";

const schema = Type.Object({
	summary: Type.Optional(Type.String({ description: "简述本阶段完成内容与产物路径" })),
});

export type XddGoalCompleteInput = Static<typeof schema>;

/**
 * xdd_goal_complete: declares the current stage complete; runs the hard gate
 * (reconcile-style against the stage's desiredState). Self-heal aware:
 * each call increments the per-stage self-heal budget; once exhausted, the
 * tool refuses and tells the model to call xdd_diagnose to enter reflection.
 */
export function createXddGoalCompleteTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_goal_complete",
		label: "xdd: complete stage",
		description:
			"声明当前 xdd 阶段完成（reconcile）。调用后会执行 desiredState gate；未达标会被拒绝，可在本阶段内重试修复至自愈预算耗尽。预算耗尽后请调用 xdd_diagnose 进入反思。",
		parameters: schema,
		async execute(_toolCallId, params: XddGoalCompleteInput): Promise<AgentToolResult<EmptyDetails>> {
			const state: XddRunnerState = getState();
			const stage = state.currentStage();
			if (!stage) {
				throw new Error("[xdd] 无活跃阶段");
			}
			const summary = String(params.summary ?? "");
			// reconcile self-heal: record this gate attempt against the budget.
			const used = state.beginSelfHealAttempt(stage.name);
			const remaining = state.remainingSelfHealBudget(stage.name);
			const gate = await stage.gate({ cwd: state.cwd, summary, desiredState: stage.desiredState });
			if (!gate.ok) {
				if (remaining <= 0) {
					throw new Error(
						`[xdd_goal_complete] ${stage.name} 自愈预算耗尽（已试 ${used} / ${state.maxSelfHealPerStage} 次）：${gate.reason ?? "未知原因"}。请调用 xdd_diagnose 进入反思 / 回退。`,
					);
				}
				throw new Error(
					`[hard gate · attempt ${used}/${state.maxSelfHealPerStage}] ${stage.name} 产物未达标：${gate.reason ?? "未知原因"}\n请补齐后重试。剩余自愈预算：${remaining}。`,
				);
			}
			state.recordSignal("complete");
			return ok(
				`${stage.name} 阶段完成${gate.soft ? "（软通过）" : ""}：${summary}\n剩余自愈预算：${remaining}/${state.maxSelfHealPerStage}`,
			);
		},
	};
}
