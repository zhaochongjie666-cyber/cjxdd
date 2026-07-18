import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { XddController } from "../../xdd/core/controller.ts";
import { createNormalFlowRuntimeStore } from "../runtime-store.ts";
import type { XddStageName } from "../../xdd/types.ts";
import { NF_STAGE_NAMES } from "../types.ts";
import type { EmptyDetails, GetNfState } from "./index.ts";

const schema = Type.Object({
	targetStage: Type.Optional(Type.String({
		description: "回退目标阶段名。Normal Flow 只允许 verify 阶段回退；不传默认 verify→execute，也可显式回 understand/spec/plan 修正设计或计划。",
	})),
	reason: Type.String({ description: "回退根因（具体、可操作）" }),
});

export type NfRollbackInput = Static<typeof schema>;

function isNfStageName(value: string): value is XddStageName {
	return (NF_STAGE_NAMES as readonly string[]).includes(value);
}

const DEFAULT_ROLLBACK_TARGET: Readonly<Partial<Record<XddStageName, XddStageName>>> = {
	verify: "execute",
};

/** nf_rollback：NF 只允许 verify 阶段把验证失败回流到 execute/spec/understand 等早期阶段。 */
export function createNfRollbackTool(getState: GetNfState): ToolDefinition {
	return {
		name: "nf_rollback",
		label: "normal-flow: rollback verify to earlier stage",
		description: "仅 verify 阶段可用：验证发现实现、规格或需求设计错误时，可回退到 execute、spec、understand 等早期阶段自愈。非 verify 阶段请在本阶段预算内修复，预算耗尽后按 NF 规则软通过并记录告警。",
		parameters: schema,
		async execute(_toolCallId, params: NfRollbackInput): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			const from = state.currentStageName();
			if (!from) throw new Error("[nf_rollback] 无活跃阶段");
			if (from !== "verify") {
				throw new Error(`[nf_rollback] Normal Flow 只允许 verify 阶段跨流程回退自愈；当前阶段 ${from} 不能跳回前序流程。请在本阶段修复后重新提交，或让预算耗尽后按非 verify 规则软通过。`);
			}
			let target: XddStageName;
			if (params.targetStage) {
				if (!isNfStageName(params.targetStage)) {
					throw new Error(`[nf_rollback] 未知或超出 Normal Flow 范围的阶段名: ${params.targetStage}`);
				}
				target = params.targetStage;
			} else {
				target = DEFAULT_ROLLBACK_TARGET[from] ?? "understand";
			}
			const controller = new XddController(createNormalFlowRuntimeStore(state.cwd), state.plan.map(({ stage }) => stage));
			try {
				const rollback = controller.dispatch({ type: "ROLLBACK", target, reason: String(params.reason ?? "") });
				if (rollback.state.status === "failed") {
					return {
						content: [{ type: "text", text: `[nf_rollback] ${rollback.state.lastStageError ?? "流程预算耗尽，流程退出"}。` }],
						details: {},
						terminate: true,
					};
				}
			} catch (error) {
				throw new Error(`[nf_rollback] ${error instanceof Error ? error.message : String(error)}`);
			}
			return { content: [{ type: "text", text: `[nf_rollback] ${from} → ${target}：${params.reason}` }], details: {} };
		},
	};
}
