import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { XddController } from "../core/controller.ts";
import { RuntimeStore } from "../storage/runtime-store.ts";
import type { XddRunnerState, XddStageName } from "../types.ts";
import { type EmptyDetails, type GetXddState, ok } from "./index.ts";
import { runAIGate, formatAIGateResult, type AIGateResult } from "../aigate.ts";
import { getAIGateLLM } from "../llm-ref.ts";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { evaluateVerifyEvidenceGateFull } from "../evidence/verify-gate.ts";
import { routeVerifyFailure } from "../verify-failure-routing.ts";
import { startAIGateProgress } from "../aigate-progress.ts";

function elapsedMs(start: number): number {
	return Math.max(0, Math.round(performance.now() - start));
}

function formatSubmitTimings(timings: { hardGateMs?: number; aiGateMs?: number; aiGateEnabled?: boolean }): string {
	const parts = [`硬 Gate ${timings.hardGateMs ?? 0}ms`];
	if (timings.aiGateEnabled) parts.push(`AIGate/AI 推理 ${timings.aiGateMs ?? 0}ms`);
	else parts.push("AIGate 已跳过");
	return `耗时：${parts.join("；")}`;
}

const schema = Type.Object({
	summary: Type.String({ description: "本阶段完成内容与产物路径摘要" }),
	artifacts: Type.Array(Type.String(), { description: "提交的产物文件路径列表" }),
	selfAttack: Type.Optional(Type.String({
		description: "本次 AIGate 提交对应的自我攻击结论；随 AIGate 每次语义审查提交，记录在 runtime，绝不写入 design",
	})),
	pass: Type.Optional(Type.Boolean({ description: "仅 verify 阶段：是否通过验证" })),
});

export type XddSubmitArtifactInput = Static<typeof schema>;

function dispatchToController(state: XddRunnerState, command: Parameters<XddController["dispatch"]>[0]) {
	const controller = new XddController(new RuntimeStore(state.cwd), state.plan.map(({ stage }) => stage));
	return controller.dispatch(command);
}

const diagnoseRollbackTarget: Readonly<Record<string, XddStageName>> = {
	"intent-unclear": "understand",
	"spec-gap": "spec",
	"architecture-flaw": "architecture",
	"wiring-bug": "wire",
	"implementation-bug": "execute",
	"test-gap": "execute",
	"cleanup-missed": "cleanup",
};

/** Verify cannot soft-pass: exhaustion automatically consumes flow budget and rolls back. */
function handleExhaustedVerifyFailure(
	state: XddRunnerState,
	reason: string,
	gate: string,
	used: number,
	limit: number,
	target: XddStageName,
	detail = "",
): AgentToolResult<EmptyDetails> {
	const controller = new XddController(new RuntimeStore(state.cwd), state.plan.map(({ stage: plannedStage }) => plannedStage));
	const rollback = controller.dispatch({ type: "ROLLBACK", target, reason: `verify ${gate} 预算耗尽：${reason}` });
	if (rollback.state.status === "failed") {
		return {
			content: [{ type: "text", text: `❌ [${gate} ${used}/${limit}] verify 未通过且自愈预算耗尽。${rollback.state.lastStageError ?? "流程预算耗尽，流程退出"}。${detail}` }],
			details: {},
			terminate: true,
		};
	}
	return ok(`⚠️ [${gate} ${used}/${limit}] verify 未通过且自愈预算耗尽：${reason}${detail}
已消耗流程回退预算（${rollback.state.flowRollbackCount}/${rollback.state.flowRollbackLimit}），自动回退 verify → ${target}。请在 ${target} 修复后重新推进 verify。`);
}

function diagnosedVerifyRollbackTarget(state: XddRunnerState): XddStageName {
	const diagnosis = state.getDiagnose();
	const diagnosedTarget = diagnosis ? diagnoseRollbackTarget[diagnosis.layer] : "execute";
	return state.plan.some(({ stage }) => stage.name === diagnosedTarget)
		? diagnosedTarget
		: state.plan[Math.max(0, state.planIndex - 1)]?.stage.name ?? "execute";
}

