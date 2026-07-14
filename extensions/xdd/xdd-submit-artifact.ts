import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { XddRunnerState } from "../types.ts";
import { type EmptyDetails, type GetXddState, ok } from "./index.ts";
import { runAIGate } from "../aigate.ts";
import { getAIGateLLM } from "../llm-ref.ts";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const schema = Type.Object({
	summary: Type.String({ description: "本阶段完成内容与产物路径摘要" }),
	artifacts: Type.Array(Type.String(), { description: "提交的产物文件路径列表" }),
	selfAttack: Type.String({
		description: "自我攻击结论：检查了哪些反例/风险/边界，结论是什么",
	}),
	pass: Type.Optional(Type.Boolean({ description: "仅 verify 阶段：是否通过验证" })),
});

export type XddSubmitArtifactInput = Static<typeof schema>;

export function createXddSubmitArtifactTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_submit_artifact",
		label: "xdd: submit artifact",
		description:
			"提交阶段产物 + 自我攻击结论，触发 Gate 验证。Gate 通过后调 xdd_advance 推进。verify 阶段需附 pass。",
		parameters: schema,
		async execute(_toolCallId, params: XddSubmitArtifactInput): Promise<AgentToolResult<EmptyDetails>> {
			const state: XddRunnerState = getState();
			const stage = state.currentStage();
			if (!stage) throw new Error("[xdd] 无活跃阶段");
			const summary = String(params.summary ?? "");
			const artifacts = params.artifacts ?? [];
			const selfAttack = String(params.selfAttack ?? "");
			state.lastSubmitAt = Date.now();
			if (selfAttack.trim().length < 20) {
				throw new Error(
					`[xdd_submit_artifact] selfAttack 过短（${selfAttack.trim().length} 字符）：必须记录具体检查了哪些反例/风险/边界及结论（至少 20 字符）`,
				);
			}
			const rejectPattern = /^(无|none|ok|n\/a|没有|passing|done|完成|ok了|n\/a\.|无异常|没问题)\s*\.?$/i;
			if (rejectPattern.test(selfAttack.trim())) {
				throw new Error(
					`[xdd_submit_artifact] selfAttack 内容无效（"${selfAttack.trim()}"）：必须记录具体检查了哪些反例/风险/边界及结论`,
				);
			}
			state.recordArtifact(stage.name, artifacts);
			state.recordSelfAttack(stage.name, selfAttack);
			state.recordEsgNode("review", stage.name, `self-attack: ${selfAttack.slice(0, 100)}`);
			const used = state.beginSelfHealAttempt(stage.name);
			const remaining = state.remainingSelfHealBudget(stage.name);
			const gate = await stage.gate({ cwd: state.cwd, summary, desiredState: stage.desiredState });
			if (!gate.ok) {
				if (remaining <= 0) {
					throw new Error(
						`[xdd_submit_artifact] ${stage.name} 自愈预算耗尽（${used}/${state.maxSelfHealPerStage}）：${gate.reason ?? "未知"}。请调 xdd_diagnose 进入反思。`,
					);
				}
				throw new Error(
					`[gate ${used}/${state.maxSelfHealPerStage}] ${stage.name} 未达标：${gate.reason ?? "未知"}\n剩余自愈预算：${remaining}。`,
				);
			}
			// --- AIGate: AI 语义审查（硬 Gate 通过后叠加） ---
			const llmInfo = await getAIGateLLM();
			if (llmInfo) {
				let intentAnchor: string | undefined;
				const intentPath = join(state.cwd, ".xdd/design/intent.md");
				if (existsSync(intentPath)) {
					intentAnchor = readFileSync(intentPath, "utf8");
				}
				const aiResult = await runAIGate({
					model: llmInfo.model,
					apiKey: llmInfo.apiKey,
					headers: llmInfo.headers,
					stageName: stage.name,
					aigateStandard: stage.aigateStandard,
					artifactPaths: artifacts.length > 0 ? artifacts : stage.deliverablePaths,
					cwd: state.cwd,
					intentAnchor,
				});
				if (!aiResult.passed) {
					const issueText = aiResult.issues.length > 0
						? aiResult.issues.map((i, n) => `${n + 1}. ${i}`).join("\n")
						: "AIGate 判定不通过（未给出具体问题）";
					const suggText = aiResult.suggestions.length > 0
						? "\n修改建议：\n" + aiResult.suggestions.map((s, n) => `${n + 1}. ${s}`).join("\n")
						: "";
					if (remaining <= 0) {
						throw new Error(
							`[AIGate ${used}/${state.maxSelfHealPerStage}] ${stage.name} 偷工减料（自愈预算耗尽）：\n${issueText}${suggText}\n请调 xdd_diagnose 进入反思。`,
						);
					}
					throw new Error(
						`[AIGate ${used}/${state.maxSelfHealPerStage}] ${stage.name} 偷工减料：\n${issueText}${suggText}\n剩余自愈预算：${remaining}。`,
					);
				}
			}
			if (stage.exit === "verdict") {
				const pass = Boolean(params.pass);
				state.recordSignal(pass ? "verdict_pass" : "verdict_fail");
				return ok(
					`${stage.name} verdict: ${pass ? "pass" : "fail"} - ${summary}\n剩余自愈预算：${remaining}/${state.maxSelfHealPerStage}${llmInfo ? "\nAIGate: 通过 ✅" : ""}`,
				);
			}
			state.recordSignal("complete");
			return ok(
				`${stage.name} 完成${gate.soft ? "（软通过）" : ""}：${summary}\n剩余自愈预算：${remaining}/${state.maxSelfHealPerStage}${llmInfo ? "\nAIGate: 通过 ✅" : ""}`,
			);
		},
	};
}
