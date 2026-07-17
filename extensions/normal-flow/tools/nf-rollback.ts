import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { XddController } from "../../xdd/core/controller.ts";
import { RuntimeStore } from "../../xdd/storage/runtime-store.ts";
import type { XddStageName } from "../../xdd/types.ts";
import { NF_STAGE_NAMES } from "../types.ts";
import type { EmptyDetails, GetNfState } from "./index.ts";

const schema = Type.Object({
	targetStage: Type.Optional(Type.String({
		description: "回退目标阶段名（须早于当前阶段）。可选：不传则按默认（verify→execute、execute→plan、plan→spec、spec→understand）",
	})),
	reason: Type.String({ description: "回退根因（具体、可操作）" }),
});

export type NfRollbackInput = Static<typeof schema>;

function isNfStageName(value: string): value is XddStageName {
	return (NF_STAGE_NAMES as readonly string[]).includes(value);
}

const DEFAULT_ROLLBACK_TARGET: Readonly<Partial<Record<XddStageName, XddStageName>>> = {
	verify: "execute",
	execute: "plan",
	plan: "spec",
	spec: "understand",
};

/** nf_rollback：对齐 xdd_rollback，但默认回退目标只覆盖 NF 的 5 阶段。 */
export function createNfRollbackTool(getState: GetNfState): ToolDefinition {
	return {
		name: "nf_rollback",
		label: "normal-flow: rollback to earlier stage",
		description: "回退到更早的 Normal Flow 阶段重做。须提供 reason；targetStage 可选。",
		parameters: schema,
		async execute(_toolCallId, params: NfRollbackInput): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			const from = state.currentStageName();
			if (!from) throw new Error("[nf_rollback] 无活跃阶段");
			let target: XddStageName;
			if (params.targetStage) {
				if (!isNfStageName(params.targetStage)) {
					throw new Error(`[nf_rollback] 未知或超出 Normal Flow 范围的阶段名: ${params.targetStage}`);
				}
				target = params.targetStage;
			} else {
				target = DEFAULT_ROLLBACK_TARGET[from] ?? "understand";
			}
			const controller = new XddController(new RuntimeStore(state.cwd), state.plan.map(({ stage }) => stage));
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
