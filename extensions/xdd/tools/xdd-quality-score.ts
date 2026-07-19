import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { buildQualityScore, writeQualityScore } from "../quality-score.ts";
import type { EmptyDetails, GetXddState } from "./index.ts";

export function createXddQualityScoreTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_quality_score",
		label: "xdd: explain quality score",
		description: "聚合重复缺陷、escaped defects、修复时间、软 Gate override 和证据覆盖率。评分只提供改进优先级，不因小分差制造无限硬阻塞。",
		parameters: Type.Object({}),
		async execute(): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			if (state.currentStage()?.name !== "verify") return { content: [{ type: "text", text: "[xdd_quality_score] 只能在 verify 阶段生成质量评分。" }], details: {} };
			const score = buildQualityScore(state.cwd);
			writeQualityScore(state.cwd, score);
			return { content: [{ type: "text", text: `${score.status === "healthy" ? "✅" : "⚠️"} [xdd_quality_score] ${score.score}/100 (${score.status})${score.recommendations.length ? `；${score.recommendations.join("；")}` : "；暂无扣分项"}` }], details: {} };
		},
	};
}
