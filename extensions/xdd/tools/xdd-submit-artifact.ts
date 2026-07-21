import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { XddController } from "../core/controller.ts";
import { RuntimeStore } from "../storage/runtime-store.ts";
import type { XddRunnerState, XddStageName } from "../types.ts";
import { type EmptyDetails, type GetXddState, ok } from "./index.ts";
import { runAIGate, formatAIGateResult, type AIGateResult } from "../aigate.ts";
import { getAIGateLLM } from "../llm-ref.ts";
import { evaluateHealingFailureClosure, evaluateVerifyEvidenceGateFull, runHarnessWithReceipt } from "../evidence/verify-gate.ts";
import { routeVerifyFailure, type VerifyFailureRoute } from "../verify-failure-routing.ts";
import { startAIGateProgress } from "../aigate-progress.ts";
import { digestReviewArtifactFiles, evaluateReviewVerdict, writeReviewVerdict, type ReviewType, type ReviewVerdict } from "../review-verdict.ts";
import { codeReviewFromAIGate, writeCodeReviewReport } from "../code-review.ts";
import { buildPreventionContext } from "../prevention-context.ts";
import { evaluateProductionPathPolicy } from "../production-path-policy.ts";
import { computeCanonicalScopeDigest, computeScopeDigest } from "../healing/content-digest.ts";
import { globToRegExp } from "../gate.ts";
import { blockingFindings, reconcileStableFindings } from "../healing/stable-findings.ts";
import { healingEnforced } from "../healing/mode.ts";

function elapsedMs(start: number): number {
	return Math.max(0, Math.round(performance.now() - start));
}

function reviewTypeForStage(stage: XddStageName): ReviewType {
	if (stage === "understand" || stage === "spec") return "requirement";
	if (stage === "architecture" || stage === "wire" || stage === "resilience") return "architecture";
	if (stage === "plan") return "qa";
	if (stage === "verify") return "security";
	return "code";
}

function modelIdentity(model: unknown): string {
	const candidate = model as { provider?: unknown; id?: unknown; name?: unknown };
	return [candidate.provider, candidate.id ?? candidate.name].filter(Boolean).map(String).join(":") || "configured-aigate-model";
}

function severityForAngle(name: string, findings: readonly string[]): "P0" | "P1" | "P2" {
	const text = `${name} ${findings.join(" ")}`;
	if (/\bP0\b/i.test(text)) return "P0";
	return /安全|权限|认证|越权|数据丢失|\bP1\b/i.test(text) ? "P1" : "P2";
}

function isReviewableSourceArtifact(path: string): boolean {
	if (path.startsWith(".xdd/") || /(^|\/)(?:tests?|docs?|fixtures?)(\/|$)/i.test(path)) return false;
	return /(^|\/)(?:src|lib|app|server|client|cmd|internal|pkg)(\/|$)/i.test(path)
		|| /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|cs|rb|php|swift|vue|svelte)$/i.test(path);
}

function changedProductionSources(cwd: string): string[] {
	return execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd, encoding: "utf8" })
		.split("\n").filter(Boolean)
		.map((line) => line.slice(3).split(" -> ").at(-1) ?? "")
		.filter(isReviewableSourceArtifact);
}

