import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { recordRuntimeObservation, writeRuntimeBaseline, type RuntimeObservation } from "../runtime-observability.ts";
import type { EmptyDetails, GetXddState } from "./index.ts";

const metric = Type.Object({
	name: Type.String({ minLength: 1 }),
	value: Type.Number(),
	unit: Type.String({ minLength: 1 }),
	direction: Type.Union([Type.Literal("lower"), Type.Literal("higher")]),
	maxRegressionPct: Type.Number({ minimum: 0 }),
	critical: Type.Boolean(),
});
const schema = Type.Object({
	mode: Type.Union([Type.Literal("baseline"), Type.Literal("observe")]),
	deploymentId: Type.String({ minLength: 1 }),
	commitSha: Type.String({ minLength: 1 }),
	capturedAt: Type.String({ minLength: 1 }),
	metrics: Type.Array(metric, { minItems: 1 }),
	logs: Type.Array(Type.String()),
	traces: Type.Array(Type.String()),
});
type Input = Static<typeof schema>;

export function createXddRuntimeObserveTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_runtime_observe",
		label: "xdd: record runtime observation",
		description: "通过 runtime-independent adapter 记录脱敏 logs/metrics/traces。baseline 保存稳定基线；observe 生成 incident，并把 P1 回归送入最终 Release Decision。",
		parameters: schema,
		async execute(_toolCallId, params: Input): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			if (state.currentStage()?.name !== "verify") return { content: [{ type: "text", text: "[xdd_runtime_observe] 只能在 verify 阶段记录发布候选运行观测。" }], details: {} };
			if (!Number.isFinite(Date.parse(params.capturedAt))) return { content: [{ type: "text", text: "[xdd_runtime_observe] capturedAt 必须是有效时间。" }], details: {} };
			const observation = params as RuntimeObservation;
			if (params.mode === "baseline") {
				writeRuntimeBaseline(state.cwd, observation);
				return { content: [{ type: "text", text: "✅ [xdd_runtime_observe] 已保存脱敏稳定基线；下一步用 mode=observe 记录发布候选。" }], details: {} };
			}
			const incident = recordRuntimeObservation(state.cwd, observation);
			const blockers = incident.findings.filter((finding) => finding.severity === "P1");
			if (blockers.length > 0) {
				state.setDiagnose({
					layer: incident.rollbackTarget === "execute" ? "implementation-bug" : "architecture-flaw",
					reason: `Runtime incident ${incident.deploymentId}: ${incident.difference.current}`,
				});
			}
			return { content: [{ type: "text", text: blockers.length > 0
				? `❌ [xdd_runtime_observe] 发现 P1 运行回归：${blockers.map((finding) => `${finding.metric}: ${finding.reason}`).join("；")}；回炉 ${incident.rollbackTarget}。`
				: `✅ [xdd_runtime_observe] 运行观测完成；${incident.findings.length} 个 P2 finding 保留为软告警。` }], details: {} };
		},
	};
}
