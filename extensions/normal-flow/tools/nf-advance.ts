import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { XddController } from "../../xdd/core/controller.ts";
import { RuntimeStore } from "../../xdd/storage/runtime-store.ts";
import { type EmptyDetails, type GetNfState, ok } from "./index.ts";

const schema = Type.Object({});

/** nf_advance：对齐 xdd_advance，但没有阶段组 Gate（NF 没有 Group Gates）。 */
export function createNfAdvanceTool(getState: GetNfState): ToolDefinition {
	return {
		name: "nf_advance",
		label: "normal-flow: advance to next stage",
		description: "推进 Normal Flow 到下一阶段。前置：当前阶段须已调用 nf_submit_artifact 并通过闸门。",
		parameters: schema,
		async execute(): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			const stage = state.currentStage();
			if (!stage) throw new Error("[nf_advance] 无活跃阶段");
			const signals = state.getSignals();
			const passed = stage.exit === "verdict" ? signals.has("verdict_pass") : signals.has("complete");
			if (!passed) {
				return ok(
					`[nf_advance] 当前阶段 ${stage.name} 尚未声明完成：请先调用 nf_submit_artifact 并通过闸门，再调用 nf_advance。`,
				);
			}
			const prevStageName = stage.name;
			const controller = new XddController(new RuntimeStore(state.cwd), state.plan.map(({ stage: plannedStage }) => plannedStage));
			controller.dispatch({ type: "ADVANCE" });
			if (state.runComplete) {
				return {
					content: [{ type: "text", text: `[nf_advance] 最终阶段 ${prevStageName} 通过，Normal Flow 完成 ✅。` }],
					details: {},
					terminate: true,
				};
			}
			const next = state.currentStage();
			return { content: [{ type: "text", text: `[nf_advance] ${prevStageName} 通过，进入下一阶段 ${next?.name ?? "?"}。` }], details: {} };
		},
	};
}
