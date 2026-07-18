import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "extension.ts"), "utf8");

describe("Normal Flow automatic steering", () => {
	it("steers immediately from a passed submit to nf_advance", () => {
		expect(SRC).toContain('toolName !== "nf_submit_artifact"');
		expect(SRC).toContain('signals.has("complete")');
		expect(SRC).toContain('signals.has("verdict_pass")');
		expect(SRC).toContain('[normal-flow submit steering]');
		expect(SRC).toContain('立即调用 nf_advance 推进');
		expect(SRC).toContain('{ deliverAs: "steer" }');
	});

	it("steers immediately after nf_advance into the next stage control loop", () => {
		expect(SRC).toContain('toolName !== "nf_advance"');
		expect(SRC).toContain('text.includes("进入下一阶段")');
		expect(SRC).toContain('[normal-flow advance steering]');
		expect(SRC).toContain('调用 nf_observe、nf_desired_state、nf_difference');
	});
});
