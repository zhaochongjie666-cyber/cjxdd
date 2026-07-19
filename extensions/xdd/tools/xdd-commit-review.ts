import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runAIGate, type AIGateResult } from "../aigate.ts";
import { commitReviewFromAIGate, evaluateCommitReviewGate, readCommitReviewReport, readStagedSnapshot, writeCommitReviewReport } from "../commit-review.ts";
import { getAIGateLLM } from "../llm-ref.ts";
import type { EmptyDetails, GetXddState } from "./index.ts";
import { buildPreventionContext } from "../prevention-context.ts";

const schema = Type.Object({
	summary: Type.String({ description: "本次 staged diff 的目标与风险摘要" }),
	selfAttack: Type.String({ minLength: 20, description: "提交者对权限、测试、密钥、迁移、契约、韧性降级的自查" }),
});
type Input = Static<typeof schema>;

function modelIdentity(model: unknown): string {
	const candidate = model as { provider?: unknown; id?: unknown; name?: unknown };
	return [candidate.provider, candidate.id ?? candidate.name].filter(Boolean).map(String).join(":") || "configured-aigate-model";
}

export function createXddCommitReviewTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_commit_review",
		label: "xdd: review staged commit diff",
		description: "只读审查 git staged diff，并把 verdict 绑定 index tree/diff digest。提交前必须运行；高风险 finding 不可 override，普通细节连续 3 轮后软放行。",
		parameters: schema,
		async execute(_toolCallId, params: Input): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			const snapshot = readStagedSnapshot(state.cwd);
			if (!snapshot.patch.trim()) return { content: [{ type: "text", text: "[xdd_commit_review] 暂存区为空；先精确 git add 待提交文件。" }], details: {} };
			const llm = await getAIGateLLM();
			if (!llm) return { content: [{ type: "text", text: "[xdd_commit_review] Pi 当前 reviewer 模型或凭证不可用，无法审查 staged diff。" }], details: {} };
			const runDir = join(state.cwd, ".xdd", "runs", "xdd_run");
			const prevention = buildPreventionContext(state.cwd, "commit", `${params.summary}\n${snapshot.patch}`);
			mkdirSync(runDir, { recursive: true });
			const patchPath = join(runDir, "commit-review-input.patch");
			writeFileSync(patchPath, snapshot.patch, { mode: 0o600 });
			let result: AIGateResult;
			try {
				result = await runAIGate({
					model: llm.model,
					apiKey: llm.apiKey,
					headers: llm.headers,
					env: llm.env,
					stageName: "commit",
					skillName: "xdd-git-commit",
					aigateStandard: ["只审 staged diff；逐项检查权限删除、测试弱化、密钥泄漏、破坏性迁移、契约破坏、韧性降级。引用具体 diff 行，不修改文件。", prevention.text].filter(Boolean).join("\n\n"),
					artifactPaths: [".xdd/runs/xdd_run/commit-review-input.patch"],
					mechanicalCheckResult: { ok: true, reason: `git index tree ${snapshot.treeHash}` },
					cwd: state.cwd,
					submissionSummary: `${params.summary}\n提交者自查：${params.selfAttack}`,
				});
			} finally {
				rmSync(patchPath, { force: true });
			}
			const previous = readCommitReviewReport(state.cwd);
			const attempt = previous?.diffDigest === snapshot.diffDigest ? (previous.attempt ?? 0) + 1 : 1;
			const critical = result.angles.some((angle) => angle.passed === false && /权限校验删除|密钥泄漏|破坏性迁移/.test(angle.name));
			const override = !result.passed && !critical && attempt >= 3
				? { actor: "xdd-commit-review-budget", reason: "同一 staged diff 已完成三轮严格审查，剩余非高风险细节保留后按软 Gate 策略放行。", at: new Date().toISOString() }
				: undefined;
			const report = commitReviewFromAIGate(snapshot, result, `pi-aigate:${modelIdentity(llm.model)}`, modelIdentity(llm.model), attempt, override);
			report.preventionPatternIds = prevention.patternIds;
			writeCommitReviewReport(state.cwd, report);
			const gate = evaluateCommitReviewGate(state.cwd);
			const prefix = gate.ok ? "✅" : "❌";
			return { content: [{ type: "text", text: `${prefix} [xdd_commit_review] attempt ${attempt}/3；${gate.ok ? "staged diff 审查可提交" : gate.reason}` }], details: {} };
		},
	};
}
