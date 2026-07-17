import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { XddController } from "../core/controller.ts";
import { RuntimeStore } from "../storage/runtime-store.ts";
import type { XddRunnerState } from "../types.ts";
import { type EmptyDetails, type GetXddState, ok } from "./index.ts";
import { runAIGate, formatAIGateResult } from "../aigate.ts";
import { getAIGateLLM } from "../llm-ref.ts";
import { readFileSync, existsSync, statSync } from "node:fs";
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

function dispatchToController(state: XddRunnerState, command: Parameters<XddController["dispatch"]>[0]): void {
	const controller = new XddController(new RuntimeStore(state.cwd), state.plan.map(({ stage }) => stage));
	controller.dispatch(command);
}

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
			// Phase 4 (F.6): verify stage is read-only by contract. Reject
			// any artifact write that touches source code (src/, lib/,
			// tests/, etc.) -- the model must only write report/evidence.
			if (stage.noCodeModification) {
				const sourceCodePattern = /^(src|lib|tests?|bin|cmd|internal|pkg|source|app|server|client)\//;
				const codeWrites = artifacts.filter((p) => sourceCodePattern.test(p));
				if (codeWrites.length > 0) {
					throw new Error(
						`[xdd_submit_artifact] verify 阶段不可写源码：${codeWrites.join(", ")}。请只写 report/evidence（.xdd/runs/、.xdd/design/ 下的 .md 文件）。`,
					);
				}
			}
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
			// Bug 1: verify declared artifacts exist on disk before recording them.
			// Gives the agent immediate, specific feedback instead of a vague gate
			// failure later. Throws (no terminate) so the agent can create the file
			// and retry within the same turn.
			// Skip glob patterns (containing * or ?) -- the gate resolves those via
			// walkRel; only check literal file paths here.
			if (artifacts.length > 0) {
				const missing = artifacts.filter((p) => !/[*?]/.test(p) && !existsSync(join(state.cwd, p)));
				if (missing.length > 0) {
					throw new Error(
						`[xdd_submit_artifact] 声明的产物在磁盘上不存在：${missing.join(", ")}。请先创建产物文件再提交，不要盲目重试。`,
					);
				}
			}
			// Bug 2: disk fingerprint guard. If the agent retries submit with zero
			// disk changes (same files, same mtime/size), refuse -- don't waste
			// self-heal budget on identical retries. Must run BEFORE
			// beginSelfHealAttempt so no-change retries don't consume budget.
			// Phase 5 (E.3): expand glob patterns to all matching files first
			// so the fingerprint reflects the actual expanded set, not the
			// pattern literal (which statSync would silently fail on).
			if (artifacts.length > 0) {
				const { computeArtifactFingerprint } = await import("./artifact-fingerprint.ts");
				const fingerprint = computeArtifactFingerprint(state.cwd, artifacts);
				const changed = state.checkAndRecordSubmitFingerprint(stage.name, fingerprint);
				if (!changed) {
					throw new Error(
						`[xdd_submit_artifact] 上次提交后磁盘产物未变化。请先产出/修改产物文件再重试，不要盲目重试相同内容。`,
					);
				}
			}
			dispatchToController(state, { type: "RECORD_ARTIFACT_REVIEW", stage: stage.name, artifacts, selfAttack });
			state.beginSelfHealAttempt(stage.name);
			const remaining = state.remainingSelfHealBudget(stage.name);
			// Mechanical checks now provide one required AIGate input. They do
			// not independently pass or block a submission; AIGate owns the only
			// final verdict and returns the combined feedback to the agent.
			const mechanicalCheckResult = await stage.gate({ cwd: state.cwd, summary, desiredState: stage.desiredState });
			// --- AIGate: unified semantic + mechanical review ---
			const llmInfo = await getAIGateLLM();
			if (!llmInfo) {
				// There is no standalone mechanical-check fallback: without the model, the
				// single unified review cannot produce a verdict.
				state.refundSelfHealAttempt(stage.name);
				state.clearSubmitFingerprint(stage.name);
				const mechanicalDetail = mechanicalCheckResult.ok
					? "机械检查通过"
					: `机械检查未通过：${mechanicalCheckResult.reason ?? "未说明原因"}`;
				const error = `AIGate 模型不可用，无法执行统一审查；${mechanicalDetail}`;
				dispatchToController(state, { type: "SUBMIT", submission: { summary, artifacts, selfAttack, pass: false, error } });
				return {
					content: [{ type: "text", text: `⚠️ [AIGate] ${error}。机械检查结果为：${mechanicalCheckResult.ok ? "通过" : "未通过"}${mechanicalCheckResult.reason ? `（${mechanicalCheckResult.reason}）` : ""}\n本 turn 继续。请恢复模型配置后重新调用 xdd_submit_artifact；无需修改产物。` }],
					details: {},
				};
			}
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
					skillName: stage.skill,
					aigateStandard: stage.aigateStandard,
					artifactPaths: artifacts.length > 0 ? artifacts : stage.deliverablePaths,
					outputContract: stage.outputs,
					mechanicalCheckResult,
					cwd: state.cwd,
					intentAnchor,
				});
				// Transport and JSON-format failures are not findings about the
				// submitted artifacts. Do not spend either retry budget, and clear
				// the fingerprint so the agent can retry the same valid artifacts.
				if (aiResult.degraded) {
					state.refundSelfHealAttempt(stage.name);
					state.clearSubmitFingerprint(stage.name);
					const aiError = aiResult.issues.join("; ") || "AIGate 服务或响应格式异常";
					dispatchToController(state, { type: "SUBMIT", submission: { summary, artifacts, selfAttack, pass: false, error: aiError } });
					const angleText = formatAIGateResult(aiResult);
					return {
						content: [{ type: "text", text: `⚠️ [AIGate] ${stage.name} 审查服务/响应格式异常（未消耗自愈预算）：\n${angleText}\n本 turn 继续。请直接重新调用 xdd_submit_artifact；无需修改产物。` }],
						details: {},
					};
				}
				// A semantic AIGate failure consumes only the AIGate retry budget.
				const aiUsed = state.beginAiGateAttempt(stage.name);
				const aiRemaining = state.remainingAiGateBudget(stage.name);
				if (!aiResult.passed) {
					const aiError = aiResult.angles.filter((a) => a.passed === false).map((a) => a.name).join(", ") || "AIGate 多角度未通过";
					dispatchToController(state, { type: "SUBMIT", submission: { summary, artifacts, selfAttack, pass: false, error: aiError } });
					const angleText = formatAIGateResult(aiResult);
					const suggText = aiResult.suggestions.length > 0
						? "\n修改建议：\n" + aiResult.suggestions.map((s, n) => `${n + 1}. ${s}`).join("\n")
						: "";
					if (aiRemaining <= 0) {
						// The unified AIGate is bounded by its repair budget. Its
						// five repair attempts must be bounded: do not strand the ten
						// stage run on an unavailable/malformed review response. Preserve
						// the failed review in the audit, then soft-pass non-verdict
						// stages and terminate this turn. agent_end recognizes the
						// gate_passed boundary and queues the next turn automatically.
						if (stage.exit === "verdict") {
							return {
								content: [{ type: "text", text: `❌ [AIGate ${aiUsed}/${state.maxSelfHealPerStage}] ${stage.name} 多角度攻击未通过（自愈预算耗尽）：\n${angleText}${suggText}\n本轮提交失败。请调 xdd_diagnose 诊断根因，或 xdd_rollback 回退。` }],
								details: {},
								terminate: true,
							};
						}
						dispatchToController(state, { type: "RECORD_SIGNAL", signal: "complete" });
						dispatchToController(state, { type: "SUBMIT", submission: { summary, artifacts, selfAttack, pass: true } });
						return {
							content: [{ type: "text", text: `⚠️ [AIGate ${aiUsed}/${state.maxSelfHealPerStage}] ${stage.name} 统一审查未通过（自愈预算耗尽）：\n${angleText}${suggText}\nAIGate 已记录为告警，现软通过并自动进入下一轮推进。` }],
							details: {},
						};
					}
					// Layer 2: AIGate failed with budget remaining -- keep the
					// same agent turn alive. Semantic review feedback is actionable
					// context for the model; terminating here forced users to start a
					// new turn even though AIGate retry budget remains.
					return {
						content: [{ type: "text", text: `❌ [AIGate ${aiUsed}/${state.maxSelfHealPerStage}] ${stage.name} 多角度攻击未通过：\n${angleText}${suggText}\n剩余 AIGate 预算：${aiRemaining}\n本轮提交失败，但本 turn 继续。请根据审查反馈修复产物后重新调用 xdd_submit_artifact。` }],
						details: {},
					};
				}
			}
			// The unified AIGate passed -- mark "real progress" only here. Setting lastSubmitAt
			// before the gate (the old behavior) caused agent_end to mis-detect stalls
			// as progress and reset consecutiveStalls to 0 on every failed submit,
			// so the stall counter could climb to 40+ without ever triggering the
			// 3-turn escalation nudge.
			state.lastSubmitAt = Date.now();
			dispatchToController(state, { type: "SUBMIT", submission: { summary, artifacts, selfAttack, pass: true } });
			if (stage.exit === "verdict") {
				const pass = Boolean(params.pass);
				dispatchToController(state, { type: "RECORD_SIGNAL", signal: pass ? "verdict_pass" : "verdict_fail" });
				if (!pass) {
					return ok(
						`${stage.name} verdict: FAIL - ${summary}\n` +
							`⚠️ 验证未通过。如果是实现缺陷（代码 bug / 端点缺失 / 测试失败），请立即调 xdd_rollback("execute", "verify 验证失败，主动返回 execute 修复后重跑")。\n` +
							`如果是设计缺陷（规则不清 / 架构缺失 / 兜底不够），调 xdd_diagnose 诊断根因后回退到对应设计层。\n` +
							`不要问用户 -- 实现缺陷应回 execute 修复后重跑 verify。`,
					);
				}
				return ok(
					`${stage.name} verdict: pass - ${summary}\n剩余自愈预算：${remaining}/${state.maxSelfHealPerStage}${llmInfo ? "\nAIGate: 通过 ✅" : ""}`,
				);
			}
			dispatchToController(state, { type: "RECORD_SIGNAL", signal: "complete" });
			return ok(
				`${stage.name} 完成${mechanicalCheckResult.soft ? "（机械检查软通过）" : ""}：${summary}\n剩余自愈预算：${remaining}/${state.maxSelfHealPerStage}\nAIGate: 通过 ✅`,
			);
		},
	};
}
