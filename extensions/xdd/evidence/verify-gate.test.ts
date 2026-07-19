import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureVerifySnapshot } from "../policy/verify-snapshot.ts";
import { evaluateBlindJourneyFailure, evaluateFeatureScenarioCoverage, evaluateTraceCoverage, evaluateVerifyEvidenceGate, evaluateVerifyEvidenceGateFull, evaluateVerifyMutation } from "./verify-gate.ts";
import { extractEvidenceReferences, hasUnfinishedPlanCheckbox } from "./report-parser.ts";

function project(): string {
	const cwd = mkdtempSync(join(tmpdir(), "xdd-verify-gate-"));
	mkdirSync(join(cwd, ".xdd", "runs", "xdd_run", "plan", "task"), { recursive: true });
	mkdirSync(join(cwd, ".xdd", "runs", "xdd_run", "evidence"), { recursive: true });
	mkdirSync(join(cwd, ".xdd", "design", "spec", "b01"), { recursive: true });
	writeFileSync(join(cwd, ".xdd", "runs", "xdd_run", "plan", "task", "plan.md"), "- [x] done\n", "utf8");
	writeFileSync(join(cwd, ".xdd", "design", "spec", "b01", "rules.md"), "| ID | Rule |\n| R01 | rule |\n", "utf8");
	return cwd;
}

function longReport(extra = ""): string {
	return `# Verify Report\n\nRuntime evidence: npm test exited 0. HTTP evidence: curl GET /api/items returned status 200. Evidence file: .xdd/runs/xdd_run/evidence/runtime.txt\n\n${extra}\n\n${"真实验证说明".repeat(80)}`;
}

function writePassingBaseEvidence(cwd: string, extra = ""): void {
	writeFileSync(join(cwd, ".xdd", "runs", "xdd_run", "verify-report.md"), longReport(extra), "utf8");
	writeFileSync(join(cwd, ".xdd", "runs", "xdd_run", "evidence", "runtime.txt"), "runtime ok", "utf8");
}

function writeTraceImplementation(cwd: string, implementsId = "R01"): void {
	mkdirSync(join(cwd, "src"), { recursive: true });
	writeFileSync(join(cwd, "src", "app.ts"), `// @implements ${implementsId}\nexport const ok = true;\n`, "utf8");
}