export function createXddSubmitArtifactTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_submit_artifact",
		label: "xdd: submit artifact",
		description:
			"提交阶段产物并触发硬 Gate；硬 Gate 通过且阶段启用 AIGate 时，会继续调用 LLM 做 AI 语义审查（因此可能较慢）。selfAttack 随每次 AIGate 语义审查提交；verify 需附 pass。Gate 通过后调 xdd_advance 推进。",
		parameters: schema,
		async execute(_toolCallId, params: XddSubmitArtifactInput, _onUpdate, ctx): Promise<AgentToolResult<EmptyDetails>> {
			const state: XddRunnerState = getState();
			const stage = state.currentStage();
			if (!stage) throw new Error("[xdd] 无活跃阶段");
			const summary = String(params.summary ?? "");
			const artifacts = params.artifacts ?? [];
			const selfAttack = params.selfAttack?.trim();
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
			// Self-attack is an AIGate-coupled review note, never a design-stage deliverable.
			if (selfAttack && selfAttack.length < 20) {
				throw new Error(
					`[xdd_submit_artifact] selfAttack 过短（${selfAttack.length} 字符）：必须记录本次 run 检查过的反例/风险/边界及结论（至少 20 字符）`,
				);
			}
			const rejectPattern = /^(无|none|ok|n\/a|没有|passing|done|完成|ok了|n\/a\.|无异常|没问题)\s*\.?$/i;
			if (selfAttack && rejectPattern.test(selfAttack)) {
				throw new Error(
					`[xdd_submit_artifact] selfAttack 内容无效（"${selfAttack}"）：必须记录本次 run 检查过的反例/风险/边界及结论`,
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
			dispatchToController(state, { type: "RECORD_ARTIFACT_REVIEW", stage: stage.name, artifacts });
			const hardGateStartedAt = performance.now();
			const mechanicalCheckResult = await stage.gate({ cwd: state.cwd, summary, desiredState: stage.desiredState });
			const hardGateMs = elapsedMs(hardGateStartedAt);
			// A failed hard Gate and a semantic AIGate failure have independent
			// five-attempt budgets. A hard failure stops before AIGate so one
			// submission can never consume both counters.
			if (!mechanicalCheckResult.ok) {
				const hardUsed = state.beginSelfHealAttempt(stage.name);
				const hardBudget = state.stageSelfHealBudget(stage.name, "hard_gate");
				const error = mechanicalCheckResult.reason ?? "硬 Gate 未通过";
				dispatchToController(state, { type: "SUBMIT", submission: { summary, artifacts, selfAttack, pass: false, error } });
				if (!hardBudget.exhausted) {
					return {
						content: [{ type: "text", text: `❌ [硬 Gate ${hardUsed}/${hardBudget.limit}] ${stage.name} 未通过：${error}\n剩余硬 Gate 自愈预算：${hardBudget.remaining}/${hardBudget.limit}。本轮提交失败，但本 turn 继续。请修复产物后重新调用 xdd_submit_artifact。` }],
						details: {},
					};
				}
				if (stage.exit !== "verdict") {
					dispatchToController(state, { type: "RECORD_SIGNAL", signal: "complete" });
					dispatchToController(state, { type: "SUBMIT", submission: { summary, artifacts, selfAttack, pass: true } });
					return ok(`⚠️ [硬 Gate ${hardUsed}/${hardBudget.limit}] ${stage.name} 未通过且预算耗尽：${error}\n硬 Gate 告警已记录，现软通过；请调用 xdd_advance 自动推进。`);
				}
				return handleExhaustedVerifyFailure(state, error, "硬 Gate", hardUsed, hardBudget.limit, diagnosedVerifyRollbackTarget(state));
			}
			// --- AIGate: semantic review after the hard Gate passes ---
			const aiGateEnabled = stage.aiGate?.enabled !== false;
			if (aiGateEnabled && !selfAttack) {
				throw new Error("[xdd_submit_artifact] AIGate 语义审查必须随本次提交提供 selfAttack；每次 AIGate 重提都要写本轮攻击检查，不是整个 run 只能一次。");
			}
			if (selfAttack) {
				dispatchToController(state, { type: "RECORD_ARTIFACT_REVIEW", stage: stage.name, artifacts, selfAttack });
			}
			const llmInfo = aiGateEnabled ? await getAIGateLLM() : null;
			if (aiGateEnabled && !llmInfo) {
				// AIGate infrastructure failures are retryable and consume neither budget.
				state.clearSubmitFingerprint(stage.name);
				const mechanicalDetail = mechanicalCheckResult.ok
					? "机械检查通过"
					: `机械检查未通过：${mechanicalCheckResult.reason ?? "未说明原因"}`;
				const error = `AIGate 模型不可用，无法执行统一审查；${mechanicalDetail}`;
				dispatchToController(state, { type: "SUBMIT", submission: { summary, artifacts, selfAttack, pass: false, error } });
				return {
					content: [{ type: "text", text: `⚠️ [AIGate] ${error}。机械检查结果为：${mechanicalCheckResult.ok ? "通过" : "未通过"}${mechanicalCheckResult.reason ? `（${mechanicalCheckResult.reason}）` : ""}\n本 turn 继续。${formatSubmitTimings({ hardGateMs, aiGateMs: 0, aiGateEnabled })}。请恢复模型配置后重新调用 xdd_submit_artifact；无需修改产物。` }],
					details: {},
				};
			}
			let aiGateMs = 0;
			if (llmInfo) {
				const aiGateStartedAt = performance.now();
				let intentAnchor: string | undefined;
				const intentPath = join(state.cwd, ".xdd/design/intent.md");
				if (existsSync(intentPath)) {
					intentAnchor = readFileSync(intentPath, "utf8");
				}
				const finishProgress = startAIGateProgress(ctx?.ui, stage.name);
				let aiResult: AIGateResult;
				try {
					aiResult = await runAIGate({
						model: llmInfo.model,
						apiKey: llmInfo.apiKey,
						headers: llmInfo.headers,
						env: llmInfo.env,
						stageName: stage.name,
						skillName: stage.skill,
						aigateStandard: stage.aigateStandard,
						artifactPaths: artifacts.length > 0 ? artifacts : stage.deliverablePaths,
						outputContract: stage.outputs,
						mechanicalCheckResult,
						cwd: state.cwd,
						intentAnchor,
						contextPatterns: stage.aiGate?.contextPatterns,
						submissionSummary: summary,
					});
				} finally {
					finishProgress();
				}
				aiGateMs = elapsedMs(aiGateStartedAt);
				// Transport and JSON-format failures are not findings about the
				// submitted artifacts. Do not spend the semantic-review budget, but
				// DO consume a degraded-attempt counter to prevent infinite retry
				// loops when the LLM API is persistently broken. Hard gate already
				// passed, so the artifacts are mechanically valid.
				if (aiResult.degraded) {
					state.clearSubmitFingerprint(stage.name);
					const degradedUsed = state.beginAiGateAttempt(stage.name);
					const degradedBudget = state.stageSelfHealBudget(stage.name, "ai_gate");
					const aiError = aiResult.issues.join("; ") || "AIGate 服务或响应格式异常";
					const angleText = formatAIGateResult(aiResult);
					if (degradedBudget.exhausted) {
						dispatchToController(state, { type: "RECORD_SIGNAL", signal: "complete" });
						dispatchToController(state, { type: "SUBMIT", submission: { summary, artifacts, selfAttack, pass: true } });
						return ok(`⚠️ [AIGate ${degradedUsed}/${degradedBudget.limit}] ${stage.name} 审查连续不可用（基础设施故障），告警已记录，现软通过。
原因：${aiError}
${angleText}
硬 Gate 已通过，产物机械验证合格。${formatSubmitTimings({ hardGateMs, aiGateMs, aiGateEnabled })}。请调用 xdd_advance 自动推进。`);
					}
					dispatchToController(state, { type: "SUBMIT", submission: { summary, artifacts, selfAttack, pass: false, error: aiError } });
					const retryAdvice = /timeout/i.test(aiError)
						? "审查请求已超时；请稍后重试，或调整 XDD_AIGATE_TIMEOUT_MS（15,000–600,000 毫秒）后重试；无需修改产物。"
						: "请恢复审查服务或模型配置后重新调用 xdd_submit_artifact；无需修改产物。";
					return {
						content: [{ type: "text", text: `⚠️ [AIGate degraded ${degradedUsed}/${degradedBudget.limit}] ${stage.name} 审查服务/响应格式异常（基础设施故障）：
原因：${aiError}
${angleText}
剩余 degraded 预算：${degradedBudget.remaining}/${degradedBudget.limit}（耗尽后将软通过）
本 turn 继续。${formatSubmitTimings({ hardGateMs, aiGateMs, aiGateEnabled })}。${retryAdvice}` }],
						details: {},
					};
				}
				// AIGate produced a real verdict (not degraded infrastructure failure).
				// Reset the degraded-attempt counter so the next degraded episode
				// starts fresh.
				state.resetAiGateBudget(stage.name);
				if (!aiResult.passed) {
					// A semantic AIGate failure consumes only the AIGate retry budget.
					const aiUsed = state.beginAiGateAttempt(stage.name);
					const aiBudget = state.stageSelfHealBudget(stage.name, "ai_gate");
					const aiRemaining = aiBudget.remaining;
					const aiError = aiResult.angles.filter((a) => a.passed === false).map((a) => a.name).join(", ") || "AIGate 多角度未通过";
					dispatchToController(state, { type: "SUBMIT", submission: { summary, artifacts, selfAttack, pass: false, error: aiError, gateKind: "ai_gate" } });
					const angleText = formatAIGateResult(aiResult);
					const suggText = aiResult.suggestions.length > 0
						? "\n修改建议：\n" + aiResult.suggestions.map((s, n) => `${n + 1}. ${s}`).join("\n")
						: "";
					if (aiBudget.exhausted) {
						if (stage.exit === "verdict") {
							return handleExhaustedVerifyFailure(state, aiError, "AIGate", aiUsed, aiBudget.limit, diagnosedVerifyRollbackTarget(state), `${angleText}${suggText}`);
						}
						dispatchToController(state, { type: "RECORD_SIGNAL", signal: "complete" });
						dispatchToController(state, { type: "SUBMIT", submission: { summary, artifacts, selfAttack, pass: true } });
						return ok(`⚠️ [AIGate ${aiUsed}/${aiBudget.limit}] ${stage.name} 统一审查未通过且预算耗尽：\n${angleText}${suggText}\nAIGate 告警已记录，现软通过；${formatSubmitTimings({ hardGateMs, aiGateMs, aiGateEnabled })}。请调用 xdd_advance 自动推进。`);
					}
					// Layer 2: AIGate failed with budget remaining -- keep the
					// same agent turn alive. Semantic review feedback is actionable
					// context for the model; terminating here forced users to start a
					// new turn even though AIGate retry budget remains.
					return {
						content: [{ type: "text", text: `❌ [AIGate ${aiUsed}/${state.maxSelfHealPerStage}] ${stage.name} 多角度攻击未通过：\n${angleText}${suggText}\n剩余 AIGate 自愈预算：${aiRemaining}/${aiBudget.limit}\n本轮提交失败，但本 turn 继续。${formatSubmitTimings({ hardGateMs, aiGateMs, aiGateEnabled })}。请根据审查反馈修复产物后重新调用 xdd_submit_artifact。` }],
						details: {},
					};
				}
			}
			// The unified AIGate passed -- mark "real progress" only here. Setting lastSubmitAt
			// before the gate (the old behavior) caused agent_end to mis-detect stalls
			// as progress and reset consecutiveStalls to 0 on every failed submit,
			// so the stall counter could climb to 40+ without ever triggering the
			// 3-turn escalation nudge.
			state.resetAiGateBudget(stage.name);
			state.lastSubmitAt = Date.now();
			if (stage.exit === "verdict") {
				const pass = Boolean(params.pass);
				dispatchToController(state, { type: "RECORD_SIGNAL", signal: pass ? "verdict_pass" : "verdict_fail" });
				if (!pass) {
					const verifyResult = await evaluateVerifyEvidenceGateFull(state.cwd);
					const route = routeVerifyFailure({ summary, gateReason: verifyResult.reason, failure: verifyResult.failure });
					// A failed verdict follows the same five-attempt local repair rule as
					// every other verify failure. Only exhaustion spends the flow-level
					// rollback budget and returns to the stage that owns the defect.
					const hardUsed = state.beginSelfHealAttempt(stage.name);
					const hardBudget = state.stageSelfHealBudget(stage.name, "hard_gate");
					dispatchToController(state, { type: "SUBMIT", submission: { summary, artifacts, selfAttack, pass: false, error: route.reason } });
					if (!hardBudget.exhausted) {
						return {
							content: [{ type: "text", text: `❌ [verify verdict ${hardUsed}/${hardBudget.limit}] verify 未通过：${route.reason}\n剩余硬 Gate 自愈预算：${hardBudget.remaining}/${hardBudget.limit}。本轮提交失败，但本 turn 继续。请修复后重新调用 xdd_submit_artifact。` }],
							details: {},
						};
					}
					return handleExhaustedVerifyFailure(state, route.reason, "verify verdict", hardUsed, hardBudget.limit, route.target);
				}
				dispatchToController(state, { type: "SUBMIT", submission: { summary, artifacts, selfAttack, pass: true } });
				return ok(
					`${stage.name} verdict: pass - ${summary}\n剩余硬 Gate 自愈预算：${state.stageSelfHealBudget(stage.name, "hard_gate").remaining}/${state.maxSelfHealPerStage}\n剩余 AIGate 自愈预算：${state.stageSelfHealBudget(stage.name, "ai_gate").remaining}/${state.maxSelfHealPerStage}${llmInfo ? "\nAIGate: 通过 ✅" : ""}\n${formatSubmitTimings({ hardGateMs, aiGateMs, aiGateEnabled })}`,
				);
			}
			dispatchToController(state, { type: "SUBMIT", submission: { summary, artifacts, selfAttack, pass: true } });
			dispatchToController(state, { type: "RECORD_SIGNAL", signal: "complete" });
			return ok(
				`${stage.name} 完成${mechanicalCheckResult.soft ? "（机械检查软通过）" : ""}：${summary}\n剩余硬 Gate 自愈预算：${state.stageSelfHealBudget(stage.name, "hard_gate").remaining}/${state.maxSelfHealPerStage}\n剩余 AIGate 自愈预算：${state.stageSelfHealBudget(stage.name, "ai_gate").remaining}/${state.maxSelfHealPerStage}${aiGateEnabled ? "\nAIGate: 通过 ✅" : "\nAIGate: 已按阶段契约跳过"}\n${formatSubmitTimings({ hardGateMs, aiGateMs, aiGateEnabled })}`,
			);
		},
	};
}
