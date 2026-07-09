import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "../../core/extensions/types.ts";
import { type EmptyDetails, type GetXddState, ok } from "./index.ts";

const schema = Type.Object({});

/** xdd_status: read-only snapshot of the active xdd run, for model orientation. */
export function createXddStatusTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_status",
		label: "xdd: run status",
		description: "返回当前 xdd run 快照：阶段、计划进度、模式、信号、各阶段尝试次数、产物闸门路径。",
		parameters: schema,
		async execute(): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			const stage = state.currentStage();
			if (!stage) {
				return ok("[xdd_status] 无活跃 run。");
			}
			const attempts = state.plan.map((e) => `${e.stage.name}=${state.currentAttempt(e.stage.name)}`).join(" ");
			const signals = [...state.getSignals()].join(", ") || "(无)";
			const deliverable = stage.deliverablePaths.length > 0 ? stage.deliverablePaths.join(", ") : "(软通过)";
			const lines = [
				`run: ${state.runId}`,
				`阶段: ${stage.name}（计划第 ${state.planIndex + 1}/${state.plan.length}）`,
				`模式: ${state.mode}`,
				`信号: ${signals}`,
				`产物闸门(任一): ${deliverable}`,
				`各阶段尝试次数: ${attempts}`,
				`回退上限/阶段: ${state.maxRollbacksPerStage}`,
			];
			return ok(lines.join("\n"));
		},
	};
}
