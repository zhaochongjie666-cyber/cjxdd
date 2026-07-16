import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { isStageName } from "../diagnosis.ts";
import { XddController } from "../core/controller.ts";
import { RuntimeStore } from "../storage/runtime-store.ts";
import type { XddStageName } from "../types.ts";
import type { EmptyDetails, GetXddState } from "./index.ts";

const schema = Type.Object({
	targetStage: Type.Optional(Type.String({
		description: "回退目标阶段名（须早于当前阶段且在执行计划内）。可选：不传则按当前阶段默认（verify→execute、execute/cleanup/plan→execute、resilience/architecture/wire→architecture、spec→spec、其它→understand）",
	})),
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
			// Phase 5 (E.5): default the rollback target based on the current
			// stage. Verify -> execute is the most common pattern (the
			// spec/architecture was correct; it's the implementation that's
			// wrong). The agent can still override with an explicit
			// targetStage if they need a different destination.
			let target: XddStageName;
			if (params.targetStage) {
				if (!isStageName(params.targetStage)) {
					throw new Error(`[xdd_rollback] 未知阶段名: ${params.targetStage}`);
				}
				target = params.targetStage as XddStageName;
			} else {
				// Default by current stage
				if (from === "verify") {
					target = "execute";
				} else if (from === "execute" || from === "cleanup" || from === "plan") {
					target = "execute";
				} else if (from === "resilience" || from === "architecture" || from === "wire") {
					target = "architecture";
				} else if (from === "spec") {
					target = "spec";
				} else {
					target = "understand";
				}
			}
			// Enforce the attempt cap BEFORE mutating any state.
			if (state.currentAttempt(target) >= state.maxRollbacksPerStage) {
				throw new Error(`[xdd_rollback] ${target} 已达回退上限 ${state.maxRollbacksPerStage}，无法再次回退`);
			}
			const controller = new XddController(new RuntimeStore(state.cwd), state.plan.map(({ stage }) => stage));
			try {
				controller.dispatch({ type: "ROLLBACK", target, reason: String(params.reason ?? "") });
			} catch (error) {
				throw new Error(`[xdd_rollback] ${error instanceof Error ? error.message : String(error)}`);
			}
			return {
				content: [{ type: "text", text: `[xdd_rollback] ${from} → ${target}：${params.reason}` }],
				details: {},
				terminate: true,
			};
		},
	};
}
