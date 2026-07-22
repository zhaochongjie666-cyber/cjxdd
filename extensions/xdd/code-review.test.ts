import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CODE_REVIEW_ANGLES, codeReviewFromAIGate, evaluateCodeReviewGate, writeCodeReviewReport } from "./code-review.ts";
import { digestReviewArtifactFiles, evaluateStoredReviewVerdict, selectReviewArtifactPaths, writeReviewVerdict, type ReviewVerdict } from "./review-verdict.ts";

let cwd: string;
beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "xdd-code-review-"));
	mkdirSync(join(cwd, "src"), { recursive: true });
	mkdirSync(join(cwd, ".xdd/runs/xdd_run"), { recursive: true });
	writeFileSync(join(cwd, "src/app.ts"), "export const ok = true;\n");
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

function report() {
	const paths = ["src/app.ts"];
	return codeReviewFromAIGate({
		artifactDigest: digestReviewArtifactFiles(cwd, paths),
		artifactPaths: paths,
		creatorId: "execute-epoch",
		reviewerId: "pi-aigate:model",
		model: "model",
		status: "pass",
		result: { passed: true, issues: [], suggestions: [], angles: CODE_REVIEW_ANGLES.map((name) => ({ name, passed: true, findings: [] })) },
	});
}

describe("read-only code review gate", () => {
	it("accepts all required checks bound to unchanged source", () => {
		writeCodeReviewReport(cwd, report());
		expect(evaluateCodeReviewGate(cwd)).toEqual({ ok: true });
	});

	it("rejects review after source changes", () => {
		writeCodeReviewReport(cwd, report());
		writeFileSync(join(cwd, "src/app.ts"), "export const changed = true;\n");
		expect(evaluateCodeReviewGate(cwd)).toMatchObject({ ok: false });
	});

	it("rejects a missing review dimension", () => {
		const value = report();
		value.checks.pop();
		writeCodeReviewReport(cwd, value);
		expect(evaluateCodeReviewGate(cwd)).toMatchObject({ ok: false });
	});

	it("keeps controller outputs out of both persisted review digests", () => {
		writeFileSync(join(cwd, ".xdd/runtime.json"), "{}\n");
		writeFileSync(join(cwd, ".xdd/runs/xdd_run/code-review.json"), "{}\n");
		mkdirSync(join(cwd, ".xdd/runs/xdd_run/reviews"), { recursive: true });
		writeFileSync(join(cwd, ".xdd/runs/xdd_run/reviews/execute.json"), "{}\n");
		const artifactPaths = selectReviewArtifactPaths(cwd, ["src/app.ts", ".xdd/**/*.json"]);
		const artifactDigest = digestReviewArtifactFiles(cwd, artifactPaths);
		const verdict: ReviewVerdict = {
			schemaVersion: 1, reviewType: "code", artifactDigest, artifactPaths,
			creatorId: "execute-epoch", reviewerId: "pi-aigate:model", model: "model", contextPolicy: "isolated",
			verdict: "pass", score: 100, findings: [], positivePathEvidence: ["execute gate passed"],
			fallbackAttackEvidence: ["controller output mutation attacked"], overrides: [],
		};
		writeReviewVerdict(cwd, "execute", verdict);
		writeCodeReviewReport(cwd, codeReviewFromAIGate({
			artifactDigest, artifactPaths, creatorId: verdict.creatorId, reviewerId: verdict.reviewerId,
			model: verdict.model, status: "pass",
			result: { passed: true, issues: [], suggestions: [], angles: CODE_REVIEW_ANGLES.map((name) => ({ name, passed: true, findings: [] })) },
		}));

		expect(artifactPaths).toEqual(["src/app.ts"]);
		expect(evaluateStoredReviewVerdict(cwd, "execute", {
			requireIndependentReviewer: true, requirePositivePathEvidence: true, requireFallbackAttackEvidence: true,
		})).toEqual({ ok: true, reasons: [] });
		expect(evaluateCodeReviewGate(cwd)).toEqual({ ok: true });
	});
});
