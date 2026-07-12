import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { findStageGroup } from "../stage-groups.ts";
import { type EmptyDetails, type GetXddState, ok } from "./index.ts";

const schema = Type.Object({});

export function createXddDesiredStateTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_desired_state",
		label: "xdd: desired state",
		description:
			"返回当前阶段的 Desired State（观察型条件列表）+ 所属四阶段组及组级 Gate 信息。",
		parameters: schema,
		async execute(): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			const stage = state.currentStage();
			if (!stage) return ok("[xdd_desired_state] 无活跃 run。");
			const group = findStageGroup(stage.name);
			const desired = stage.desiredState.map((d, i) => `  ${i + 1}. ${d}`).join("\n");
			const lines = [
				`当前阶段: ${stage.name}`,
				`角色: ${stage.role}`,
				`Desired State:`,
				desired,
			];
			if (group) {
				lines.push(`所属阶段组: ${group.label}`);
				lines.push(`组级 Gate: ${group.gateLabel}`);
			}
			return ok(lines.join("\n"));
		},
	};
}
