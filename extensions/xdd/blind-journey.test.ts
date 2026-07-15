import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	parseFeatureFile,
	findScenario,
	buildSituation,
	buildGoal,
	buildActorPrompt,
	buildJudgePrompt,
	journeyReportPath,
	resultsFilePath,
	createReportSkeleton,
	recordResult,
	readResults,
	generateCoverageReport,
	computeOverallVerdict,
} from "./blind-journey.ts";
import { requireBlindJourneyReports } from "./gate.ts";
import type { XddBlindJourneyResult } from "./types.ts";

let dirCounter = 0;
function tmpCwd(): string {
	return mkdtempSync(join(tmpdir(), `xdd-bj-test-${Date.now()}-${dirCounter++}-`));
}

const SAMPLE_FEATURE = `Feature: 任务分配
  作为项目管理员
  我想要分配任务给标注员

  @AC-01
  Scenario: 项目管理员将待分配任务分配给标注员
    Given 小李是 PROJECT-100 的项目管理员
    And TASK-1024 处于"待分配"状态
    When 小李将 TASK-1024 分配给小王
    Then TASK-1024 的状态应变为"进行中"
    And TASK-1024 的负责人应为小王

  @AC-02
  Scenario: 无权限用户不能分配任务
    Given 小张是其他项目的管理员
    When 小张尝试分配 TASK-1024
    Then 操作被拒绝
`;

describe("parseFeatureFile", () => {
	it("parses scenarios with Given/When/Then split", () => {
		const cwd = tmpCwd();
		const fp = join(cwd, "test.feature");
		writeFileSync(fp, SAMPLE_FEATURE, "utf8");
		const { featureName, scenarios } = parseFeatureFile(fp);
		expect(featureName).toBe("任务分配");
		expect(scenarios).toHaveLength(2);

		const s1 = scenarios[0];
		expect(s1.scenarioName).toBe("项目管理员将待分配任务分配给标注员");
		expect(s1.tags).toContain("@AC-01");
		expect(s1.given).toHaveLength(2);
		expect(s1.given[0]).toContain("小李");
		expect(s1.when).toHaveLength(1);
		expect(s1.when[0]).toContain("分配");
		expect(s1.then).toHaveLength(2);
		expect(s1.then[0]).toContain("进行中");
	});

	it("finds scenario by tag ID", () => {
		const cwd = tmpCwd();
		const fp = join(cwd, "test.feature");
		writeFileSync(fp, SAMPLE_FEATURE, "utf8");
		const { scenarios } = parseFeatureFile(fp);
		const found = findScenario(scenarios, "AC-02");
		expect(found?.scenarioName).toContain("无权限");
	});
});

describe("buildActorPrompt", () => {
	it("does NOT include Then steps (actor isolation)", () => {
		const prompt = buildActorPrompt({
			roleDef: "项目管理员小李",
			situation: "TASK-1024 处于待分配状态",
			goal: "将 TASK-1024 分配给小王",
			entryUrl: "https://preview.example.com",
			reportPath: "/tmp/report.md",
		});
		expect(prompt).toContain("项目管理员小李");
		expect(prompt).toContain("TASK-1024");
		expect(prompt).toContain("https://preview.example.com");
		// Must NOT contain Then keywords (actor must not know expected results)
		expect(prompt).not.toContain("进行中");
		expect(prompt).not.toContain("状态应变为");
	});
});

describe("buildJudgePrompt", () => {
	it("includes full Feature content", () => {
		const prompt = buildJudgePrompt({
			featureContent: SAMPLE_FEATURE,
			journeyReportPath: "/tmp/journey.md",
			resultReportPath: "/tmp/judge.md",
		});
		expect(prompt).toContain("Feature: 任务分配");
		expect(prompt).toContain("进行中"); // Judge sees Then clauses
		expect(prompt).toContain("PASS_WITH_FRICTION");
		expect(prompt).toContain("BLOCKED");
	});
});

