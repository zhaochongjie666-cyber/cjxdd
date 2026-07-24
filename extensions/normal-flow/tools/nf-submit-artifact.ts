/** nf_submit_artifact：提交产物 -> 跑硬 Gate -> 记录结果。vibe coding：不做磁盘校验和指纹去重。 */
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { NfController } from "../core/controller.ts";
import type { NfCommand } from "../core/commands.ts";
import { createNormalFlowRuntimeStore } from "../runtime-store.ts";
import type { NfRunnerState, NfStageName } from "../types.ts";
import { type EmptyDetails, type GetNfState, ok } from "./index.ts";
import { canSoftPassExhaustedStage } from "../policy.ts";

const schema = Type.Object({
	summary: Type.String({ description: "本阶段完成内容与产物路径摘要" }),
	artifacts: Type.Array(Type.String(), { description: "提交的产物文件路径列表" }),
	pass: Type.Optional(Type.Boolean({ description: "仅 verify 阶段：是否通过验证" })),
});
export type NfSubmitArtifactInput = Static<typeof schema>;
const VERIFY_ROLLBACK_TARGET: NfStageName = "spec";

function dispatch(state: NfRunnerState, command: NfCommand) {
	return new NfController(createNormalFlowRuntimeStore(state.cwd), state.plan.map(({ stage }) => stage)).dispatch(command);
}

export function createNfSubmitArtifactTool(getState: GetNfState): ToolDefinition {
	return {
		name: "nf_submit_artifact",
		label: "normal-flow: submit artifact",
		description: "提交阶段产物并触发硬 Gate 验证。verify 阶段需附 pass。Gate 通过后调 nf_advance 推进。",
		parameters: schema,
		async execute(_toolCallId, params: NfSubmitArtifactInput): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			const stage = state.currentStage();
			if (!stage) throw new Error("[nf_submit_artifact] 无活跃阶段");
			const summary = String(params.summary ?? "");
			const artifacts = params.artifacts ?? [];

			dispatch(state, { type: "RECORD_ARTIFACT_REVIEW", stage: stage.name, artifacts });
			const gateResult = await stage.gate({ cwd: state.cwd, summary, desiredState: stage.desiredState });

			if (!gateResult.ok) {
				const used = state.beginSelfHealAttempt(stage.name);
				const budget = state.stageSelfHealBudget(stage.name, "hard_gate");
				const error = gateResult.reason ?? "硬 Gate 未通过";
				dispatch(state, { type: "SUBMIT", submission: { summary, artifacts, pass: false, error } });
				if (!budget.exhausted) {
					return { content: [{ type: "text", text: `❌ [硬 Gate ${used}/${budget.limit}] ${stage.name} 未通过：${error}\n剩余自愈预算：${budget.remaining}/${budget.limit}。请修复产物后重新调用 nf_submit_artifact。` }], details: {} };
				}
				if (stage.exit !== "verdict") {
					if (!canSoftPassExhaustedStage(stage.name)) {
						return { content: [{ type: "text", text: `❌ [设计 Gate ${used}/${budget.limit}] design 未达到可实现状态：${error}\n设计是冻结契约，不能软通过。请按上述缺口完善设计。` }], details: {} };
					}
					dispatch(state, { type: "RECORD_SIGNAL", signal: "complete" });
					dispatch(state, { type: "SUBMIT", submission: { summary, artifacts, pass: true } });
					return ok(`⚠️ [硬 Gate ${used}/${budget.limit}] ${stage.name} 未通过且预算耗尽：${error}\n问题已记录带到下一阶段，现软通过；请调用 nf_advance 推进。`);
				}
				// verify 预算耗尽：回退到 scenarios（NF Controller 不创建 HealingCase）
				const rollback = dispatch(state, { type: "ROLLBACK", target: VERIFY_ROLLBACK_TARGET, reason: `verify 硬 Gate 预算耗尽：${error}` });
				if (rollback.state.status === "failed") {
					return { content: [{ type: "text", text: `❌ verify 未通过且预算耗尽。${rollback.state.lastStageError ?? "流程退出"}。` }], details: {}, terminate: true };
				}
				return ok(`⚠️ [硬 Gate ${used}/${budget.limit}] verify 未通过且预算耗尽：${error}\n已回退 verify -> ${VERIFY_ROLLBACK_TARGET}（${rollback.state.flowRollbackCount}/${rollback.state.flowRollbackLimit}）。请修复后重新推进 verify。`);
			}

			state.lastSubmitAt = Date.now();
			if (stage.exit === "verdict") {
				const pass = Boolean(params.pass);
				dispatch(state, { type: "RECORD_SIGNAL", signal: pass ? "verdict_pass" : "verdict_fail" });
				if (!pass) {
					const used = state.beginSelfHealAttempt(stage.name);
					const budget = state.stageSelfHealBudget(stage.name, "hard_gate");
					dispatch(state, { type: "SUBMIT", submission: { summary, artifacts, pass: false, error: "verify 提交 pass=false" } });
					if (!budget.exhausted) {
						return { content: [{ type: "text", text: `❌ [verify verdict ${used}/${budget.limit}] verify 未通过。剩余：${budget.remaining}/${budget.limit}。请修复后重新调用 nf_submit_artifact。` }], details: {} };
					}
					const rollback = dispatch(state, { type: "ROLLBACK", target: VERIFY_ROLLBACK_TARGET, reason: "verify verdict 未通过且自愈预算耗尽" });
					if (rollback.state.status === "failed") {
						return { content: [{ type: "text", text: `❌ verify 未通过且预算耗尽。${rollback.state.lastStageError ?? "流程退出"}。` }], details: {}, terminate: true };
					}
					return ok(`⚠️ [verify verdict] 已回退 verify -> ${VERIFY_ROLLBACK_TARGET}（${rollback.state.flowRollbackCount}/${rollback.state.flowRollbackLimit}）。请修复后重新推进 verify。`);
				}
				dispatch(state, { type: "SUBMIT", submission: { summary, artifacts, pass: true } });
				return ok(`${stage.name} verdict: pass - ${summary}\n剩余自愈预算：${state.stageSelfHealBudget(stage.name, "hard_gate").remaining}/${state.maxSelfHealPerStage}`);
			}
			dispatch(state, { type: "SUBMIT", submission: { summary, artifacts, pass: true } });
			dispatch(state, { type: "RECORD_SIGNAL", signal: "complete" });
			return ok(`${stage.name} 完成${gateResult.soft ? "（软通过）" : ""}：${summary}\n剩余自愈预算：${state.stageSelfHealBudget(stage.name, "hard_gate").remaining}/${state.maxSelfHealPerStage}`);
		},
	};
}
