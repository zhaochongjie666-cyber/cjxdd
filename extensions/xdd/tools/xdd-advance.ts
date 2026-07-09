import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "../../core/extensions/types.ts";
import { type EmptyDetails, type GetXddState, ok } from "./index.ts";

const schema = Type.Object({});

/**
 * xdd_advance: the stage-transition primitive. The model calls this after a
 * stage's completion signal (xdd_goal_complete / xdd_verdict) has been recorded
 * and the deliverable gate has passed. On success it advances the shared state
 * to the next plan stage and terminates the turn so the host driver can swap in
 * the next stage's tool set + system prompt.
 *
 * If the completion signal is absent, it returns guidance (no termination) so
 * the model can recover in-turn.
 */
export function createXddAdvanceTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_advance",
		label: "xdd: advance to next stage",
		description:
			"推进 xdd 到下一阶段。前置：当前阶段须已调用 xdd_goal_complete / xdd_verdict(pass=true) 并通过闸门。成功即结束本阶段回合。",
		parameters: schema,
		async execute(): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			const stage = state.currentStage();
			if (!stage) {
				throw new Error("[xdd_advance] 无活跃阶段");
			}
			const signals = state.getSignals();
			const passed = stage.exit === "verdict" ? signals.has("verdict_pass") : signals.has("complete");
			if (!passed) {
				return ok(
					`[xdd_advance] 当前阶段 ${stage.name} 尚未声明完成：请先调用 ${
						stage.exit === "verdict" ? "xdd_verdict(pass=true)" : "xdd_goal_complete"
					} 并通过闸门，再调用 xdd_advance。`,
				);
			}
			state.advanceOutcome = { passed: true };
			state.clearSignals();
			const next = state.advancePlan();
			const text = next
				? `[xdd_advance] ${stage.name} 通过，进入下一阶段 ${next.name}。`
				: `[xdd_advance] 最终阶段 ${stage.name} 通过，xdd run 完成。`;
			return { content: [{ type: "text", text }], details: {}, terminate: true };
		},
	};
}
