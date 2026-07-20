import { describe, expect, it } from "vitest";
import { buildSeed } from "./context.ts";
import { STAGES } from "./stages.ts";

describe("Gate positive-development pairing", () => {
	it.each(STAGES.map((stage) => [stage.name, stage] as const))("tells AI to develop before the %s Gate", (_name, stage) => {
		const seed = buildSeed(stage, "test goal");
		expect(seed).toContain("先按 desiredState 和阶段 skill 做完正向开发与自检");
		expect(seed).toContain("未修改产物时禁止原样重提");
		expect(seed).toContain("finding 指向的修复");
	});
});
