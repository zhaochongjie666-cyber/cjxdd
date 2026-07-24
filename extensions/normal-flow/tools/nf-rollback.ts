import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { NfController } from "../core/controller.ts";
import { createNormalFlowRuntimeStore } from "../runtime-store.ts";
import type { NfStageName } from "../types.ts";
import { NF_STAGE_NAMES } from "../types.ts";
import type { EmptyDetails, GetNfState } from "./index.ts";

const schema = Type.Object({
	targetStage: Type.Optional(Type.String({
		description: "回退目标阶段名。Normal Flow 只允许 verify 阶段回退；不传默认 verify→spec，也可回 architecture 重搭框架或 understand 补完整设计。",
	})),
	reason: Type.String({ description: "回退根因（具体、可操作）" }),
});

export type NfRollbackInput = Static<typeof schema>;

function isNfStageName(value: string): value is NfStageName {
	return (NF_STAGE_NAMES as readonly string[]).includes(value);
}

const DEFAULT_ROLLBACK_TARGET: Readonly<Partial<Record<NfStageName, NfStageName>>> = {
	verify: "spec",
};

/** nf_rollback：NF 只允许 verify 阶段把验证失败回流到 spec/architecture。 */
export function createNfRollbackTool(getState: GetNfState): ToolDefinition {
	return {
		name: "nf_rollback",
		label: "normal-flow: rollback verify to earlier stage",
		description: "仅 verify 阶段可用：场景实现错误回 spec，框架错误回 architecture，设计根因回 understand。非 verify 阶段请在本阶段预算内修复。",
		parameters: schema,
		async execute(_toolCallId, params: NfRollbackInput): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			const from = state.currentStageName();
			if (!from) throw new Error("[nf_rollback] 无活跃阶段");
			if (from !== "verify") {
				throw new Error(`[nf_rollback] Normal Flow 只允许 verify 阶段跨流程回退自愈；当前阶段 ${from} 不能跳回前序流程。请在本阶段修复后重新提交，或让预算耗尽后按非 verify 规则软通过。`);
			}
			let target: NfStageName;
			if (params.targetStage) {
				if (!isNfStageName(params.targetStage)) {
					throw new Error(`[nf_rollback] 未知或超出 Normal Flow 范围的阶段名: ${params.targetStage}`);
				}
				target = params.targetStage;
			} else {
				target = DEFAULT_ROLLBACK_TARGET[from] ?? "architecture";
			}
			const controller = new NfController(createNormalFlowRuntimeStore(state.cwd), state.plan.map(({ stage }) => stage));
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
