import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type EmptyDetails, type GetNfState, ok } from "./index.ts";

const schema = Type.Object({});

/** nf_desired_state：对齐 xdd_desired_state，但没有阶段组（NF 没有 Group Gates）。 */
export function createNfDesiredStateTool(getState: GetNfState): ToolDefinition {
	return {
		name: "nf_desired_state",
		label: "normal-flow: desired state",
		description: "返回当前阶段的 Desired State（观察型条件列表）。",
		parameters: schema,
		async execute(): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			const stage = state.currentStage();
			if (!stage) return ok("[nf_desired_state] 无活跃 run。");
			const desired = stage.desiredState.map((d, i) => `  ${i + 1}. ${d}`).join("\n");
			return ok([`当前阶段: ${stage.name}`, `角色: ${stage.role}`, "Desired State:", desired].join("\n"));
		},
	};
}
