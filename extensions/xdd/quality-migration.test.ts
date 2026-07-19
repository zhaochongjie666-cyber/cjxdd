import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createQualityMigration, evaluateLegacyQualityWaiver } from "./quality-migration.ts";
import { RuntimeStore } from "./storage/runtime-store.ts";

let cwd: string;
beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "xdd-migration-")); mkdirSync(join(cwd, ".xdd"), { recursive: true }); });
afterEach(() => rmSync(cwd, { recursive: true, force: true }));
function runtime(stage: "plan" | "execute" | "verify", legacy = true): void {
	const plan = ["understand", "spec", "architecture", "wire", "resilience", "plan", "execute", "cleanup", "verify"].map((stageName) => ({ stageName, originalIndex: 0 }));
	writeFileSync(join(cwd, ".xdd/runtime.json"), JSON.stringify({ runId: "old-run", userInput: "ship feature", plan, planIndex: plan.findIndex((item) => item.stageName === stage), qualityPipelineLegacyEligible: legacy, ...(legacy ? {} : { qualityPipelineVersion: 1 }) }));
}

describe("legacy quality pipeline migration", () => {
	it("waives only requirements that predate the detected stage", () => {
		runtime("verify");
		const manifest = createQualityMigration(cwd, "owner", "该运行由质量流水线升级前启动且已经完成实现阶段", "2026-01-01T00:00:00Z");
		expect(manifest.waivers).toContain("frozen-qa-plan");
		expect(evaluateLegacyQualityWaiver(cwd, "review:execute")).toBe(true);
		expect(evaluateLegacyQualityWaiver(cwd, "review:verify")).toBe(false);
	});

	it("never lets a new run claim a legacy waiver", () => {
		runtime("verify", false);
		expect(() => createQualityMigration(cwd, "owner", "试图绕过新版运行应当生成的质量工件和独立审查", "2026-01-01T00:00:00Z")).toThrow(/不允许/);
	});

	it("remains eligible after RuntimeStore loads and saves an old runtime with new defaults", () => {
		runtime("verify");
		const store = new RuntimeStore(cwd);
		const loaded = store.load({ qualityPipelineVersion: 1, qualityPipelineLegacyEligible: false })!;
		expect(loaded.qualityPipelineLegacyEligible).toBe(true);
		store.save(loaded);
		expect(createQualityMigration(cwd, "owner", "该运行确实由新版质量流水线上线之前创建并推进至验证").waivers).toContain("frozen-qa-plan");
	});

	it("does not waive QA while the old run can still produce it in plan", () => {
		runtime("plan");
		expect(() => createQualityMigration(cwd, "owner", "旧运行仍在计划阶段因此必须正常生成冻结质量计划", "2026-01-01T00:00:00Z")).toThrow(/越过 plan/);
	});
});
