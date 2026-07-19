import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AIGateResult, XddAIGateAngleStatus } from "./aigate.ts";
import { digestReviewArtifactFiles } from "./review-verdict.ts";
import type { XddGateResult } from "./types.ts";

export const CODE_REVIEW_ANGLES = [
	"空值安全攻击",
	"并发安全攻击",
	"资源生命周期攻击",
	"授权与注入攻击",
	"错误处理攻击",
	"架构漂移攻击",
] as const;

export interface CodeReviewCheck {
	name: string;
	passed: XddAIGateAngleStatus;
	findings: string[];
}

export interface CodeReviewReport {
	schemaVersion: 1;
	readonly: true;
	artifactDigest: string;
	artifactPaths: string[];
	creatorId: string;
	reviewerId: string;
	model: string;
	verdict: "pass" | "fail" | "inconclusive";
	checks: CodeReviewCheck[];
	createdAt: string;
	preventionPatternIds?: string[];
}

export function writeCodeReviewReport(cwd: string, report: CodeReviewReport): string {
	const path = join(cwd, ".xdd", "runs", "xdd_run", "code-review.json");
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporary, path);
	return path;
}

export function codeReviewFromAIGate(params: {
	artifactDigest: string;
	artifactPaths: string[];
	creatorId: string;
	reviewerId: string;
	model: string;
	status: CodeReviewReport["verdict"];
	result: AIGateResult;
	preventionPatternIds?: string[];
}): CodeReviewReport {
	return {
		schemaVersion: 1,
		readonly: true,
		artifactDigest: params.artifactDigest,
		artifactPaths: [...params.artifactPaths],
		creatorId: params.creatorId,
		reviewerId: params.reviewerId,
		model: params.model,
		verdict: params.status,
		checks: params.result.angles
			.filter((angle) => CODE_REVIEW_ANGLES.includes(angle.name as typeof CODE_REVIEW_ANGLES[number]))
			.map((angle) => ({ name: angle.name, passed: angle.passed, findings: [...angle.findings] })),
		createdAt: new Date().toISOString(),
		preventionPatternIds: params.preventionPatternIds,
	};
}

export function evaluateCodeReviewGate(cwd: string): XddGateResult {
	const path = join(cwd, ".xdd", "runs", "xdd_run", "code-review.json");
	let report: CodeReviewReport;
	try {
		report = JSON.parse(readFileSync(path, "utf8")) as CodeReviewReport;
	} catch {
		return { ok: false, reason: "Code Review Gate: 缺少或无法解析 code-review.json" };
	}
	if (report.schemaVersion !== 1 || report.readonly !== true) return { ok: false, reason: "Code Review Gate: report 必须声明 schemaVersion=1 与 readonly=true" };
	if (!report.creatorId?.trim() || !report.reviewerId?.trim() || report.creatorId === report.reviewerId) return { ok: false, reason: "Code Review Gate: creator/reviewer 身份缺失或发生自审" };
	if (!Array.isArray(report.artifactPaths) || report.artifactPaths.length === 0) return { ok: false, reason: "Code Review Gate: 缺少被审源码路径" };
	const currentDigest = digestReviewArtifactFiles(cwd, report.artifactPaths);
	if (currentDigest !== report.artifactDigest) return { ok: false, reason: "Code Review Gate: 源码已变化，旧 code review 失效" };
	const missing = CODE_REVIEW_ANGLES.filter((name) => !report.checks?.some((check) => check.name === name));
	if (missing.length > 0) return { ok: false, reason: `Code Review Gate: 缺少只读检查维度：${missing.join(", ")}` };
	return { ok: true };
}
