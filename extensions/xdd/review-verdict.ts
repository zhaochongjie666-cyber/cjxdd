import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveGlobs, safeRealpath } from "./glob-resolver.ts";
import { RuntimeStore } from "./storage/runtime-store.ts";

export type ReviewType =
	| "requirement"
	| "architecture"
	| "code"
	| "qa"
	| "security"
	| "commit"
	| "runtime";
export type ReviewContextPolicy = "isolated" | "black_box" | "full";
export type ReviewVerdictStatus = "pass" | "fail" | "blocked" | "inconclusive";
export type ReviewSeverity = "P0" | "P1" | "P2";

export interface ReviewFinding {
	id: string;
	severity: ReviewSeverity;
	category: string;
	evidence: string;
	rollbackTarget?: string;
}

export interface ReviewVerdict {
	schemaVersion: 1;
	reviewType: ReviewType;
	artifactDigest: string;
	artifactPaths: string[];
	/** Explanation for a stage whose contract intentionally produces no file. */
	noArtifactReason?: string;
	creatorId: string;
	reviewerId: string;
	model: string;
	contextPolicy: ReviewContextPolicy;
	verdict: ReviewVerdictStatus;
	score: number;
	findings: ReviewFinding[];
	positivePathEvidence: string[];
	fallbackAttackEvidence: string[];
	overrides: Array<{ actor: string; reason: string; at: string }>;
	/** Historical bug patterns actually injected into this isolated review. */
	preventionPatternIds?: string[];
	verifyGeneration?: number;
	healingCaseId?: string;
}

export interface ReviewPolicy {
	requireIndependentReviewer: boolean;
	requirePositivePathEvidence: boolean;
	requireFallbackAttackEvidence: boolean;
	allowOverrides?: boolean;
}

export interface ReviewPolicyResult {
	ok: boolean;
	reasons: string[];
}

/** A content or path change invalidates every verdict for the old artifact set. */
export function digestReviewArtifacts(artifacts: Readonly<Record<string, string | Uint8Array>>): string {
	const hash = createHash("sha256");
	for (const path of Object.keys(artifacts).sort()) {
		const content = artifacts[path];
		const contentLength = typeof content === "string" ? Buffer.byteLength(content) : content.byteLength;
		hash.update(`${Buffer.byteLength(path)}:${path}:${contentLength}:`);
		hash.update(content);
		hash.update("\n");
	}
	return `sha256:${hash.digest("hex")}`;
}

export function digestReviewArtifactFiles(cwd: string, patterns: readonly string[]): string {
	const artifacts: Record<string, Uint8Array> = {};
	for (const relativePath of resolveGlobs(cwd, patterns)) {
		const absolutePath = safeRealpath(cwd, relativePath);
		if (absolutePath) artifacts[relativePath] = readFileSync(absolutePath);
	}
	return digestReviewArtifacts(artifacts);
}

export function writeReviewVerdict(cwd: string, stage: string, verdict: ReviewVerdict): string {
	if (!/^[a-z][a-z0-9-]*$/.test(stage)) throw new Error(`invalid review stage: ${stage}`);
	const path = join(cwd, ".xdd", "runs", "xdd_run", "reviews", `${stage}.json`);
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(verdict, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporary, path);
	return path;
}

export function readReviewVerdict(cwd: string, stage: string): ReviewVerdict | null {
	if (!/^[a-z][a-z0-9-]*$/.test(stage)) return null;
	try {
		return JSON.parse(readFileSync(join(cwd, ".xdd", "runs", "xdd_run", "reviews", `${stage}.json`), "utf8")) as ReviewVerdict;
	} catch {
		return null;
	}
}

export function evaluateStoredReviewVerdict(cwd: string, stage: string, policy: ReviewPolicy): ReviewPolicyResult {
	const verdict = readReviewVerdict(cwd, stage);
	if (!verdict) return { ok: false, reasons: ["缺少当前 run 的 review verdict"] };
	if (!Array.isArray(verdict.artifactPaths)) return { ok: false, reasons: ["review verdict 缺少 artifact paths"] };
	const result = evaluateReviewVerdict(verdict, digestReviewArtifactFiles(cwd, verdict.artifactPaths), policy);
	const runtime = new RuntimeStore(cwd).load();
	if (runtime?.activeHealingCaseId) {
		const healing = runtime.healingCases.find((item) => item.id === runtime.activeHealingCaseId);
		const targetIndex = runtime.plan.findIndex((entry) => entry.stageName === healing?.targetStage);
		const reviewIndex = runtime.plan.findIndex((entry) => entry.stageName === stage);
		if (reviewIndex >= targetIndex && targetIndex >= 0 && (verdict.verifyGeneration !== runtime.verifyGeneration || verdict.healingCaseId !== runtime.activeHealingCaseId)) result.reasons.push("review verdict 已过期：verifyGeneration/healingCaseId 不匹配");
	}
	result.ok = result.reasons.length === 0;
	return result;
}

export function evaluateReviewVerdict(
	verdict: ReviewVerdict,
	currentArtifactDigest: string,
	policy: ReviewPolicy,
): ReviewPolicyResult {
	const reasons: string[] = [];
	const overrideAccepted = policy.allowOverrides === true && verdict.overrides.some((override) =>
		override.actor.trim().length > 0
		&& override.reason.trim().length >= 20
		&& Number.isFinite(Date.parse(override.at))
	);
	if (!Array.isArray(verdict.artifactPaths) || (verdict.artifactPaths.length === 0 && (verdict.noArtifactReason?.trim().length ?? 0) < 20)) {
		reasons.push("review verdict 缺少 artifact paths 或无产物说明");
	}
	if (!/^sha256:[0-9a-f]{64}$/.test(verdict.artifactDigest)) reasons.push("artifact digest 格式无效");
	if (verdict.artifactDigest !== currentArtifactDigest) reasons.push("review verdict 已过期：artifact digest 不匹配");
	if (!verdict.creatorId.trim() || !verdict.reviewerId.trim()) reasons.push("creator/reviewer identity 不能为空");
	if (policy.requireIndependentReviewer && verdict.creatorId === verdict.reviewerId) reasons.push("creator 与 reviewer 必须独立");
	if (verdict.verdict !== "pass" && !overrideAccepted) reasons.push(`review verdict 不是 pass：${verdict.verdict}`);
	if (!Number.isFinite(verdict.score) || verdict.score < 0 || verdict.score > 100) reasons.push("review score 必须是 0-100 的有限数值");
	if (verdict.findings.some((finding) => !finding.id.trim() || !finding.category.trim() || !finding.evidence.trim())) {
		reasons.push("finding 必须包含非空 id/category/evidence");
	}
	if (verdict.findings.some((finding) => finding.severity === "P0" || finding.severity === "P1")) {
		reasons.push("仍存在未关闭的 P0/P1 finding");
	}
	if (policy.requirePositivePathEvidence && verdict.positivePathEvidence.length === 0) reasons.push("缺少正向路径证据");
	if (policy.requireFallbackAttackEvidence && verdict.fallbackAttackEvidence.length === 0) reasons.push("缺少兜底攻击证据");
	return { ok: reasons.length === 0, reasons };
}
