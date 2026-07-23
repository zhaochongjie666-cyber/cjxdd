import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { XddController } from "../../xdd/core/controller.ts";
import { createNormalFlowRuntimeStore } from "../runtime-store.ts";
import type { XddRunnerState, XddStageName } from "../../xdd/types.ts";
import { type EmptyDetails, type GetNfState, ok } from "./index.ts";
import { canSoftPassExhaustedStage } from "../policy.ts";

const schema = Type.Object({
	summary: Type.String({ description: "本阶段完成内容与产物路径摘要" }),
	artifacts: Type.Array(Type.String(), { description: "提交的产物文件路径列表" }),
	pass: Type.Optional(Type.Boolean({ description: "仅 verify 阶段：是否通过验证" })),
});

export type NfSubmitArtifactInput = Static<typeof schema>;

function dispatchToController(state: XddRunnerState, command: Parameters<XddController["dispatch"]>[0]) {
	const controller = new XddController(createNormalFlowRuntimeStore(state.cwd), state.plan.map(({ stage }) => stage));
	return controller.dispatch(command);
}

/** verify 失败回到 scenarios，在同一阶段继续按 TDD 修复场景。 */
const VERIFY_ROLLBACK_TARGET: XddStageName = "spec";

/**
 * nf_submit_artifact：跟 xdd_submit_artifact 的关键区别——不调用 AIGate，只有
 * 硬 Gate（文件系统校验）。语义质量交给 verify 阶段的证据审查（verify-report.md
 * 逐 RXX 举证），不做 LLM 多角度攻击审查。也没有 selfAttack（xdd 特有的单次
 * run 级自我攻击记录，NF 不要求）。
 */
