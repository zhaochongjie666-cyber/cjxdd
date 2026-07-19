import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildReleaseDecision, evaluateReleaseDecisionGate, releaseInputDigest, writeReleaseDecision, type ReleaseDecision } from "./release-decision.ts";
import { digestReviewArtifactFiles, writeReviewVerdict } from "./review-verdict.ts";

let cwd: string;
beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "xdd-release-"));
	execFileSync("git", ["init", "-q"], { cwd });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
	execFileSync("git", ["config", "user.name", "Test"], { cwd });
	writeFileSync(join(cwd, "README.md"), "test\n");
	execFileSync("git", ["add", "README.md"], { cwd });
	execFileSync("git", ["commit", "-qm", "init"], { cwd });
	mkdirSync(join(cwd, ".xdd/runs/xdd_run"), { recursive: true });
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

describe("release decision aggregator", () => {
	it("blocks when required independent verdicts and evidence are missing", async () => {
		const decision = await buildReleaseDecision(cwd);
		expect(decision.verdict).toBe("block");
		expect(decision.checks.some((item) => !item.ok)).toBe(true);
	});

	it("accepts a current release decision and invalidates it when an input changes", () => {
		const decision: ReleaseDecision = {
			schemaVersion: 1,
			inputDigest: releaseInputDigest(cwd),
			verdict: "release",
			checks: [{ name: "fixture", ok: true }],
			createdAt: new Date().toISOString(),
		};
		writeReleaseDecision(cwd, decision);
		expect(evaluateReleaseDecisionGate(cwd)).toEqual({ ok: true });
		writeFileSync(join(cwd, ".xdd/runs/xdd_run/verify-report.md"), "changed\n");
		expect(evaluateReleaseDecisionGate(cwd)).toMatchObject({ ok: false });
	});

	it("invalidates release when the product worktree becomes dirty", () => {
		const decision: ReleaseDecision = { schemaVersion: 1, inputDigest: releaseInputDigest(cwd), verdict: "release", checks: [{ name: "fixture", ok: true }], createdAt: new Date().toISOString() };
		writeReleaseDecision(cwd, decision);
		writeFileSync(join(cwd, "README.md"), "uncommitted change\n");
		expect(evaluateReleaseDecisionGate(cwd)).toMatchObject({ ok: false });
	});

	it("invalidates release when a design artifact named by a review changes", () => {
		mkdirSync(join(cwd, ".xdd/design/spec"), { recursive: true });
		writeFileSync(join(cwd, ".xdd/design/spec/rules.md"), "original design\n");
		writeReviewVerdict(cwd, "spec", {
			schemaVersion: 1, reviewType: "requirement", artifactPaths: [".xdd/design/spec/rules.md"],
			artifactDigest: digestReviewArtifactFiles(cwd, [".xdd/design/spec/rules.md"]), creatorId: "creator", reviewerId: "reviewer",
			model: "test", contextPolicy: "isolated", verdict: "pass", score: 100, findings: [], positivePathEvidence: ["pass"], fallbackAttackEvidence: ["attack"], overrides: [],
		});
		const decision: ReleaseDecision = { schemaVersion: 1, inputDigest: releaseInputDigest(cwd), verdict: "release", checks: [{ name: "fixture", ok: true }], createdAt: new Date().toISOString() };
		writeReleaseDecision(cwd, decision);
		writeFileSync(join(cwd, ".xdd/design/spec/rules.md"), "changed design\n");
		expect(evaluateReleaseDecisionGate(cwd)).toMatchObject({ ok: false });
	});
});
