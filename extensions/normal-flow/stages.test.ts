import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileStageContracts } from "../xdd/core/stage-contract.ts";
import { NF_STAGES } from "./stages.ts";
import { NF_STAGE_NAMES } from "./types.ts";

describe("Normal Flow stage contracts", () => {
	it("has exactly the 4 NF stages in order, reusing xdd stage names", () => {
		expect(NF_STAGES.map((s) => s.name)).toEqual([...NF_STAGE_NAMES]);
	});

	it("passes compileStageContracts (inputs/outputs/hardGate/rollbackPolicy all populated)", () => {
		expect(() => compileStageContracts(NF_STAGES)).not.toThrow();
	});

	it("design is first and every later stage has an actionable rollback target", () => {
		const design = NF_STAGES.find((s) => s.name === "understand");
		const framework = NF_STAGES.find((s) => s.name === "architecture");
		const scenarios = NF_STAGES.find((s) => s.name === "spec");
		const verify = NF_STAGES.find((s) => s.name === "verify");
		expect(design?.rollbackPolicy?.target).toBe("none");
		expect(framework?.rollbackPolicy?.target).toBe("understand");
		expect(scenarios?.rollbackPolicy?.target).toBe("architecture");
		expect(verify?.rollbackPolicy?.target).toBe("spec");
		expect(NF_STAGES.some((s) => s.name === "plan" || s.name === "execute")).toBe(false);
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
		const framework = NF_STAGES.find((s) => s.name === "architecture");
		expect(framework?.writeScopes).toContain("**");
		const verify = NF_STAGES.find((s) => s.name === "verify");
		expect(verify?.writeScopes).toContain(".xdd/runs/normal_run/verify-report.md");
	});

	it("requires the complete xdd-shaped design chain before framework", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "normal-flow-design-"));
		try {
			const write = (rel: string, body = "complete design evidence ".repeat(8)) => {
				mkdirSync(join(cwd, rel, ".."), { recursive: true });
				writeFileSync(join(cwd, rel), body);
			};
			write(".xdd/design/intent.md"); write(".xdd/design/design.md"); write(".xdd/design/personas/_index.md"); write(".xdd/design/personas/p01-user.md");
			write(".xdd/design/spec/b01/rules.md", "R01 complete business rule ".repeat(8));
			write(".xdd/design/spec/b01/flow.feature", "@covers-R01 Feature: complete\nScenario: happy\nScenario: rejected\n");
			write(".xdd/design/architecture/b01/architecture.md");
			write(".xdd/design/architecture/module-landscape.md"); write(".xdd/design/architecture/event-contract.md");
			write(".xdd/design/architecture/aggregate-landscape.md"); write(".xdd/design/wire/home.md");
			write(".xdd/design/architecture/b01/resilience/failure-modes.md");
			write(".xdd/design/architecture/b01/resilience/failsafe-design.md");
			const design = NF_STAGES.find((stage) => stage.name === "understand")!;
			await expect(design.gate({ cwd, summary: "", desiredState: design.desiredState })).resolves.toMatchObject({
				ok: false,
				reason: expect.stringContaining("resilience-test-plan.md"),
			});
			write(".xdd/design/architecture/b01/resilience/resilience-test-plan.md");
			await expect(design.gate({ cwd, summary: "", desiredState: design.desiredState })).resolves.toMatchObject({ ok: true });
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("lets verify write its report while keeping source modification disabled", () => {
		const verify = NF_STAGES.find((s) => s.name === "verify");
		expect(verify?.allowedTools).toEqual(expect.arrayContaining(["write", "edit"]));
		expect(verify?.noCodeModification).toBe(true);
		expect(verify?.writeScopes).toEqual([".xdd/runs/normal_run/verify-report.md"]);
	});
});

describe("Normal Flow traceability gates", () => {
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
		return cwd;
	}

	it("does not use literal attack words as a substitute for semantic review", async () => {
		const cwd = fixture();
		try {
			writeFileSync(join(cwd, ".xdd", "design", "spec", "b01", "rules.md"), "| ID | Rule |\n| R01 | A request outside the account scope leaves stored state unchanged |\n".repeat(8));
			writeFileSync(join(cwd, ".xdd", "design", "spec", "b01", "flow.feature"), "Feature: traceability @covers-R01\nScenario: an outsider attempts the operation\nThen the prior state remains unchanged\n");
			writeFileSync(join(cwd, "src", "app.ts"), "// @implements R01\nexport const app = true;\n");
			const spec = NF_STAGES.find((stage) => stage.name === "spec")!;
			expect(spec.desiredState.join("\n")).toContain("失败/拒绝");
			await expect(spec.gate({ cwd, summary: "", desiredState: spec.desiredState })).resolves.toMatchObject({ ok: true });
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("rejects scenarios when even one RXX is missing a TDD implementation marker", async () => {
		const cwd = fixture();
		try {
			writeFileSync(join(cwd, "src", "app.ts"), "// @implements R01\nexport const app = true;\n");
			const scenarios = NF_STAGES.find((stage) => stage.name === "spec")!;
			await expect(scenarios.gate({ cwd, summary: "", desiredState: scenarios.desiredState })).resolves.toMatchObject({
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
