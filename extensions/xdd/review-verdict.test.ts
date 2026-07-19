import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { digestReviewArtifactFiles, digestReviewArtifacts, evaluateReviewVerdict, evaluateStoredReviewVerdict, writeReviewVerdict, type ReviewVerdict } from "./review-verdict.ts";

function verdict(overrides: Partial<ReviewVerdict> = {}): ReviewVerdict {
	return {
		schemaVersion: 1,
		reviewType: "code",
		artifactDigest: digestReviewArtifacts({ "src/a.ts": "export const a = 1;" }),
		artifactPaths: ["src/a.ts"],
		creatorId: "creator-1",
		reviewerId: "reviewer-1",
		model: "review-model",
		contextPolicy: "isolated",
		verdict: "pass",
		score: 100,
		findings: [],
		positivePathEvidence: ["test:happy-path"],
		fallbackAttackEvidence: ["test:permission-denied"],
		overrides: [],
		...overrides,
	};
}

const strictPolicy = {
	requireIndependentReviewer: true,
	requirePositivePathEvidence: true,
	requireFallbackAttackEvidence: true,
};

describe("review verdict policy", () => {
	it("accepts an explicit no-file completion reason but rejects an unexplained empty artifact set", () => {
		const digest = digestReviewArtifacts({});
		expect(evaluateReviewVerdict(verdict({ artifactPaths: [], artifactDigest: digest, noArtifactReason: "cleanup inspection confirmed the existing tree required no file changes" }), digest, strictPolicy)).toEqual({ ok: true, reasons: [] });
		expect(evaluateReviewVerdict(verdict({ artifactPaths: [], artifactDigest: digest }), digest, strictPolicy)).toMatchObject({ ok: false });
	});

	it("produces a stable digest independent of insertion order and binds file paths", () => {
		const first = digestReviewArtifacts({ "b.ts": "b", "a.ts": "a" });
		const reordered = digestReviewArtifacts({ "a.ts": "a", "b.ts": "b" });
		const renamed = digestReviewArtifacts({ "a.ts": "a", "c.ts": "b" });
		expect(first).toBe(reordered);
		expect(first).not.toBe(renamed);
	});

	it("digests resolved files and atomically persists a run-scoped verdict", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-review-"));
		try {
			writeFileSync(join(cwd, "artifact.md"), "review me");
			const digest = digestReviewArtifactFiles(cwd, ["artifact.md"]);
			const review = verdict({ artifactDigest: digest });
			const path = writeReviewVerdict(cwd, "spec", review);
			expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ artifactDigest: digest, reviewType: "code" });
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("rejects a persisted verdict after the reviewed file changes", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-review-stale-"));
		try {
			const artifact = join(cwd, "artifact.md");
			writeFileSync(artifact, "before");
			writeReviewVerdict(cwd, "spec", verdict({
				artifactDigest: digestReviewArtifactFiles(cwd, ["artifact.md"]),
				artifactPaths: ["artifact.md"],
			}));
			writeFileSync(artifact, "after");
			expect(evaluateStoredReviewVerdict(cwd, "spec", strictPolicy)).toMatchObject({ ok: false });
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("accepts a current independent verdict with positive and fallback evidence", () => {
		const review = verdict();
		expect(evaluateReviewVerdict(review, review.artifactDigest, strictPolicy)).toEqual({ ok: true, reasons: [] });
	});

	it("invalidates a verdict when an artifact changes", () => {
		const review = verdict();
		const changed = digestReviewArtifacts({ "src/a.ts": "export const a = 2;" });
		expect(evaluateReviewVerdict(review, changed, strictPolicy)).toMatchObject({ ok: false });
	});

	it("rejects self-review, P1 findings, and missing fallback evidence", () => {
		const review = verdict({
			reviewerId: "creator-1",
			findings: [{ id: "F-1", severity: "P1", category: "permission", evidence: "missing RBAC" }],
			fallbackAttackEvidence: [],
		});
		const result = evaluateReviewVerdict(review, review.artifactDigest, strictPolicy);
		expect(result.ok).toBe(false);
		expect(result.reasons).toHaveLength(3);
	});

	it("accepts an audited soft-gate override after strict review budget exhaustion", () => {
		const review = verdict({
			verdict: "fail",
			findings: [{ id: "F-1", severity: "P2", category: "detail", evidence: "review did not converge" }],
			overrides: [{ actor: "xdd-budget-policy", reason: "严格审查达到预算上限，保留问题并让后续验证继续攻击。", at: new Date().toISOString() }],
		});
		expect(evaluateReviewVerdict(review, review.artifactDigest, { ...strictPolicy, allowOverrides: true })).toEqual({ ok: true, reasons: [] });
	});

	it("never lets a soft-gate override bypass P0/P1 findings", () => {
		const review = verdict({
			verdict: "fail",
			findings: [{ id: "F-1", severity: "P1", category: "security", evidence: "authorization bypass" }],
			overrides: [{ actor: "xdd-budget-policy", reason: "严格审查达到预算上限，但高严重度问题仍不得被软放行。", at: new Date().toISOString() }],
		});
		expect(evaluateReviewVerdict(review, review.artifactDigest, { ...strictPolicy, allowOverrides: true })).toMatchObject({ ok: false });
	});

	it("rejects an unauditable soft-gate override", () => {
		const review = verdict({ verdict: "fail", overrides: [{ actor: "", reason: "放过", at: "not-a-date" }] });
		expect(evaluateReviewVerdict(review, review.artifactDigest, { ...strictPolicy, allowOverrides: true })).toMatchObject({ ok: false });
	});

	it("rejects malformed identities, scores, digests, and findings", () => {
		const review = verdict({
			artifactDigest: "sha256:not-a-digest",
			creatorId: " ",
			score: Number.NaN,
			findings: [{ id: "", severity: "P2", category: "", evidence: "" }],
		});
		const result = evaluateReviewVerdict(review, review.artifactDigest, strictPolicy);
		expect(result.ok).toBe(false);
		expect(result.reasons).toHaveLength(4);
	});
});