describe("recordResult and readResults", () => {
	it("records and reads back results", () => {
		const cwd = tmpCwd();
		const result: XddBlindJourneyResult = {
			scenarioId: "AC-01",
			featurePath: "test.feature",
			roleId: "project_admin",
			roleName: "项目管理员",
			verdict: "PASS",
			severity: null,
			confidence: "High",
			issues: [],
			evidencePaths: ["screenshot-01.png"],
			reportPath: "journeys/project_admin_AC-01.md",
			at: new Date().toISOString(),
		};
		recordResult(cwd, result);
		const read = readResults(cwd);
		expect(read).toHaveLength(1);
		expect(read[0].verdict).toBe("PASS");
		expect(read[0].roleId).toBe("project_admin");
	});

	it("updates existing result on re-record", () => {
		const cwd = tmpCwd();
		const r1: XddBlindJourneyResult = {
			scenarioId: "AC-01", featurePath: "", roleId: "admin", roleName: "Admin",
			verdict: "BLOCKED", severity: null, confidence: "Low", issues: [], evidencePaths: [], reportPath: "", at: "",
		};
		recordResult(cwd, r1);
		const r2: XddBlindJourneyResult = { ...r1, verdict: "PASS", confidence: "High" };
		recordResult(cwd, r2);
		const read = readResults(cwd);
		expect(read).toHaveLength(1);
		expect(read[0].verdict).toBe("PASS");
	});
});

describe("computeOverallVerdict", () => {
	it("returns pending when no results", () => {
		const cwd = tmpCwd();
		expect(computeOverallVerdict(cwd)).toBe("pending");
	});

	it("returns fail when any FAIL verdict", () => {
		const cwd = tmpCwd();
		recordResult(cwd, {
			scenarioId: "AC-01", featurePath: "", roleId: "admin", roleName: "Admin",
			verdict: "PASS", severity: null, confidence: "High", issues: [], evidencePaths: [], reportPath: "", at: "",
		});
		recordResult(cwd, {
			scenarioId: "AC-02", featurePath: "", roleId: "admin", roleName: "Admin",
			verdict: "FAIL", severity: "P1", confidence: "High", issues: [], evidencePaths: [], reportPath: "", at: "",
		});
		expect(computeOverallVerdict(cwd)).toBe("fail");
	});

	it("returns fail when P0 issue exists", () => {
		const cwd = tmpCwd();
		recordResult(cwd, {
			scenarioId: "AC-01", featurePath: "", roleId: "admin", roleName: "Admin",
			verdict: "PASS_WITH_FRICTION", severity: "P0", confidence: "High",
			issues: [{ id: "UX-001", severity: "P0", role: "admin", location: "page", expected: "e", actual: "a", impact: "i", evidence: [] }],
			evidencePaths: [], reportPath: "", at: "",
		});
		expect(computeOverallVerdict(cwd)).toBe("fail");
	});

	it("returns pass when all PASS", () => {
		const cwd = tmpCwd();
		recordResult(cwd, {
			scenarioId: "AC-01", featurePath: "", roleId: "admin", roleName: "Admin",
			verdict: "PASS", severity: null, confidence: "High", issues: [], evidencePaths: [], reportPath: "", at: "",
		});
		expect(computeOverallVerdict(cwd)).toBe("pass");
	});
});

