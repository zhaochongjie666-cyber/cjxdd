import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { computeStageDifference, renderStageDifference } from "../stage-diff.ts";
import { type EmptyDetails, type GetXddState, ok } from "./index.ts";

const schema = Type.Object({});

/**
 * xdd_difference: Compare phase of the Controller cycle.
 *
 * Delegates to computeStageDifference, which runs the stage's REAL hard gate
 * (filesystem-backed) + disk-grounded desiredState classification - NOT a keyword heuristic. core.md principle 3 (Gate decides
 * advancement; the model cannot self-declare completion) made available as a
 * pre-flight diff.
 */
export function createXddDifferenceTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_difference",
		label: "xdd: difference",
		description:
			"Compare: 计算 Desired State 与 Current State 的真实差距。调用本阶段硬 Gate（文件系统校验，与 xdd_submit_artifact 同一闸门）+ 磁盘观测，逐条返回未满足条件。不用关键词猜测，不信任自报完成信号。",
		parameters: schema,
		async execute(): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			const stage = state.currentStage();
			if (!stage) return ok("[xdd_difference] 无活跃 run。");
			const artifacts = state.submittedArtifacts.get(stage.name) ?? [];
			const selfAttack = state.selfAttackNotes.get(stage.name);
			const remaining = state.remainingSelfHealBudget(stage.name);

			const diff = await computeStageDifference(state.cwd, stage, { artifacts, selfAttack });
			state.recordEsgNode("task", stage.name, `difference: gate ${diff.gate.ok ? "ok" : "fail"}, ${diff.metCount}/${diff.checks.length} met`);

			const text = renderStageDifference(diff, {
				artifacts,
				selfHealRemaining: remaining,
				maxSelfHeal: state.maxSelfHealPerStage,
			});
			return ok(text);
		},
	};
}
