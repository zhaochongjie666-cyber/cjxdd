import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../../core/extensions/types.ts";
import type { XddRunnerState } from "../types.ts";
import { type EmptyDetails, type GetXddState, ok } from "./index.ts";

const schema = Type.Object({
	pass: Type.Boolean({ description: "是否通过验证" }),
	summary: Type.Optional(Type.String({ description: "验证结论 / 失败摘要" })),
});

export type XddVerdictInput = Static<typeof schema>;

/**
 * xdd_verdict: verify-stage exit. Runs the stage gate (reconcile against the
 * stage's desiredState) and records verdict_pass / verdict_fail. Self-heal
 * aware: same budget as xdd_goal_complete.
 */
export function createXddVerdictTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_verdict",
		label: "xdd: verdict",
		description:
			"verify 阶段 reconcile 收尾：调用 gate 校验 desiredState；pass=true 推进，pass=false 可在本阶段重试修复至自愈预算耗尽。预算耗尽后请调用 xdd_diagnose 进入反思。",
		parameters: schema,
		async execute(_toolCallId, params: XddVerdictInput): Promise<AgentToolResult<EmptyDetails>> {
			const state: XddRunnerState = getState();
			const stage = state.currentStage();
			if (!stage) {
				throw new Error("[xdd] 无活跃阶段");
			}
			const pass = Boolean(params.pass);
			const summary = String(params.summary ?? "");

			const used = state.beginSelfHealAttempt(stage.name);
			const remaining = state.remainingSelfHealBudget(stage.name);
			const gate = await stage.gate({ cwd: state.cwd, summary, desiredState: stage.desiredState });
			if (!gate.ok) {
				if (remaining <= 0) {
					throw new Error(
						`[xdd_verdict] ${stage.name} 自愈预算耗尽（已试 ${used} / ${state.maxSelfHealPerStage} 次）：${gate.reason ?? "未知原因"}。请调用 xdd_diagnose 进入反思 / 回退。`,
					);
				}
				throw new Error(
					`[hard gate · attempt ${used}/${state.maxSelfHealPerStage}] ${stage.name} 验证未通过：${gate.reason ?? "未知原因"}\n请补齐后重试。剩余自愈预算：${remaining}。`,
				);
			}
			// reconcile passed; record signal the runner reads.
			state.recordSignal(pass ? "verdict_pass" : "verdict_fail");
			return ok(
				`${stage.name} verdict: ${pass ? "pass" : "fail"}${summary ? ` — ${summary}` : ""}\n剩余自愈预算：${remaining}/${state.maxSelfHealPerStage}`,
			);
		},
	};
}
