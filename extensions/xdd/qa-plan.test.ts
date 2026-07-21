import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evaluateQaEvidenceGate, evaluateQaPlanGate } from "./qa-plan.ts";
import { createQualityMigration } from "./quality-migration.ts";

let cwd: string;
beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "xdd-qa-plan-"));
	mkdirSync(join(cwd, ".xdd/design/spec/auth"), { recursive: true });
	mkdirSync(join(cwd, ".xdd/runs/xdd_run"), { recursive: true });
	writeFileSync(join(cwd, ".xdd/design/spec/auth/login.feature"), "Feature: Login\n  Scenario: valid password\n    Then accepted\n");
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

function validPlan(): string {
	return `# QA Plan
### QA-001
- Category: happy
- Feature: \`auth/login.feature :: Scenario: valid password\`
- Entry: POST /login
- Expected: HTTP 200 and token
- Automation: automated
${["rejection", "boundary", "concurrency", "dependency-failure", "load"].map((category, index) => `### QA-N${index}
- Category: ${category}
- Applicability: not-applicable
- Reason: 当前功能没有该类可执行风险，已记录适用性决策
`).join("\n")}`;
}

describe("QA plan gate", () => {
	it("rejects non-contract category layouts and returns the exact repair template", () => {
		writeFileSync(join(cwd, ".xdd/runs/xdd_run/qa-plan.md"), validPlan().replace("- Category: happy", "Category\nhappy\nR01"));
		const result = evaluateQaPlanGate(cwd);
		expect(result).toMatchObject({ ok: false });
		expect(result.reason).toContain("QA-001.Category：检测到独立值行 `happy`");
		expect(result.reason).toContain("改为 `- Category: happy`");
		expect(result.reason).toContain("修复方向：只修改上述 QA 项的对应字段");
		expect(result.reason).toContain("字段名不可加粗、不可拆成“字段名/值”两行、不可写成表格");
		expect(result.reason).toContain("- Category: happy");
	});

	it("pinpoints every incomplete field and invalid value", () => {
		const broken = validPlan()
			.replace("- Entry: POST /login\n", "")
			.replace("- Expected: HTTP 200 and token\n", "")
			.replace("- Automation: automated", "- Automation: sometimes");
		writeFileSync(join(cwd, ".xdd/runs/xdd_run/qa-plan.md"), broken);
		const result = evaluateQaPlanGate(cwd);
		expect(result.reason).toContain("QA-001.Entry：缺失");
		expect(result.reason).toContain("QA-001.Expected：缺失");
		expect(result.reason).toContain("QA-001.Automation：值 `sometimes` 非法");
	});

	it("rejects duplicate fields instead of silently accepting the first value", () => {
		const broken = validPlan().replace("- Entry: POST /login", "- Entry: generic public API\n- Entry: POST /login");
		writeFileSync(join(cwd, ".xdd/runs/xdd_run/qa-plan.md"), broken);
		const result = evaluateQaPlanGate(cwd);
		expect(result).toMatchObject({ ok: false });
		expect(result.reason).toContain("QA Plan Gate: 测试项字段重复");
		expect(result.reason).toContain("QA-001.Entry：字段重复出现 2 次");
	});

	it("accepts full scenario coverage and explicit six-category applicability decisions", () => {
		writeFileSync(join(cwd, ".xdd/runs/xdd_run/qa-plan.md"), validPlan());
		expect(evaluateQaPlanGate(cwd)).toEqual({ ok: true });
	});

	it("rejects a missing Feature Scenario anchor", () => {
		writeFileSync(join(cwd, ".xdd/runs/xdd_run/qa-plan.md"), validPlan().replace("valid password", "another scenario"));
		const result = evaluateQaPlanGate(cwd);
		expect(result).toMatchObject({ ok: false });
		expect(result.reason).toContain("auth/login.feature :: Scenario: valid password");
		expect(result.reason).toContain("将完整字符串原样写入 `- Feature:`");
	});

	it("does not count a not-applicable case as Feature Scenario coverage", () => {
		const plan = validPlan()
			.replace("- Feature: `auth/login.feature :: Scenario: valid password`\n- Entry: POST /login\n- Expected: HTTP 200 and token\n- Automation: automated", "- Applicability: not-applicable\n- Reason: 当前场景被错误声明为无需执行但理由长度足够")
			.replace("- Applicability: not-applicable\n- Reason: 当前功能没有该类可执行风险，已记录适用性决策", "- Feature: `auth/login.feature :: Scenario: valid password`\n- Applicability: not-applicable\n- Reason: 当前功能没有该类可执行风险，已记录适用性决策");
		writeFileSync(join(cwd, ".xdd/runs/xdd_run/qa-plan.md"), plan);
		expect(evaluateQaPlanGate(cwd)).toMatchObject({ ok: false });
	});

	it("rejects a category omitted without an applicability decision", () => {
		writeFileSync(join(cwd, ".xdd/runs/xdd_run/qa-plan.md"), validPlan().replace(/### QA-N4[\s\S]*$/, ""));
		const result = evaluateQaPlanGate(cwd);
		expect(result).toMatchObject({ ok: false });
		expect(result.reason).toContain("`load` 没有任何测试项或不适用决策");
		expect(result.reason).toContain("- Applicability: not-applicable");
	});

	it("requires PASS evidence for every applicable frozen QA case", () => {
		writeFileSync(join(cwd, ".xdd/runs/xdd_run/qa-plan.md"), validPlan());
		writeFileSync(join(cwd, ".xdd/runs/xdd_run/verify-report.md"), "| QA-001 | PASS ✅ | evidence/http-login.txt |\n");
		expect(evaluateQaEvidenceGate(cwd)).toEqual({ ok: true });
		writeFileSync(join(cwd, ".xdd/runs/xdd_run/verify-report.md"), "QA-001 FAIL\n");
		expect(evaluateQaEvidenceGate(cwd)).toMatchObject({ ok: false });
	});

	it("allows an audited old-run QA freeze waiver but still requires a verify report", () => {
		const plan = ["understand", "spec", "architecture", "wire", "resilience", "plan", "execute", "cleanup", "verify"].map((stageName) => ({ stageName, originalIndex: 0 }));
		writeFileSync(join(cwd, ".xdd/runtime.json"), JSON.stringify({ runId: "old-run", userInput: "legacy", plan, planIndex: 8, qualityPipelineLegacyEligible: true }));
		createQualityMigration(cwd, "owner", "该运行在质量流水线升级之前已经进入最终验证阶段");
		expect(evaluateQaEvidenceGate(cwd)).toMatchObject({ ok: false });
		writeFileSync(join(cwd, ".xdd/runs/xdd_run/verify-report.md"), "legacy verification evidence\n");
		expect(evaluateQaEvidenceGate(cwd)).toMatchObject({ ok: true, soft: true });
	});
});
