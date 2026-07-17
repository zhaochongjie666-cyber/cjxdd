import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { computeStageDifference, renderStageDifference } from "../stage-diff.ts";
import { XddController } from "../core/controller.ts";
import { RuntimeStore } from "../storage/runtime-store.ts";
import { type EmptyDetails, type GetXddState, ok } from "./index.ts";
import { HarnessStore } from "../harness/store.ts";

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
			const harnessCommands = new HarnessStore(state.cwd).load().验证命令;
			const harnessHint = stage.name === "verify"
				? `[Harness 验证命令] ${harnessCommands.length > 0 ? harnessCommands.join(" | ") : "未配置；请用 xdd_harness_set 写入已确认命令"}`
				: "";
			return ok([harnessHint, text].filter(Boolean).join("\n\n"));
		},
	};
}
