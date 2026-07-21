import { describe, expect, it } from "vitest";
import { compileStageContracts, scopeCoversPattern, StageContractError } from "./stage-contract.ts";
import { STAGES } from "../stages.ts";
import type { XddStageSpec } from "../types.ts";

const clone = (stage: XddStageSpec): XddStageSpec => ({
	...stage,
	inputs: [...(stage.inputs ?? [])],
	outputs: [...(stage.outputs ?? [])],
	readScopes: [...(stage.readScopes ?? [])],
	writeScopes: [...(stage.writeScopes ?? [])],
	aiGate: stage.aiGate ? {
		...stage.aiGate,
		requiredAngles: [...stage.aiGate.requiredAngles],
		artifactPatterns: [...stage.aiGate.artifactPatterns],
		contextPatterns: [...stage.aiGate.contextPatterns],
	} : undefined,
	rollbackPolicy: stage.rollbackPolicy ? { ...stage.rollbackPolicy } : undefined,
});

describe("compileStageContracts", () => {
	it("compiles the built-in 10-stage contract set", () => {
		const compiled = compileStageContracts(STAGES);
		expect(compiled).toHaveLength(10);
		expect(compiled.map((stage) => stage.name)).toEqual([
			"init", "understand", "spec", "architecture", "wire", "resilience", "plan", "execute", "cleanup", "verify",
		]);
	});

	it("keeps plan output directly under the fixed xdd run directory", () => {
		const plan = compileStageContracts(STAGES).find((stage) => stage.name === "plan");
		expect(plan?.outputs?.map((rule) => rule.pattern)).toEqual([
			".xdd/runs/xdd_run/plan.md",
			".xdd/runs/xdd_run/qa-plan.md",
		]);
		expect(plan?.writeScopes).toEqual([".xdd/runs/xdd_run/plan.md", ".xdd/runs/xdd_run/qa-plan.md"]);
		expect(plan?.desiredState.join("\n")).toContain("- Category: happy");
		expect(plan?.desiredState.join("\n")).toContain("字段名和值必须同处一行");
		expect(plan?.desiredState.join("\n")).toContain("失败/拒绝/依赖不可用任务或处理");
		expect(plan?.desiredState.join("\n")).toContain("可执行重规划动作");
		expect(plan?.aigateStandard).toContain("过度设计");
		expect(plan?.aigateStandard).toContain("可观察完成证据");
		expect(plan?.aigateStandard).toContain("依赖不可用路径");
	});

	it("rejects required outputs not covered by writeScopes", () => {
		const stages = STAGES.map(clone);
		const spec = stages.find((stage) => stage.name === "spec") as XddStageSpec;
		spec.writeScopes = [".xdd/design/architecture/**"];
		expect(() => compileStageContracts(stages)).toThrow(StageContractError);
		try {
			compileStageContracts(stages);
		} catch (error) {
			expect(String(error)).toContain("stage=spec");
			expect(String(error)).toContain("必需输出没有被 writeScopes 覆盖");
		}
	});

	it("rejects every Gate that has no paired positive-development desired state", () => {
		const stages = STAGES.map(clone);
		const architecture = stages.find((stage) => stage.name === "architecture") as XddStageSpec;
		architecture.desiredState = [];
		expect(() => compileStageContracts(stages)).toThrow(/Gate 没有配对非空的正向开发目标/);
	});

	it("rejects rollback targets that are not earlier than the current stage", () => {
		const stages = STAGES.map(clone);
		const verify = stages.find((stage) => stage.name === "verify") as XddStageSpec;
		verify.rollbackPolicy = { target: "verify", reason: "bad self rollback" };
		expect(() => compileStageContracts(stages)).toThrow(/rollback target/);
	});

	it("rejects AI Gate artifact drift", () => {
		const stages = STAGES.map(clone);
		const architecture = stages.find((stage) => stage.name === "architecture") as XddStageSpec;
		architecture.aiGate = {
			...(architecture.aiGate as NonNullable<XddStageSpec["aiGate"]>),
			artifactPatterns: [".xdd/design/spec/**/rules.md"],
			contextPatterns: [],
		};
		expect(() => compileStageContracts(stages)).toThrow(/aiGate\.artifactPatterns/);
	});

	it("uses the shared glob matcher for recursive scope coverage", () => {
		expect(scopeCoversPattern(".xdd/design/**", ".xdd/design/spec/**/rules.md")).toBe(true);
		expect(scopeCoversPattern(".xdd/runs/**/evidence/**", ".xdd/runs/*/verify-report.md")).toBe(false);
	});
});
