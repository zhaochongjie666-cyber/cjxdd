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
		description: "回退目标阶段名（只能在 verify 阶段调用，且目标须早于 verify 并在执行计划内）。可选：不传则默认 verify→execute",
	})),
	reason: Type.String({ description: "回退根因（具体、可操作）" }),
});

export type XddRollbackInput = Static<typeof schema>;

/**
 * xdd_rollback: model-initiated rollback. The model calls this during a reflect
 * turn (or directly during a stage turn) to rewind to an earlier stage. It
 * validates the target, lets the Controller atomically enforce the per-stage
 * rollback cap, marks superseded ledger entries, moves the shared state to the target, records the rollback
 * intent, and leaves the turn alive so the agent can immediately resume work at
 * the target stage with the failure context still available.
 */
export function createXddRollbackTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_rollback",
		label: "xdd: rollback to earlier stage",
		description:
			"只能在 verify 阶段回退到更早的 xdd 阶段重做。须提供 reason；targetStage 可选（默认 execute）。非 verify 阶段调用会被拒绝。",
		parameters: schema,
		async execute(_toolCallId, params: XddRollbackInput): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			const from = state.currentStageName();
			if (!from) {
				throw new Error("[xdd_rollback] 无活跃阶段");
			}
			// Rollback is intentionally verify-only: earlier stages must repair
			// inside their own stage instead of jumping the flow backward. Verify
			// may route defects back to the owning earlier stage.
			let target: XddStageName;
			if (params.targetStage) {
				if (!isStageName(params.targetStage)) {
					throw new Error(`[xdd_rollback] 未知阶段名: ${params.targetStage}`);
				}
				target = params.targetStage as XddStageName;
			} else {
				target = "execute";
			}
			const controller = new XddController(new RuntimeStore(state.cwd), state.plan.map(({ stage }) => stage));
			try {
				const rollback = controller.dispatch({ type: "ROLLBACK", target, reason: String(params.reason ?? "") });
				if (rollback.state.status === "failed") {
					return {
						content: [{ type: "text", text: `[xdd_rollback] ${rollback.state.lastStageError ?? "流程预算耗尽，流程退出"}。` }],
						details: {},
						terminate: true,
					};
				}
			} catch (error) {
				throw new Error(`[xdd_rollback] ${error instanceof Error ? error.message : String(error)}`);
			}
			return {
				content: [{ type: "text", text: `[xdd_rollback] ${from} → ${target}：${params.reason}` }],
				details: {},
			};
		},
	};
}
