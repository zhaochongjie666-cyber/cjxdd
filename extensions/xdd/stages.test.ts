import { describe, expect, it } from "vitest";
import { STAGES } from "./stages.ts";

describe("run-level self-attack", () => {
	it("does not make self-attack a design-stage desired-state item", () => {
		const designStages = ["understand", "spec", "architecture", "wire", "resilience"];
		for (const name of designStages) {
			const stage = STAGES.find((candidate) => candidate.name === name);
			expect(stage).toBeDefined();
			expect(stage!.desiredState.join("\n")).not.toContain("自我攻击");
		}
	});
});
