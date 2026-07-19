import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CODE_REVIEW_ANGLES, codeReviewFromAIGate, evaluateCodeReviewGate, writeCodeReviewReport } from "./code-review.ts";
import { digestReviewArtifactFiles } from "./review-verdict.ts";

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
});
