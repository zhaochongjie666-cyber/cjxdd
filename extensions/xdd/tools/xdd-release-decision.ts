import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { buildReleaseDecision, writeReleaseDecision } from "../release-decision.ts";
import { buildQualityScore, writeQualityScore } from "../quality-score.ts";
import type { EmptyDetails, GetXddState } from "./index.ts";

const schema = Type.Object({});

export function createXddReleaseDecisionTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_release_decision",
		label: "xdd: aggregate release decision",
		description: "聚合当前 run 的阶段 review、冻结 QA、只读 Code Review、Commit Diff Review 与 verify evidence，生成 release-decision.json。机械失败/P0/P1/过期证据不可软放行。",
		parameters: schema,
		async execute(): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			if (state.currentStage()?.name !== "verify") return { content: [{ type: "text", text: "[xdd_release_decision] 只能在 verify 阶段生成最终发布裁决。" }], details: {} };
			// Generate the diagnostic score immediately before aggregation so legacy
			// callers of xdd_release_decision do not need to learn a mandatory new step.
			writeQualityScore(state.cwd, buildQualityScore(state.cwd));
			const decision = await buildReleaseDecision(state.cwd);
			writeReleaseDecision(state.cwd, decision);
			const failed = decision.checks.filter((item) => !item.ok);
			return {
				content: [{ type: "text", text: decision.verdict === "release"
					? "✅ [xdd_release_decision] RELEASE：所有独立 verdict 与运行证据闭环。"
					: `❌ [xdd_release_decision] BLOCK：${failed.map((item) => `${item.name}: ${item.reason ?? "未通过"}`).join("；")}` }],
				details: {},
			};
		},
	};
}
