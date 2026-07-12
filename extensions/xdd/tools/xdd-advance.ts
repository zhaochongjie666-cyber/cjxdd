import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { findStageGroup, isLastStageInGroup } from "../stage-groups.ts";
import { type EmptyDetails, type GetXddState, ok } from "./index.ts";

const schema = Type.Object({});

export function createXddAdvanceTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_advance",
		label: "xdd: advance to next stage",
		description:
			"推进 xdd 到下一阶段。前置：当前阶段须已调用 xdd_submit_artifact 并通过闸门。若为阶段组末尾阶段，会执行组级 Gate；失败则需 xdd_rollback 回退。",
		parameters: schema,
		async execute(): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			const stage = state.currentStage();
			if (!stage) throw new Error("[xdd_advance] 无活跃阶段");
			const signals = state.getSignals();
			const passed = stage.exit === "verdict" ? signals.has("verdict_pass") : signals.has("complete");
			if (!passed) {
				return ok(
					`[xdd_advance] 当前阶段 ${stage.name} 尚未声明完成：请先调用 xdd_submit_artifact 并通过闸门，再调用 xdd_advance。`,
				);
			}
			if (isLastStageInGroup(stage.name)) {
				const group = findStageGroup(stage.name);
				if (group) {
					const groupGate = await group.gate({
						cwd: state.cwd,
						summary: "",
						desiredState: [],
					});
					if (!groupGate.ok) {
						state.clearSignals();
						state.rollbackOutcome = {
							from: stage.name,
							to: group.rollbackTarget,
							reason: `${group.gateLabel} 未通过：${groupGate.reason ?? "未知"}`,
						};
						return ok(
							`[xdd_advance] 组级 ${group.gateLabel} 未通过，强制回退 ${stage.name} -> ${group.rollbackTarget}：${groupGate.reason ?? "未知"}`,
						);
					}
				}
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
