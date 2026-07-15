import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { findStageGroup, isLastStageInGroup } from "../stage-groups.ts";
import type { XddTaskInstruction } from "../types.ts";
import { type EmptyDetails, type GetXddState, ok } from "./index.ts";

const schema = Type.Object({});

export function createXddNextTaskTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_next_task",
		label: "xdd: next task",
		description:
			"Reconcile: Controller 返回唯一下一步 Task（基于 Difference 计算）。Agent 通过此工具接收控制指令。",
		parameters: schema,
		async execute(): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			const stage = state.currentStage();
			if (!stage) return ok("[xdd_next_task] 无活跃 run。");
			const signals = state.getSignals();
			const hasComplete = signals.has("complete") || signals.has("verdict_pass");
			const artifacts = state.getSubmittedArtifactsForStage(stage.name) ?? [];
			const selfAttack = state.getSelfAttackNoteForStage(stage.name);
			const remaining = state.remainingSelfHealBudget(stage.name);
			const groupGatePending = isLastStageInGroup(stage.name);
			const gaps: string[] = [];
			let action: string;
			if (!hasComplete) {
				if (artifacts.length === 0) {
					gaps.push("尚未产出阶段产物");
					action = `按 desiredState 执行 ${stage.name} 阶段工作，产出产物后调 xdd_submit_artifact 提交`;
				} else if (!selfAttack) {
					gaps.push("尚未进行自我攻击");
					action = `对已产出的产物进行自我攻击（检查反例/风险/边界），记录结论后调 xdd_submit_artifact`;
				} else {
					gaps.push("产物已提交但 Gate 未通过");
					action = `检查 Gate 失败原因，修复后重新调 xdd_submit_artifact（剩余预算: ${remaining}）`;
				}
			} else {
				gaps.push("阶段已通过 Gate，尚未推进");
				action = `调用 xdd_advance 推进到下一阶段`;
			}
			const instr: XddTaskInstruction = {
				stage: stage.name,
				role: stage.role,
				desiredState: stage.desiredState,
				gaps,
				action,
				selfHealRemaining: remaining,
				groupGatePending,
			};
			const group = findStageGroup(stage.name);
			state.recordEsgNode("task", stage.name, `next task: ${action}`);
			const lines = [
				"[Controller 指令]",
				`阶段: ${instr.stage}（${instr.role}）`,
				`下一步行动: ${instr.action}`,
				`差距:`,
				...(instr.gaps.length > 0 ? instr.gaps.map((g) => `  - ${g}`) : ["  (无)"]),
				`自愈预算剩余: ${instr.selfHealRemaining}`,
				`组级 Gate 待执行: ${instr.groupGatePending ? "是" : "否"}`,
				group ? `阶段组: ${group.label}` : "",
				"",
				"Desired State:",
				...instr.desiredState.map((d, i) => `  ${i + 1}. ${d}`),
			].filter((s) => s !== "");
			return ok(lines.join("\n"));
		},
	};
}
