import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileStageContracts } from "../xdd/core/stage-contract.ts";
import { NF_STAGES } from "./stages.ts";
import { NF_STAGE_NAMES } from "./types.ts";

describe("Normal Flow stage contracts", () => {
	it("has exactly the 5 NF stages in order, reusing xdd stage names", () => {
		expect(NF_STAGES.map((s) => s.name)).toEqual([...NF_STAGE_NAMES]);
	});

	it("passes compileStageContracts (inputs/outputs/hardGate/rollbackPolicy all populated)", () => {
		expect(() => compileStageContracts(NF_STAGES)).not.toThrow();
	});

	it("explore (understand) rolls back to none, not to a nonexistent init stage", () => {
		const explore = NF_STAGES.find((s) => s.name === "understand");
		expect(explore?.rollbackPolicy?.target).toBe("none");
	});

	it("plan rolls back to spec (NF has no architecture/wire/resilience stages)", () => {
		const plan = NF_STAGES.find((s) => s.name === "plan");
		expect(plan?.rollbackPolicy?.target).toBe("spec");
	});

	it("verify rolls back to execute (implement), matching xdd's convention", () => {
		const verify = NF_STAGES.find((s) => s.name === "verify");
		expect(verify?.rollbackPolicy?.target).toBe("execute");
	});

	it("every stage has a non-empty aigateStandard placeholder and does not enable AIGate", () => {
		for (const stage of NF_STAGES) {
			expect(stage.aigateStandard.length).toBeGreaterThan(0);
			expect(stage.aiGate?.enabled).not.toBe(true);
		}
	});

	it("every stage's required outputs are covered by its writeScopes", () => {
		// compileStageContracts() already asserts this and would throw above if
		// violated; this test pins the specific stages most likely to regress.
		const explore = NF_STAGES.find((s) => s.name === "understand");
		expect(explore?.writeScopes).toContain(".xdd/design/**");
		const verify = NF_STAGES.find((s) => s.name === "verify");
		expect(verify?.writeScopes).toContain(".xdd/runs/normal_run/verify-report.md");
	});

	it("lets verify write its report while keeping source modification disabled", () => {
		const verify = NF_STAGES.find((s) => s.name === "verify");
		expect(verify?.allowedTools).toEqual(expect.arrayContaining(["write", "edit"]));
		expect(verify?.noCodeModification).toBe(true);
		// 「真实可用契约」：verify 必须能写 evidence 目录（health-check.txt /
		// wander-report.md / responses/）和 verify-report.md，但不能动源码。
		expect(verify?.writeScopes).toEqual([
			".xdd/runs/normal_run/verify-report.md",
			".xdd/runs/normal_run/evidence/**",
		]);
	});

	it("verify deliverablePaths cover health-check / wander-report / responses (so the evidence gate has a contract anchor)", () => {
		const verify = NF_STAGES.find((s) => s.name === "verify");
		const paths = verify?.deliverablePaths ?? [];
		expect(paths).toContain(".xdd/runs/normal_run/verify-report.md");
		expect(paths).toContain(".xdd/runs/normal_run/evidence/health-check.txt");
		expect(paths).toContain(".xdd/runs/normal_run/evidence/wander-report.md");
		expect(paths.some((p) => p.includes("responses"))).toBe(true);
	});

	it("exposes nf_wander in every stage's allowedTools so plan/execute can capture observations early", () => {
		for (const stage of NF_STAGES) {
			expect(stage.allowedTools).toContain("nf_wander");
		}
	});
});

describe("Normal Flow traceability gates", () => {
	function writePlan(cwd: string): void {
		mkdirSync(join(cwd, ".xdd", "runs", "normal_run"), { recursive: true });
		writeFileSync(
			join(cwd, ".xdd", "runs", "normal_run", "plan.md"),
			[
				"# Plan",
				"## Task 1",
				"**回指 RXX:** R01,R02",
				"**Files:** src/app.ts",
				"**Attack:** 覆盖失败拒绝路径",
				"**Gate:** npm test + trace coverage",
				"- [ ] Step 1: 写失败测试 Expected: FAIL",
				"- [ ] Step 2: 实现 Expected: PASS",
			].join("\n"),
		);
	}

	function writeVerifyReport(cwd: string): void {
		mkdirSync(join(cwd, ".xdd", "runs", "normal_run"), { recursive: true });
		writeFileSync(
			join(cwd, ".xdd", "runs", "normal_run", "verify-report.md"),
			"攻击 Attack 失败假设 P0 P1 证据 spec↔code ".repeat(8),
		);
	}

	function fixture(): string {
		const cwd = mkdtempSync(join(tmpdir(), "normal-flow-gate-"));
		mkdirSync(join(cwd, ".xdd", "design", "spec", "b01"), { recursive: true });
		mkdirSync(join(cwd, "src"), { recursive: true });
		writeFileSync(
			join(cwd, ".xdd", "design", "spec", "b01", "rules.md"),
			"| ID | Rule |\n| R01 | First rule |\n| R02 | Second rule |\n| Attack | 覆盖失败、拒绝、冲突、无权限等反例 |\n".repeat(4),
		);
		writeFileSync(
			join(cwd, ".xdd", "design", "spec", "b01", "flow.feature"),
			"Feature: traceability @covers-R01\nScenario: 成功\nScenario: 失败拒绝\n",
		);
		writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node -e 'process.exit(0)'" } }));
		writePlan(cwd);
		return cwd;
	}

	it("rejects spec without an attack or negative-path contract", async () => {
		const cwd = fixture();
		try {
			writeFileSync(join(cwd, ".xdd", "design", "spec", "b01", "rules.md"), "| ID | Rule |\n| R01 | Only happy path |\n".repeat(8));
			writeFileSync(join(cwd, ".xdd", "design", "spec", "b01", "flow.feature"), "Feature: traceability @covers-R01\nScenario: success\n");
			const spec = NF_STAGES.find((stage) => stage.name === "spec")!;
			await expect(spec.gate({ cwd, summary: "", desiredState: spec.desiredState })).resolves.toMatchObject({
				ok: false,
				reason: expect.stringContaining("攻击"),
			});
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("rejects plan when attack/TDD/Gate coordination fields are missing", async () => {
		const cwd = fixture();
		try {
			writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "plan.md"), "# Plan\n**回指 RXX:** R01\n".repeat(10));
			const plan = NF_STAGES.find((stage) => stage.name === "plan")!;
			await expect(plan.gate({ cwd, summary: "", desiredState: plan.desiredState })).resolves.toMatchObject({
				ok: false,
				reason: expect.stringContaining("Gate"),
			});
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("rejects implement when even one spec RXX is missing an implementation marker", async () => {
		const cwd = fixture();
		try {
			writeFileSync(join(cwd, "src", "app.ts"), "// @implements R01\nexport const app = true;\n");
			const execute = NF_STAGES.find((stage) => stage.name === "execute")!;
			await expect(execute.gate({ cwd, summary: "", desiredState: execute.desiredState })).resolves.toMatchObject({
				ok: false,
				reason: expect.stringContaining("R02"),
			});
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("rejects verify when code has an orphan @implements marker", async () => {
		const cwd = fixture();
		try {
			writeVerifyReport(cwd);
			writeFileSync(join(cwd, "src", "app.ts"), "// @implements R01\n// @implements R02\n// @implements R99\n");
			const verify = NF_STAGES.find((stage) => stage.name === "verify")!;
			await expect(verify.gate({ cwd, summary: "", desiredState: verify.desiredState })).resolves.toMatchObject({
				ok: false,
				reason: expect.stringContaining("R99"),
			});
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
