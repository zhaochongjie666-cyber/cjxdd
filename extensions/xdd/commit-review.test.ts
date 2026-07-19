import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COMMIT_REVIEW_ANGLES, commitReviewFromAIGate, evaluateCommitReviewForRelease, evaluateCommitReviewGate, readStagedSnapshot, writeCommitReviewReport } from "./commit-review.ts";

let cwd: string;
beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "xdd-commit-review-"));
	execFileSync("git", ["init", "-q"], { cwd });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
	execFileSync("git", ["config", "user.name", "Test"], { cwd });
	mkdirSync(join(cwd, ".xdd/runs/xdd_run"), { recursive: true });
	writeFileSync(join(cwd, "app.ts"), "export const value = 1;\n");
	execFileSync("git", ["add", "app.ts"], { cwd });
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

function report() {
	const snapshot = readStagedSnapshot(cwd);
	return commitReviewFromAIGate(snapshot, {
		passed: true,
		issues: [],
		suggestions: [],
		angles: COMMIT_REVIEW_ANGLES.map((name) => ({ name, passed: true, findings: [] })),
	}, "pi-aigate:model", "model");
}

describe("commit diff review gate", () => {
	it("accepts a report bound to the current staged tree and patch", () => {
		writeCommitReviewReport(cwd, report());
		expect(evaluateCommitReviewGate(cwd)).toEqual({ ok: true });
	});

	it("invalidates the report after the staged diff changes", () => {
		writeCommitReviewReport(cwd, report());
		writeFileSync(join(cwd, "app.ts"), "export const value = 2;\n");
		execFileSync("git", ["add", "app.ts"], { cwd });
		expect(evaluateCommitReviewGate(cwd)).toMatchObject({ ok: false });
	});

	it("rejects an empty staged diff", () => {
		execFileSync("git", ["reset", "-q"], { cwd });
		writeCommitReviewReport(cwd, report());
		expect(evaluateCommitReviewGate(cwd)).toMatchObject({ ok: false });
	});

	it("allows an audited override for non-critical findings only", () => {
		const value = report();
		value.verdict = "fail";
		value.checks.find((check) => check.name === "测试弱化攻击")!.passed = false;
		value.override = { actor: "xdd-budget", reason: "同一 diff 已完成三轮审查，保留普通细节后按软 Gate 策略推进。", at: new Date().toISOString() };
		writeCommitReviewReport(cwd, value);
		expect(evaluateCommitReviewGate(cwd)).toEqual({ ok: true });
	});

	it("never overrides critical authorization, secret, or destructive-migration findings", () => {
		const value = report();
		value.verdict = "fail";
		value.checks.find((check) => check.name === "密钥泄漏攻击")!.passed = false;
		value.override = { actor: "xdd-budget", reason: "即使已经完成三轮审查，高风险 finding 也必须继续阻断。", at: new Date().toISOString() };
		writeCommitReviewReport(cwd, value);
		expect(evaluateCommitReviewGate(cwd)).toMatchObject({ ok: false });
	});

	it("accepts the reviewed index tree after it becomes the HEAD commit tree", () => {
		writeCommitReviewReport(cwd, report());
		execFileSync("git", ["commit", "-qm", "test"], { cwd });
		expect(evaluateCommitReviewForRelease(cwd)).toEqual({ ok: true });
	});
});
