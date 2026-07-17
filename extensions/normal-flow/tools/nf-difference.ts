import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { computeStageDifference, renderStageDifference } from "../../xdd/stage-diff.ts";
import { XddController } from "../../xdd/core/controller.ts";
import { RuntimeStore } from "../../xdd/storage/runtime-store.ts";
import { type EmptyDetails, type GetNfState, ok } from "./index.ts";

const schema = Type.Object({});

/**
 * nf_difference：对齐 xdd_difference——跑本阶段真实硬 Gate（与
 * nf_submit_artifact 同一闸门）+ 磁盘观测，逐条分类 desiredState，不靠关键词
 * 猜测、不信任自报完成信号。
 */
export function createNfDifferenceTool(getState: GetNfState): ToolDefinition {
	return {
		name: "nf_difference",
		label: "normal-flow: difference",
		description:
			"Compare：计算 Desired State 与 Current State 的真实差距。跑本阶段硬 Gate（与 nf_submit_artifact 同一闸门）+ 磁盘观测，逐条返回未满足条件。",
		parameters: schema,
		async execute(): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			const stage = state.currentStage();
			if (!stage) return ok("[nf_difference] 无活跃 run。");
			const artifacts = state.getSubmittedArtifactsForStage(stage.name) ?? [];
			const remaining = state.remainingSelfHealBudget(stage.name);
			const diff = await computeStageDifference(state.cwd, stage, { artifacts });
			new XddController(new RuntimeStore(state.cwd), state.plan.map(({ stage: plannedStage }) => plannedStage)).dispatch({
				type: "RECORD_ESG",
				nodeType: "task",
				stage: stage.name,
				label: `difference: gate ${diff.gate.ok ? "ok" : "fail"}, ${diff.metCount}/${diff.checks.length} met`,
			});
			const text = renderStageDifference(diff, {
				artifacts,
				selfHealRemaining: remaining,
				maxSelfHeal: state.maxSelfHealPerStage,
			});
			return ok(text);
		},
	};
}