describe("verify evidence gate", () => {
	it("ignores checkboxes inside fenced code", () => {
		expect(hasUnfinishedPlanCheckbox("```md\n- [ ] example\n```\n- [x] done")).toBe(false);
		expect(hasUnfinishedPlanCheckbox("- [ ] real task")).toBe(true);
	});

	it("extracts current-style evidence references from plain text and Markdown links", () => {
		const refs = extractEvidenceReferences("see .xdd/runs/xdd_run/evidence/out.txt and [runtime log](.xdd/runs/xdd_run/evidence/runtime.txt)");
		expect(refs).toContain(".xdd/runs/xdd_run/evidence/out.txt");
		expect(refs).toContain(".xdd/runs/xdd_run/evidence/runtime.txt");
	});

	it("fails missing and too-short reports", () => {
		const cwd = project();
		try {
			expect(evaluateVerifyEvidenceGate(cwd).failure?.code).toBe("REPORT_MISSING");
			writeFileSync(join(cwd, ".xdd", "runs", "xdd_run", "verify-report.md"), "short", "utf8");
			expect(evaluateVerifyEvidenceGate(cwd).failure?.code).toBe("REPORT_TOO_SHORT");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("fails unfinished plan checkboxes outside code fences", () => {
		const cwd = project();
		try {
			writeFileSync(join(cwd, ".xdd", "runs", "xdd_run", "plan", "task", "plan.md"), "- [ ] todo\n```md\n- [ ] example\n```\n", "utf8");
			writeFileSync(join(cwd, ".xdd", "runs", "xdd_run", "verify-report.md"), longReport(), "utf8");
			writeFileSync(join(cwd, ".xdd", "runs", "xdd_run", "evidence", "runtime.txt"), "ok", "utf8");
			expect(evaluateVerifyEvidenceGate(cwd).failure?.code).toBe("PLAN_UNFINISHED");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("passes report with current evidence references and two evidence categories", () => {
		const cwd = project();
		try {
			writeFileSync(join(cwd, ".xdd", "runs", "xdd_run", "verify-report.md"), longReport(), "utf8");
			writeFileSync(join(cwd, ".xdd", "runs", "xdd_run", "evidence", "runtime.txt"), "ok", "utf8");
			expect(evaluateVerifyEvidenceGate(cwd).ok).toBe(true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});


	it("passes report with Markdown link destination evidence reference", () => {
		const cwd = project();
		try {
			const report = longReport("Evidence link: [runtime log](.xdd/runs/xdd_run/evidence/runtime.txt)");
			writeFileSync(join(cwd, ".xdd", "runs", "xdd_run", "verify-report.md"), report, "utf8");
			writeFileSync(join(cwd, ".xdd", "runs", "xdd_run", "evidence", "runtime.txt"), "ok", "utf8");
			expect(evaluateVerifyEvidenceGate(cwd).ok).toBe(true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("rejects evidence references from an other run", () => {
		const cwd = project();
		try {
			mkdirSync(join(cwd, ".xdd", "runs", "xdd_run", "plan", "task"), { recursive: true });
			mkdirSync(join(cwd, ".xdd", "runs", "xdd_run", "evidence"), { recursive: true });
			mkdirSync(join(cwd, ".xdd", "runs", "normal_run", "evidence"), { recursive: true });
			writeFileSync(join(cwd, ".xdd", "runs", "xdd_run", "plan", "task", "plan.md"), "- [x] done\n", "utf8");
			writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "evidence", "old.txt"), "old", "utf8");
			writeFileSync(join(cwd, ".xdd", "runs", "xdd_run", "verify-report.md"), longReport("Evidence .xdd/runs/normal_run/evidence/old.txt"), "utf8");
			expect(evaluateVerifyEvidenceGate(cwd).failure?.code).toBe("EVIDENCE_MISSING");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("requires UI evidence when wire artifacts exist", () => {
		const cwd = project();
		try {
			mkdirSync(join(cwd, ".xdd", "design", "wire"), { recursive: true });
			writeFileSync(join(cwd, ".xdd", "design", "wire", "screen.md"), "wireframe", "utf8");
			writeFileSync(join(cwd, ".xdd", "runs", "xdd_run", "verify-report.md"), longReport(), "utf8");
			writeFileSync(join(cwd, ".xdd", "runs", "xdd_run", "evidence", "runtime.txt"), "ok", "utf8");
			expect(evaluateVerifyEvidenceGate(cwd).failure?.code).toBe("UI_EVIDENCE_MISSING");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("rejects reports that only call /healthz", () => {
		const cwd = project();
		try {
			const report = `# Verify Report\n\nRuntime evidence npm test exit 0. HTTP evidence curl GET /healthz returned 200. Evidence .xdd/runs/xdd_run/evidence/runtime.txt\n\n${"真实验证说明".repeat(80)}`;
			writeFileSync(join(cwd, ".xdd", "runs", "xdd_run", "verify-report.md"), report, "utf8");
			writeFileSync(join(cwd, ".xdd", "runs", "xdd_run", "evidence", "runtime.txt"), "ok", "utf8");
			expect(evaluateVerifyEvidenceGate(cwd).failure?.code).toBe("BUSINESS_ENDPOINT_UNTESTED");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("returns structured VERIFY_COMMAND_FAILED for failing Harness commands", async () => {
		const cwd = project();
		try {
			writeFileSync(join(cwd, ".xdd", "runs", "xdd_run", "verify-report.md"), longReport(), "utf8");
			writeFileSync(join(cwd, ".xdd", "runs", "xdd_run", "evidence", "runtime.txt"), "ok", "utf8");
			const { HarnessStore } = await import("../harness/store.ts");
			const { evaluateHarnessValidationCommands } = await import("./verify-gate.ts");
			new HarnessStore(cwd).update("验证命令", "append", "node -e \"process.exit(7)\"");
			const result = await evaluateHarnessValidationCommands(cwd);
			expect(result.failure?.code).toBe("VERIFY_COMMAND_FAILED");
			expect(result.reason).toContain("node -e");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("returns structured TRACE_GAP for spec/code @implements mismatches", async () => {
		const cwd = project();
		try {
			const result = evaluateTraceCoverage(cwd);
			expect(result.failure?.code).toBe("TRACE_GAP");
			expect(result.reason).toContain("R01");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("rejects a Feature Scenario without an implementation and acceptance-test mapping", () => {
		const cwd = project();
		try {
			writeFileSync(join(cwd, ".xdd", "design", "spec", "b01", "login.feature"), "Feature: Login\n  Scenario: password succeeds\n    Given a user\n", "utf8");
			const result = evaluateFeatureScenarioCoverage(cwd);
			expect(result.failure?.code).toBe("FEATURE_SCENARIO_GAP");
			expect(result.reason).toContain("login.feature :: Scenario: password succeeds");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("accepts every Scenario and Scenario Outline mapped to production code and acceptance tests", () => {
		const cwd = project();
		try {
			writeFileSync(join(cwd, ".xdd", "design", "spec", "b01", "login.feature"), "Feature: Login\n  Scenario: password succeeds\n  Scenario Outline: password fails\n    Examples:\n      | password |\n      | bad |\n", "utf8");
			writeFileSync(join(cwd, ".xdd", "runs", "xdd_run", "plan", "task", "plan.md"), `### Task 1: success\n**Feature:** \`login.feature :: Scenario: password succeeds\`\n**Implementation:** \`src/auth.ts::login\`\n**Acceptance Test:** \`test/auth.test.ts::success\`\n- [x] done\n\n### Task 2: failure\n**Feature:** \`login.feature :: Scenario Outline: password fails\`\n**Implementation:** \`src/auth.ts::login\`\n**Acceptance Test:** \`test/auth.test.ts::failure\`\n- [x] done\n`, "utf8");
			expect(evaluateFeatureScenarioCoverage(cwd).ok).toBe(true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("returns structured BLIND_JOURNEY_FAILED for P0/P1 issues", () => {
		const cwd = project();
		try {
			mkdirSync(join(cwd, ".xdd", "runs", "xdd_run", "blind-journey", "roles"), { recursive: true });
			writeFileSync(join(cwd, ".xdd", "runs", "xdd_run", "blind-journey", "roles", "buyer.md"), "buyer", "utf8");
			writeFileSync(join(cwd, ".xdd", "runs", "xdd_run", "blind-journey", "results.json"), JSON.stringify([{
				scenarioId: "S01",
				featurePath: ".xdd/design/spec/b01/login.feature",
				roleId: "buyer",
				roleName: "Buyer",
				verdict: "PASS",
				evidence: [],
				issues: [{
					id: "I1",
					severity: "P1",
					role: "buyer",
					location: "/checkout",
					expected: "can pay",
					actual: "payment button hidden",
					impact: "cannot buy",
					evidence: [],
				}],
			}], null, 2), "utf8");
			expect(evaluateBlindJourneyFailure(cwd).failure?.code).toBe("BLIND_JOURNEY_FAILED");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("returns structured VERIFY_MUTATED_CONTRACT for verify snapshot diffs", () => {
		const cwd = project();
		try {
			mkdirSync(join(cwd, "src"), { recursive: true });
			writeFileSync(join(cwd, "src", "app.ts"), "// @implements R01\n", "utf8");
			ensureVerifySnapshot(cwd);
			writeFileSync(join(cwd, "src", "app.ts"), "// @implements R01\nexport const changed = true;\n", "utf8");
			const result = evaluateVerifyMutation(cwd);
			expect(result.failure?.code).toBe("VERIFY_MUTATED_CONTRACT");
			expect(result.failure?.files).toContain("src/app.ts");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("full gate short-circuits to TRACE_GAP after the base report passes", async () => {
		const cwd = project();
		try {
			writePassingBaseEvidence(cwd);
			const { HarnessStore } = await import("../harness/store.ts");
			new HarnessStore(cwd).update("验证命令", "append", "node -e \"process.exit(7)\"");
			const result = await evaluateVerifyEvidenceGateFull(cwd);
			expect(result.failure?.code).toBe("TRACE_GAP");
			expect(result.reason).toContain("R01");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("full gate returns VERIFY_COMMAND_FAILED when trace passes but Harness command fails", async () => {
		const cwd = project();
		try {
			writePassingBaseEvidence(cwd);
			writeTraceImplementation(cwd);
			const { HarnessStore } = await import("../harness/store.ts");
			new HarnessStore(cwd).update("验证命令", "append", "node -e \"process.exit(7)\"");
			const result = await evaluateVerifyEvidenceGateFull(cwd);
			expect(result.failure?.code).toBe("VERIFY_COMMAND_FAILED");
			expect(result.reason).toContain("node -e");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("full gate passes when base evidence, trace, Harness, mutation, and Blind Journey gates pass", async () => {
		const cwd = project();
		try {
			writePassingBaseEvidence(cwd);
			writeTraceImplementation(cwd);
			const { HarnessStore } = await import("../harness/store.ts");
			new HarnessStore(cwd).update("验证命令", "append", "node -e \"process.exit(0)\"");
			const result = await evaluateVerifyEvidenceGateFull(cwd);
			expect(result.ok).toBe(true);
			expect(result.failure).toBeUndefined();
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

});