export function createNfSubmitArtifactTool(getState: GetNfState): ToolDefinition {
	return {
		name: "nf_submit_artifact",
		label: "normal-flow: submit artifact",
		description:
			"提交阶段产物并触发硬 Gate 验证（不调用 AIGate）。verify 阶段需附 pass。Gate 通过后调 nf_advance 推进。",
		parameters: schema,
		async execute(_toolCallId, params: NfSubmitArtifactInput): Promise<AgentToolResult<EmptyDetails>> {
			const state: XddRunnerState = getState();
			const stage = state.currentStage();
			if (!stage) throw new Error("[nf_submit_artifact] 无活跃阶段");
			const summary = String(params.summary ?? "");
			const artifacts = params.artifacts ?? [];

			// verify 阶段按契约只读：拒绝任何声称写了源码的产物路径。
			if (stage.noCodeModification) {
				const sourceCodePattern = /^(src|lib|tests?|bin|cmd|internal|pkg|source|app|server|client)\//;
				const codeWrites = artifacts.filter((p) => sourceCodePattern.test(p));
				if (codeWrites.length > 0) {
					throw new Error(
						`[nf_submit_artifact] verify 阶段不可写源码：${codeWrites.join(", ")}。请只写 .xdd/runs/ 下的 verify-report.md。`,
					);
				}
			}
			// 声明的产物必须先真的落盘（跳过 glob 字面量）。
			if (artifacts.length > 0) {
				const missing = artifacts.filter((p) => !/[*?]/.test(p) && !existsSync(join(state.cwd, p)));
				if (missing.length > 0) {
					throw new Error(
						`[nf_submit_artifact] 声明的产物在磁盘上不存在：${missing.join(", ")}。请先创建产物文件再提交，不要盲目重试。`,
					);
				}
			}
			// 与 xdd_submit_artifact 保持一致：相同产物、相同磁盘内容的重复提交
			// 不应继续消耗硬 Gate 自愈预算。glob 会先展开为真实文件集合，
			// 避免只比较 pattern 字面量导致新增/删除文件被漏判。
			if (artifacts.length > 0) {
				const { computeArtifactFingerprint } = await import("../../xdd/tools/artifact-fingerprint.ts");
				const fingerprint = computeArtifactFingerprint(state.cwd, artifacts);
				const changed = state.checkAndRecordSubmitFingerprint(stage.name, fingerprint);
				if (!changed) {
					throw new Error(
						`[nf_submit_artifact] 上次提交后磁盘产物未变化。请先产出/修改产物文件再重试，不要盲目重试相同内容。`,
					);
				}
			}

			dispatchToController(state, { type: "RECORD_ARTIFACT_REVIEW", stage: stage.name, artifacts });
			const gateResult = await stage.gate({ cwd: state.cwd, summary, desiredState: stage.desiredState });

			if (!gateResult.ok) {
				const used = state.beginSelfHealAttempt(stage.name);
				const budget = state.stageSelfHealBudget(stage.name, "hard_gate");
				const error = gateResult.reason ?? "硬 Gate 未通过";
				dispatchToController(state, { type: "SUBMIT", submission: { summary, artifacts, pass: false, error } });
				if (!budget.exhausted) {
					return {
						content: [{
							type: "text",
							text: `❌ [硬 Gate ${used}/${budget.limit}] ${stage.name} 未通过：${error}\n剩余自愈预算：${budget.remaining}/${budget.limit}。本轮提交失败，但本 turn 继续。请修复产物后重新调用 nf_submit_artifact。`,
						}],
						details: {},
					};
				}
				if (stage.exit !== "verdict") {
					// design 是后续实现的冻结契约，不能带病软通过；即使三次快速
					// 自愈预算耗尽，也必须按 Gate 的正向动作补齐后再提交。
					if (!canSoftPassExhaustedStage(stage.name)) {
						return {
							content: [{
								type: "text",
								text: `❌ [设计 Gate ${used}/${budget.limit}] design 未达到可实现状态：${error}\n设计是业务、体验、运维与架构的冻结契约，不能软通过。请按上述缺口完善设计并提交有实质变化的产物。`,
							}],
							details: {},
						};
					}
					dispatchToController(state, { type: "RECORD_SIGNAL", signal: "complete" });
					dispatchToController(state, { type: "SUBMIT", submission: { summary, artifacts, pass: true } });
					return ok(
						`⚠️ [硬 Gate ${used}/${budget.limit}] ${stage.name} 未通过且预算耗尽：${error}\n问题已记录并将带到下一阶段，现软通过；请调用 nf_advance 单向推进。`,
					);
				}
				// verify 阶段不能软通过：自动消耗流程回退预算，回退到 scenarios。
				const rollback = dispatchToController(state, {
					type: "ROLLBACK",
					target: VERIFY_ROLLBACK_TARGET,
					reason: `verify 硬 Gate 预算耗尽：${error}`,
				});
				if (rollback.state.status === "failed") {
					return {
						content: [{ type: "text", text: `❌ [硬 Gate ${used}/${budget.limit}] verify 未通过且自愈预算耗尽。${rollback.state.lastStageError ?? "流程预算耗尽，流程退出"}。` }],
						details: {},
						terminate: true,
					};
				}
				return ok(
					`⚠️ [硬 Gate ${used}/${budget.limit}] verify 未通过且自愈预算耗尽：${error}\n已消耗流程回退预算（${rollback.state.flowRollbackCount}/${rollback.state.flowRollbackLimit}），自动回退 verify → ${VERIFY_ROLLBACK_TARGET}。请在 ${VERIFY_ROLLBACK_TARGET} 修复后重新推进 verify。`,
				);
			}

			state.lastSubmitAt = Date.now();
			if (stage.exit === "verdict") {
				const pass = Boolean(params.pass);
				dispatchToController(state, { type: "RECORD_SIGNAL", signal: pass ? "verdict_pass" : "verdict_fail" });
				if (!pass) {
					const used = state.beginSelfHealAttempt(stage.name);
					const budget = state.stageSelfHealBudget(stage.name, "hard_gate");
					dispatchToController(state, { type: "SUBMIT", submission: { summary, artifacts, pass: false, error: "verify 提交 pass=false" } });
					if (!budget.exhausted) {
						return {
							content: [{ type: "text", text: `❌ [verify verdict ${used}/${budget.limit}] verify 未通过。剩余自愈预算：${budget.remaining}/${budget.limit}。本轮提交失败，但本 turn 继续。请修复后重新调用 nf_submit_artifact。` }],
							details: {},
						};
					}
					const rollback = dispatchToController(state, {
						type: "ROLLBACK",
						target: VERIFY_ROLLBACK_TARGET,
						reason: "verify verdict 未通过且自愈预算耗尽",
					});
					if (rollback.state.status === "failed") {
						return {
							content: [{ type: "text", text: `❌ verify 未通过且自愈预算耗尽。${rollback.state.lastStageError ?? "流程预算耗尽，流程退出"}。` }],
							details: {},
							terminate: true,
						};
					}
					return ok(
						`⚠️ [verify verdict] verify 未通过且自愈预算耗尽，已消耗流程回退预算（${rollback.state.flowRollbackCount}/${rollback.state.flowRollbackLimit}）自动回退 verify → ${VERIFY_ROLLBACK_TARGET}。请修复后重新推进 verify。`,
					);
				}
				dispatchToController(state, { type: "SUBMIT", submission: { summary, artifacts, pass: true } });
				return ok(
					`${stage.name} verdict: pass - ${summary}\n剩余自愈预算：${state.stageSelfHealBudget(stage.name, "hard_gate").remaining}/${state.maxSelfHealPerStage}`,
				);
			}
			dispatchToController(state, { type: "SUBMIT", submission: { summary, artifacts, pass: true } });
			dispatchToController(state, { type: "RECORD_SIGNAL", signal: "complete" });
			return ok(
				`${stage.name} 完成${gateResult.soft ? "（机械检查软通过）" : ""}：${summary}\n剩余自愈预算：${state.stageSelfHealBudget(stage.name, "hard_gate").remaining}/${state.maxSelfHealPerStage}`,
			);
		},
	};
}
