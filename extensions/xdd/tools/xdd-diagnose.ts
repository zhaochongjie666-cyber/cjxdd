import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { isDiagnoseLayer } from "../diagnosis.ts";
import type { XddDiagnose } from "../types.ts";
import { type EmptyDetails, type GetXddState, ok } from "./index.ts";

const schema = Type.Object({
	layer: Type.String({
		description:
			"失败根因层（任选其一）: intent-unclear / spec-gap / architecture-flaw / wiring-bug / implementation-bug / test-gap / cleanup-missed",
	}),
	reason: Type.String({ description: "根因说明（具体、可操作）" }),
});

export type XddDiagnoseInput = Static<typeof schema>;

/**
 * xdd_diagnose: reflect-turn tool; records a structured root-cause for the
 * failure. In the tool-driven model the actual rollback target is supplied to
 * xdd_rollback separately; this tool only classifies the failure layer + reason
 * (used for audit/reflection bookkeeping).
 */
export function createXddDiagnoseTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_diagnose",
		label: "xdd: diagnose",
		description: "反思阶段上报失败根因 layer/reason（供审计与反思记录）。回退目标请用 xdd_rollback 的 targetStage。",
		parameters: schema,
		async execute(_toolCallId, params: XddDiagnoseInput): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			if (!isDiagnoseLayer(params.layer)) {
				throw new Error(`[xdd_diagnose] 未知 layer: ${params.layer}。合法值见工具描述。`);
			}
			const diagnose: XddDiagnose = {
				layer: params.layer,
				reason: String(params.reason ?? ""),
			};
			state.setDiagnose(diagnose);
			const stageName = state.currentStageName();
			if (stageName) {
				state.recordEsgNode("finding", stageName, `diagnose: ${diagnose.layer} - ${diagnose.reason}`);
			}
			return ok(`诊断记录：layer=${diagnose.layer}`);
		},
	};
}
