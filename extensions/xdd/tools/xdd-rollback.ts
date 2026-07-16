import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { isStageName } from "../diagnosis.ts";
import type { XddStageName } from "../types.ts";
import type { EmptyDetails, GetXddState } from "./index.ts";

const schema = Type.Object({
	targetStage: Type.String({
		description: "回退目标阶段名（须早于当前阶段且在执行计划内）",
	}),
	reason: Type.String({ description: "回退根因（具体、可操作）" }),
});

export type XddRollbackInput = Static<typeof schema>;

/**
 * xdd_rollback: model-initiated rollback. The model calls this during a reflect
 * turn (or directly during a stage turn) to rewind to an earlier stage. It
 * validates the target, enforces the per-stage attempt cap, marks superseded
 * ledger entries, moves the shared state to the target, records the rollback
 * intent, and terminates the turn. The host driver observes `rollbackOutcome`
 * and resumes at the target.
 */
export function createXddRollbackTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_rollback",
		label: "xdd: rollback to earlier stage",
		description:
			"回退到更早的 xdd 阶段重做。须提供 targetStage（早于当前阶段）与 reason。超过该阶段回退上限时会被拒绝。",
		parameters: schema,
		async execute(_toolCallId, params: XddRollbackInput): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			const from = state.currentStageName();
			if (!from) {
				throw new Error("[xdd_rollback] 无活跃阶段");
			}
			if (!isStageName(params.targetStage)) {
				throw new Error(`[xdd_rollback] 未知阶段名: ${params.targetStage}`);
			}
			const target = params.targetStage as XddStageName;
			// Enforce the attempt cap BEFORE mutating any state.
			if (state.currentAttempt(target) >= state.maxRollbacksPerStage) {
				throw new Error(`[xdd_rollback] ${target} 已达回退上限 ${state.maxRollbacksPerStage}，无法再次回退`);
			}
			const moved = state.goToStageName(target);
			if (!moved.ok) {
				throw new Error(`[xdd_rollback] ${moved.reason}`);
			}
			state.markSuperseded(moved.originalIndex);
			state.rollbackOutcome = { from, to: target, reason: String(params.reason ?? "") };
			// Phase 2 (B): record outcome so agent_end can see "this stage is
			// now failed; the next stage starts fresh". Don't keep the old
			// gate_passed/hard_gate_failed -- those describe the *current*
			// stage (the rolled-back one), not the rolled-back-to target.
			state.stageOutcome = "advanced";
			state.lastStageError = undefined;
			return {
				content: [{ type: "text", text: `[xdd_rollback] ${from} → ${target}：${params.reason}` }],
				details: {},
				terminate: true,
			};
		},
	};
}