function persistAIGateReview(params: {
	state: XddRunnerState;
	stage: ReturnType<XddRunnerState["currentStage"]> & {};
	model: unknown;
	artifacts: string[];
	mechanicalReason?: string;
	selfAttack: string;
	result: AIGateResult;
	status: Exclude<ReviewVerdict["verdict"], "blocked">;
	overrideReason?: string;
	preventionPatternIds?: string[];
}): void {
	const { state, stage, model, artifacts, mechanicalReason, selfAttack, result, status, overrideReason, preventionPatternIds } = params;
	const artifactPaths = [...(artifacts.length > 0 ? artifacts : stage.deliverablePaths)];
	const artifactDigest = digestReviewArtifactFiles(state.cwd, artifactPaths);
	const runtime = new RuntimeStore(state.cwd).load();
	const reviewVerdict: ReviewVerdict = {
		schemaVersion: 1,
		reviewType: reviewTypeForStage(stage.name),
		artifactDigest,
		artifactPaths,
		noArtifactReason: artifactPaths.length === 0 && stage.name === "cleanup"
			? `cleanup 阶段无文件产物：${params.mechanicalReason ?? "机械检查确认现有工作树无需清理"}`
			: undefined,
		creatorId: state.stageEpoch,
		reviewerId: `pi-aigate:${modelIdentity(model)}`,
		model: modelIdentity(model),
		contextPolicy: "isolated",
		verdict: status,
		score: status === "pass" ? 100 : status === "inconclusive" ? 0 : 50,
		findings: (runtime?.aiGateFindings?.[stage.name] ?? [])
			.filter((finding) => finding.status === "open")
			.map(({ id, severity, category, evidence }) => ({ id, severity, category, evidence })),
		positivePathEvidence: [mechanicalReason ?? "机械 Gate 通过"],
		fallbackAttackEvidence: [selfAttack],
		overrides: overrideReason ? [{ actor: "xdd-aigate-budget-policy", reason: overrideReason, at: new Date().toISOString() }] : [],
		preventionPatternIds,
		verifyGeneration: runtime?.verifyGeneration ?? 0,
		healingCaseId: runtime?.activeHealingCaseId,
	};
	const reviewPolicy = evaluateReviewVerdict(reviewVerdict, artifactDigest, {
		requireIndependentReviewer: true,
		requirePositivePathEvidence: true,
		requireFallbackAttackEvidence: true,
		allowOverrides: Boolean(overrideReason),
	});
	if (!reviewPolicy.ok) throw new Error(`[xdd] AIGate review verdict policy failed: ${reviewPolicy.reasons.join("；")}`);
	writeReviewVerdict(state.cwd, stage.name, reviewVerdict);
	if (stage.name === "execute") {
		writeCodeReviewReport(state.cwd, codeReviewFromAIGate({
			artifactDigest,
			artifactPaths,
			creatorId: reviewVerdict.creatorId,
			reviewerId: reviewVerdict.reviewerId,
			model: reviewVerdict.model,
			status,
			result,
			preventionPatternIds,
		}));
	}
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
	healing: Type.Optional(Type.Object({
		failureId: Type.String(),
		changedPaths: Type.Array(Type.String()),
		commands: Type.Array(Type.String()),
		evidencePaths: Type.Array(Type.String()),
		summary: Type.String({ minLength: 20 }),
	})),
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
	route?: VerifyFailureRoute,
): AgentToolResult<EmptyDetails> {
	const controller = new XddController(new RuntimeStore(state.cwd), state.plan.map(({ stage: plannedStage }) => plannedStage));
	const rollback = controller.dispatch({
		type: "ROLLBACK", target, reason: `verify ${gate} 预算耗尽：${reason}`,
		failure: route ? { code: /^(\w+):/.exec(reason)?.[1] ?? "VERIFY_FAILURE", gateKind: "verdict", summary: reason, reason, files: [], remediation: route.closureCriteria.join("；") } : undefined,
		ownerScopes: route?.ownerScopes,
		closureCriteria: route?.closureCriteria,
	});
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
			let candidateFingerprint: string | undefined;
			const selfAttack = params.selfAttack?.trim();
			const runtime = new RuntimeStore(state.cwd).load();
			const activeHealing = runtime?.healingCases?.find((item) => item.id === runtime.activeHealingCaseId && item.status !== "closed" && item.status !== "abandoned");
			let healingClosure: import("../types.ts").HealingClosureEvidence | undefined;
			if (healingEnforced() && activeHealing && stage.name === activeHealing.targetStage) {
				if (!params.healing || params.healing.failureId !== activeHealing.id) throw new Error(`[xdd_submit_artifact] HEALING_CLOSURE_REQUIRED: active ${activeHealing.id} 必须提交 healing payload。请按 xdd_next_task 填写 failureId、changedPaths、commands、evidencePaths 和 summary。`);
				const outside = params.healing.changedPaths.filter((path) => !activeHealing.ownerScopes.some((scope) => globToRegExp(scope.endsWith("/**") ? `${scope}/*` : scope).test(path)));
				if (outside.length > 0) throw new Error(`[xdd_submit_artifact] HEALING_OWNER_SCOPE_MISMATCH: ${outside.join(", ")} 不在负责范围 ${activeHealing.ownerScopes.join(", ")}。请修改负责阶段产物，不要用无关文件绕过。`);
				if (params.healing.changedPaths.length === 0 || params.healing.commands.length === 0 || params.healing.evidencePaths.length === 0) throw new Error("[xdd_submit_artifact] HEALING_EVIDENCE_INCOMPLETE: changedPaths、commands、evidencePaths 均不能为空；请执行原 failure 的机械检查并保存证据。");
				const missingEvidence = params.healing.evidencePaths.filter((path) => !existsSync(join(state.cwd, path)) || !readFileSync(join(state.cwd, path), "utf8").includes(activeHealing.id));
				if (missingEvidence.length > 0) throw new Error(`[xdd_submit_artifact] HEALING_FAILURE_ID_MISSING: evidence 必须存在并引用 ${activeHealing.id}：${missingEvidence.join(", ")}。`);
				const ownerScopeDigest = computeScopeDigest(state.cwd, activeHealing.ownerScopes);
				if (ownerScopeDigest === activeHealing.baseline.ownerScopeDigest) throw new Error(`[xdd_submit_artifact] ARTIFACT_NON_SUBSTANTIVE_CHANGE: ${activeHealing.id} 负责范围内容 digest 未变化；touch、时间戳或 owner scope 外变化不能关闭 failure。`);
				if (activeHealing.baseline.ownerScopeCanonicalDigest && computeCanonicalScopeDigest(state.cwd, activeHealing.ownerScopes) === activeHealing.baseline.ownerScopeCanonicalDigest) throw new Error(`[xdd_submit_artifact] ARTIFACT_NON_SUBSTANTIVE_CHANGE: ${activeHealing.id} 仅检测到时间戳/generatedAt/格式变化；请修改负责范围的实质业务内容。`);
				healingClosure = { submittedAt: new Date().toISOString(), stage: stage.name, changedPaths: params.healing.changedPaths, ownerScopeDigest, commands: params.healing.commands, evidencePaths: params.healing.evidencePaths, summary: params.healing.summary };
			}
			if (stage.name === "execute") {
				const submitted = new Set(artifacts.filter(isReviewableSourceArtifact));
				const omitted = changedProductionSources(state.cwd).filter((path) => !submitted.has(path));
				if (submitted.size === 0 || omitted.length > 0) {
					throw new Error(`[xdd_submit_artifact] execute 必须声明全部变更的生产源码路径；缺少：${omitted.length > 0 ? omitted.join(", ") : "至少一个生产源码路径"}。Code Reviewer 不接受部分源码或只审 plan/docs/tests。`);
				}
			}
			if (stage.name === "execute") {
				const pathPolicy = evaluateProductionPathPolicy(state.cwd);
				if (!pathPolicy.ok) throw new Error(`[xdd_submit_artifact] ${pathPolicy.reason}`);
			}
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
				candidateFingerprint = computeArtifactFingerprint(state.cwd, artifacts);
				const changed = state.checkAndRecordSubmitFingerprint(stage.name, candidateFingerprint);
				if (!changed) {
					throw new Error(
						`[xdd_submit_artifact] 上次提交后磁盘产物未变化。请先产出/修改产物文件再重试，不要盲目重试相同内容。`,
					);
				}
			}
			dispatchToController(state, { type: "RECORD_ARTIFACT_REVIEW", stage: stage.name, artifacts });
			if (stage.name === "verify" && activeHealing) {
				const latest = new RuntimeStore(state.cwd).load();
				const receipt = await runHarnessWithReceipt(state.cwd, latest?.verifyGeneration ?? 0, latest?.activeHealingCaseId);
				dispatchToController(state, { type: "RECORD_VERIFY_RECEIPT", receipt });
			}
			const hardGateStartedAt = performance.now();
			const mechanicalCheckResult = await stage.gate({ cwd: state.cwd, summary, desiredState: stage.desiredState });
			const hardGateMs = elapsedMs(hardGateStartedAt);
			// A failed hard Gate and a semantic AIGate failure have independent
			// five-attempt budgets. A hard failure stops before AIGate so one
			// submission can never consume both counters.
			if (!mechanicalCheckResult.ok) {
				if (candidateFingerprint) state.recordSubmitFingerprint(stage.name, candidateFingerprint, false);
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
					return ok(`❌ [硬 Gate ${hardUsed}/${hardBudget.limit}] ${stage.name} 未通过且预算耗尽：${error}\n没有生成 review verdict，禁止软通过。请修复产物后重试，或诊断根因并回退到负责阶段。`);
				}
				const route = routeVerifyFailure({ summary, gateReason: error, failure: (mechanicalCheckResult as import("../evidence/verify-gate.ts").VerifyEvidenceGateResult).failure });
				return handleExhaustedVerifyFailure(state, error, "硬 Gate", hardUsed, hardBudget.limit, route.target, "", route);
			}
			if (activeHealing && healingClosure) {
				const originalFailure = await evaluateHealingFailureClosure(state.cwd, activeHealing.failure.code);
				if (!originalFailure.ok) throw new Error(`[xdd_submit_artifact] HEALING_ORIGINAL_FAILURE_OPEN: ${originalFailure.reason ?? activeHealing.failure.code}。请按 xdd_next_task 修复原 failure 并重跑指定命令。`);
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
				const prevention = buildPreventionContext(state.cwd, stage.name, `${state.userInput}\n${summary}`);
				try {
					aiResult = await runAIGate({
						model: llmInfo.model,
						apiKey: llmInfo.apiKey,
						headers: llmInfo.headers,
						env: llmInfo.env,
						stageName: stage.name,
						skillName: stage.skill,
						aigateStandard: [
							stage.aigateStandard,
							prevention.text,
							`稳定 finding 复核协议：先逐 ID 判断上一轮 open finding 是否 closed/still-open；新 P0/P1 可阻塞，新 P2 仅 backlog。上一轮：${(runtime?.aiGateFindings?.[stage.name] ?? []).filter((item) => item.status === "open").map((item) => `${item.id}:${item.category}`).join(", ") || "无"}。本轮 changed paths：${artifacts.join(", ") || "无文件产物"}。selfAttack 必须逐 ID 回答。`,
						].filter(Boolean).join("\n\n"),
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
						persistAIGateReview({ state, stage, model: llmInfo.model, artifacts, mechanicalReason: mechanicalCheckResult.reason, selfAttack: selfAttack!, result: aiResult, status: "inconclusive", overrideReason: `AIGate 基础设施连续 ${degradedUsed} 次不可用；保留审查记录并按软 Gate 策略放行，后续阶段继续攻击。`, preventionPatternIds: prevention.patternIds });
						const softPass = stage.exit !== "verdict" || Boolean(params.pass);
						dispatchToController(state, { type: "RECORD_SIGNAL", signal: stage.exit === "verdict" ? (softPass ? "verdict_pass" : "verdict_fail") : "complete" });
						dispatchToController(state, { type: "SUBMIT", submission: { summary, artifacts, selfAttack, pass: softPass } });
						return ok(`⚠️ [AIGate ${degradedUsed}/${degradedBudget.limit}] ${stage.name} 审查连续不可用（基础设施故障），已记录 inconclusive verdict 与软 Gate override。
原因：${aiError}
${angleText}
硬 Gate 已通过；不再为审查基础设施无限卡住流程。${formatSubmitTimings({ hardGateMs, aiGateMs, aiGateEnabled })}。请调用 xdd_advance 继续。`);
					}
					dispatchToController(state, { type: "SUBMIT", submission: { summary, artifacts, selfAttack, pass: false, error: aiError } });
					const retryAdvice = /timeout/i.test(aiError)
						? "审查请求已超时；请稍后重试，或调整 XDD_AIGATE_TIMEOUT_MS（15,000–600,000 毫秒）后重试；无需修改产物。"
						: "请恢复审查服务或模型配置后重新调用 xdd_submit_artifact；无需修改产物。";
					return {
						content: [{ type: "text", text: `⚠️ [AIGate degraded ${degradedUsed}/${degradedBudget.limit}] ${stage.name} 审查服务/响应格式异常（基础设施故障）：
原因：${aiError}
${angleText}
剩余 degraded 预算：${degradedBudget.remaining}/${degradedBudget.limit}（耗尽后记录 override 并软放行）
本 turn 继续。${formatSubmitTimings({ hardGateMs, aiGateMs, aiGateEnabled })}。${retryAdvice}` }],
						details: {},
					};
				}
				const findingStore = new RuntimeStore(state.cwd);
				const beforeFindings = findingStore.load()?.aiGateFindings?.[stage.name] ?? [];
				const stableFindings = reconcileStableFindings(stage.name, beforeFindings, aiResult.angles.filter((angle) => angle.passed === false).map((angle) => ({ severity: severityForAngle(angle.name, angle.findings), category: angle.name, evidence: angle.findings.join("；") || angle.name })));
				findingStore.update((current) => { current.aiGateFindings = { ...(current.aiGateFindings ?? {}), [stage.name]: stableFindings }; });
				// On resubmission, newly discovered P2 findings are backlog only. Existing
				// blockers and every new P0/P1 remain blocking, so the target converges.
				if (blockingFindings(stableFindings).length === 0) aiResult = { ...aiResult, passed: true };
				// AIGate produced a real verdict (not degraded infrastructure failure).
				// Do not reset here: a failing verdict must accumulate toward the
				// bounded retry limit. A successful verdict resets it below.
				if (!aiResult.passed) {
					if (candidateFingerprint) state.recordSubmitFingerprint(stage.name, candidateFingerprint, false);
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
						const hasPriorityBlocker = aiResult.angles.some((angle) =>
							angle.passed === false && severityForAngle(angle.name, angle.findings) !== "P2"
						);
						if (hasPriorityBlocker) {
							if (stage.exit === "verdict") {
								return handleExhaustedVerifyFailure(state, aiError, "AIGate P1", aiUsed, aiBudget.limit, diagnosedVerifyRollbackTarget(state), `\n${angleText}${suggText}`);
							}
							return ok(`❌ [AIGate ${aiUsed}/${aiBudget.limit}] ${stage.name} 审查发现不可 override 的 P0/P1 blocker：\n${angleText}${suggText}\n未写入无效 verdict、未记录完成信号。请回到负责阶段修复安全/权限/数据风险后重新提交。`);
						}
						persistAIGateReview({ state, stage, model: llmInfo.model, artifacts, mechanicalReason: mechanicalCheckResult.reason, selfAttack: selfAttack!, result: aiResult, status: "fail", overrideReason: `AIGate 已完成 ${aiUsed} 轮严格审查仍未收敛；按软 Gate 策略停止细节循环，保留 findings 供后续阶段继续验证。`, preventionPatternIds: prevention.patternIds });
						const softPass = stage.exit !== "verdict" || Boolean(params.pass);
						dispatchToController(state, { type: "RECORD_SIGNAL", signal: stage.exit === "verdict" ? (softPass ? "verdict_pass" : "verdict_fail") : "complete" });
						dispatchToController(state, { type: "SUBMIT", submission: { summary, artifacts, selfAttack, pass: softPass } });
						return ok(`⚠️ [AIGate ${aiUsed}/${aiBudget.limit}] ${stage.name} 严格审查达到预算上限：\n${angleText}${suggText}\n已保留 fail verdict/findings 并记录软 Gate override；${formatSubmitTimings({ hardGateMs, aiGateMs, aiGateEnabled })}。请调用 xdd_advance 继续。`);
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
				persistAIGateReview({ state, stage, model: llmInfo.model, artifacts, mechanicalReason: mechanicalCheckResult.reason, selfAttack: selfAttack!, result: aiResult, status: "pass", preventionPatternIds: prevention.patternIds });
			}
			// The unified AIGate passed -- mark "real progress" only here. Setting lastSubmitAt
			// before the gate (the old behavior) caused agent_end to mis-detect stalls
			// as progress and reset consecutiveStalls to 0 on every failed submit,
			// so the stall counter could climb to 40+ without ever triggering the
			// 3-turn escalation nudge.
			state.resetAiGateBudget(stage.name);
			if (activeHealing && healingClosure) dispatchToController(state, { type: "RECORD_HEALING_CLOSURE", caseId: activeHealing.id, closure: healingClosure });
			if (candidateFingerprint) state.recordSubmitFingerprint(stage.name, candidateFingerprint, stage.exit !== "verdict" || Boolean(params.pass));
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
					return handleExhaustedVerifyFailure(state, route.reason, "verify verdict", hardUsed, hardBudget.limit, route.target, "", route);
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
