import { describe, it, expect } from "vitest";
import { findStageGroup, isLastStageInGroup, STAGE_GROUPS } from "./stage-groups.ts";

describe("STAGE_GROUPS", () => {
	it("has 4 groups", () => {
		expect(STAGE_GROUPS).toHaveLength(4);
	});

	it("covers all 10 stages without overlap", () => {
		const allStages = STAGE_GROUPS.flatMap((g) => g.stages);
		expect(allStages).toHaveLength(10);
		expect(new Set(allStages).size).toBe(10);
	});

	it("has rollback targets that are group first stage", () => {
		for (const g of STAGE_GROUPS) {
			expect(g.stages[0]).toBe(g.rollbackTarget);
		}
	});
});

describe("findStageGroup", () => {
	it("finds discovery group for spec", () => {
		expect(findStageGroup("spec")?.name).toBe("discovery");
	});

	it("finds architecture group for wire", () => {
		expect(findStageGroup("wire")?.name).toBe("architecture");
	});

	it("finds architecture group for resilience", () => {
		expect(findStageGroup("resilience")?.name).toBe("architecture");
	});

	it("finds implementation group for execute", () => {
		expect(findStageGroup("execute")?.name).toBe("implementation");
	});

	it("finds verification group for verify", () => {
		expect(findStageGroup("verify")?.name).toBe("verification");
	});
});

describe("isLastStageInGroup", () => {
	it("returns true for resilience (last in architecture)", () => {
		expect(isLastStageInGroup("resilience")).toBe(true);
	});

	it("returns false for wire (not last in architecture, resilience is)", () => {
		expect(isLastStageInGroup("wire")).toBe(false);
	});

	it("returns true for cleanup (last in implementation)", () => {
		expect(isLastStageInGroup("cleanup")).toBe(true);
	});

	it("returns true for verify (last in verification)", () => {
		expect(isLastStageInGroup("verify")).toBe(true);
	});

	it("returns true for spec (last in discovery)", () => {
		expect(isLastStageInGroup("spec")).toBe(true);
	});

	it("returns false for init (not last in discovery)", () => {
		expect(isLastStageInGroup("init")).toBe(false);
	});
});
