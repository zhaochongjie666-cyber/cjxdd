import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { evaluateCodeReviewGate } from "./code-review.ts";
import { evaluateCommitReviewForRelease } from "./commit-review.ts";
import { evaluateVerifyEvidenceGateFull } from "./evidence/verify-gate.ts";
import { evaluateQaEvidenceGate } from "./qa-plan.ts";
import { digestReviewArtifactFiles, evaluateStoredReviewVerdict, type ReviewVerdict } from "./review-verdict.ts";
import { evaluateRuntimeObservabilityGate } from "./runtime-observability.ts";
import { evaluateQualityScoreGate } from "./quality-score.ts";
import { evaluateLegacyQualityWaiver } from "./quality-migration.ts";
import type { XddGateResult } from "./types.ts";
import type { XddStageName } from "./types.ts";
import { RuntimeStore } from "./storage/runtime-store.ts";
import { verifyReceiptMatches } from "./healing/healing-case.ts";
import { healingEnforced } from "./healing/mode.ts";

export interface ReleaseCheck {
	name: string;
	ok: boolean;
	reason?: string;
}

export interface ReleaseDecision {
	schemaVersion: 1;
	inputDigest: string;
	verdict: "release" | "block";
	checks: ReleaseCheck[];
	createdAt: string;
	verifyGeneration?: number;
	healingCaseId?: string;
}

const REQUIRED_REVIEW_STAGES = ["understand", "spec", "architecture", "resilience", "plan", "execute", "cleanup", "verify"] as const;

function hasWireArtifacts(cwd: string): boolean {
	const root = join(cwd, ".xdd", "design", "wire");
	try {
		return readdirSync(root, { recursive: true }).some((entry) => String(entry).endsWith(".md"));
	} catch {
		return false;
	}
}

function releaseRelevantStatus(cwd: string): string[] {
	return execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd, encoding: "utf8" })
		.split("\n")
		.filter(Boolean)
		.filter((line) => {
			const path = line.slice(3).split(" -> ").at(-1) ?? "";
			return path !== ".xdd" && !path.startsWith(".xdd/");
		});
}

function decisionInputs(cwd: string): string[] {
	const run = join(cwd, ".xdd", "runs", "xdd_run");
	const paths = [
		join(run, "qa-plan.md"),
		join(run, "verify-report.md"),
		join(run, "code-review.json"),
		join(run, "commit-review.json"),
		join(run, "runtime-observability", "baseline.json"),
		join(run, "runtime-observability", "latest.json"),
		join(run, "runtime-observability", "incident.json"),
		join(run, "quality-score.json"),
		join(run, "quality-migration.json"),
		join(run, "prevention-injections.json"),
		...REQUIRED_REVIEW_STAGES.map((stage) => join(run, "reviews", `${stage}.json`)),
	];
	if (hasWireArtifacts(cwd)) paths.push(join(run, "reviews", "wire.json"));
	return paths;
}

export function releaseInputDigest(cwd: string): string {
	const hash = createHash("sha256");
	for (const path of decisionInputs(cwd).sort()) {
		hash.update(path).update("\0");
		hash.update(existsSync(path) ? readFileSync(path) : Buffer.from("<missing>"));
		if (path.includes(join("runs", "xdd_run", "reviews")) && existsSync(path)) {
			try {
				const review = JSON.parse(readFileSync(path, "utf8")) as ReviewVerdict;
				hash.update("\0review-artifacts\0").update(digestReviewArtifactFiles(cwd, review.artifactPaths ?? []));
			} catch {
				hash.update("\0<invalid-review>");
			}
		}
		hash.update("\0");
	}
	try {
		hash.update(execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd, encoding: "utf8" }).trim());
		hash.update("\0").update(releaseRelevantStatus(cwd).join("\n"));
		hash.update("\0").update(execFileSync("git", ["diff", "--binary", "--no-ext-diff", "--", "."], { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));
	} catch {
		hash.update("<no-head-tree>");
	}
	return `sha256:${hash.digest("hex")}`;
}

function evaluateCleanWorktree(cwd: string): XddGateResult {
	try {
		const dirty = releaseRelevantStatus(cwd);
		return dirty.length === 0 ? { ok: true } : { ok: false, reason: `Release Worktree: 存在未提交改动：${dirty.join("；")}` };
	} catch (error) {
		return { ok: false, reason: `Release Worktree: 无法读取 git status（${error instanceof Error ? error.message : String(error)}）` };
	}
}

function check(name: string, result: XddGateResult): ReleaseCheck {
	return { name, ok: result.ok, reason: result.ok ? undefined : result.reason };
}

