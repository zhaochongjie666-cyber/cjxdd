import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AIGateResult, XddAIGateAngleStatus } from "./aigate.ts";
import type { XddGateResult } from "./types.ts";

export const COMMIT_REVIEW_ANGLES = [
	"权限校验删除攻击",
	"测试弱化攻击",
	"密钥泄漏攻击",
	"破坏性迁移攻击",
	"契约破坏攻击",
	"韧性降级攻击",
] as const;

export interface StagedSnapshot {
	treeHash: string;
	diffDigest: string;
	patch: string;
}

export interface CommitReviewReport {
	schemaVersion: 1;
	treeHash: string;
	diffDigest: string;
	reviewerId: string;
	model: string;
	verdict: "pass" | "fail" | "inconclusive";
	checks: Array<{ name: string; passed: XddAIGateAngleStatus; findings: string[] }>;
	attempt: number;
	override?: { actor: string; reason: string; at: string };
	createdAt: string;
	preventionPatternIds?: string[];
}

export function readStagedSnapshot(cwd: string): StagedSnapshot {
	const patch = execFileSync("git", ["diff", "--cached", "--binary", "--no-ext-diff", "--", "."], { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
	const treeHash = execFileSync("git", ["write-tree"], { cwd, encoding: "utf8" }).trim();
	const diffDigest = `sha256:${createHash("sha256").update(treeHash).update("\0").update(patch).digest("hex")}`;
	return { treeHash, diffDigest, patch };
}

export function commitReviewFromAIGate(snapshot: StagedSnapshot, result: AIGateResult, reviewerId: string, model: string, attempt = 1, override?: CommitReviewReport["override"]): CommitReviewReport {
	return {
		schemaVersion: 1,
		treeHash: snapshot.treeHash,
		diffDigest: snapshot.diffDigest,
		reviewerId,
		model,
		verdict: result.degraded ? "inconclusive" : result.passed ? "pass" : "fail",
		checks: result.angles
			.filter((angle) => COMMIT_REVIEW_ANGLES.includes(angle.name as typeof COMMIT_REVIEW_ANGLES[number]))
			.map((angle) => ({ name: angle.name, passed: angle.passed, findings: [...angle.findings] })),
		attempt,
		override,
		createdAt: new Date().toISOString(),
	};
}

export function readCommitReviewReport(cwd: string): CommitReviewReport | null {
	try {
		return JSON.parse(readFileSync(join(cwd, ".xdd", "runs", "xdd_run", "commit-review.json"), "utf8")) as CommitReviewReport;
	} catch {
		return null;
	}
}

export function writeCommitReviewReport(cwd: string, report: CommitReviewReport): string {
	const path = join(cwd, ".xdd", "runs", "xdd_run", "commit-review.json");
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporary, path);
	return path;
}

export function evaluateCommitReviewGate(cwd: string): XddGateResult {
	const report = readCommitReviewReport(cwd);
	if (!report) {
		return { ok: false, reason: "Commit Review Gate: 缺少或无法解析 commit-review.json" };
	}
	const snapshot = readStagedSnapshot(cwd);
	if (!snapshot.patch.trim()) return { ok: false, reason: "Commit Review Gate: 暂存区为空，无法绑定待提交 diff" };
	if (snapshot.treeHash !== report.treeHash || snapshot.diffDigest !== report.diffDigest) return { ok: false, reason: "Commit Review Gate: staged diff 已变化，旧审查失效" };
	return evaluateCommitReportPolicy(report);
}

function evaluateCommitReportPolicy(report: CommitReviewReport): XddGateResult {
	const missing = COMMIT_REVIEW_ANGLES.filter((name) => !report.checks?.some((check) => check.name === name));
	if (missing.length > 0) return { ok: false, reason: `Commit Review Gate: 缺少检查维度：${missing.join(", ")}` };
	const critical = report.checks.filter((check) => check.passed === false && /权限校验删除|密钥泄漏|破坏性迁移/.test(check.name));
	if (critical.length > 0) return { ok: false, reason: `Commit Review Gate: 高风险 finding 不可软放行：${critical.map((check) => check.name).join(", ")}` };
	const validOverride = report.override
		&& report.override.actor.trim().length > 0
		&& report.override.reason.trim().length >= 20
		&& Number.isFinite(Date.parse(report.override.at));
	if (report.verdict !== "pass" && !validOverride) return { ok: false, reason: `Commit Review Gate: verdict=${report.verdict} 且没有合规软 Gate override` };
	return { ok: true };
}

export function evaluateCommitReviewForRelease(cwd: string): XddGateResult {
	const report = readCommitReviewReport(cwd);
	if (!report) return { ok: false, reason: "Release Commit Review: 缺少 commit-review.json" };
	let headTree = "";
	try {
		headTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd, encoding: "utf8" }).trim();
	} catch {
		return { ok: false, reason: "Release Commit Review: 无法读取 HEAD tree" };
	}
	if (headTree !== report.treeHash) return { ok: false, reason: "Release Commit Review: HEAD tree 与已审 staged tree 不一致" };
	return evaluateCommitReportPolicy(report);
}