describe("generateCoverageReport", () => {
	it("generates a markdown table", () => {
		const cwd = tmpCwd();
		recordResult(cwd, {
			scenarioId: "AC-01", featurePath: "", roleId: "admin", roleName: "管理员",
			verdict: "PASS", severity: null, confidence: "High", issues: [], evidencePaths: [], reportPath: "", at: "",
		});
		recordResult(cwd, {
			scenarioId: "AC-02", featurePath: "", roleId: "annotator", roleName: "标注员",
			verdict: "PASS_WITH_FRICTION", severity: "P2", confidence: "Medium",
			issues: [{ id: "UX-001", severity: "P2", role: "annotator", location: "page", expected: "e", actual: "a", impact: "i", evidence: [] }],
			evidencePaths: [], reportPath: "", at: "",
		});
		const report = generateCoverageReport(cwd);
		expect(report).toContain("Coverage Report");
		expect(report).toContain("管理员");
		expect(report).toContain("标注员");
		expect(report).toContain("PASS_WITH_FRICTION");
		expect(existsSync(join(cwd, ".xdd", "runs", "iter-1", "blind-journey", "coverage-report.md"))).toBe(true);
	});
});

describe("requireBlindJourneyReports gate", () => {
	it("soft-passes when no roles defined", async () => {
		const cwd = tmpCwd();
		const result = await requireBlindJourneyReports(cwd);
		expect(result.ok).toBe(true);
		expect(result.soft).toBe(true);
	});

	it("fails when roles defined but no results", async () => {
		const cwd = tmpCwd();
		mkdirSync(join(cwd, ".xdd", "runs", "iter-1", "blind-journey", "roles"), { recursive: true });
		writeFileSync(join(cwd, ".xdd", "runs", "iter-1", "blind-journey", "roles", "admin.yaml"), "role_id: admin", "utf8");
		const result = await requireBlindJourneyReports(cwd);
		expect(result.ok).toBe(false);
		expect(result.reason).toContain("无验收结果");
	});

	it("passes when all results are PASS", async () => {
		const cwd = tmpCwd();
		mkdirSync(join(cwd, ".xdd", "runs", "iter-1", "blind-journey", "roles"), { recursive: true });
		writeFileSync(join(cwd, ".xdd", "runs", "iter-1", "blind-journey", "roles", "admin.yaml"), "role_id: admin", "utf8");
		recordResult(cwd, {
			scenarioId: "AC-01", featurePath: "", roleId: "admin", roleName: "Admin",
			verdict: "PASS", severity: null, confidence: "High", issues: [], evidencePaths: [], reportPath: "", at: "",
		});
		const result = await requireBlindJourneyReports(cwd);
		expect(result.ok).toBe(true);
	});

	it("fails when any P0 issue", async () => {
		const cwd = tmpCwd();
		mkdirSync(join(cwd, ".xdd", "runs", "iter-1", "blind-journey", "roles"), { recursive: true });
		writeFileSync(join(cwd, ".xdd", "runs", "iter-1", "blind-journey", "roles", "admin.yaml"), "role_id: admin", "utf8");
		recordResult(cwd, {
			scenarioId: "AC-01", featurePath: "", roleId: "admin", roleName: "Admin",
			verdict: "PASS_WITH_FRICTION", severity: "P0", confidence: "High",
			issues: [{ id: "UX-001", severity: "P0", role: "admin", location: "page", expected: "e", actual: "越权访问", impact: "i", evidence: [] }],
			evidencePaths: [], reportPath: "", at: "",
		});
		const result = await requireBlindJourneyReports(cwd);
		expect(result.ok).toBe(false);
		expect(result.reason).toContain("P0");
	});

	it("fails when any BLOCKED verdict", async () => {
		const cwd = tmpCwd();
		mkdirSync(join(cwd, ".xdd", "runs", "iter-1", "blind-journey", "roles"), { recursive: true });
		writeFileSync(join(cwd, ".xdd", "runs", "iter-1", "blind-journey", "roles", "admin.yaml"), "role_id: admin", "utf8");
		recordResult(cwd, {
			scenarioId: "AC-01", featurePath: "", roleId: "admin", roleName: "Admin",
			verdict: "BLOCKED", severity: null, confidence: "Low", issues: [], evidencePaths: [], reportPath: "", at: "",
		});
		const result = await requireBlindJourneyReports(cwd);
		expect(result.ok).toBe(false);
		expect(result.reason).toContain("BLOCKED");
	});
});