export async function buildReleaseDecision(cwd: string): Promise<ReleaseDecision> {
	const runtime = new RuntimeStore(cwd).load();
	const reviewPolicy = { requireIndependentReviewer: true, requirePositivePathEvidence: true, requireFallbackAttackEvidence: true, allowOverrides: true };
	const reviewStages: string[] = [...REQUIRED_REVIEW_STAGES];
	if (hasWireArtifacts(cwd)) reviewStages.splice(3, 0, "wire");
	const checks: ReleaseCheck[] = reviewStages.map((stage) => {
		if (evaluateLegacyQualityWaiver(cwd, `review:${stage as XddStageName}`)) {
			return { name: `review:${stage}`, ok: true, reason: "旧 run 迁移：该阶段在升级前已完成，审计 waiver 生效" };
		}
		const result = evaluateStoredReviewVerdict(cwd, stage, reviewPolicy);
		return { name: `review:${stage}`, ok: result.ok, reason: result.ok ? undefined : result.reasons.join("；") };
	});
	checks.push(check("qa-evidence", evaluateQaEvidenceGate(cwd)));
	checks.push(check("code-review", evaluateCodeReviewGate(cwd)));
	checks.push(check("commit-review", evaluateCommitReviewForRelease(cwd)));
	checks.push(check("clean-worktree", evaluateCleanWorktree(cwd)));
	checks.push(check("runtime-observability", evaluateRuntimeObservabilityGate(cwd)));
	checks.push(check("quality-score", evaluateQualityScoreGate(cwd)));
	checks.push(check("verify-evidence", await evaluateVerifyEvidenceGateFull(cwd)));
	checks.push(check("healing-state", evaluateHealingReleaseState(cwd)));
	return {
		schemaVersion: 1,
		inputDigest: releaseInputDigest(cwd),
		verdict: checks.every((item) => item.ok) ? "release" : "block",
		checks,
		createdAt: new Date().toISOString(),
		verifyGeneration: runtime?.verifyGeneration ?? 0,
		healingCaseId: runtime?.activeHealingCaseId,
	};
}

function evaluateHealingReleaseState(cwd: string): XddGateResult {
	const runtime = new RuntimeStore(cwd).load();
	if (!runtime) return { ok: false, reason: "Release Healing Gate: runtime.json 缺失" };
	if (!healingEnforced()) return { ok: true, soft: true, reason: `Release Healing Gate observe-only：active=${runtime.activeHealingCaseId ?? "none"}，审计保留但不阻断。` };
	if (runtime.activeHealingCaseId) {
		const active = runtime.healingCases.find((item) => item.id === runtime.activeHealingCaseId);
		if (!active || active.status !== "ready-for-reverify") return { ok: false, reason: `Release Healing Gate: active HealingCase ${runtime.activeHealingCaseId} 尚未 ready-for-reverify` };
		if (!runtime.lastVerifyReceipt) return { ok: false, reason: "Release Healing Gate: active case 缺少 verify receipt" };
		const activeFreshness = verifyReceiptMatches(cwd, runtime.lastVerifyReceipt, runtime.verifyGeneration, runtime.activeHealingCaseId);
		if (!activeFreshness.ok) return { ok: false, reason: `Release Healing Gate: ${activeFreshness.code} ${activeFreshness.reason}` };
	}
	if (runtime.verifyGeneration > 0) {
		if (!runtime.lastVerifyReceipt) return { ok: false, reason: "Release Healing Gate: verify receipt 缺失" };
		const freshness = verifyReceiptMatches(cwd, runtime.lastVerifyReceipt, runtime.verifyGeneration);
		if (!freshness.ok) return { ok: false, reason: `Release Healing Gate: ${freshness.code} ${freshness.reason}` };
	}
	if (runtime.budgetResetHistory?.some((entry) => !entry.reason || entry.reason.length < 20)) return { ok: false, reason: "Release Healing Gate: 存在未审计 budget reset" };
	return { ok: true };
}

export function writeReleaseDecision(cwd: string, decision: ReleaseDecision): string {
	const path = join(cwd, ".xdd", "runs", "xdd_run", "release-decision.json");
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(decision, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporary, path);
	return path;
}

export function evaluateReleaseDecisionGate(cwd: string): XddGateResult {
	let decision: ReleaseDecision;
	try {
		decision = JSON.parse(readFileSync(join(cwd, ".xdd", "runs", "xdd_run", "release-decision.json"), "utf8")) as ReleaseDecision;
	} catch {
		return { ok: false, reason: "Release Decision Gate: 缺少或无法解析 release-decision.json" };
	}
	if (decision.inputDigest !== releaseInputDigest(cwd)) return { ok: false, reason: "Release Decision Gate: 上游 verdict/evidence/HEAD 已变化，旧决策失效" };
	const runtime = new RuntimeStore(cwd).load();
	if (runtime?.activeHealingCaseId && (decision.verifyGeneration !== runtime.verifyGeneration || decision.healingCaseId !== runtime.activeHealingCaseId)) return { ok: false, reason: "Release Decision Gate: verifyGeneration/healingCaseId 已过期" };
	const failed = decision.checks?.filter((item) => !item.ok) ?? [];
	if (decision.verdict !== "release" || failed.length > 0) return { ok: false, reason: `Release Decision Gate: BLOCK（${failed.map((item) => item.name).join(", ")}）` };
	return { ok: true };
}
