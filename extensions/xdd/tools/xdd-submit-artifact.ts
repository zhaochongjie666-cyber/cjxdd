import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
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
			// Phase 3 (C) P28: bump stageEpoch on every artifact submit. This
			// is the signal to the context hook that a new "logical session"
			// has begun -- any context before this point is safe to drop.
			const attempt = state.currentAttempt(stage.name);
			state.stageEpoch = state.makeStageEpoch(stage.name, attempt);
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
			state.recordArtifact(stage.name, artifacts);
			state.recordSelfAttack(stage.name, selfAttack);
			state.recordEsgNode("review", stage.name, `self-attack: ${selfAttack.slice(0, 100)}`);
			// Phase 2 (B): mark "working" so the agent_end scheduler knows the
			// stage is mid-flight. The outcome will be re-written below based
			// on gate / AIGate results.
			state.stageOutcome = "working";
			state.lastStageError = undefined;
			const used = state.beginSelfHealAttempt(stage.name);
			const remaining = state.remainingSelfHealBudget(stage.name);
			const gate = await stage.gate({ cwd: state.cwd, summary, desiredState: stage.desiredState });
			if (!gate.ok) {
				state.stageOutcome = "hard_gate_failed";
				state.lastStageError = gate.reason ?? "未知";
				if (remaining <= 0) {
					// Layer 1: self-heal budget exhausted -- soft-pass (non-blocking).
					// For non-verdict stages: record 'complete' so xdd_advance can
					// proceed to the next stage. "能做多少做多少，别卡住".
					// For verdict stages: do NOT soft-pass -- verify failure must go
					// through Layer 2 (flow rollback), so keep throwing.
					if (stage.exit !== "verdict") {
						state.recordSignal("complete");
						state.stageOutcome = "gate_passed"; // soft-pass = passed
						return ok(
							`[soft-pass] ${stage.name} 自愈预算耗尽（${used}/${state.maxSelfHealPerStage}），软通过进下一阶段。` +
								`\nGate: ${gate.reason ?? "未知"}（未达标但放行）` +
								"\nAIGate: 跳过（软通过模式）",
						);
					}
					// Layer 2: terminate the turn so the runner can trigger reflectTurn.
					// Returning (not throwing) with terminate:true prevents the agent
					// from blindly retrying within the same turn.
					return {
						content: [{ type: "text", text: `❌ [xdd_submit_artifact] ${stage.name} 自愈预算耗尽（${used}/${state.maxSelfHealPerStage}）：${gate.reason ?? "未知"}\n本轮提交失败，turn 结束。下轮将进入反思，请诊断并修复后重新提交。` }],
						details: {},
						terminate: true,
					};
				}
				// Layer 2: gate failed with budget remaining -- terminate the turn.
				return {
					content: [{ type: "text", text: `❌ [gate ${used}/${state.maxSelfHealPerStage}] ${stage.name} 未达标：${gate.reason ?? "未知"}\n剩余自愈预算：${remaining}\n本轮提交失败，turn 结束。请诊断问题并修复产物，下轮重新提交。` }],
					details: {},
					terminate: true,
				};
			}
			// --- AIGate: AI 语义审查（硬 Gate 通过后叠加） ---
			const llmInfo = await getAIGateLLM();
			if (llmInfo) {
				let intentAnchor: string | undefined;
				const intentPath = join(state.cwd, ".xdd/design/intent.md");
				if (existsSync(intentPath)) {
					intentAnchor = readFileSync(intentPath, "utf8");
				}
				// Phase 5 (E.2): AIGate has its own budget counter, independent
				// of the hard-Gate budget. A failed AIGate now only burns
				// AIGate budget, leaving hard-Gate budget untouched (and vice
				// versa).
				const aiUsed = state.beginAiGateAttempt(stage.name);
				const aiRemaining = state.remainingAiGateBudget(stage.name);
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
					state.stageOutcome = "ai_gate_failed";
					state.lastStageError = aiResult.angles.filter((a) => a.passed === false).map((a) => a.name).join(", ") || "AIGate 多角度未通过";
					const angleText = formatAIGateResult(aiResult);
					const suggText = aiResult.suggestions.length > 0
						? "\n修改建议：\n" + aiResult.suggestions.map((s, n) => `${n + 1}. ${s}`).join("\n")
						: "";
					if (aiRemaining <= 0) {
						// Layer 1: AIGate budget exhausted -- hard-fail (E.1).
						// Per P5 plan: "硬 Gate 永不 soft-pass; 预算耗尽 →
						// diagnose/rollback/fail". No more soft-pass escape hatch.
						if (stage.exit === "verdict") {
							return {
								content: [{ type: "text", text: `❌ [AIGate ${aiUsed}/${state.maxSelfHealPerStage}] ${stage.name} 多角度攻击未通过（自愈预算耗尽）：\n${angleText}${suggText}\n本轮提交失败。请调 xdd_diagnose 诊断根因，或 xdd_rollback 回退。` }],
								details: {},
								terminate: true,
							};
						}
						// Non-verdict: still hard-fail (P5 E.1); agent must
						// diagnose/rollback rather than soft-pass.
						return {
							content: [{ type: "text", text: `❌ [AIGate ${aiUsed}/${state.maxSelfHealPerStage}] ${stage.name} 多角度攻击未通过（自愈预算耗尽）：\n${angleText}${suggText}\n本轮提交失败。请调 xdd_diagnose 诊断根因，或 xdd_rollback 回退。` }],
							details: {},
							terminate: true,
						};
					}
					// Layer 2: AIGate failed with budget remaining -- terminate the turn.
					return {
						content: [{ type: "text", text: `❌ [AIGate ${aiUsed}/${state.maxSelfHealPerStage}] ${stage.name} 多角度攻击未通过：\n${angleText}${suggText}\n剩余 AIGate 预算：${aiRemaining}\n本轮提交失败，turn 结束。请诊断问题并修复产物，下轮重新提交。` }],
						details: {},
						terminate: true,
					};
				}
			}
			// All gates passed -- mark "real progress" only here. Setting lastSubmitAt
			// before the gate (the old behavior) caused agent_end to mis-detect stalls
			// as progress and reset consecutiveStalls to 0 on every failed submit,
			// so the stall counter could climb to 40+ without ever triggering the
			// 3-turn escalation nudge.
			state.lastSubmitAt = Date.now();
			state.stageOutcome = "gate_passed";
			state.lastStageError = undefined;
			if (stage.exit === "verdict") {
				const pass = Boolean(params.pass);
				state.recordSignal(pass ? "verdict_pass" : "verdict_fail");
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
			state.recordSignal("complete");
			return ok(
				`${stage.name} 完成${gate.soft ? "（软通过）" : ""}：${summary}\n剩余自愈预算：${remaining}/${state.maxSelfHealPerStage}${llmInfo ? "\nAIGate: 通过 ✅" : ""}`,
			);
		},
	};
}
