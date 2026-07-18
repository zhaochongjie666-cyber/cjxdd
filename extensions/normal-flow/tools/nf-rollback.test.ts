import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "nf-rollback.ts"), "utf8");

describe("nf_rollback source contract", () => {
	it("allows cross-stage flow self-heal only from verify", () => {
		expect(SRC).toContain('if (from !== "verify")');
		expect(SRC).toContain("Normal Flow 只允许 verify 阶段跨流程回退自愈");
		expect(SRC).toContain('verify: "execute"');
		expect(SRC).toContain("可显式回 understand/spec/plan 修正设计或计划");
		expect(SRC).not.toContain('execute: "plan"');
		expect(SRC).not.toContain('plan: "spec"');
		expect(SRC).not.toContain('spec: "understand"');
	});
});
