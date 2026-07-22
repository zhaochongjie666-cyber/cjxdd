import { describe, expect, it } from "vitest";
import { buildSeed, buildStageSystemPrompt } from "./context.ts";
import { STAGES } from "./stages.ts";

describe("TDD workflow injection", () => {
	const stage = (name: "plan" | "execute" | "spec") => STAGES.find((item) => item.name === name)!;

	it.each(["plan", "execute"] as const)("injects the executable TDD contract into the %s prompt and seed", (name) => {
		const current = stage(name);
		const systemPrompt = buildStageSystemPrompt({
			cwd: "/tmp/project",
			stage: current,
			userInput: "build feature",
			skills: [],
			planIndex: name === "plan" ? 6 : 7,
			planTotal: 10,
		});
		const seed = buildSeed(current, "build feature");

		for (const prompt of [systemPrompt, seed]) {
			expect(prompt).toContain("[TDD 强制契约]");
			expect(prompt).toContain("RED");
			expect(prompt).toContain("GREEN");
			expect(prompt).toContain("REFACTOR");
			expect(prompt).toContain("正向与兜底");
			expect(prompt).toContain("回炉");
		}
	});

	it("does not inject implementation TDD instructions into a design-only stage", () => {
		expect(buildSeed(stage("spec"), "build feature")).not.toContain("[TDD 强制契约]");
	});
});
